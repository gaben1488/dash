# Plan: Закрытие всех расхождений сверки + ревизия эвристик

## Контекст

CalcEngine создан и внедрён (92 теста, 0 TS ошибок). Сверка показывает ~340 метрик с calculated=0 при ненулевых official. Корень: orchestrator.ts не эмитирует 7 из 18 ROW_COLUMN_DEFS ключей. Плюс ложные срабатывания сигналов на незаполненных строках. Плюс одно реальное расхождение по УО economy.kp (51.3%).

---

## Часть 1: Недостающие ключи оркестратора

### 1.1 Per-method deviation + amount_dev + savings_pct
**Файл:** `core/src/pipeline/orchestrator.ts`, `mergeRecalcIntoMetrics()`

В per-quarter loop (после line 101) добавить для КП и ЕП:
```
deviation = fact - plan (count)      // col F
amount_dev = planSum - factSum (rub) // col P
savings_pct = amount_dev/planSum     // col Q
```
+ year-level (после line 165)
**~240 ключей**

### 1.2 Per-method per-budget economy (R-U)
В per-quarter loop добавить economy_fb/kb/mb/total для competitive и ep из `q.competitive.economyFB` etc.
+ year-level через `sumQ()`
**~320 ключей**

### 1.3 economy.kp/ep per-budget (year)
После line 194: `economy.kp.fb/kb/mb`, `economy.ep.fb/kb/mb`
**~48 ключей**

### 1.4 Summary amount_dev + savings_pct
**Файл:** `orchestrator.ts`, `mergeSummaryMetrics()`
**~20 ключей**

### 1.5 Summary economy per-budget
Aggregate from dept-level per-method economy
**~40 ключей**

### 1.6 Summary EP per-budget plan/fact
Аналогично KP (lines 291-298): sole.{p}.fb_plan/kb_plan/mb_plan/fb_fact/kb_fact/mb_fact
**~30 ключей**

---

## Часть 2: УО economy.kp (51.3% расхождение)

**Корень:** economyKpCell=U259 содержит ИТОГО 2025+2026, а CalcEngine фильтрует targetYear=2026. 2025 экономия ≈ 18,812 тыс.руб отсекается.

**Решение:** Не передавать targetYear для economy расчёта, ИЛИ указать economyKpCell на строку только-2026.

**Реализация:** В orchestrator.ts — второй compute() без targetYear только для economy, либо adapter собирает economy из ungated total.

---

## Часть 3: Ложные срабатывания сигналов

**Корень Y132 УКСиМП:** Rule 13 (formula_continuity) не различает "формула=0 из-за пустых входных" от "удалённая формула". Y132 = =V132+W132+X132 = 0, соседи имеют данные → ложный флаг.

### 3.1 Fix Rule 13: исключить Y/AC на plan-only строках
**Файл:** `shared/src/rule-book.ts`
Если row не имеет fact date (Q пусто) — не проверять Y и AC на formula continuity.

### 3.2 Fix dataQuality: не флагить plan-only строки
**Файл:** `core/src/pipeline/signals.ts`
dataQuality должен проверять обязательные поля только если row имеет fact date ИЛИ plan date в прошлом.

### 3.3 Fix economy_conflict: не флагить при fact=0
Не флагить конфликт если factTotal=0 (строка ещё не исполнена).

---

## Часть 4: Shared package тесты

Добавить `packages/shared/src/report-map.test.ts`:
- REPORT_MAP имеет >200 entries
- Все ключи следуют naming convention
- ROW_COLUMN_DEFS содержит 18 суффиксов

---

## Часть 5: SHDYU Q4

Не баг кода — данные не заполнены за Q4 в ШДЮ таблице. Добавить warning в reconcileMonthly() когда SHDYU=0 но calculated>0.

---

## Порядок выполнения

1. **Часть 1** (orchestrator emissions) — ~100 строк кода
2. **Часть 2** (УО economy year filter) — ~10 строк
3. **Часть 3** (signal false positives) — ~30 строк
4. **Часть 4** (shared tests) — ~40 строк
5. **Часть 5** (SHDYU warning) — ~5 строк
6. Верификация: tsc + vitest + manual recon check

## Ключевые файлы

| Файл | Изменение |
|------|-----------|
| `core/src/pipeline/orchestrator.ts` | +100 строк put()/putSummary() |
| `shared/src/rule-book.ts` | Fix Rule 13 gating |
| `core/src/pipeline/signals.ts` | Fix dataQuality/economy_conflict |
| `shared/src/report-map.test.ts` | NEW: shared tests |
| `core/src/pipeline/reconcile.ts` | SHDYU Q4 warning |

## Верификация

1. `npx tsc --noEmit` — 0 ошибок все 4 пакета
2. `npx vitest run` — 92+ тестов
3. Recon page: все "Допустимо" с Δ=100% → "Совпадает" (Δ<1%)
4. УО economy.kp: Δ<5% (вместо 51.3%)
5. Y132 УКСиМП: не флагится как ошибка
6. Plan-only строки: 0 ложных economy_conflict / dataQuality
