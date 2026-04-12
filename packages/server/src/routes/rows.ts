import type { FastifyInstance } from 'fastify';
import { DEPARTMENTS, COL_LETTER_INDEX, DEPT_HEADER_ROWS, buildCellDict, isMetaRow } from '@aemr/shared';
import { getSheetData, getSheetDataFromSpreadsheet, writeCellValue } from '../services/google-sheets.js';
import { getSnapshot, getDeptSheetCache, setDeptSheetCache } from '../services/snapshot.js';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { db, schema } from '../db/index.js';
import { detectSignals, classifyRowState, getSignalBadges, applyTextNormalization } from '@aemr/core';

/**
 * Returns the canonical sheet tab name for a department.
 * E.g. УО → "Все", УИО → "УИО".
 * Uses DEPARTMENTS[].sheetName from report-map (single source of truth).
 */
function getDeptSheetName(deptShortName: string): string {
  const dept = DEPARTMENTS.find(d => d.nameShort === deptShortName);
  return dept?.sheetName ?? deptShortName;
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
    const sortCol = query.sort ?? '';
    const sortOrder = query.order === 'desc' ? 'desc' : 'asc';

    // Read sheet data — cache-first strategy:
    // 1. Department cache (populated by fetchDepartmentSpreadsheets on startup)
    // 2. SVOD spreadsheet sheet (legacy fallback)
    // 3. Department's own spreadsheet (last resort, live API call)
    const sheetName = dept.sheetName;
    let rawRows: unknown[][];
    const cached = getDeptSheetCache()[dept.nameShort];
    if (cached && cached.length > 0) {
      rawRows = cached;
    } else {
      let loaded = false;
      try {
        rawRows = await getSheetData(sheetName);
        loaded = rawRows.length > 0;
      } catch {
        rawRows = [];
      }
      if (!loaded) {
        const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
        if (ssId) {
          try {
            rawRows = await getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort));
            if (!rawRows || rawRows.length === 0) {
              rawRows = await getSheetDataFromSpreadsheet(ssId, dept.nameShort);
            }
          } catch (err) {
            app.log.error(`Ошибка чтения таблицы управления "${dept.nameShort}": ${err}`);
            return reply.status(503).send({ error: 'Google Sheets unavailable' });
          }
        } else {
          app.log.error(`Нет данных для отдела "${dept.nameShort}" и нет spreadsheetId`);
          return reply.status(503).send({ error: 'Google Sheets unavailable' });
        }
      }
    }

    // Convert raw rows to cell dictionaries, skip header rows (шапка)
    const processedRows = rawRows.slice(DEPT_HEADER_ROWS).map((row, idx) => {
      const cells = buildCellDict(row as unknown[]);

      const signalsObj = detectSignals(cells);
      const state = classifyRowState(signalsObj);
      const badges = getSignalBadges(signalsObj);
      // Convert RowSignals boolean object → array of active signal keys for frontend
      const signals = Object.entries(signalsObj)
        .filter(([, v]) => v === true)
        .map(([k]) => k);

      // Map status from English state to Russian label
      const STATUS_MAP: Record<string, string> = {
        'signed': 'Подписан', 'overdue': 'Просрочен', 'planning': 'Планирование',
        'canceled': 'Отменён', 'has-fact': 'Исполнение', 'open': 'Открыт',
        'error': 'Ошибка', 'near-plan': 'Скоро срок', 'not-due': 'Срок не наступил',
        'finance-delay': 'Задержка финансирования',
      };

      // Column mapping per DEPT_COLUMNS:
      // A=ID, B=REG_NUMBER, C=SUBORDINATE, F=TYPE, G=SUBJECT,
      // H=FB_PLAN, I=KB_PLAN, J=MB_PLAN, K=TOTAL_PLAN, L=METHOD,
      // N=PLAN_DATE, O=PLAN_QUARTER, Q=FACT_DATE, R=FACT_QUARTER,
      // V=FB_FACT, W=KB_FACT, X=MB_FACT, Y=TOTAL_FACT,
      // Z=ECONOMY_FB, AA=ECONOMY_KB, AB=ECONOMY_MB, AD=FLAG
      const planMoney = parseFloat(String(cells.K ?? 0)) || 0;
      const factMoney = parseFloat(String(cells.Y ?? 0)) || 0;
      const ecoFB = parseFloat(String(cells.Z ?? 0)) || 0;
      const ecoKB = parseFloat(String(cells.AA ?? 0)) || 0;
      const ecoMB = parseFloat(String(cells.AB ?? 0)) || 0;
      const ecoTotal = ecoFB + ecoKB + ecoMB;

      return {
        rowIndex: idx + 4, // 1-based: slice(3) skips 3 header rows, so idx=0 → row 4
        id: cells.A,
        regNumber: cells.B ?? '',
        subordinate: cells.C ?? '',
        type: cells.F ?? '',
        subject: cells.G ?? '',
        planFB: parseFloat(String(cells.H ?? 0)) || 0,
        planKB: parseFloat(String(cells.I ?? 0)) || 0,
        planMB: parseFloat(String(cells.J ?? 0)) || 0,
        planSum: planMoney,
        method: String(cells.L ?? ''),
        planDate: cells.N ?? '',
        planQuarter: cells.O ?? '',
        factDate: cells.Q ?? '',
        factQuarter: cells.R ?? '',
        factFB: parseFloat(String(cells.V ?? 0)) || 0,
        factKB: parseFloat(String(cells.W ?? 0)) || 0,
        factMB: parseFloat(String(cells.X ?? 0)) || 0,
        factSum: factMoney,
        economy: ecoTotal,
        economyFB: ecoFB,
        economyKB: ecoKB,
        economyMB: ecoMB,
        flag: cells.AD ?? '',
        commentGRBS: cells.AE ?? '',
        commentExtra: cells.AF ?? '',
        status: STATUS_MAP[state] ?? state,
        dept: dept.id,
        signals,
        state,
        badges,
      };
    }).filter(r => {
      // Filter out non-data rows
      const subj = String(r.subject).trim().toLowerCase();
      const idStr = String(r.id ?? '').trim().toLowerCase();
      // Skip rows with no subject AND no plan money
      if (!subj && !r.planSum) return false;
      // Skip aggregate/header rows
      if (isMetaRow(subj)) return false;
      // Skip header-like rows (id contains non-numeric text like "№ п/п")
      if (idStr && isNaN(Number(idStr)) && !idStr.match(/^\d/)) return false;
      // Skip rows where method is clearly a header label (not ЭА/ЭК/ЭЗК/ЕП)
      const m = r.method.trim().toUpperCase();
      if (m.length > 5 && !['ЭА', 'ЭК', 'ЭЗК', 'ЕП'].includes(m)) return false;
      return true;
    });

    // Apply search filter
    let filtered = processedRows;
    if (searchTerm) {
      filtered = filtered.filter(r =>
        String(r.subject).toLowerCase().includes(searchTerm) ||
        String(r.method).toLowerCase().includes(searchTerm) ||
        String(r.status).toLowerCase().includes(searchTerm) ||
        String(r.regNumber).toLowerCase().includes(searchTerm) ||
        String(r.subordinate).toLowerCase().includes(searchTerm),
      );
    }

    // Apply type filter (column L = METHOD: ЭА, ЭК, ЭЗК = КП; ЕП = ЕП)
    if (filterType === 'competitive' || filterType === 'КП') {
      filtered = filtered.filter(r => {
        const m = r.method.toUpperCase();
        return m === 'ЭА' || m === 'ЭК' || m === 'ЭЗК';
      });
    } else if (filterType === 'single' || filterType === 'ЕП') {
      filtered = filtered.filter(r => r.method.toUpperCase() === 'ЕП');
    }

    // Apply subordinate filter (column C = SUBORDINATE)
    // Supports comma-separated list of subordinates
    if (filterSubordinate) {
      const subs = filterSubordinate.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      filtered = filtered.filter(r => {
        const sub = String(r.subordinate).toLowerCase();
        return subs.some(s => sub.includes(s));
      });
    }

    // Apply activity filter (column F = TYPE + column D/E program name)
    // F = "Текущая деятельность" / "Программное мероприятие"
    // ТД sub-classification: наличие реального текста ПМ в D/E → в рамках ПМ, иначе (X/x/Х/х/пусто) → вне ПМ
    if (filterActivity) {
      filtered = filtered.filter(r => {
        const at = String(r.type).toLowerCase();
        const pmVal = String((r as any).programName ?? '').trim();
        const hasPM = pmVal.length > 0 && !/^[XxХх]$/u.test(pmVal);
        switch (filterActivity) {
          case 'program':
            return at.includes('программное мероприятие');
          case 'current_program':
            return at.includes('текущая') && hasPM;
          case 'current_non_program':
            return at.includes('текущая') && !hasPM;
          default:
            return at.includes(filterActivity);
        }
      });
    }

    // Apply state filter
    if (filterState) {
      filtered = filtered.filter(r => r.state === filterState);
    }

    // Compute signal summary (before pagination, after filters)
    const signalSummary = {
      signed: filtered.filter(r => r.state === 'signed').length,
      overdue: filtered.filter(r => r.state === 'overdue').length,
      planning: filtered.filter(r => r.state === 'planning').length,
      canceled: filtered.filter(r => r.state === 'canceled').length,
      hasFact: filtered.filter(r => r.state === 'has-fact').length,
      total: filtered.length,
    };

    // Sort
    if (sortCol) {
      filtered.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortCol];
        const bVal = (b as Record<string, unknown>)[sortCol];
        const aNum = typeof aVal === 'number' ? aVal : NaN;
        const bNum = typeof bVal === 'number' ? bVal : NaN;

        let cmp: number;
        if (!isNaN(aNum) && !isNaN(bNum)) {
          cmp = aNum - bNum;
        } else {
          cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''), 'ru');
        }
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    // Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedRows = filtered.slice(start, start + limit);

    return reply.send({
      department: dept,
      rows: paginatedRows,
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

    // Read sheet data — cache-first, then SVOD fallback, then live API
    const sheetName = dept.sheetName;
    let rawRows: unknown[][];
    const cached = getDeptSheetCache()[dept.nameShort];
    if (cached && cached.length > 0) {
      rawRows = cached;
    } else {
      let loaded = false;
      try {
        rawRows = await getSheetData(sheetName);
        loaded = rawRows.length > 0;
      } catch {
        rawRows = [];
      }
      if (!loaded) {
        const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
        if (ssId) {
          try {
            rawRows = await getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort));
            if (!rawRows || rawRows.length === 0) {
              rawRows = await getSheetDataFromSpreadsheet(ssId, dept.nameShort);
            }
          } catch (err) {
            app.log.error(`Ошибка чтения таблицы управления "${dept.nameShort}": ${err}`);
            return reply.status(503).send({ error: 'Google Sheets unavailable' });
          }
        } else {
          app.log.error(`Нет данных для отдела "${dept.nameShort}" и нет spreadsheetId`);
          return reply.status(503).send({ error: 'Google Sheets unavailable' });
        }
      }
    }

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
    const TEXT_COLUMNS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'L', 'U', 'AD', 'AE', 'AF']);

    const field = body.field.toUpperCase();
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

    // Use canonical sheet name from DEPARTMENTS (e.g. "Все" for УО, "УИО" for УИО)
    const sheetName = getDeptSheetName(dept.nameShort);

    const cellAddress = `${field}${idx}`;
    const now = new Date().toISOString();

    try {
      const result = await writeCellValue(spreadsheetId, sheetName, cellAddress, normalizedValue);

      // Invalidate cache for this dept so next read picks up the change
      const cache = getDeptSheetCache();
      if (cache[dept.nameShort]) {
        // Update the cached row in-place
        const rows = cache[dept.nameShort];
        const colIdx = COL_LETTER_INDEX[field];
        if (colIdx !== undefined && rows[idx - 1]) {
          (rows[idx - 1] as unknown[])[colIdx] = normalizedValue;
          setDeptSheetCache({ ...cache });
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

      const sheetName = getDeptSheetName(dept.nameShort);

      for (const [rawField, rawValue] of Object.entries(entry.changes)) {
        const field = rawField.toUpperCase();

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
          const writeResult = await writeCellValue(spreadsheetId, sheetName, cellAddress, normalizedValue);

          // Update cache in-place
          const cache = getDeptSheetCache();
          if (cache[dept.nameShort]) {
            const rows = cache[dept.nameShort];
            const colIdx = COL_LETTER_INDEX[field];
            if (colIdx !== undefined && rows[entry.rowIndex - 1]) {
              (rows[entry.rowIndex - 1] as unknown[])[colIdx] = normalizedValue;
              setDeptSheetCache({ ...cache });
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
   * GET /api/reconcile
   * Сверка СВОД vs Расчёт по всем отделам (единая методика).
   *
   * Методика:
   * 1. «План СВОД» — из ячеек СВОД ТД-ПМ (D64, D94, D124...)
   * 2. «План расчёт» — реплика тех же COUNTIFS/SUMIFS по строкам листа ВСЕ
   * 3. Дельта ≠ 0 → проблема в формулах или данных
   */
  app.get('/api/reconcile', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'reconcile: failed to get snapshot');
      snapshot = null;
    }

    const deltas = snapshot?.deltas ?? [];

    // Группируем deltas по department (из metricKey: "grbs.УЭР.xxx")
    const byDept: Record<string, any[]> = {};
    for (const d of deltas) {
      const match = d.metricKey?.match(/^grbs\.([^.]+)\./);
      const deptId = match?.[1] ?? 'general';
      if (!byDept[deptId]) byDept[deptId] = [];
      byDept[deptId].push(d);
    }

    const reconciliation = DEPARTMENTS.map(dept => {
      const deptDeltas = byDept[dept.id] ?? [];
      const planDelta = deptDeltas.find(d => d.metricKey?.includes('total_plan'));
      const factDelta = deptDeltas.find(d => d.metricKey?.includes('total_fact'));
      const maxDeltaPct = Math.max(...deptDeltas.map(d => Math.abs(d.deltaPercent ?? 0)), 0);

      return {
        department: dept,
        planOfficial: planDelta?.officialValue ?? null,
        planCalculated: planDelta?.calculatedValue ?? null,
        planDelta: planDelta?.deltaPercent ?? null,
        factOfficial: factDelta?.officialValue ?? null,
        factCalculated: factDelta?.calculatedValue ?? null,
        factDelta: factDelta?.deltaPercent ?? null,
        assessment: maxDeltaPct > 3 ? 'critical' as const
          : maxDeltaPct > 1 ? 'acceptable' as const
          : deptDeltas.length > 0 ? 'ok' as const
          : 'unknown' as const,
        deltas: deptDeltas,
      };
    });

    return reply.send({
      reconciliation,
      totalDeltas: deltas.length,
      methodology: 'Единая формула: реплика COUNTIFS/SUMIFS из СВОД применяется к строкам отделов',
      thresholds: {
        ok: '|Δ| < 1%',
        acceptable: '|Δ| 1-3%',
        critical: '|Δ| > 3%',
      },
    });
  });

  /**
   * GET /api/reconcile/:deptId
   * Детальная сверка по одному отделу.
   */
  app.get('/api/reconcile/:deptId', async (request, reply) => {
    const { deptId } = request.params as { deptId: string };

    const dept = DEPARTMENTS.find(d => d.id === deptId || d.nameShort === deptId);
    if (!dept) {
      return reply.status(404).send({ error: `Отдел "${deptId}" не найден` });
    }

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'reconcile/dept: failed to get snapshot');
      snapshot = null;
    }

    const deltas = (snapshot?.deltas ?? []).filter((d: any) => d.metricKey?.includes(`grbs.${deptId}.`));
    const planDelta = deltas.find((d: any) => d.metricKey?.includes('total_plan'));
    const factDelta = deltas.find((d: any) => d.metricKey?.includes('total_fact'));

    return reply.send({
      department: dept,
      plan: { official: planDelta?.officialValue ?? null, calculated: planDelta?.calculatedValue ?? null, delta: planDelta?.deltaPercent ?? null },
      fact: { official: factDelta?.officialValue ?? null, calculated: factDelta?.calculatedValue ?? null, delta: factDelta?.deltaPercent ?? null },
      details: deltas,
    });
  });

  /**
   * GET /api/rows/subordinates
   * Подведомственные учреждения из реальных данных (столбец C каждого листа).
   */
  app.get('/api/rows/subordinates', async (_request, reply) => {
    const result: Record<string, string[]> = {};

    for (const dept of DEPARTMENTS) {
      let rawRows: unknown[][];
      const cachedSub = getDeptSheetCache()[dept.nameShort];
      if (cachedSub && cachedSub.length > 0) {
        rawRows = cachedSub;
      } else {
        let loaded = false;
        try {
          rawRows = await getSheetData(dept.sheetName);
          loaded = rawRows.length > 0;
        } catch {
          rawRows = [];
        }
        if (!loaded) {
          const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
          if (ssId) {
            try {
              rawRows = await getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort));
              if (!rawRows || rawRows.length === 0) {
                rawRows = await getSheetDataFromSpreadsheet(ssId, dept.nameShort);
              }
            } catch (err) {
              app.log.warn({ err }, `subordinates: failed to read spreadsheet for ${dept.nameShort}`);
              continue;
            }
          } else {
            app.log.warn(`subordinates: no data source for ${dept.nameShort}`);
            continue;
          }
        }
      }

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
      let rawRows: unknown[][];
      const cachedSubj = getDeptSheetCache()[dept.nameShort];
      if (cachedSubj && cachedSubj.length > 0) {
        rawRows = cachedSubj;
      } else {
        let loaded = false;
        try {
          rawRows = await getSheetData(dept.sheetName);
          loaded = rawRows.length > 0;
        } catch {
          rawRows = [];
        }
        if (!loaded) {
          const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
          if (ssId) {
            try {
              rawRows = await getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort));
              if (!rawRows || rawRows.length === 0) {
                rawRows = await getSheetDataFromSpreadsheet(ssId, dept.nameShort);
              }
            } catch (err) {
              app.log.warn({ err }, `subjects: failed to read spreadsheet for ${dept.nameShort}`);
              continue;
            }
          } else {
            app.log.warn(`subjects: no data source for ${dept.nameShort}`);
            continue;
          }
        }
      }

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
      let rawRows: unknown[][];
      const cachedScatter = getDeptSheetCache()[dept.nameShort];
      if (cachedScatter && cachedScatter.length > 0) {
        rawRows = cachedScatter;
      } else {
        let loaded = false;
        try {
          rawRows = await getSheetData(dept.sheetName);
          loaded = rawRows.length > 0;
        } catch {
          rawRows = [];
        }
        if (!loaded) {
          const ssId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
          if (ssId) {
            try {
              rawRows = await getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort));
              if (!rawRows || rawRows.length === 0) {
                rawRows = await getSheetDataFromSpreadsheet(ssId, dept.nameShort);
              }
            } catch (err) {
              app.log.warn({ err }, `scatter: failed to read spreadsheet for ${dept.nameShort}`);
              continue;
            }
          } else {
            app.log.warn(`scatter: no data source for ${dept.nameShort}`);
            continue;
          }
        }
      }

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
