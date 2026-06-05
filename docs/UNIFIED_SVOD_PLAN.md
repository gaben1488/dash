# Unified СВОД — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development или superpowers:executing-plans, task-by-task. Steps — чекбоксы `- [ ]`.

**Goal:** Одна сверенная сетка `ГРБС × активность(4) × метод × бюджет × период(мес/кв/год)`, считаемая CalcEngine из атомов, сверяемая против листов СВОД ТД-ПМ + СВОД с месяцами, с единой таблицей в UI.

**Architecture:** Новая чистая функция `computeUnifiedGrid(deptRows)` в core считает все оси из 33-колоночных dept-строк (атомы). Листы = cross-check (доверие). Server кладёт сетку в snapshot + отдаёт API. Web рисует одну таблицу (переиспущенные компоненты + цветокод).

**Tech Stack:** TS ESM monorepo (@aemr/shared, /core, /server, /web), vitest, React 19, Tailwind.

**Spec:** `docs/UNIFIED_SVOD_DESIGN.md`.

---

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `packages/shared/src/activity-scope.ts` | modify | +scope `td_pm`, правило `D≠X/Х`, `PROGRAM_COL` |
| `packages/shared/src/unified-svod.ts` | create | типы `UnifiedCell/Row/Grid`, оси |
| `packages/shared/src/index.ts` | modify | реэкспорт unified-svod |
| `packages/core/src/pipeline/unified-svod.ts` | create | `computeUnifiedGrid(rows)` + `reconcileUnified` |
| `packages/core/src/pipeline/unified-svod.test.ts` | create | инварианты §7 |
| `packages/core/src/index.ts` | modify | экспорт computeUnifiedGrid |
| `packages/server/src/services/snapshot.ts` | modify | строит unifiedGrid из dept-rows + cross-check |
| `packages/server/src/routes/dashboard.ts` | modify | `/api/svod/unified` отдаёт сетку |
| `packages/web/src/lib/unified-svod-view.ts` | create | срез сетки под выбранные фильтры |
| `packages/web/src/pages/SvodView.tsx` | modify | одна таблица + фильтры активность(4)/период |

---

## Layer 1 — shared (контракты)

### Task 1: Расширить ось активности до td_pm

**Files:** Modify `packages/shared/src/activity-scope.ts`; Test `packages/shared/src/activity-scope.test.ts` (create)

- [ ] **Step 1: Failing test** — `activity-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesActivityScope, PROGRAM_EMPTY_MARKERS } from './activity-scope.js';

describe('td_pm scope', () => {
  it('td_pm = ТД with a real program in D', () => {
    const td = 'Текущая деятельность';
    expect(matchesActivityScope('td_pm', td, 'Муниципальная программа N')).toBe(true);
    expect(matchesActivityScope('td_pm', td, 'X')).toBe(false);
    expect(matchesActivityScope('td_pm', td, 'Х')).toBe(false);
    expect(matchesActivityScope('td_pm', td, '')).toBe(false);
  });
  it('td_pm excludes ПМ rows', () => {
    expect(matchesActivityScope('td_pm', 'Программное мероприятие', 'Программа N')).toBe(false);
  });
  it('all/pm/td unchanged', () => {
    expect(matchesActivityScope('all', 'Программное мероприятие', '')).toBe(true);
    expect(matchesActivityScope('pm', 'Программное мероприятие', '')).toBe(true);
    expect(matchesActivityScope('td', 'Текущая деятельность', 'X')).toBe(true);
  });
});
```

- [ ] **Step 2:** `pnpm -F @aemr/shared exec vitest run activity-scope` → FAIL.
- [ ] **Step 3: Implement.** Изменить `ActivityScope` тип на `'all'|'td'|'pm'|'td_pm'`; добавить `PROGRAM_EMPTY_MARKERS = new Set(['x','х',''])`; обновить `matchesActivityScope(scope, fValue, programValue?)`:

```ts
export type ActivityScope = 'all' | 'td' | 'pm' | 'td_pm';
export const ACTIVITY_SCOPES = ['all', 'td', 'pm', 'td_pm'] as const;
export const ACTIVITY_LABEL: Record<ActivityScope, string> = {
  all: 'ВСЕ', td: 'ТД', pm: 'ПМ', td_pm: 'ТД-ПМ',
};
const PROGRAM_EMPTY = new Set(['x', 'х', '']);
function hasProgram(programValue: unknown): boolean {
  return !PROGRAM_EMPTY.has(String(programValue ?? '').trim().toLowerCase());
}
export function matchesActivityScope(scope: ActivityScope, fValue: unknown, programValue?: unknown): boolean {
  if (scope === 'all') return true;
  const f = String(fValue ?? '').trim().toLowerCase();
  if (scope === 'pm') return f === 'программное мероприятие';
  if (scope === 'td') return f === 'текущая деятельность';
  // td_pm
  return f === 'текущая деятельность' && hasProgram(programValue);
}
```
(`ACTIVITY_LABEL.all` меняется с 'ТД-ПМ' на 'ВСЕ' — проверить потребителей; td_pm берёт метку 'ТД-ПМ'.)

- [ ] **Step 4:** vitest → PASS. Также `pnpm -F @aemr/shared exec vitest run` (регрессия потребителей ACTIVITY_LABEL).
- [ ] **Step 5: Commit** `feat(shared): activity scope td_pm (ТД с программой), program-column rule`.

### Task 2: Типы единой сетки

**Files:** Create `packages/shared/src/unified-svod.ts`; Modify `index.ts`.

- [ ] **Step 1:** Определить типы (без теста — чистые типы):

```ts
import type { ActivityScope } from './activity-scope.js';
export type SvodMethod = 'kp' | 'ep';
export type SvodPeriodKey = `m${number}` | `q${number}` | 'year';
/** Числа одной ячейки: кол-во + суммы ФБ/КБ/МБ план/факт/экономия. */
export interface UnifiedCell {
  planCount: number; factCount: number;
  planFB: number; planKB: number; planMB: number;
  factFB: number; factKB: number; factMB: number;
  economyFB: number; economyKB: number; economyMB: number;
}
/** Срез по (ГРБС × активность × метод × период). */
export interface UnifiedGrid {
  /** key: `${grbsId}|${scope}|${method}|${periodKey}` → cell */
  cells: Record<string, UnifiedCell>;
  grbsIds: string[];
  scopes: ActivityScope[];
}
export function unifiedKey(grbsId: string, scope: ActivityScope, method: SvodMethod, period: SvodPeriodKey): string {
  return `${grbsId}|${scope}|${method}|${period}`;
}
export const emptyCell = (): UnifiedCell => ({
  planCount: 0, factCount: 0, planFB: 0, planKB: 0, planMB: 0,
  factFB: 0, factKB: 0, factMB: 0, economyFB: 0, economyKB: 0, economyMB: 0,
});
```

- [ ] **Step 2:** index.ts: `export * from './unified-svod.js';`
- [ ] **Step 3:** `pnpm -F @aemr/shared run typecheck` → 0.
- [ ] **Step 4: Commit** `feat(shared): unified СВОД grid types`.

---

## Layer 2 — core (железобетон: вычисление из атомов + инварианты)

### Task 3: computeUnifiedGrid из dept-строк

**Files:** Create `packages/core/src/pipeline/unified-svod.ts`, `unified-svod.test.ts`; Modify `core/src/index.ts`.

**Маппинг столбцов атома (0-based):** D=3 program, F=5 activity, L=11 method, N=13 planDate, O=14 planQuarter, P=15 planYear, Q=16 factStatus(Х=нет), H/I/J=7/8/9 planFB/KB/MB, V/W/X=21/22/23 factFB/KB/MB, Z/AA/AB=25/26/27 ecoFB/KB/MB, AD=29 economyGate.

- [ ] **Step 1: Failing test** (инварианты §7) — `unified-svod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeUnifiedGrid } from './unified-svod.js';
import { unifiedKey } from '@aemr/shared';

// мини-атомы: [B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,...] — заполняем нужные индексы
function row(o: Partial<Record<number, unknown>>): unknown[] {
  const r = new Array(30).fill(''); for (const k in o) r[+k] = o[k as any]; return r;
}
describe('computeUnifiedGrid invariants', () => {
  const rows = {
    uo: [
      // ПМ, КП, Q1/2026, plan FB=100 fact FB=90 eco FB=10(gate да)
      row({3:'Программа A',5:'Программное мероприятие',11:'ЭА',14:1,15:2026,16:'2026-02-01',7:100,21:90,25:10,29:'да'}),
      // ТД с программой → td_pm, ЕП, Q1
      row({3:'Программа B',5:'Текущая деятельность',11:'ЕП',14:1,15:2026,16:'2026-02-01',7:50,21:50,25:0,29:'нет'}),
      // ТД без программы (X) → чистая ТД, КП, Q1
      row({3:'X',5:'Текущая деятельность',11:'ЭА',14:1,15:2026,16:'2026-03-01',7:30,21:0,25:0,29:'нет'}),
    ],
  };
  const grid = computeUnifiedGrid(rows);
  const cell = (s:any,m:any,p:any)=>grid.cells[unifiedKey('uo',s,m,p)];

  it('ВСЕ = ПМ + ТД (план кол-во, Q1)', () => {
    const all = ['kp','ep'].reduce((a,m)=>a+(cell('all',m,'q1')?.planCount??0),0);
    const pm = ['kp','ep'].reduce((a,m)=>a+(cell('pm',m,'q1')?.planCount??0),0);
    const td = ['kp','ep'].reduce((a,m)=>a+(cell('td',m,'q1')?.planCount??0),0);
    expect(all).toBe(3); expect(pm + td).toBe(3);
  });
  it('td_pm ⊂ td (td_pm.count ≤ td.count)', () => {
    expect(cell('td_pm','ep','q1')?.planCount).toBe(1);
    expect(cell('td','ep','q1')?.planCount).toBe(1); // строка B
    expect(cell('td','kp','q1')?.planCount).toBe(1); // строка C (X)
    expect(cell('td_pm','kp','q1')?.planCount ?? 0).toBe(0); // C без программы
  });
  it('год = Σ месяцев = Σ кварталов (план сумма ФБ, ВСЕ КП)', () => {
    const year = cell('all','kp','year')?.planFB ?? 0;
    expect(year).toBe(130); // строка A (100) + строка C (30), обе КП
    const q1 = cell('all','kp','q1')?.planFB ?? 0;
    expect(q1).toBe(130);
  });
  it('экономия только при gate да', () => {
    expect(cell('pm','kp','q1')?.economyFB).toBe(10); // строка A gate=да
  });
});
```

- [ ] **Step 2:** `pnpm -F @aemr/core exec vitest run unified-svod` → FAIL.
- [ ] **Step 3: Implement `computeUnifiedGrid`.** Для каждой dept-строки: распарсить активность(F)/программу(D)/метод(L)/период(O,P + месяц из N)/бюджеты; для каждого подходящего scope из `['all','pm','td','td_pm']` (через `matchesActivityScope`) и для месяца+квартала+года — аккумулировать в `cells[unifiedKey(...)]`. Экономию добавлять только при `AD='да'`. Метод: `L` начинается с 'ЕП' → 'ep', иначе 'kp'. Полный код — в Step (DRY: один проход, helper `addToCell`).
- [ ] **Step 4:** vitest → PASS (4 инварианта).
- [ ] **Step 5: Commit** `feat(core): computeUnifiedGrid from atoms (activity×method×budget×period) + invariants`.

### Task 4: reconcileUnified — cross-check против листов

**Files:** Modify `packages/core/src/pipeline/unified-svod.ts` (+`reconcileUnified`), `unified-svod.test.ts`.

- [ ] **Step 1: Failing test:** сверка `computeUnifiedGrid[all,Q1/year]` против officialMetrics СВОД ТД-ПМ → статус ok при Δ<1%, high при ≥5%. (тест с моками officialMetrics.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализовать `reconcileUnified(grid, officialMetrics, shdyuMonthly)` → `{ cellKey, calc, official, deltaPct, status, rootCause? }[]`. Переиспользовать `makeCell`-логику из reconcile.ts (Δ% пороги 1/5).
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(core): reconcileUnified cross-check vs СВОД sheets`.

---

## Layer 3 — server (API)

### Task 5: snapshot строит unifiedGrid + API

**Files:** Modify `packages/server/src/services/snapshot.ts`, `routes/dashboard.ts`.

- [ ] **Step 1:** В snapshot после чтения dept sheetRows: `const unifiedGrid = computeUnifiedGrid(deptRowsById)` + `reconcileUnified(...)`; положить в snapshot.
- [ ] **Step 2:** `routes/dashboard.ts`: эндпоинт `GET /api/svod/unified` → `{ grid, reconciliation }`.
- [ ] **Step 3:** Тест `server` (vitest) на форму ответа (мок snapshot).
- [ ] **Step 4:** `pnpm -F @aemr/server run typecheck` + vitest → green.
- [ ] **Step 5: Commit** `feat(server): /api/svod/unified — grid + reconciliation from snapshot`.

---

## Layer 4 — web (одна таблица)

### Task 6: client view + одна таблица с фильтрами

**Files:** Create `packages/web/src/lib/unified-svod-view.ts`; Modify `packages/web/src/pages/SvodView.tsx`.

- [ ] **Step 1:** `unified-svod-view.ts`: `sliceUnified(grid, {scope, period, methods, budgets, depts})` → `SvodView`-совместимая структура (переиспуем `BlockGroup`). Тест на бюджет-фильтр + scope.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** `SvodView.tsx`: фетч `/api/svod/unified`; добавить тумблеры **активность (ВСЕ/ПМ/ТД/ТД-ПМ)** и **период (мес/кв/год)**; одна таблица (вместо СВОД+ШДЮ) с цветокодом (уже есть) + колонка «сверено ✓/⚠». Старые две таблицы → одна.
- [ ] **Step 4:** `pnpm -F @aemr/web run typecheck` + lint → 0 errors.
- [ ] **Step 5: Commit** `feat(web): unified СВОД table — activity(4)/period filters + reconciliation column`.

---

## Layer 5 — verify + deploy

### Task 7: Полная верификация + деплой

- [ ] typecheck все · `pnpm -r test` · lint · build · audit · diff-check — всё green.
- [ ] Инварианты §7 зелёные (core тесты).
- [ ] Деплой на VPS; live `/api/svod/unified` 200; визуальная приёмка одной таблицы + 4 среза + период.
- [ ] **Commit** + mark_chapter + mulch record.

---

## Self-Review (план vs спека)

- §3 атом-маппинг → Task 3 (column indices). ✓
- §4 активность 4 → Task 1 (matchesActivityScope td_pm). ✓
- §5 период мес/кв/год → Task 3 (аккумуляция). ✓
- §7 инварианты → Task 3 тесты (1,2,3,5) + Task 4 (3,4). ✓ (инвариант 4 «AN4-срез» — частично, зависит от чтения AN4; помечено в Task 4.)
- §8 UI одна таблица → Task 6. ✓
- Типы: `UnifiedCell/Grid`, `unifiedKey`, `ActivityScope` — согласованы между Task 2/3/6.
