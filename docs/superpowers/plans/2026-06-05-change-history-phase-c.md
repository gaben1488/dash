# История изменений — Фаза C (MVP: snapshot-diff метрик) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Spec:** `docs/superpowers/specs/2026-06-05-change-history-design.md`. Эта фаза = слой 1 (snapshot-diff) + инлайн Δ-бейдж + тумблер «изменения с [дата]». Ноль новых таблиц — данные есть (`snapshots` + `metric_history`).

**Goal:** Показать руководителю дрейф метрик «неделю назад vs сейчас» — Δ-бейдж цветом по смыслу на метриках Пульта/Свода, с тумблером в шапке.

**Architecture:** Чистая функция `diffMetrics(from, to)` в `@aemr/core` (изолированно тестируема) → REST `/api/history/*` в server (список снимков + diff) → web: store-тумблер `changeWindow` + `<DeltaBadge>` на метриках. Сентимент (рост ЕП = внимание, рост экономии = хорошо) — справочником, цвет по нему.

**Tech Stack:** TypeScript ESM, vitest, drizzle (better-sqlite3), Fastify, React 19 + zustand store.

---

## Файлы

- Create: `packages/core/src/history/snapshot-diff.ts` — типы `MetricDelta`/`MetricRow` + `diffMetrics()` + `sentimentFor()`.
- Create: `packages/core/src/history/snapshot-diff.test.ts` — юнит.
- Modify: `packages/core/src/index.ts` — реэкспорт.
- Create: `packages/server/src/routes/history.ts` — `GET /api/history/snapshots`, `GET /api/history/diff?from=&to=`.
- Modify: `packages/server/src/index.ts` (или `app.ts`) — регистрация роута (по образцу существующих `*Routes`).
- Create: `packages/web/src/components/DeltaBadge.tsx` — бейдж дельты.
- Modify: `packages/web/src/store.ts` — поле `changeWindow:{enabled,sinceISO}` + `setChangeWindow`.
- Modify: `packages/web/src/components/Header.tsx` — тумблер «изменения с [дата]» (по образцу period/budget-тумблеров).

---

## Task 1: ядро `diffMetrics` (core, TDD)

**Files:** Create `packages/core/src/history/snapshot-diff.ts` + `...snapshot-diff.test.ts`; Modify `packages/core/src/index.ts`.

- [ ] **Step 1 — failing test** (`snapshot-diff.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { diffMetrics, sentimentFor, type MetricRow } from './snapshot-diff.js';

describe('diffMetrics', () => {
  const from: MetricRow[] = [
    { metricKey: 'sole.year.share',  numericValue: 0.5039, at: '2026-05-29' },
    { metricKey: 'economy.year.total', numericValue: 33503, at: '2026-05-29' },
    { metricKey: 'gone.metric', numericValue: 10, at: '2026-05-29' },
  ];
  const to: MetricRow[] = [
    { metricKey: 'sole.year.share',  numericValue: 0.5406, at: '2026-06-05' },
    { metricKey: 'economy.year.total', numericValue: 52781, at: '2026-06-05' },
    { metricKey: 'new.metric', numericValue: 5, at: '2026-06-05' },
  ];
  it('считает дельту, направление и сентимент', () => {
    const map = Object.fromEntries(diffMetrics(from, to).map(d => [d.metricKey, d]));
    expect(map['sole.year.share'].deltaAbs).toBeCloseTo(0.0367, 4);
    expect(map['sole.year.share'].direction).toBe('up');
    expect(map['sole.year.share'].sentiment).toBe('bad');      // рост доли ЕП = внимание
    expect(map['economy.year.total'].direction).toBe('up');
    expect(map['economy.year.total'].sentiment).toBe('good');  // рост экономии = хорошо
  });
  it('появление/исчезновение метрики не даёт NaN', () => {
    const map = Object.fromEntries(diffMetrics(from, to).map(d => [d.metricKey, d]));
    expect(map['gone.metric'].direction).toBe('disappeared');
    expect(map['new.metric'].direction).toBe('appeared');
    expect(Number.isNaN(map['new.metric'].deltaPct as number)).toBe(false);
  });
  it('sentimentFor: flat = neutral', () => {
    expect(sentimentFor('economy.year.total', 'flat')).toBe('neutral');
  });
});
```
- [ ] **Step 2 — run, verify FAIL:** `pnpm -F @aemr/core test snapshot-diff` → FAIL (module not found).
- [ ] **Step 3 — implement** (`snapshot-diff.ts`):
```ts
export type Direction = 'up' | 'down' | 'flat' | 'appeared' | 'disappeared';
export type Sentiment = 'good' | 'bad' | 'neutral';
export interface MetricRow { metricKey: string; numericValue: number | null; at: string }
export interface MetricDelta {
  metricKey: string;
  from: { value: number | null; at: string } | null;
  to:   { value: number | null; at: string } | null;
  deltaAbs: number | null;
  deltaPct: number | null;     // доля (0.1 = +10%), null если from=0/нет
  direction: Direction;
  sentiment: Sentiment;
}
// «рост = плохо» (внимание): доля ЕП, аномалии, просрочки; «рост = хорошо»: экономия, исполнение, потрачено
const UP_IS_BAD = [/доля.*еп|ep.*share|sole.*share|просроч|overdue|наруш|аномал/i];
const UP_IS_GOOD = [/эконом|econom|savings|исполн|exec|потрач|spent/i];
export function sentimentFor(metricKey: string, dir: Direction): Sentiment {
  if (dir === 'flat') return 'neutral';
  const up = dir === 'up' || dir === 'appeared';
  if (UP_IS_BAD.some(r => r.test(metricKey)))  return up ? 'bad'  : 'good';
  if (UP_IS_GOOD.some(r => r.test(metricKey))) return up ? 'good' : 'bad';
  return 'neutral';
}
export function diffMetrics(from: MetricRow[], to: MetricRow[]): MetricDelta[] {
  const fm = new Map(from.map(r => [r.metricKey, r]));
  const tm = new Map(to.map(r => [r.metricKey, r]));
  const keys = new Set([...fm.keys(), ...tm.keys()]);
  const out: MetricDelta[] = [];
  for (const k of keys) {
    const f = fm.get(k), t = tm.get(k);
    const fv = f?.numericValue ?? null, tv = t?.numericValue ?? null;
    let direction: Direction;
    if (f && !t) direction = 'disappeared';
    else if (!f && t) direction = 'appeared';
    else if (fv === null || tv === null || fv === tv) direction = 'flat';
    else direction = tv > fv ? 'up' : 'down';
    const deltaAbs = (fv !== null && tv !== null) ? tv - fv : (tv ?? fv);
    const deltaPct = (fv !== null && tv !== null && fv !== 0) ? (tv - fv) / Math.abs(fv) : null;
    out.push({
      metricKey: k,
      from: f ? { value: fv, at: f.at } : null,
      to:   t ? { value: tv, at: t.at } : null,
      deltaAbs, deltaPct, direction, sentiment: sentimentFor(k, direction),
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0));
}
```
- [ ] **Step 4 — run, verify PASS:** `pnpm -F @aemr/core test snapshot-diff` → PASS.
- [ ] **Step 5 — реэкспорт:** в `packages/core/src/index.ts` добавить `export * from './history/snapshot-diff.js';`.
- [ ] **Step 6 — commit:** `git add packages/core/src/history packages/core/src/index.ts && git commit -m "feat(core): diffMetrics snapshot-diff + sentiment"`

## Task 2: REST `/api/history/*` (server)

**Files:** Create `packages/server/src/routes/history.ts`; Modify регистратор роутов (`index.ts`/`app.ts`).
Снимки: таблица `snapshots` (`id`,`createdAt`); значения: `metric_history` (`snapshotId`,`metricKey`,`numericValue`). `MetricRow.at` = `snapshots.createdAt` соответствующего снимка.

- [ ] **Step 1 — тест** (`packages/server/src/routes/history.test.ts`): по образцу существующих route-тестов (см. `source-inventory.test.ts`) поднять app, замокать БД с 2 снимками (createdAt −7д и сегодня) + по 2 строки `metric_history`, дёрнуть `GET /api/history/diff?from=<s1>&to=<s2>`, проверить что вернулся массив `MetricDelta` с верными дельтами.
- [ ] **Step 2 — run FAIL.**
- [ ] **Step 3 — implement** `history.ts`: `GET /api/history/snapshots` → `db.select({id,createdAt}).from(snapshots).orderBy(desc(snapshots.createdAt))`; `GET /api/history/diff` → загрузить `metric_history` для двух `snapshotId` (join на createdAt), собрать `MetricRow[]` from/to, вернуть `diffMetrics(from,to)`. Регистрация — по образцу `journalRoutes`/`dashboardRoutes` в регистраторе.
- [ ] **Step 4 — run PASS.**
- [ ] **Step 5 — commit:** `git commit -m "feat(server): /api/history snapshots+diff"`

## Task 3: web — тумблер + `<DeltaBadge>` на метриках

**Files:** Create `packages/web/src/components/DeltaBadge.tsx`; Modify `store.ts`, `Header.tsx`, и места метрик Пульта/Свода.

- [ ] **Step 1 — тест** (`DeltaBadge.test.tsx`, по образцу web-тестов): рендер `<DeltaBadge delta={{direction:'up',sentiment:'bad',deltaPct:0.0367,...}}/>` → текст содержит `+3.7` и класс/цвет «внимание» (amber), а `sentiment:'good'` → зелёный.
- [ ] **Step 2 — run FAIL.**
- [ ] **Step 3 — implement** `DeltaBadge.tsx`: входной `MetricDelta`, рендер `▲/▼ {fmtPct(deltaPct)}` цветом по `sentiment` (good=emerald, bad=amber, neutral=zinc); тихий по умолчанию (маленький), клик → `onClick?` (поповер — фаза позже). `store.ts`: `changeWindow:{enabled:false, sinceISO:<−7д>}` + `setChangeWindow`. `Header.tsx`: тумблер «Δ с [дата]» по образцу существующих period/budget-тумблеров — при enabled фетчит `/api/history/diff?from=<снимок≤sinceISO>&to=<последний>` и кладёт map `metricKey→delta` в store.
- [ ] **Step 4 — run PASS.**
- [ ] **Step 5 — wire:** на метриках Пульта/Свода (там где `metricKey` известен) рядом со значением — `{changeWindow.enabled && deltas[key] && <DeltaBadge delta={deltas[key]}/>}`. Не зашумлять: только если есть дельта.
- [ ] **Step 6 — commit:** `git commit -m "feat(web): Δ-бейдж изменений метрик + тумблер окна"`

## Self-review (план vs спек)
- Спек §2-слой1 (snapshot-diff) → Task 1+2 ✓. §3-инлайн (Δ-бейдж+тумблер) → Task 3 ✓. §6 краевые (нет 2-го снимка → disabled; появление/исчезновение → не NaN) → покрыто тестами Task 1 + тумблер. §7 тесты → у каждой задачи TDD. Слой 2 (cell-edit), хаб, IA — фазы 2/3, отдельные планы (вне этого).
- Плейсхолдеров нет в ядре (Task 1 — полный код). Task 2/3 интеграция — «по образцу существующих X» т.к. агенты в коде; сигнатуры роута/стора не выдуманы.
- Типы консистентны: `MetricRow`/`MetricDelta`/`Sentiment`/`Direction` едины во всех задачах.

## Execution handoff
Этот план — для **dashboard-агентов** (мне код коммитить нельзя — гонка HEAD на общем дереве). Рекомендую им **subagent-driven** (по задаче на агента, ревью между). Фазы 2 (cell-edit `event_changelog`) и 3 (хаб «Доверие» + IA) — отдельные планы после фазы C.
