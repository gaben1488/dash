# Фаза 0 — Честность фильтров и долги · детальный план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или
> superpowers:executing-plans. Каждая задача — свой коммит с зелёным гейтом.

**Goal:** Убрать всё, из-за чего числа dash лгут при фильтрации, закрыть незакрытые долги
дорожки B, провести перепись остатка сверки — чтобы отчёт-проекция (фаза 1) строилась на
честных числах.

**Architecture:** Точечные фиксы существующего кода + вынос фильтр-логики в чистые
тестируемые функции (`packages/web/src/lib/*.ts`). Ни одной новой подсистемы.

**Tech Stack:** TS ESM, vitest. Гейт на каждый коммит:
`pnpm typecheck && pnpm lint && pnpm -r test`.

**Порядок:** задачи независимы по файлам (кроме 0.2↔0.3, обе трогают DataBrowser — делать
последовательно). Рекомендуемый порядок: 0.1 → 0.8 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7 → 0.9.

---

## Общие команды

```bash
# гейт (из корня C:/Users/filat/dash)
pnpm typecheck && pnpm lint && pnpm -r test

# один тест-файл (пример)
cd packages/core && npx vitest run src/pipeline/silent-drop-signals.test.ts
cd packages/web  && npx vitest run src/lib/rows-filter.test.ts
cd packages/server && npx vitest run src/routes/rows-year.test.ts
```

Протокол TDD каждой задачи: написать тест → прогнать (RED, правильная причина) → применить фикс
→ прогнать (GREEN) → полный гейт → коммит. Для правок в существующих файлах: перед фиксом
временно застэшить, убедиться что тест краснеет на HEAD, вернуть — если фикс уже написан.

---

## Задача 0.1 — B-8: сигнал молчаливых потерь (счётчик + unknown-лист) — ✅ УЖЕ СДЕЛАНО

**СТАТУС (верифицировано 2026-07-13):** закрыто ранее коммитом `eced5ee` (предок HEAD);
B-8 и B-10 отмечены `[x]` в `docs/PLAN.md`; тест `silent-drop-signals.test.ts` в дереве,
core 734/734 зелёный. Задача включена в план по ошибочной посылке «незакрытый долг» —
переоткрывать НЕ нужно. Шаги ниже оставлены как запись факта.

**Контекст:** AGENTS.md запрещает тихие потери. `CalcEngine.compute()` дропает строки, не
прошедшие классификатор, без счётчика; `validateData()` для нераспознанного листа молча
пропускает ВСЕ svod/department-правила. Драфт верифицирован эмпирически (агент применял и
прогонял). B-10 (`savings_pct`) — НЕ баг (колонка Q «Потрачено, %», документирован, тесты
есть), не трогать.

**Files:**
- Create: `packages/core/src/pipeline/silent-drop-signals.test.ts`
- Modify: `packages/core/src/pipeline/calc-engine.ts` (интерфейс GroupedResults + инициализация + цикл)
- Modify: `packages/core/src/pipeline/validate.ts` (сигнал unknown-листа)

- [ ] **Шаг 1. Написать тест** — создать `silent-drop-signals.test.ts` с содержимым:

```ts
/**
 * "No silent data loss" invariant (AGENTS.md carve-out) — two independent
 * pipeline paths currently drop rows / skip validation with zero signal:
 *
 *  - B-8: CalcEngine.compute() excludes rows that fail the classification
 *    filter (or are empty slots) from every metric, with no counter exposed.
 *  - validate.ts: validateData() skips ALL svod/department-scoped rules for
 *    a sheet that classifySheet() cannot recognize ('unknown' kind), with no
 *    issue/log recording that the skip happened.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import type { ClassifiedRow, NormalizedMetric, ReportMapEntry, ValidationRule } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { validateData } from './validate.js';

const COL = DEPT_COLUMNS;

function makeGoodRow(id: string): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = id;
  row[COL.SUBJECT] = 'Закупка';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.METHOD] = 'ЭА';
  row[COL.FB_PLAN] = 100;
  row[COL.PLAN_DATE] = '15.01.2025';
  row[COL.PLAN_QUARTER] = 1;
  row[COL.PLAN_YEAR] = 2025;
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  const headers = [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
  ];
  return [...headers, ...dataRows];
}

describe('CalcEngine.compute() — dropped-row signal (B-8)', () => {
  it('counts a malformed row rejected by standardRowFilter instead of letting it vanish silently', () => {
    const malformedRow: unknown[] = new Array(32).fill('');
    const rows = buildSheet([makeGoodRow('1'), malformedRow, makeGoodRow('2')]);

    const grouped = new CalcEngine().compute(rows, standardRowFilter, 3, 2025);

    expect(grouped.rowCount).toBe(2);
    expect((grouped as unknown as { droppedRows: number }).droppedRows).toBe(1);
  });
});

function makeRow(overrides: Partial<ClassifiedRow> & { cells?: Record<string, unknown> } = {}): ClassifiedRow {
  return {
    rowIndex: 5,
    sheet: 'Лист1',
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: {},
    ...overrides,
  };
}

function makeRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    id: 'dept_only_rule',
    name: 'Dept Only Rule',
    description: 'A department-scoped rule',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    params: {},
    check: () => ({ passed: false, message: 'should never run on an unclassified sheet' }),
    ...overrides,
  };
}

const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

describe('validateData() — unclassified-sheet silent skip', () => {
  it('signals when a sheet classifySheet() cannot recognize causes svod/department rules to be skipped', () => {
    const row = makeRow();
    const issues = validateData(EMPTY_METRICS, [row], [makeRule()], EMPTY_REPORT_MAP);

    expect(issues.some(i => i.category === 'dept_only_rule')).toBe(false);
    const signalIssue = issues.find(i => i.category === 'unclassified_sheet');
    expect(signalIssue).toBeDefined();
    expect(signalIssue?.sheet).toBe('Лист1');
  });
});
```

- [ ] **Шаг 2. Прогнать (RED).** Run: `cd packages/core && npx vitest run src/pipeline/silent-drop-signals.test.ts`
  Expected: FAIL — `droppedRows` undefined (≠1); `unclassified_sheet` issue не найден.

- [ ] **Шаг 3. Фикс `calc-engine.ts` (3 правки).**

Правка A — поле в интерфейс `GroupedResults` (после `economyTotalMath: number;`):
```ts
  /** Mathematical economy total (ungated by AD, Math.max(0, eco)), only hasFact gate. */
  economyTotalMath: number;
  /**
   * Rows silently excluded BEFORE metric accumulation: empty row slots or rows
   * that failed the row-classification filter (e.g. standardRowFilter score < 3).
   * Does NOT include rows skipped by the year filter (targetYear) — that is
   * intentional scoping, not a parsing/classification problem. (B-8)
   */
  droppedRows: number;
}
```

Правка B — инициализация (в объекте `result` рядом с `economyTotalMath: 0,`):
```ts
      rowCount: 0,
      conflicts: 0,
      economyTotalMath: 0,
      droppedRows: 0,
    };
```

Правка C — инкремент в цикле:
```ts
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row) { result.droppedRows++; continue; }
      if (!filter(row)) { result.droppedRows++; continue; }

      // Year filter
      if (targetYear) {
```

- [ ] **Шаг 4. Фикс `validate.ts`** — после `const sheetClass = classifySheet(sheetName);`,
  перед `for (const rule of rules) {`:
```ts
  const sheetName = rows.length > 0 ? rows[0].sheet : '';
  const sheetClass = classifySheet(sheetName);

  // Тихие провалы запрещены (AGENTS.md carve-out): нераспознанный лист молча
  // теряет ВСЕ svod- и department-scoped правила ниже (правила scope='both' по-прежнему
  // выполняется) — раньше это было полностью бесшумно. Один сигнал на лист.
  if (sheetClass.kind === 'unknown' && rows.length > 0) {
    issues.push({
      id: nanoid(),
      severity: 'warning',
      origin: 'runtime_error',
      category: 'unclassified_sheet',
      title: `Лист не распознан: ${sheetName || '(без имени)'}`,
      description: 'classifySheet() вернул unknown — svod- и department-scoped правила пропущены для всех строк этого листа (правила scope="both" по-прежнему выполняются).',
      sheet: sheetName,
      recommendation: 'Проверить имя листа: опечатка, новый ГРБС ещё не добавлен в department-registry, либо лист действительно не относится к данным закупок.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'pipeline:validate',
    });
  }

  for (const rule of rules) {
```
(`nanoid` и `now` уже в области видимости: `validate.ts:1` import, `:38` `const now`.)

- [ ] **Шаг 5. Прогнать (GREEN)** тот же тест → PASS.
- [ ] **Шаг 6. Гейт** `pnpm typecheck && pnpm lint && pnpm -r test` → зелёный
  (droppedRows добавлен в тип — проверить, что все конструкции `GroupedResults` в коде и
  тестах инициализируют его; агент подтвердил чистый гейт).
- [ ] **Шаг 7. Коммит.**
```bash
git add packages/core/src/pipeline/calc-engine.ts packages/core/src/pipeline/validate.ts packages/core/src/pipeline/silent-drop-signals.test.ts
git commit -m "fix(core): сигнал молчаливых потерь — счётчик дропнутых строк + unknown-лист (B-8)"
```
Обновить `docs/PLAN.md`: отметить B-8 `[x]`, B-10 `[x]` с пометкой «не баг, savings_pct=колонка Q».

---

## Задача 0.2 — T3: Реестр честно фильтрует по году

**Контекст (QA):** `/api/rows/:deptId` (`rows.ts:59`) не принимает `?year=`; строка не отдаёт
год (колонка P = `cells.P`, `PLAN_YEAR`=15). Реестр год-агностичен. Год строки уже читается
ядром (`calc-engine.ts:440` `num(row[COL.PLAN_YEAR])`).

**Files:**
- Modify: `packages/server/src/routes/rows.ts` (DTO + query-фильтр)
- Modify: `packages/web/src/api.ts` (getRows принимает year)
- Modify: `packages/web/src/pages/DataBrowser.tsx` (передаёт store.year)
- Test: `packages/server/src/routes/rows-year.test.ts` (новый)

- [ ] **Шаг 1. Тест** `rows-year.test.ts` — паттерн как в
  `packages/server/src/routes/issues-status.test.ts` (mock google-sheets, `setDeptSheetCache`
  для посева). Посеять 2 строки: P=2025 и P=2026 в кэш дептом; `GET /api/rows/УЭР?year=2026&limit=100`
  → в ответе ровно строки с planYear=2026; без `year` → обе.

```ts
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
}));
vi.mock('../services/google-sheets.js', () => ({
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

// helper: строка листа с планом в году `y`. Индексы столбцов из DEPT_COLUMNS.
function sheetRow(id: string, y: number): unknown[] {
  const r: unknown[] = new Array(32).fill('');
  r[0] = id;          // A = ID
  r[6] = 'Закупка ' + id; // G = SUBJECT
  r[10] = 100;        // K = TOTAL_PLAN
  r[11] = 'ЭА';       // L = METHOD
  r[15] = y;          // P = PLAN_YEAR
  return r;
}

describe('GET /api/rows/:dept — фильтр по году (T3)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];
    setDeptSheetCache({ 'УЭР': { values: [...headers, sheetRow('1', 2025), sheetRow('2', 2026)], formulas: [], sheetName: 'УЭР' } });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);
  afterAll(async () => { await app?.close(); process.env = { ...ORIGINAL_ENV }; vi.resetModules(); });

  it('year=2026 отдаёт только строки с planYear=2026', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УЭР?year=2026&limit=100' });
    const body = res.json<{ rows: Array<{ planYear: number }> }>();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every(r => r.planYear === 2026)).toBe(true);
  }, 30_000);

  it('без year отдаёт все годы', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/УЭР?limit=100' });
    const body = res.json<{ rows: Array<{ planYear: number }> }>();
    const years = new Set(body.rows.map(r => r.planYear));
    expect(years.has(2025) && years.has(2026)).toBe(true);
  }, 30_000);
});
```

- [ ] **Шаг 2. RED.** `cd packages/server && npx vitest run src/routes/rows-year.test.ts`
  Expected: FAIL — `planYear` undefined в DTO, `year` не фильтрует.

- [ ] **Шаг 3. Фикс `rows.ts`.**
  (а) в объекте строки (после `factQuarter: cells.R ?? '',`) добавить:
```ts
        factQuarter: cells.R ?? '',
        planYear: parseInt(String(cells.P ?? ''), 10) || 0,
```
  (б) после блока чтения query (около `const filterActivity = ...`) добавить парсинг года:
```ts
    const yearRaw = query.year;
    const yearFilter = yearRaw && yearRaw !== 'all'
      ? (() => { const n = parseInt(yearRaw, 10); return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : undefined; })()
      : undefined;
```
  (в) в цепочке фильтров (после `if (filterState) {...}`, перед `signalSummary`) добавить:
```ts
    if (yearFilter) {
      filtered = filtered.filter(r => r.planYear === 0 || r.planYear === yearFilter);
    }
```
  (Строки без года (planYear=0) остаются видимыми — как в ядре: год-агностичные строки не
  выкидываются. Проверить: это соответствует поведению calc-engine `rowYear>0 && rowYear!==targetYear → skip`.)

- [ ] **Шаг 4. Фикс `api.ts` getRows** — добавить необязательный year в params (getRows уже
  принимает `params?: Record<string, string>`; вызывающая сторона добавит `year`). Изменений в
  api.ts не требуется, если DataBrowser кладёт year в params. Проверить сигнатуру
  (`api.ts:76`): `getRows: (deptId, params) => fetchJSON('/rows/'+enc+'?'+new URLSearchParams(params))`.

- [ ] **Шаг 5. Фикс `DataBrowser.tsx`** — там, где собираются params для `api.getRows`
  (около :325-346, где кладутся type/quarter/months/search), добавить год из стора:
```ts
    // year из стора: number → строка, 'all' → не передаём (все годы)
    const { year } = useStore.getState(); // или из деструктуризации выше, если year уже читается
    if (typeof year === 'number') params.year = String(year);
```
  (Найти реальное место сбора `params` в fetch-эффекте DataBrowser; year брать из того же
  `useStore`, что уже используется на странице. Убедиться, что эффект пере-фетчит при смене
  года — добавить `year` в deps массива эффекта.)

- [ ] **Шаг 6. GREEN** + **Шаг 7. Гейт** + **Шаг 8. Коммит:**
```bash
git commit -m "fix(server+web): Реестр честно фильтрует строки по году (T3)"
```

---

## Задача 0.3 — T4: Реестр честно фильтрует по бюджету

**Контекст (QA):** барабан ФБ/КБ/МБ показан на странице data (Header.tsx PAGE_FILTERS), но
DataBrowser не читает `selectedBudgets`. Строка имеет planFB/KB/MB + factFB/KB/MB.

**Files:**
- Create: `packages/web/src/lib/rows-filter.ts` (чистая функция)
- Create: `packages/web/src/lib/rows-filter.test.ts`
- Modify: `packages/web/src/pages/DataBrowser.tsx` (использует функцию)

- [ ] **Шаг 1. Тест** `rows-filter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { filterRowsByBudgets, type BudgetRow } from './rows-filter';

const mk = (o: Partial<BudgetRow>): BudgetRow => ({
  planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, ...o,
});

describe('filterRowsByBudgets (T4)', () => {
  it('пустой набор бюджетов → все строки проходят', () => {
    const rows = [mk({ planFB: 100 }), mk({ planMB: 50 })];
    expect(filterRowsByBudgets(rows, new Set())).toHaveLength(2);
  });
  it('ФБ → только строки с федеральной компонентой (план ИЛИ факт)', () => {
    const rows = [mk({ planFB: 100 }), mk({ planMB: 50 }), mk({ factFB: 5 })];
    const out = filterRowsByBudgets(rows, new Set(['ФБ']));
    expect(out).toHaveLength(2); // planFB и factFB
  });
  it('несколько бюджетов → объединение (OR)', () => {
    const rows = [mk({ planFB: 100 }), mk({ planKB: 50 }), mk({ planMB: 10 })];
    expect(filterRowsByBudgets(rows, new Set(['ФБ', 'МБ']))).toHaveLength(2);
  });
});
```
  ВАЖНО: перед написанием — грепнуть точные значения `selectedBudgets` (store.ts `toggleBudget`,
  тип `BudgetType`). Если значения латинские (`'fb'|'kb'|'mb'`) — заменить `'ФБ'`/`'КБ'`/`'МБ'`
  в тесте и функции на реальные. Тест ДОЛЖЕН отражать реальные значения стора.

- [ ] **Шаг 2. RED** (функции нет). **Шаг 3. Функция** `rows-filter.ts`:
```ts
export interface BudgetRow {
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
}

/** Строка проходит, если у неё есть план ИЛИ факт хотя бы в одном из выбранных бюджетов.
 *  Пустой набор = без фильтра. Значения набора — из store BudgetType (сверить регистр). */
export function filterRowsByBudgets<T extends BudgetRow>(rows: T[], budgets: Set<string>): T[] {
  if (budgets.size === 0) return rows;
  return rows.filter(r =>
    (budgets.has('ФБ') && (r.planFB > 0 || r.factFB > 0)) ||
    (budgets.has('КБ') && (r.planKB > 0 || r.factKB > 0)) ||
    (budgets.has('МБ') && (r.planMB > 0 || r.factMB > 0)),
  );
}
```
- [ ] **Шаг 4. GREEN.**
- [ ] **Шаг 5. Подключить в DataBrowser** — в цепочке фильтров (рядом с period/search) добавить
  `filterRowsByBudgets(rows, selectedBudgets)`, `selectedBudgets` из `useStore`; убедиться, что
  summary bar считается от отфильтрованного набора. Добавить `selectedBudgets` в deps.
- [ ] **Шаг 6. Гейт** + **Шаг 7. Коммит:** `fix(web): Реестр честно фильтрует по бюджету (T4)`.

---

## Задача 0.4 — T5: сигнал-виджет Пульта уважает фильтр ГРБС

**Контекст (QA D10):** `useFilteredData.ts:833-834` — signalCounts из `dashboardData.signalCounts`
(полный датасет), не по отфильтрованным depts. Каждый dept в `departmentSummaries` имеет свой
`signalCounts` (проверить shape).

**Files:**
- Create: `packages/web/src/lib/signal-counts.ts` + `.test.ts`
- Modify: `packages/web/src/hooks/useFilteredData.ts:833-844`

- [ ] **Шаг 1. Тест** `signal-counts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { aggregateSignalCounts } from './signal-counts';

describe('aggregateSignalCounts (T5)', () => {
  it('суммирует per-dept counts только по переданным (отфильтрованным) депам', () => {
    const depts = [
      { signalCounts: { overdue: 2, highEconomy: 1 } },
      { signalCounts: { overdue: 3 } },
    ];
    expect(aggregateSignalCounts(depts, {})).toEqual({ overdue: 5, highEconomy: 1 });
  });
  it('один выбранный депт → его counts, не сумма всех', () => {
    const depts = [{ signalCounts: { overdue: 2 } }];
    expect(aggregateSignalCounts(depts, { overdue: 99 })).toEqual({ overdue: 2 });
  });
  it('депты без signalCounts → фолбэк на серверный полный счёт', () => {
    expect(aggregateSignalCounts([], { overdue: 7 })).toEqual({ overdue: 7 });
  });
});
```
- [ ] **Шаг 2. RED.** **Шаг 3. Функция:**
```ts
type WithSignals = { signalCounts?: Record<string, number> };

/** Складывает per-dept signalCounts по отфильтрованному списку депов.
 *  Если ни у одного депа нет per-dept счётчиков (старый снапшот) — фолбэк на серверный
 *  полный счёт (fallback), чтобы виджет не обнулялся. */
export function aggregateSignalCounts(depts: WithSignals[], fallback: Record<string, number>): Record<string, number> {
  const hasPerDept = depts.some(d => d.signalCounts && Object.keys(d.signalCounts).length > 0);
  if (!hasPerDept) return { ...fallback };
  const acc: Record<string, number> = {};
  for (const d of depts) {
    for (const [k, v] of Object.entries(d.signalCounts ?? {})) acc[k] = (acc[k] ?? 0) + v;
  }
  return acc;
}
```
- [ ] **Шаг 4. GREEN.**
- [ ] **Шаг 5. Подключить в useFilteredData** — заменить строку 834:
```ts
    // Signal counts: суммируем по ОТФИЛЬТРОВАННЫМ депам (fd.depts), фолбэк на серверный полный.
    const signalCounts = aggregateSignalCounts(depts, dashboardData?.signalCounts ?? {});
```
  Проверить, что `depts` в этой области = уже отфильтрованный список (по коду — да, строится
  выше в том же useMemo). Если у per-dept summary поле называется иначе — сверить и поправить
  тип `WithSignals`.
- [ ] **Шаг 6. Гейт** + **Шаг 7. Коммит:** `fix(web): сигнал-виджет уважает фильтр ГРБС (T5)`.

---

## Задача 0.5 — T6: «Δ нед.» → честная «Δ кв.»

**Контекст (QA D9):** колонка подписана «Δ нед.» (tooltip `dept_delta_week`), значение = дельта
к предыдущему КВАРТАЛУ (`useMultiDimMetrics.ts:256-262`, `Dashboard.tsx:153`).

**Files:**
- Modify: `packages/web/src/pages/Dashboard.tsx:153` (`deltaWeek` → `deltaQuarter`)
- Modify: `packages/web/src/components/RatingTableV2.tsx` (проп + подпись «Δ кв.» + tooltip key)
- Modify: KB-registry (`packages/web/src/lib/metrics-registry.ts` или `bootstrap-kb-registry.ts`):
  `dept_delta_week` → `dept_delta_quarter` + честный текст
- Test: `packages/web/src/lib/kb-delta-label.test.ts` (новый, если реестр — данные)

- [ ] **Шаг 1. Грепнуть** `dept_delta_week` и `deltaWeek` по web — собрать все сайты.
- [ ] **Шаг 2. Тест** (на данные реестра, стабилен):
```ts
import { describe, expect, it } from 'vitest';
import { KB_REGISTRY } from './metrics-registry'; // сверить реальный экспорт/путь

describe('KB-registry: честная подпись дельты (T6)', () => {
  it('содержит dept_delta_quarter и НЕ содержит dept_delta_week', () => {
    const keys = Object.keys(KB_REGISTRY); // или .map(e=>e.metric), сверить форму
    expect(keys).toContain('dept_delta_quarter');
    expect(keys).not.toContain('dept_delta_week');
  });
});
```
  (Форму реестра сверить по факту — тест отражает реальную структуру.)
- [ ] **Шаг 3. RED.** **Шаг 4. Переименования** по цепочке: поле `deltaQuarter`, проп
  RatingTableV2, подпись `Δ кв.`, KB-запись `dept_delta_quarter` с текстом «изменение
  исполнения по сумме к предыдущему кварталу (не к неделе)». **Шаг 5. GREEN.**
- [ ] **Шаг 6. Гейт** + **Шаг 7. Коммит:** `fix(web): честная подпись Δ квартала вместо ложной Δ недели (T6)`.
  Примечание: настоящая недельная дельта («что изменилось за неделю») появится в фазе 2 как
  дельта к прошлому снапшоту — это отдельная работа, здесь только честная подпись.

---

## Задача 0.6 — T7: тексты Экономии (чужой ГРБС + ложное «в норме»)

**Контекст (QA):** авто-инсайт при фильтре УО называет УФБП; баннер «Все показатели в норме»
рядом со «120 расхождений». Файл `Economy.tsx`; есть `packages/web/src/lib/economy-copy.ts`.

**Files:**
- Modify: `packages/web/src/lib/economy-copy.ts` (+ тесты)
- Create: `packages/web/src/lib/economy-copy.test.ts`
- Modify: `packages/web/src/pages/Economy.tsx` (использует чистые функции)

- [ ] **Шаг 1. Прочитать** `economy-copy.ts` и места :673-697 / :817-832 в Economy.tsx — понять,
  как формируется фраза расхождений и статус баннера, откуда берётся «УФБП» (топ-расхождения по
  ВСЕМ депам вместо отфильтрованных).
- [ ] **Шаг 2. Тест** `economy-copy.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildEconomyInsight, economyBannerStatus } from './economy-copy'; // сверить/создать экспорты

describe('economy-copy (T7)', () => {
  it('инсайт не называет ГРБС вне выбранных', () => {
    const insight = buildEconomyInsight({
      selectedDepts: ['УО'],
      conflictsByDept: { 'УО': 120, 'УФБП': 5 },
    });
    expect(insight).toContain('УО');
    expect(insight).not.toContain('УФБП');
  });
  it('статус не «в норме» при конфликтах > 0', () => {
    expect(economyBannerStatus({ conflicts: 120 }).ok).toBe(false);
  });
  it('статус «в норме» только при нуле конфликтов и отклонений', () => {
    expect(economyBannerStatus({ conflicts: 0 }).ok).toBe(true);
  });
});
```
  (Точные сигнатуры функций подогнать под то, что реально нужно Economy.tsx — сначала прочитать
  вызывающий код, вынести ровно те входы, что у него есть.)
- [ ] **Шаг 3. RED → Шаг 4. Реализация чистых функций + подключение в Economy.tsx → Шаг 5. GREEN.**
- [ ] **Шаг 6. Гейт** + **Шаг 7. Коммит:** `fix(web): тексты Экономии — свой ГРБС в инсайте, честный статус баннера (T7)`.

---

## Задача 0.7 — T8: баннер года только при реальном несовпадении

**Контекст (QA D19):** баннер «данные за другой год» виден при year=2026 и dataYear=2026.
Механизм: `Dashboard.tsx:214-219` + `useFilteredData` yearMismatch.

**Files:**
- Create/Modify: чистая `shouldShowYearMismatch(storeYear, dataYear, isLoading)` (в
  `packages/web/src/lib/year-mismatch.ts` или экспорт из useFilteredData-модуля) + тест
- Modify: `Dashboard.tsx` / `useFilteredData.ts` использует функцию

- [ ] **Шаг 1. Грепнуть** `yearMismatch` — понять текущее условие и почему ложно срабатывало
  (кандидаты: year='all' vs числовой dataYear; сравнение во время рефетча; тип-микс number/строка).
- [ ] **Шаг 2. Тест** `year-mismatch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { shouldShowYearMismatch } from './year-mismatch';

describe('shouldShowYearMismatch (T8)', () => {
  it('одинаковый год → не показывать', () => {
    expect(shouldShowYearMismatch(2026, 2026, false)).toBe(false);
  });
  it('во время загрузки → не показывать (данные ещё старые)', () => {
    expect(shouldShowYearMismatch(2025, 2026, true)).toBe(false);
  });
  it('year="all" → не показывать (агрегат всех лет)', () => {
    expect(shouldShowYearMismatch('all', 2026, false)).toBe(false);
  });
  it('реальное несовпадение и не загрузка → показать', () => {
    expect(shouldShowYearMismatch(2025, 2026, false)).toBe(true);
  });
});
```
- [ ] **Шаг 3. RED → Шаг 4. Функция:**
```ts
export function shouldShowYearMismatch(storeYear: number | 'all', dataYear: number | undefined, isLoading: boolean): boolean {
  if (isLoading) return false;
  if (storeYear === 'all') return false;
  if (dataYear == null) return false;
  return storeYear !== dataYear;
}
```
- [ ] **Шаг 5. Подключить** в Dashboard/useFilteredData (заменить инлайн-условие вызовом). GREEN.
- [ ] **Шаг 6. Гейт** + **Шаг 7. Коммит:** `fix(web): баннер года только при реальном несовпадении (T8)`.

---

## Задача 0.8 — T9: скрипт переписи остатка сверки

**Контекст (спека §17 шаги 1-2):** нужен полный список расхождений всех трёх сверок с
предварительной категорией. Это ЧТЕНИЕ через API (dev-сервер на :3000), продукт не трогается.

**Files:**
- Create: `scripts/recon_census.py`

- [ ] **Шаг 1. Прочитать** формы ответов: `reconciliation.ts` (три роута), `/svod/unified`
  (`dashboard.ts:570`), тип `SvodReconRow` в shared — понять поля статуса/расхождения.
- [ ] **Шаг 2. Написать скрипт** (Python 3.12, stdlib+urllib, БЕЗ print кириллицы — вывод в
  UTF-8 файл `docs/superpowers/qa/recon-census-<дата>.md`). Структура:
  - для каждого года {2025, 2026, all}: GET /api/reconciliation, /api/reconciliation/monthly,
    /api/svod/unified?year=;
  - извлечь все строки со статусом ≠ «совпадает» (реальные поля — по шагу 1);
  - на каждое: `сверка · ГРБС · метрика/ячейка · официальное · расчётное · Δ · Δ% · категория`;
  - категория-эвристика: та же величина с обратным знаком → `знак`; официальное 0/пусто →
    `пусто в листе`; |Δ%|<1% → `округление`; иначе → `требует разбора`;
  - выход: сводная таблица + счётчики по категориям + по ГРБС.
  - секция самопроверки: assert на shape ответов (если API вернул иную форму — явная ошибка,
    не молчание).
- [ ] **Шаг 3. Запустить** (dev-сервер поднят): `python scripts/recon_census.py`. Прочитать
  результат Read-tool'ом.
- [ ] **Шаг 4. Коммит:** `chore(qa): скрипт переписи остатка сверки + отчёт (T9, спека §17)`.

---

## Задача 0.9 — категоризация + письменный ответ «почему сверка расходилась»

**Зависит от:** 0.8 (перепись готова).

- [ ] **Шаг 1.** По отчёту переписи разнести каждое расхождение по 4 категориям (наш баг движка
  / дефект формулы листа / методологическое различие / ошибка ввода ГРБС).
- [ ] **Шаг 2.** Написать `docs/superpowers/qa/recon-why-2026-07-13.md` — прямой ответ
  пользователю: почему сверка показывала расхождения всё время, что из этого уже устранено
  (знак, база год/все-годы, латиница↔кириллица, AD-гейт), что осталось и в какой категории.
- [ ] **Шаг 3.** Завести в `docs/PLAN.md` / фазу 5 задачи по «нашим багам» из категоризации;
  «дефекты листа» → задача фазы 5.4 (бейдж «лист ошибается, вот доказательство»).
- [ ] **Шаг 4. Коммит:** `docs(qa): категоризация остатка сверки + ответ «почему расхождения» (0.9)`.

---

## DoD фазы 0

- [ ] Каждый показанный фильтр применяется (T3-T5 + контракт-тесты зелёные).
- [ ] Ни одной тихой потери строк (B-8) + сигнал unknown-листа.
- [ ] Честные подписи (T6) и тексты (T7, T8).
- [ ] Перепись сверки завершена (T9), остаток категоризирован (0.9), письменный ответ отдан.
- [ ] `docs/PLAN.md` обновлён (B-8/B-10 закрыты).
- [ ] Гейт зелёный на каждом коммите; `ml sync` в конце фазы.

## Self-review плана (проведён)

- **Покрытие спеки:** §8 (канон фильтров) → T3-T5; §15 дефициты Реестра/Экономии → T3,T4,T7;
  §16 (сигналы, тихие потери) → B-8; §17 (сверка-ноль шаги 1-2) → T9, 0.9; §20 (D9 подпись) → T6;
  D19 → T8. Долги дорожки B → 0.1.
- **Плейсхолдеры:** код задач конкретен; места, требующие сверки реальных значений стора
  (BudgetType в T4, форма KB-registry в T6, поля ответов API в T9), помечены явной инструкцией
  «сначала грепнуть/прочитать» — это не плейсхолдер, а обязательный шаг верификации против HEAD
  (у меня нет права галлюцинировать значения, которых не видел).
- **Согласованность типов:** `droppedRows` (0.1), `planYear` (0.2), `filterRowsByBudgets`/
  `BudgetRow` (0.3), `aggregateSignalCounts` (0.4), `deltaQuarter` (0.5), `buildEconomyInsight`/
  `economyBannerStatus` (0.6), `shouldShowYearMismatch` (0.7) — имена сквозные, не пересекаются.
