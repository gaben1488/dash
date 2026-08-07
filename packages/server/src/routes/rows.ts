import type { FastifyInstance } from 'fastify';
import { DEPARTMENTS, COL_LETTER_INDEX, DEPT_HEADER_ROWS, buildCellDict, isMetaRow } from '@aemr/shared';
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
 * Единственная проверка адресуемости строки перед записью в живую таблицу.
 * Возвращает текст ошибки или null, если писать можно.
 *
 * Нижняя граница: строка 1 — заголовок. Верхняя: строка обязана существовать в листе
 * (иначе writeCellValue создаст ячейку за пределами данных и побьёт итоговые формулы,
 * а кэш этого не заметит — values[idx-1] просто undefined).
 * Кэша нет — писать вслепую нельзя: сначала обновить снимок.
 */
function rowWriteError(idx: number, deptShortName: string, display: string | number = idx): string | null {
  if (!Number.isInteger(idx) || idx < 2) return `Некорректный номер строки "${display}"`;
  const rowCount = getDeptSheetValues()[deptShortName]?.length ?? 0;
  if (rowCount === 0) return `Лист "${deptShortName}" не загружен — обновите данные перед правкой`;
  if (idx > rowCount) return `Строка ${idx} за пределами листа (строк: ${rowCount})`;
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
      return reply.status(404).send({ error: `Отдел "${deptId}" не найден` });
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
      return reply.status(503).send({ error: 'Google Sheets unavailable' });
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
      return reply.status(404).send({ error: `Отдел "${deptId}" не найден` });
    }

    // Чтение строк — каскад cache-first в rows-read (кэш → СВОД → книга управления)
    const read = await readDeptRows(dept);
    if (!read.ok) {
      if (read.reason === 'read-error') {
        app.log.error(`Ошибка чтения таблицы управления "${dept.nameShort}": ${read.error}`);
      } else {
        app.log.error(`Нет данных для отдела "${dept.nameShort}" и нет spreadsheetId`);
      }
      return reply.status(503).send({ error: 'Google Sheets unavailable' });
    }
    const rawRows = read.values;

    // Validate row index (idx is 1-based sheet row; row 1 = header, data starts at row 2)
    // rawRows[0] = header, rawRows[idx - 1] = requested row
    if (idx < 2 || idx - 1 >= rawRows.length) {
      return reply.status(404).send({ error: `Строка ${idx} не найдена` });
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
      return reply.status(400).send({ error: 'Поля "field" и "value" обязательны' });
    }

    const dept = DEPARTMENTS.find(d => d.id === deptId || d.nameShort === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Отдел "${deptId}" не найден` });
    }

    // Блокировка формульных колонок
    const FORMULA_COLUMNS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'];
    if (FORMULA_COLUMNS.includes(body.field.toUpperCase())) {
      // Логируем попытку записи в формульную ячейку
      app.log.warn(`Попытка записи в формульную колонку ${body.field} отдела ${deptId} строка ${idx}`);
      return reply.status(403).send({
        error: 'Запись заблокирована',
        reason: `Колонка ${body.field} содержит формулу и не может быть изменена вручную`,
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
      return reply.status(400).send({ error: `Неизвестная колонка "${body.field}"` });
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
          error: `Колонка ${field} ожидает числовое значение`,
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
          error: `Колонка ${field} ожидает дату в формате ДД.ММ.ГГГГ`,
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
      return reply.status(503).send({ error: `Нет spreadsheetId для "${dept.nameShort}"` });
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

      // Check if it's an auth scope error
      if (err.message?.includes('readonly') || err.code === 403) {
        return reply.status(403).send({
          error: 'Service Account не имеет прав на запись. Требуется scope spreadsheets (не readonly)',
          details: err.message,
        });
      }

      return reply.status(500).send({
        error: 'Ошибка записи в Google Таблицу',
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
      return reply.status(400).send({ error: 'Массив "rows" обязателен и не может быть пустым' });
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
          results.push({ deptId: entry.deptId, rowIndex: entry.rowIndex, field, success: false, error: `Отдел "${entry.deptId}" не найден` });
        }
        continue;
      }

      const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
      if (!spreadsheetId) {
        for (const field of Object.keys(entry.changes)) {
          results.push({ deptId: entry.deptId, rowIndex: entry.rowIndex, field, success: false, error: `Нет spreadsheetId для "${dept.nameShort}"` });
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
            success: false, error: `Неизвестная колонка "${rawField}"`,
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
            error: `Колонка ${field} содержит формулу и не может быть изменена`,
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
              error: `Колонка ${field} ожидает числовое значение`,
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
              error: `Колонка ${field} ожидает дату в формате ДД.ММ.ГГГГ`,
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
          results.push({
            deptId: entry.deptId,
            rowIndex: entry.rowIndex,
            field,
            success: false,
            error: err.message ?? String(err),
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
        // Skip empty, meta-rows, and "X" (means no subordinate)
        if (
          cat &&
          cat.toLowerCase() !== 'x' &&
          cat.length > 1 &&
          !isMetaRow(cat)
        ) {
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

    for (const dept of DEPARTMENTS) {
      // Каскад чтения — rows-read; недоступный отдел пропускается
      const read = await readDeptRows(dept);
      if (!read.ok) {
        if (read.reason === 'read-error') {
          app.log.warn({ err: read.error }, `subjects: failed to read spreadsheet for ${dept.nameShort}`);
        } else {
          app.log.warn(`subjects: no data source for ${dept.nameShort}`);
        }
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

    return reply.send({ subjects: entries });
  });

  /**
   * GET /api/rows/scatter
   * Все строки всех управлений для scatter plot (Лимит программы vs Цена контракта).
   *
   * Query params:
   *   - type: 'competitive' | 'single' — фильтр по типу закупки
   *   - activity: 'program' | 'current_program' | 'current_non_program'
   *   - dept: comma-separated dept IDs
   */
  app.get('/api/rows/scatter', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const filterType = query.type ?? '';
    const filterActivity = query.activity ?? '';
    const filterDepts = query.dept ? query.dept.split(',').map(s => s.trim()) : [];

    const departments = filterDepts.length > 0
      ? DEPARTMENTS.filter(d => filterDepts.includes(d.id))
      : DEPARTMENTS;

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

    for (const dept of departments) {
      // Каскад чтения — rows-read; недоступный отдел пропускается
      const read = await readDeptRows(dept);
      if (!read.ok) {
        if (read.reason === 'read-error') {
          app.log.warn({ err: read.error }, `scatter: failed to read spreadsheet for ${dept.nameShort}`);
        } else {
          app.log.warn(`scatter: no data source for ${dept.nameShort}`);
        }
        continue;
      }
      const rawRows = read.values;

      for (let i = DEPT_HEADER_ROWS; i < rawRows.length && allPoints.length < 2500; i++) {
        const row = rawRows[i];
        if (!row) continue;

        const subject = String(row[6] ?? '').trim(); // G=subject
        if (!subject) continue;
        const subLow = subject.toLowerCase();
        if (isMetaRow(subLow)) continue;

        const planTotal = parseFloat(String(row[10] ?? '')) || 0; // K=planTotal
        const factTotal = parseFloat(String(row[24] ?? '')) || 0; // Y=factTotal (цена контракта)

        if (planTotal <= 0) continue; // skip rows without plan limit

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

        const economyPercent = planTotal > 0 ? +((1 - factTotal / planTotal) * 100).toFixed(2) : 0;

        allPoints.push({
          id: row[0],
          department: dept.id,
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
    });
  });
}
