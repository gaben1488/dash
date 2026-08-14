import type { FastifyInstance } from 'fastify';
import {
  DEPARTMENTS,
  COL_LETTER_INDEX,
  DEPT_COLUMNS,
  DEPT_HEADER_LABELS,
  DEPT_HEADER_ROWS,
  FACT_DATE_PLACEHOLDERS,
  buildCellDict,
  isMetaRow,
  isOrgItself,
} from '@aemr/shared';
import { writeCellValue, resolveDeptSheetName } from '../services/google-sheets.js';
import { getSnapshot, getDeptSheetValues, getDeptSheetCache, setDeptSheetCache } from '../services/snapshot.js';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { db, schema } from '../db/index.js';
import { detectSignals, classifyRowState, getSignalBadges, applyTextNormalization } from '@aemr/core';
import { readDeptRows } from '../services/rows-read.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';
import {
  parseYearFilter,
  applySearchFilter,
  applyTypeFilter,
  applySubordinateFilter,
  applyActivityFilter,
  applyStateFilter,
  applyYearFilter,
  sortRows,
  paginateRows,
} from '../services/rows-filters.js';

/**
 * Буква колонки → подпись из живой шапки книги ГРБС.
 *
 * Почему: «колонка K» — внутреннее обозначение, оно ничего не объясняет тому,
 * кто правит таблицу; в своей книге он видит подпись «ИТОГО 1». Буква остаётся
 * только внутри адреса ячейки («K1481») — так адресуют ячейки сами таблицы.
 * Подписи не изобретаются здесь: берутся из DEPT_HEADER_LABELS (@aemr/shared),
 * которые сверены с реальной шапкой стражем column-map.test.ts.
 */
const COLUMN_KEY_BY_INDEX = new Map<number, keyof typeof DEPT_COLUMNS>(
  (Object.entries(DEPT_COLUMNS) as Array<[keyof typeof DEPT_COLUMNS, number]>)
    .map(([key, index]) => [index, key]),
);

function columnTitle(letter: string): string {
  const index = COL_LETTER_INDEX[letter];
  if (index === undefined) return letter;
  const key = COLUMN_KEY_BY_INDEX.get(index);
  return key ? DEPT_HEADER_LABELS[key] : letter;
}

/**
 * Причина недоступности книги управления — человеческой фразой с действием.
 * Одно место на все роуты чтения: пользователь должен понять, к кому идти
 * (доступ к книге) или что нажать (обновление данных), а не увидеть «unavailable».
 */
function sourceUnavailableMessage(deptShortName: string, reason: 'read-error' | 'no-source'): string {
  return reason === 'read-error'
    ? `Книга управления «${deptShortName}» не прочитана — проверьте доступ к таблице и обновите данные`
    : `Для управления «${deptShortName}» не указана книга — задайте адрес таблицы в разделе «Источники» и обновите данные`;
}

/**
 * Единственная проверка адресуемости строки перед записью в живую таблицу.
 * Возвращает текст ошибки или null, если писать можно.
 *
 * Нижняя граница: строка 1 — заголовок. Верхняя: строка обязана существовать в листе
 * (иначе writeCellValue создаст ячейку за пределами данных и побьёт итоговые формулы,
 * а кэш этого не заметит — values[idx-1] просто undefined).
 * Кэша нет — писать вслепую нельзя: сначала обновить снимок.
 */
function rowWriteError(idx: number, deptShortName: string, display: string | number = idx): string | null {
  if (!Number.isInteger(idx) || idx < 2) return `Номер строки «${display}» не подходит: строки данных начинаются со второй`;
  const rowCount = getDeptSheetValues()[deptShortName]?.length ?? 0;
  if (rowCount === 0) return `Книга управления «${deptShortName}» ещё не прочитана — обновите данные и повторите правку`;
  if (idx > rowCount) return `Строки ${idx} в книге управления «${deptShortName}» нет — сейчас там ${rowCount} строк. Обновите данные, если таблицу дополнили`;
  return null;
}

/**
 * Маршруты для работы со строковыми данными закупок.
 *
 * Обеспечивает:
 * - Чтение строк с вычисленными сигналами
 * - Безопасную запись полей (с валидацией + нормализацией + аудит-лог)
 * - Сверку СВОД vs расчёт
 */
export async function rowsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/rows/:deptId
   * Получить все строки закупок отдела с сигналами.
   *
   * Query params:
   *   - type: 'all' | 'competitive' | 'single' — тип закупки
   *   - state: RowState — фильтр по состоянию
   *   - search: string — поиск по предмету
   *   - page: number — страница (default 1)
   *   - limit: number — строк на странице (default 25)
   *   - sort: string — колонка сортировки
   *   - order: 'asc' | 'desc'
   */
  app.get('/api/rows/:deptId', async (request, reply) => {
    const { deptId } = request.params as { deptId: string };
    const query = request.query as Record<string, string>;

    // Accept both English IDs ('uer') and Russian short names ('УЭР')
    const dept = DEPARTMENTS.find(d => d.id === deptId || d.nameShort === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Управление «${deptId}» не найдено` });
    }

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(1000, Math.max(1, parseInt(query.limit || '25', 10)));
    const searchTerm = (query.search ?? '').trim().toLowerCase();
    const filterType = query.type ?? 'all'; // 'all' | 'competitive' | 'single'
    const filterState = query.state ?? '';   // RowState or empty
    const filterSubordinate = (query.subordinate ?? '').trim().toLowerCase();
    const filterActivity = (query.activity ?? '').trim().toLowerCase();
    const yearFilter = parseYearFilter(query.year);
    const sortCol = query.sort ?? '';
    const sortOrder: 'asc' | 'desc' = query.order === 'desc' ? 'desc' : 'asc';

    // Чтение строк — каскад cache-first в rows-read (кэш → СВОД → книга управления)
    const read = await readDeptRows(dept);
    if (!read.ok) {
      if (read.reason === 'read-error') {
        app.log.error(`Ошибка чтения таблицы управления "${dept.nameShort}": ${read.error}`);
      } else {
        app.log.error(`Нет данных для отдела "${dept.nameShort}" и нет spreadsheetId`);
      }
      return reply.status(503).send({ error: sourceUnavailableMessage(dept.nameShort, read.reason) });
    }

    // Строки листа (без шапки) → DTO с сигналами, отсев не-данных — rows-dto
    const processedRows = read.values
      .slice(DEPT_HEADER_ROWS)
      .map((row, idx) => buildRowDto(row as unknown[], idx, { deptId: dept.id }))
      .filter(isDataRow);

    // Query-фильтры — rows-filters (пустой параметр = всё проходит)
    let filtered = applySearchFilter(processedRows, searchTerm);
    filtered = applyTypeFilter(filtered, filterType);
    filtered = applySubordinateFilter(filtered, filterSubordinate);
    filtered = applyActivityFilter(filtered, filterActivity);
    filtered = applyStateFilter(filtered, filterState);
    filtered = applyYearFilter(filtered, yearFilter);

    // Сводка по сигналам (до пагинации, после фильтров)
    const signalSummary = {
      signed: filtered.filter(r => r.state === 'signed').length,
      overdue: filtered.filter(r => r.state === 'overdue').length,
      planning: filtered.filter(r => r.state === 'planning').length,
      canceled: filtered.filter(r => r.state === 'canceled').length,
      hasFact: filtered.filter(r => r.state === 'has-fact').length,
      total: filtered.length,
    };

    const sorted = sortRows(filtered, sortCol, sortOrder);
    const { pageRows, total, totalPages } = paginateRows(sorted, page, limit);

    return reply.send({
      department: dept,
      rows: pageRows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      signals: signalSummary,
    });
  });

  /**
   * GET /api/rows/:deptId/:rowIndex
   * Получить одну строку с полной детализацией сигналов.
   */
  app.get('/api/rows/:deptId/:rowIndex', async (request, reply) => {
    const { deptId, rowIndex } = request.params as { deptId: string; rowIndex: string };
    const idx = parseInt(rowIndex, 10);

    const dept = DEPARTMENTS.find(d => d.id === deptId || d.nameShort === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Управление «${deptId}» не найдено` });
    }

    // Чтение строк — каскад cache-first в rows-read (кэш → СВОД → книга управления)
    const read = await readDeptRows(dept);
    if (!read.ok) {
      if (read.reason === 'read-error') {
        app.log.error(`Ошибка чтения таблицы управления "${dept.nameShort}": ${read.error}`);
      } else {
        app.log.error(`Нет данных для отдела "${dept.nameShort}" и нет spreadsheetId`);
      }
      return reply.status(503).send({ error: sourceUnavailableMessage(dept.nameShort, read.reason) });
    }
    const rawRows = read.values;

    // Validate row index (idx is 1-based sheet row; row 1 = header, data starts at row 2)
    // rawRows[0] = header, rawRows[idx - 1] = requested row.
    // Нечисловой номер (`/api/rows/uo/abc`) даёт NaN — обе проверки ниже его
    // пропускали бы как «строка найдена», поэтому названа отдельной причиной.
    if (!Number.isInteger(idx)) {
      return reply.status(400).send({ error: `Номер строки «${rowIndex}» не похож на число` });
    }
    if (idx < 2 || idx - 1 >= rawRows.length) {
      return reply.status(404).send({
        error: `Строки ${idx} в книге управления «${dept.nameShort}» нет — сейчас там ${rawRows.length} строк`,
      });
    }

    const row = rawRows[idx - 1];

    const cells = buildCellDict(row as unknown[]);

    const signals = detectSignals(cells);
    const state = classifyRowState(signals);
    const badges = getSignalBadges(signals);

    // Build Google Sheets source URL
    const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort] ?? config.google.spreadsheetId;
    const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=A${idx}`;

    return reply.send({
      department: dept,
      rowIndex: idx,
      cells,
      signals,
      state,
      badges,
      sourceUrl,
    });
  });

  /**
   * PUT /api/rows/:deptId/:rowIndex/field
   * Безопасная запись поля в Google Таблицу.
   *
   * Процесс: валидация → нормализация → запись → лог
   *
   * Body: { field: string, value: unknown }
   *
   * Формульные колонки (K, O, P, R, S, T, Y, Z, AA, AB, AC) — ЗАБЛОКИРОВАНЫ.
   * Итоговые строки — ЗАБЛОКИРОВАНЫ.
   */
  // E11-3: вынести в rows-write service (живой критичный путь записи — не разрезан в E11-2)
  app.put('/api/rows/:deptId/:rowIndex/field', async (request, reply) => {
    const { deptId, rowIndex } = request.params as { deptId: string; rowIndex: string };
    const body = request.body as { field?: string; value?: unknown };
    const idx = parseInt(rowIndex, 10);

    if (!body.field || body.value === undefined) {
      return reply.status(400).send({ error: 'Не указано, какой столбец и какое значение сохранять' });
    }

    const dept = DEPARTMENTS.find(d => d.id === deptId || d.nameShort === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Управление «${deptId}» не найдено` });
    }

    // Блокировка формульных колонок
    const FORMULA_COLUMNS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'];
    if (FORMULA_COLUMNS.includes(body.field.toUpperCase())) {
      // Логируем попытку записи в формульную ячейку
      app.log.warn(`Попытка записи в формульную колонку ${body.field} отдела ${deptId} строка ${idx}`);
      return reply.status(403).send({
        error: 'Правка отклонена',
        reason: `Столбец «${columnTitle(body.field.toUpperCase())}» книга считает формулой — значение получается из других столбцов. Измените исходные суммы или даты, итог пересчитается сам`,
      });
    }

    // Column type expectations for validation
    const NUMERIC_COLUMNS = new Set(['H', 'I', 'J', 'V', 'W', 'X']);
    const DATE_COLUMNS = new Set(['N', 'Q']);

    const field = body.field.toUpperCase();

    // SECURITY (C2/H3): field обязан быть РЕАЛЬНОЙ колонкой (COL_LETTER_INDEX), иначе range-injection:
    // field="A5:Z5" пишет значение в ДИАПАЗОН, field="AG"/"ZZ" — в произвольную колонку прод-таблицы
    // (writeCellValue USER_ENTERED → значение с "=" станет живой формулой). Только blacklist FORMULA_COLUMNS недостаточно.
    if (COL_LETTER_INDEX[field] === undefined) {
      // Человеческого имени у несуществующего столбца нет по определению —
      // сырое обозначение уходит в details (техническая подсказка), не в заголовок.
      return reply.status(400).send({
        error: 'Правка отклонена: такого столбца в книге закупок нет',
        details: `запрошенный столбец: ${body.field}`,
      });
    }
    // idx обязан быть integer >= 2 (строка 1 — заголовок) И существовать в листе,
    // иначе cellAddress "GNaN"/"G-1"/header либо запись за пределами данных.
    const boundsError = rowWriteError(idx, dept.nameShort, rowIndex);
    if (boundsError) {
      return reply.status(400).send({ error: boundsError });
    }

    let normalizedValue: unknown = body.value;

    // Type validation and normalization
    if (NUMERIC_COLUMNS.has(field)) {
      const num = typeof body.value === 'number' ? body.value
        : parseFloat(String(body.value).replace(/\s/g, '').replace(/,/g, '.'));
      if (isNaN(num)) {
        return reply.status(400).send({
          error: `Столбец «${columnTitle(field)}» принимает только число — например 1 234,56`,
          field,
          received: body.value,
        });
      }
      normalizedValue = num;
    } else if (DATE_COLUMNS.has(field)) {
      // Accept DD.MM.YYYY or ISO format
      const str = String(body.value).trim();
      const ddmmyyyy = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!ddmmyyyy && !iso && str !== '') {
        return reply.status(400).send({
          error: `Столбец «${columnTitle(field)}» принимает дату в виде ДД.ММ.ГГГГ — например 15.03.2026`,
          field,
          received: body.value,
        });
      }
      normalizedValue = str;
    }
    // TEXT_COLUMNS: accept any string value

    // Determine spreadsheet and sheet name
    const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
    if (!spreadsheetId) {
      return reply.status(503).send({ error: sourceUnavailableMessage(dept.nameShort, 'no-source') });
    }

    // РЕАЛЬНОЕ имя вкладки книги (кандидаты «ВСЕ»/«Все»/имя по метаданным) —
    // статичное имя из реестра могло не существовать → запись в никуда.
    const sheetName = await resolveDeptSheetName(dept.nameShort, spreadsheetId);

    const cellAddress = `${field}${idx}`;
    const now = new Date().toISOString();

    try {
      const result = await writeCellValue(spreadsheetId, sheetName, cellAddress, normalizedValue);

      // Invalidate cache for this dept so next read picks up the change
      const fullCache = getDeptSheetCache();
      const deptResult = fullCache[dept.nameShort];
      if (deptResult) {
        // Update the cached row in-place (values array)
        const colIdx = COL_LETTER_INDEX[field];
        if (colIdx !== undefined && deptResult.values[idx - 1]) {
          (deptResult.values[idx - 1] as unknown[])[colIdx] = normalizedValue;
          setDeptSheetCache({ ...fullCache });
        }
      }

      // Audit log
      try {
        db.insert(schema.auditLog).values({
          action: 'cell_edit',
          entity: 'row',
          entityId: `${deptId}:${idx}:${field}`,
          details: JSON.stringify({
            department: deptId,
            row: idx,
            field,
            oldValue: null, // Would need pre-read for old value
            newValue: normalizedValue,
            sheetRange: result.updatedRange,
          }),
          timestamp: now,
        }).run();
      } catch (logErr) {
        app.log.warn({ logErr }, 'field-update: failed to write audit log');
      }

      return reply.send({
        success: true,
        department: deptId,
        rowIndex: idx,
        field,
        originalValue: body.value,
        normalizedValue,
        updatedRange: result.updatedRange,
        message: 'Значение сохранено в Google Таблице',
      });
    } catch (err: any) {
      app.log.error({ err }, `field-update: failed to write ${cellAddress} for ${deptId}`);

      // Отказ по правам доступа отделён от прочих: действие пользователя разное —
      // тут идти к владельцу книги, там просто повторить.
      if (err.message?.includes('readonly') || err.code === 403) {
        return reply.status(403).send({
          error: `Нет прав на запись в книгу управления «${dept.nameShort}»`,
          reason: 'Учётной записи сервиса выдан доступ только на чтение. Откройте доступ на редактирование книги и повторите правку',
          details: err.message,
        });
      }

      // 503, а не 500: отказала внешняя книга, а не расчёт продукта —
      // тот же код, что у чтения недоступного источника выше.
      return reply.status(503).send({
        error: `Не удалось сохранить значение в ячейку ${cellAddress}`,
        reason: 'Google Таблицы не приняли правку. Повторите через минуту; если повторяется — проверьте доступ к книге',
        details: err.message ?? String(err),
      });
    }
  });

  /**
   * POST /api/data/rows
   * Batch-save edited rows. Each entry specifies department, row index, and
   * a map of column→value changes. All writes are validated, normalized, and
   * logged to audit_log.
   *
   * Body: { rows: Array<{ deptId: string; rowIndex: number; changes: Record<string, unknown> }> }
   */
  // E11-3: вынести в rows-write service (живой критичный путь записи — не разрезан в E11-2)
  app.post('/api/data/rows', async (request, reply) => {
    const body = request.body as {
      rows?: Array<{ deptId: string; rowIndex: number; changes: Record<string, unknown> }>;
    };

    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      return reply.status(400).send({ error: 'Не переданы строки для сохранения' });
    }

    const FORMULA_COLUMNS = new Set(['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC']);
    const NUMERIC_COLUMNS = new Set(['H', 'I', 'J', 'V', 'W', 'X']);
    const DATE_COLUMNS = new Set(['N', 'Q']);

    const results: Array<{
      deptId: string;
      rowIndex: number;
      field: string;
      success: boolean;
      error?: string;
    }> = [];

    const now = new Date().toISOString();

    for (const entry of body.rows) {
      const dept = DEPARTMENTS.find(d => d.id === entry.deptId || d.nameShort === entry.deptId);
      if (!dept) {
        for (const field of Object.keys(entry.changes)) {
          results.push({ deptId: entry.deptId, rowIndex: entry.rowIndex, field, success: false, error: `Управление «${entry.deptId}» не найдено` });
        }
        continue;
      }

      const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
      if (!spreadsheetId) {
        for (const field of Object.keys(entry.changes)) {
          results.push({ deptId: entry.deptId, rowIndex: entry.rowIndex, field, success: false, error: sourceUnavailableMessage(dept.nameShort, 'no-source') });
        }
        continue;
      }

      // Ленивый резолв РЕАЛЬНОГО имени вкладки: только когда есть что писать
      // (после всех валидаций) — невалидные запросы отклоняются без сетевого вызова.
      let sheetName: string | null = null;

      for (const [rawField, rawValue] of Object.entries(entry.changes)) {
        const field = rawField.toUpperCase();

        // SECURITY (C2/H3): field обязан быть реальной колонкой — иначе range-injection.
        if (COL_LETTER_INDEX[field] === undefined) {
          results.push({
            deptId: entry.deptId, rowIndex: entry.rowIndex, field,
            success: false, error: 'Такого столбца в книге закупок нет — правка отклонена',
          });
          continue;
        }

        // Та же граница строки, что и в PUT: строка обязана существовать в листе.
        const boundsError = rowWriteError(entry.rowIndex, dept.nameShort);
        if (boundsError) {
          results.push({
            deptId: entry.deptId, rowIndex: entry.rowIndex, field,
            success: false, error: boundsError,
          });
          continue;
        }

        // Block formula columns
        if (FORMULA_COLUMNS.has(field)) {
          results.push({
            deptId: entry.deptId,
            rowIndex: entry.rowIndex,
            field,
            success: false,
            error: `Столбец «${columnTitle(field)}» книга считает формулой — измените исходные суммы или даты, итог пересчитается сам`,
          });
          continue;
        }

        // Normalize value
        let normalizedValue: unknown = rawValue;
        if (NUMERIC_COLUMNS.has(field)) {
          const num = typeof rawValue === 'number'
            ? rawValue
            : parseFloat(String(rawValue).replace(/\s/g, '').replace(/,/g, '.'));
          if (isNaN(num) && rawValue !== null && rawValue !== '') {
            results.push({
              deptId: entry.deptId,
              rowIndex: entry.rowIndex,
              field,
              success: false,
              error: `Столбец «${columnTitle(field)}» принимает только число — например 1 234,56`,
            });
            continue;
          }
          normalizedValue = isNaN(num) ? null : num;
        } else if (DATE_COLUMNS.has(field)) {
          const str = String(rawValue ?? '').trim();
          if (str && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(str) && !/^\d{4}-\d{2}-\d{2}/.test(str)) {
            results.push({
              deptId: entry.deptId,
              rowIndex: entry.rowIndex,
              field,
              success: false,
              error: `Столбец «${columnTitle(field)}» принимает дату в виде ДД.ММ.ГГГГ — например 15.03.2026`,
            });
            continue;
          }
          normalizedValue = str;
        }

        const cellAddress = `${field}${entry.rowIndex}`;

        try {
          sheetName ??= await resolveDeptSheetName(dept.nameShort, spreadsheetId);
          const writeResult = await writeCellValue(spreadsheetId, sheetName, cellAddress, normalizedValue);

          // Update cache in-place
          const batchFullCache = getDeptSheetCache();
          const batchDeptResult = batchFullCache[dept.nameShort];
          if (batchDeptResult) {
            const colIdx = COL_LETTER_INDEX[field];
            if (colIdx !== undefined && batchDeptResult.values[entry.rowIndex - 1]) {
              (batchDeptResult.values[entry.rowIndex - 1] as unknown[])[colIdx] = normalizedValue;
              setDeptSheetCache({ ...batchFullCache });
            }
          }

          // Audit log
          try {
            db.insert(schema.auditLog).values({
              action: 'batch_cell_edit',
              entity: 'row',
              entityId: `${entry.deptId}:${entry.rowIndex}:${field}`,
              departmentId: entry.deptId,
              rowIndex: entry.rowIndex,
              field,
              newValue: String(normalizedValue ?? ''),
              details: JSON.stringify({
                department: entry.deptId,
                row: entry.rowIndex,
                field,
                newValue: normalizedValue,
                updatedRange: writeResult.updatedRange,
                batchSave: true,
              }),
              timestamp: now,
            }).run();
          } catch (logErr) {
            app.log.warn({ logErr }, 'batch-save: failed to write audit log');
          }

          results.push({
            deptId: entry.deptId,
            rowIndex: entry.rowIndex,
            field,
            success: true,
          });
        } catch (err: any) {
          app.log.error({ err }, `batch-save: failed to write ${cellAddress} for ${entry.deptId}`);
          // Сообщение Google API (английское, с кодами) уходит только в лог:
          // веб показывает это поле пользователю дословно (DataBrowser.tsx:260).
          const deniedByRights = err?.message?.includes('readonly') || err?.code === 403;
          results.push({
            deptId: entry.deptId,
            rowIndex: entry.rowIndex,
            field,
            success: false,
            error: deniedByRights
              ? `Нет прав на запись в книгу управления «${dept.nameShort}» — откройте доступ на редактирование`
              : `Ячейка ${cellAddress} не сохранена: Google Таблицы не приняли правку. Повторите через минуту`,
          });
        }
      }
    }

    const totalChanges = results.length;
    const successCount = results.filter(r => r.success).length;
    const failCount = totalChanges - successCount;

    return reply.send({
      ok: failCount === 0,
      totalChanges,
      successCount,
      failCount,
      results,
      timestamp: now,
    });
  });

  /**
   * GET /api/rows/subordinates
   * Подведомственные учреждения из реальных данных (столбец C каждого листа).
   */
  app.get('/api/rows/subordinates', async (_request, reply) => {
    const result: Record<string, string[]> = {};

    for (const dept of DEPARTMENTS) {
      // Каскад чтения — rows-read; недоступный отдел пропускается (в отличие от 503 основных роутов)
      const read = await readDeptRows(dept);
      if (!read.ok) {
        if (read.reason === 'read-error') {
          app.log.warn({ err: read.error }, `subordinates: failed to read spreadsheet for ${dept.nameShort}`);
        } else {
          app.log.warn(`subordinates: no data source for ${dept.nameShort}`);
        }
        continue;
      }
      const rawRows = read.values;

      const subs = new Set<string>();
      for (let i = DEPT_HEADER_ROWS; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row) continue;
        const cat = String(row[2] ?? '').trim(); // C = index 2 (наименование подведомственного учреждения)
        // Канон п.51 (интервью 14.08.2026): «X/x/Х/х», тире, «н/д» и пустая
        // ячейка C = закупка САМОГО управления, а не подвед. Прежний ad-hoc
        // фильтр ловил только латинскую 'x' и однобуквенные значения — любой
        // иной плейсхолдер («н/д», «нет», «—») становился фейковым подведом и
        // завышал счётчик Пульта. Единый предикат — isOrgItself (org-itself.ts).
        if (cat && !isOrgItself(cat) && !isMetaRow(cat)) {
          subs.add(cat);
        }
      }

      if (subs.size > 0) {
        // Use nameShort (Russian) as key to match frontend store expectations
        result[dept.nameShort] = Array.from(subs).sort();
      }
    }

    return reply.send(result);
  });

  /**
   * GET /api/rows/subjects
   * Уникальные предметы закупок по всем управлениям с группировкой похожих.
   */
  app.get('/api/rows/subjects', async (_request, reply) => {
    // Collect subjects across all departments
    const subjectMap = new Map<string, { text: string; count: number; departments: Set<string> }>();
    // Непрочитанные книги называются в ответе поимённо: свод по семи книгам
    // вместо восьми выглядит так же, как полный, и молча занижает счётчики.
    const unreadDepartments: Array<{ department: string; reason: string }> = [];

    for (const dept of DEPARTMENTS) {
      // Каскад чтения — rows-read; недоступный отдел пропускается
      const read = await readDeptRows(dept);
      if (!read.ok) {
        if (read.reason === 'read-error') {
          app.log.warn({ err: read.error }, `subjects: failed to read spreadsheet for ${dept.nameShort}`);
        } else {
          app.log.warn(`subjects: no data source for ${dept.nameShort}`);
        }
        unreadDepartments.push({
          department: dept.nameShort,
          reason: sourceUnavailableMessage(dept.nameShort, read.reason),
        });
        continue;
      }
      const rawRows = read.values;

      for (let i = DEPT_HEADER_ROWS; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row) continue;

        const rawSubject = String(row[6] ?? '').trim(); // G = index 6
        if (!rawSubject) continue;
        const subLow = rawSubject.toLowerCase();
        if (isMetaRow(subLow)) continue;

        const { cleaned } = applyTextNormalization(rawSubject);
        const key = cleaned.toLowerCase();

        const existing = subjectMap.get(key);
        if (existing) {
          existing.count++;
          existing.departments.add(dept.id);
        } else {
          subjectMap.set(key, { text: cleaned, count: 1, departments: new Set([dept.id]) });
        }
      }
    }

    // Convert to array
    const entries = Array.from(subjectMap.values()).map(e => ({
      text: e.text,
      count: e.count,
      departments: Array.from(e.departments),
      similarTo: [] as string[],
    }));

    // Simple similarity: for short subjects, find similar ones via normalized comparison
    const normalize = (s: string) => s.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');

    for (let i = 0; i < entries.length; i++) {
      if (entries[i].text.length >= 50) continue;
      const normI = normalize(entries[i].text);
      if (normI.length < 5) continue;

      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].text.length >= 50) continue;
        const normJ = normalize(entries[j].text);
        if (normJ.length < 5) continue;

        // Check if one contains the other, or Levenshtein-like similarity
        if (normI === normJ) continue; // already same key
        const longer = normI.length >= normJ.length ? normI : normJ;
        const shorter = normI.length >= normJ.length ? normJ : normI;

        // Containment check
        if (longer.includes(shorter) && shorter.length / longer.length > 0.7) {
          entries[i].similarTo.push(entries[j].text);
          entries[j].similarTo.push(entries[i].text);
          continue;
        }

        // Simple character-level similarity (good enough for short strings)
        if (shorter.length > 0 && longer.length > 0) {
          let matches = 0;
          const maxLen = Math.max(normI.length, normJ.length);
          const minLen = Math.min(normI.length, normJ.length);
          for (let k = 0; k < minLen; k++) {
            if (normI[k] === normJ[k]) matches++;
          }
          const ratio = matches / maxLen;
          if (ratio > 0.85) {
            entries[i].similarTo.push(entries[j].text);
            entries[j].similarTo.push(entries[i].text);
          }
        }
      }
    }

    // Sort by count descending
    entries.sort((a, b) => b.count - a.count);

    return reply.send({ subjects: entries, unreadDepartments });
  });

  /**
   * GET /api/rows/scatter
   * ЗАКЛЮЧЁННЫЕ контракты всех управлений для scatter plot
   * (Лимит программы vs Цена контракта).
   *
   * Гейт заключения (пп. 38-39 интервью 14.08.2026): точка попадает в облако
   * только при ФАКТЕ заключения контракта — есть дата заключения (Q) и цена
   * (Y > 0). До гейта строка с планом и ценой 0 без даты заключения рисовалась
   * как «экономия 100 %» и раздувала счётчик «подозрительных» (2394 шт. —
   * следствие того же ложного гейта); незаключённые строки без плановой даты
   * (не обеспеченные финансированием, кредитная линия УФБП на 32 млн — п.39)
   * попадали туда же. Экономия существует только у заключённого контракта.
   *
   * Query params:
   *   - type: 'competitive' | 'single' — фильтр по типу закупки
   *   - activity: 'program' | 'current_program' | 'current_non_program'
   *   - dept: comma-separated dept IDs (латинский 'uer' или кириллический 'УЭР')
   */
  app.get('/api/rows/scatter', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const filterType = query.type ?? '';
    const filterActivity = query.activity ?? '';
    const filterDepts = query.dept ? query.dept.split(',').map(s => s.trim()) : [];

    // Обе формы ключа ГРБС: store канонизирует выбор в кириллицу (dept-key.ts),
    // а d.id здесь латинский — матч только по d.id молча обнулял фильтр.
    const departments = filterDepts.length > 0
      ? DEPARTMENTS.filter(d => filterDepts.includes(d.id) || filterDepts.includes(d.nameShort))
      : DEPARTMENTS;

    /**
     * Дата в ячейке листа есть (не пусто и не заглушка «Х»/«-»/«н/д»).
     * Канон плейсхолдеров — FACT_DATE_PLACEHOLDERS (@aemr/shared/fact-date.ts):
     * тот же список заглушек операторы ставят и в N (дата плана), и в Q (дата
     * заключения) — шапка книги прямо говорит «в случае отсутствия проставляется Х».
     */
    const hasCellDate = (raw: unknown): boolean =>
      !FACT_DATE_PLACEHOLDERS.has(String(raw ?? '').trim().toLowerCase());

    const allPoints: Array<{
      id: unknown;
      department: string;
      subject: string;
      planTotal: number;
      factTotal: number;
      economyPercent: number;
      activityType: string;
      procurementType: string;
      quarter: unknown;
    }> = [];
    // Те же две честности, что и в /rows/subjects: какие книги не прочитаны и
    // упёрлись ли мы в потолок выборки. Иначе неполное облако точек выглядит
    // как полное, и «средняя экономия» считается по обрезку молча.
    const unreadDepartments: Array<{ department: string; reason: string }> = [];
    const POINT_LIMIT = 2500;

    for (const dept of departments) {
      // Каскад чтения — rows-read; недоступный отдел пропускается
      const read = await readDeptRows(dept);
      if (!read.ok) {
        if (read.reason === 'read-error') {
          app.log.warn({ err: read.error }, `scatter: failed to read spreadsheet for ${dept.nameShort}`);
        } else {
          app.log.warn(`scatter: no data source for ${dept.nameShort}`);
        }
        unreadDepartments.push({
          department: dept.nameShort,
          reason: sourceUnavailableMessage(dept.nameShort, read.reason),
        });
        continue;
      }
      const rawRows = read.values;

      for (let i = DEPT_HEADER_ROWS; i < rawRows.length && allPoints.length < POINT_LIMIT; i++) {
        const row = rawRows[i];
        if (!row) continue;

        const subject = String(row[6] ?? '').trim(); // G=subject
        if (!subject) continue;
        const subLow = subject.toLowerCase();
        if (isMetaRow(subLow)) continue;

        const planTotal = parseFloat(String(row[10] ?? '')) || 0; // K=planTotal
        const factTotal = parseFloat(String(row[24] ?? '')) || 0; // Y=factTotal (цена контракта)

        if (planTotal <= 0) continue; // skip rows without plan limit

        // ── Гейт заключения (пп. 38-39) ──
        // 1. Нет плановой даты (N) → закупка не обеспечена финансированием —
        //    ей не место в облаке «лимит vs цена» вовсе (п.39, УФБП).
        if (!hasCellDate(row[DEPT_COLUMNS.PLAN_DATE])) continue;
        // 2. Нет даты заключения (Q) → контракта нет → нет ни цены, ни экономии.
        //    Именно эти строки рисовались как «экономия 100 %» (п.38).
        if (!hasCellDate(row[DEPT_COLUMNS.FACT_DATE])) continue;
        // 3. Дата есть, а цена 0 — дефект данных листа (контракт не заключают
        //    по цене 0), а не экономия 100 %: точку не рисуем.
        if (factTotal <= 0) continue;

        const procType = String(row[11] ?? '').trim(); // L=method
        const actType = String(row[5] ?? '').trim();  // F=activityType

        // Apply type filter
        if (filterType === 'competitive') {
          const lt = procType.toLowerCase();
          if (lt.includes('еп') || lt.includes('единствен')) continue;
        } else if (filterType === 'single') {
          const lt = procType.toLowerCase();
          if (!lt.includes('еп') && !lt.includes('единствен')) continue;
        }

        // Apply activity filter
        if (filterActivity) {
          const actMap: Record<string, string[]> = {
            program: ['программное мероприятие'],
            current_program: ['текущая деятельность в рамках программного мероприятия', 'текущая деятельность в рамках программ'],
            current_non_program: ['текущая деятельность вне рамок программного мероприятия', 'текущая деятельность вне программных мероприятий'],
          };
          const terms = actMap[filterActivity] ?? [filterActivity];
          if (!terms.some(t => actType.toLowerCase().includes(t))) continue;
        }

        // Экономия считается только здесь — ПОСЛЕ гейта заключения: planTotal > 0
        // и factTotal > 0 гарантированы, «100 %» из цены 0 больше невозможны.
        const economyPercent = +((1 - factTotal / planTotal) * 100).toFixed(2);

        allPoints.push({
          id: row[0],
          // Кириллический канон ('УАГЗО'), НЕ латинский dept.id ('uagzo'):
          // поле уходит в тултип графика как есть — внутренний латинский ключ
          // торчал наружу (п.38 интервью 14.08). Переходы по клику не ломаются:
          // store канонизирует обе формы (dept-key.ts), роуты /api/rows ищут
          // по d.id ИЛИ d.nameShort.
          department: dept.nameShort,
          subject: subject.length > 80 ? subject.slice(0, 80) + '…' : subject,
          planTotal,
          factTotal,
          economyPercent,
          activityType: actType,
          procurementType: procType,
          quarter: row[14], // O=plan quarter
        });
      }
    }

    return reply.send({
      points: allPoints,
      total: allPoints.length,
      departments: departments.map(d => d.id),
      unreadDepartments,
      /** Выборка упёрлась в потолок: показано не всё, среднее считать нельзя. */
      truncated: allPoints.length >= POINT_LIMIT,
      pointLimit: POINT_LIMIT,
    });
  });
}
