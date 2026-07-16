# Проводка ядра на экран (E4) — готовая к реализации спека — 2026-07-16

> **Задача.** Решение пользователя 15.07: «сначала вывести ядро». Каждая невыведенная
> способность ядра либо получает готовую спеку подключения, либо мотивированный вердикт
> «не выводить». Все статусы проверены **на HEAD ветки `claude/refactor-consolidation`**
> и **на живом API** (`http://localhost:3000`, реальные данные, curl 2026-07-17).
> Инвентарь-предшественники: `qa/code_quality_audit_2026-07-15.md` §4,
> `specs/target-architecture-2026-07-15.md` §2 (muda) и §5 (правила),
> `plans/REMAINING-2026-07-15.md` E4/E7.
>
> **Поправки к аудиту 07-15 (перепроверено на HEAD):** с момента аудита уже проведены
> `getSvodUnified` (жив в `SvodView.tsx:194`), `getAnalyticsForecast` (жив в
> `Analytics.tsx:129`, карточка «Прогноз исполнения»), `getAnalyticsCentralization`
> (жив в `Analytics.tsx:1058`, `CentralizationCard`, коммит `96d95f0`). Реально мёртвых
> клиентских функций осталось **16 из 43** (grep `api.<fn>` по web/src на HEAD, см. §4.4).

---

## §1. Полный инвентарь способностей ядра

Готовность live: 🟢 = curl 200, данные осмысленные; 🟡 = работает, но с оговоркой;
🔴 = не работает/данные врут; ⚪ = не проверяемо снаружи (нет роута).
Усилие: S ≤ 0.5 сессии, M ≈ 1 сессия, L > 1 сессии.
«Куда» — по целевой IA to-be (`target-architecture` §3.1): **Отчёт / Реестр /
Лаборатория / Данные**; до переплавки E9 физически = Analytics.tsx / Quality.tsx.

| # | Способность | Что считает (вход → выход) | Готовность live | Куда | Усилие | Ценность (что увидит и решит пользователь) |
|---|---|---|---|---|---|---|
| 1 | **datasetAnalyses** (`orchestrator.ts:486-511` → `dataset-signals.ts:543 analyzeDataset`) | Строки листа + row-signals → на каждый ГРБС: Benford (MAD/Nigrini), Z-выбросы, composite score A-E с 4 компонентами, 5-уровневый ЕП-риск, noise map, сезонные аномалии, дробление | 🟢 **уже приезжает в браузер**: `/api/dashboard → snapshot.datasetAnalyses`, 8 ГРБС; живьём: Benford `nonconforming` у 5/8, composite 17.75(B)…47.75(D), сезонные УКСиМП 6 / УО 23, выбросы УО 39. web читает **0 раз** (grep `datasetAnalyses` по web/src = 0) | Лаборатория (сейчас Analytics.tsx) | **S** (только web!) | Аудиторский вердикт по каждому ГРБС одним экраном: «у 5 из 8 суммы не проходят закон Бенфорда, у УО 39 выбросов и 23 сезонные аномалии» → куда направить проверку |
| 2 | **scorecard** (`routes/analytics.ts:161`; ядро: `grbs-grade.ts:50` + `discipline-index.ts` + `anticorruption.ts:236`) | Профили + строки → грейд A-D со score и причинами, индекс дисциплины 0-100 с режимом (НОРМА/ВНИМАНИЕ/ТРЕВОГА) и доминирующим фактором, готовый narrative, топ-3 антикор-флага, riskLevel | 🟢 curl 200; живьём: УЭР C/68, дисциплина 38 «ТРЕВОГА», причины «доля ЕП 52% > нормы 50%, нарушений 44-ФЗ: 7»; УАГЗО дисциплина 7/100. Клиента нет (grep scorecard по web/src = 0) | Лаборатория | **S** | Управленческий рейтинг 8 ГРБС с готовой формулировкой причин — прямой кандидат в еженедельный доклад начальству: кого вызвать, за что спросить |
| 3 | **compliance-44fz** (`routes/analytics.ts:43`; ядро: `compliance-44fz.ts` — `checkEPContractLimits`, `checkAntiDumping`, `checkEPShareLimits`) | Строки → нарушения с кодом правила, статьёй 44-ФЗ, порогом, фактическим значением, номером строки | 🟢 curl 200: 51 warning, 0 critical; каждое адресно («ст. 37, строка 6, 29.7% > 25%»); честная оговорка «прокси от лимита, не НМЦК» уже в тексте | Лаборатория | **S** (обёртка `getAnalyticsCompliance` уже есть в api.ts:201 — мертва) | Юридически адресный список: статья + строка + порог. Решение: поручить ГРБС объясниться по конкретным строкам |
| 4 | **anticorruption** (`routes/analytics.ts:126`; ядро: `anticorruption.ts:236 detectAntiCorruption`) | Строки + ЕП-доля → флаги price_inflation / zero_competition / … с severity и адресом строки | 🟢 curl 200, 18.7 КБ; живьём УИО: «нулевая экономия в 22/28 (79%) конкурентных — возможна имитация конкуренции» | Лаборатория (деталь-панель scorecard) | **S** | Развёртка «почему у ГРБС N антикор-флагов» из карточки №2; топ-3 уже в scorecard — полный список по клику |
| 5 | **recommendations.ts** (`pipeline/recommendations.ts:65` — 13 правил-порогов: ЕП>60%, AD-пустота>50%, q1<30%, overdue, спорная экономия, подписан-без-факта, дельта официал/расчёт, trust<60/80…) | RecommendationInput (метрики ГРБС из recalcResults + сигналы + trust) → Recommendation{type, priority 0-5, title, description} | ⚪ мёртвый модуль: не в `core/src/index.ts`, 0 импортёров (перепроверено grep на HEAD). Все входы доступны в снапшоте | Контроль→Рекомендации (Recs.tsx), фундамент E7 | **M** | Recs.tsx сейчас лепит рекомендации клиентски из issues (`Recs.tsx:72-84`) — движок заменяет самоделку на 13 канонических правил с приоритетами; это же — сущность Recommendation для реакций ГРБС (E7) |
| 6 | **anomaly.ts** (`analytics/anomaly.ts`: `benfordAnalysis` χ²+p-value :53, `zScoreAnalysis` :153, `ewmaDetection` :111) | Суммы → Benford χ²/p; метрики по ГРБС → Z-выбросы; временной ряд → EWMA-дрейф | 🟢 роут `/api/analytics/anomalies` живой: УИО p=0 (не проходит Бенфорда), Z-выбросы по исполнению и ЕП-доле. **`ewmaDetection` не зовёт никто нигде** (grep по всем пакетам = только export) | частично дублирует №1 — см. §4.1 | S/— | Второе мнение по Бенфорду (χ² против MAD в №1). EWMA заработает только когда появится потребитель временных рядов (история снапшотов) |
| 7 | **trust/scorer** (`trust/scorer.ts:60 computeTrustScore`) | Метрики+issues+deltas → trust 0-100 по 5 компонентам | 🟢 **уже выведен**: dashboard.ts:125,434 → DTO → Trust.tsx. Оставшийся сирота — `/api/trust/:deptId` (dashboard.ts:409, curl 200) | — (выведено) | — | Пер-ГРБС деталь уже показывается из dashboard-DTO; отдельный роут избыточен → §4 |
| 8 | **forecast** (`analytics/forecast.ts: linearForecast, seasonalForecast, buildScenarios`) | Месячные факты + план → 3-4 сценария год-конец с confidence | 🟢 **уже выведен**: `/api/analytics/forecast/:deptId` ← `Analytics.tsx:129`, карточка «Прогноз исполнения»; curl: УЭР 68.7% базовый / 82.5% оптимистичный | — (выведено) | — | Сделано после аудита 07-15 — из списка E4 вычеркнуть |
| 9 | **risk / grbs-profile** (`grbs-profile.ts buildGRBSProfiles`, роут `/api/analytics/profiles`) | recalcResults → роль ГРБС, ожидаемое/фактическое исполнение, отклонения, riskLevel | 🟢 curl 200; но **все поля уже входят в scorecard** (№2 возвращает execPct, epShare, riskLevel, role) | — | — | Отдельная карточка не нужна — дубль №2 → §4 |
| 10 | **seasonal-детекторы** (`pipeline/seasonal.ts:61 detectSeasonalAnomalies`; ожили после serial-фикса `parseSheetDate`) | Строки с датами → аномалии календаря (декабрьский вал, задним числом…) | 🟢 живые данные внутри №1: УКСиМП 6, УО 23, остальные 0 | Лаборатория — внутри панели №1 | — (входит в №1) | Часть аудит-вердикта: «у УО 23 закупки с аномальным календарём» |
| 11 | **quarterExecution** (`metrics/quarter-execution.ts:84`, коммит `afbb771`, фаза 1.3 Отчёта 2.0) | Счётчики план/факт квартала → каноническая метрика исполнения с режимами округления | ⚪ экспортирован из core/index.ts:28, **0 потребителей** вне своего файла (grep server+web+core = 0) | не UI — потребитель = `buildReport` (E3, фаза 1.4) | — | Строился как канон для Отчёта 2.0; выводить в UI отдельно нечего — судьба решается E3 |
| 12 | **parseSvodGrid** (`shared/svod-grid.ts:113`, коммит `cfe3ce4`, свежий) | Полный лист СВОД ТД-ПМ → структурные блоки (ре-реверс всего листа, а не трети) | ⚪ 0 потребителей вне shared (grep = только index.ts + тест) | не UI — потребитель = сверочный модуль «сводная↔отдельные» (E2) | — | Кирпич D1-переезда: сводная книга уходит в роль сверки — parseSvodGrid и есть её читатель |
| 13 | **centralization 2.0** (спека `research/joint-procurement-principles-2026-07-15.md` §5; текущий `centralization.ts` выведен `96d95f0`) | Строки всех ГРБС → JointProposal с адресными номерами п/п, серией одного заказчика, ЕП→ЭА, риск-факторами, reportText | 🟢 v1 живой (curl: «Ремонт, 5 управлений, 318.6 млн, экономия 47.8 млн»); **v2 не написан** — v1 инвертирован против практики (отбрасывает ЕП — главный источник кандидатов, §6 спеки) | Лаборатория / Отчёт (E5) | **L** | Адресные предложения совмещения в формате ручного отчёта («1343,1473 мебель — объединить в совместный аукцион») — ядро эпика E5 |
| 14 | **ep-reasons** (`routes/analytics.ts:97`; ядро: `analyzeEPReasons` из compliance-44fz.ts) | AE-обоснования ЕП → распределение по пунктам ч.1 ст.93 | 🟡 curl 200, но классификатор не матчит: у УЭР и УИО **100% в «иное»** (все п1…п29 = 0) — регексы не находят реальные формулировки | Лаборатория — после фикса парсера | M | В текущем виде покажет пустышку; ценность появится после доработки `ae-parser`/регексов (связка с E5-словарём причин) |
| 15 | **subjects** (`routes/analytics.ts:329 buildSubjectAnalysis`) | Строки → категории закупок по ГРБС (count/сумма/средний чек/топ-предметы) | 🟢 curl 200, 33 КБ; но у УЭР 25/35 строк в «Другое» — классификатор из 16 регексов груб | Лаборатория (или дождаться E5-кластеризации) | M | Структура закупок по категориям; честнее подождать subject-classify 2.0 (E5), чтобы не показывать «Другое = 71%» |
| 16 | **history/snapshot-diff** (`history/snapshot-diff.ts`; роуты `/api/history/snapshots` :11, `/api/history/diff` :16) | Снапшоты БД → список с trust/issues; два id → пометрический дифф | 🟢 snapshots: curl 200, живой список (trust 82 B, 955 issues, каждые ~5 мин); diff требует from/to | Данные (сейчас Quality→Journal) | M | «Что изменилось между вчера и сегодня» — кирпич changeWindow/E3 (Δ4/Δ5 переносы дат — E6) |
| 17 | **cell-refs** (`routes/analytics.ts:394`) | metricKey → лист/ячейка/формула + прямой URL в Google Sheets | 🟢 curl 200: `D9 → https://docs.google.com/...range=D9` | Отчёт 2.0 — оверлей-доказательство claim'а (E3) | — (ждёт E3) | «Открыть ячейку-источник в Sheets» — это и есть evidence-оверлей Отчёта; выводить отдельно от E3 бессмысленно |
| 18 | **`/api/reconcile` + `/api/reconcile/:deptId`** (rows.ts:743,801) | Перегруппировка snapshot.deltas по ГРБС | 🟢 curl 200, 189 КБ | — | — | Дубль семантики `/api/reconciliation` (Recon.tsx уже живёт на ней) → снести, §4 |
| 19 | **`/api/reconciliation/quarterly`** (dashboard.ts:539) | ШДЮ-суммы vs СВОД по кварталам | 🔴 curl 200, но данные врут: `svodValue:0` во всех ячейках → deltaPct 13700% | — | — | Не выводить до фикса маппинга СВОД-стороны; в текущем виде это генератор паники → §4 |
| 20 | **Служебные сироты**: `/api/metrics`(+`/:key`), `/api/report-map`, `/api/journal/stats`, `/api/export/audit`, POST `/api/load-all`, POST `/api/sources/:name/test`, GET `/api/rows/:deptId/:rowIndex`, GET `/api/issues/:id`, `/api/reconciliation/monthly/diagnostics` | разное | 🟢/🟡 (metrics/journal-stats живые; load-all — POST-only; journal/stats: uniqueUsers=0) | — | — | по одному вердикту в §4 |

**Сквозная оговорка готовности (общая для №2-4, 6, 14, 15):** все analytics-роуты зовут
`getSnapshot()` **без года** (`routes/analytics.ts` — `request.query` читается только в
subjects/forecast для dept), а `getSnapshot(force, targetYear?)` без года агрегирует
«все годы» (`snapshot.ts:126-131`). Dashboard год передаёт (`dashboard.ts:16-25`).
Проводка волны 1 обязана добавить `?year` в роуты и прокинуть год из глобального
фильтра store — иначе карточки Лаборатории разъедутся с остальным экраном по периоду.

---

## §2. DTO/компонент-контракты волны 1 (готовые к коду)

Правила, которым подчиняется вся проводка (target-architecture §5): новый роут/функция
api.ts — только вместе с потребителем в том же изменении (§5-12); подписи — из
`SIGNAL_LABELS`/словаря продукта (§5-4/5-5); web импортирует из core только `METRIC_KB`
и **типы** (§5-9) — поэтому DTO-типы ниже кладём в `@aemr/shared` (`types.ts` или новый
`shared/src/analytics-dto.ts`), а core-типы (`DatasetAnalysis`) web берёт как `import type`.

### 2.1. W1-A: панель «Аудит данных» из datasetAnalyses (только web)

Данные **уже в браузере** — `store.dashboardData.snapshot.datasetAnalyses`. Ноль серверного кода.

```ts
// packages/web/src/lib/dataset-audit.ts (новый, чистые селекторы + тест)
import type { DatasetAnalysis } from '@aemr/core'; // type-only — разрешено §5-9

export interface DeptAuditRow {
  deptId: string;                        // ключ snapshot.datasetAnalyses
  compositeScore: number;                // 0-100, меньше = лучше (шкала GS-порта)
  compositeGrade: string;                // 'A'…'E'
  benfordConformity: DatasetAnalysis['benford']['conformity']; // close|acceptable|marginal|nonconforming
  benfordMad: number;
  outlierCount: number;
  epRiskLevel: DatasetAnalysis['epRisk']['level'];  // НИЗКИЙ…КРИТИЧЕСКИЙ
  seasonalCount: number;
  splittingCount: number;
  noiseGroups: Array<{ label: string; count: number }>; // топ-3 из noiseMap
}
export function selectDatasetAudit(
  analyses: Record<string, DatasetAnalysis> | undefined,
): DeptAuditRow[];
```

Компонент — в стиле существующего `AnalyticsCard` (`Analytics.tsx:51`,
`{title, icon, source, defaultOpen}`, бейдж source='calculated'):

```tsx
<AnalyticsCard
  title={`Аудит данных: закон Бенфорда нарушен у ${nonconf}/${rows.length} управлений`}
  icon={Microscope} source="calculated">
  {/* таблица: ГРБС | композит (грейд+score) | Бенфорд (бейдж conformity) |
      выбросы | ЕП-риск (бейдж уровня) | сезонные | дробление;
      клик по строке → navigateTo('quality', {department}) — паттерн Analytics.tsx:965 */}
</AnalyticsCard>
```

Известные дефекты данных, которые волна 1 обходит, а волна 2 чинит:
`dataAnomalyFlags` — это `Map`, в JSON сериализуется в `{}` (проверено curl) — поле в
UI не читать; фикс — `orchestrator.ts` конвертирует в `Record<number, DataAnomaly[]>`
(правка DTO + тест). Композит-грейды по шкале GS-порта «меньше=лучше» — подписать
в UI явно, чтобы не читалось как школьная оценка.

### 2.2. W1-B: карточка «Рейтинг дисциплины» (scorecard)

```ts
// packages/shared/src/analytics-dto.ts (новый)
export interface ScorecardEntryDTO {
  grbsShort: string;
  role: string;                       // 'ОПЕРАЦИОННЫЙ' | 'ИНВЕСТИЦИОННЫЙ' | …
  grade: 'A' | 'B' | 'C' | 'D';       // grbs-grade.ts:85
  gradeScore: number;                 // 0-100
  gradeReasons: string[];             // готовые формулировки
  discipline: number;                 // 0-100
  mode: string;                       // НОРМА | ВНИМАНИЕ | ТРЕВОГА
  dominantFactor: string;
  narrative: string;                  // готовая строка для доклада
  anticorruptionFlags: number;
  topFlags: Array<{ indicator: string; severity: 'low'|'medium'|'high';
                    rowIndex?: number; message: string }>;
  execPct: number; epShare: number;   // шкала 0-1
  riskLevel: 'low' | 'medium' | 'high';
}
export type ScorecardDTO = Record<string, ScorecardEntryDTO>; // ключ = grbsId
```

```ts
// packages/web/src/api.ts — типизированная НОВАЯ функция (не fetchJSON<any>!)
getAnalyticsScorecard: (year?: number) =>
  fetchJSON<ScorecardDTO>(`/analytics/scorecard${year ? `?year=${year}` : ''}`),
```

Сервер: `routes/analytics.ts:161` — добавить чтение `?year` по образцу
`dashboard.ts:16-25` и передать в `getSnapshot(false, targetYear)`; типизировать
`result` как `ScorecardDTO` (убирает часть из 31 server-`any`).

Компонент `ScorecardCard` (в Analytics.tsx рядом с CentralizationCard — тот же
useEffect-паттерн `Analytics.tsx:1055-1059`): таблица 8 ГРБС — грейд-бейдж,
дисциплина-прогрессбар с цветом режима (🟢НОРМА/🟡ВНИМАНИЕ/🔴ТРЕВОГА), narrative,
gradeReasons списком, счётчик антикор-флагов с раскрытием topFlags. Сортировка по
discipline asc (худшие сверху — это управленческий рейтинг, а не витрина).

### 2.3. W1-C: карточка «Нарушения 44-ФЗ» (compliance)

```ts
// shared/analytics-dto.ts
export interface ComplianceIssueDTO {
  grbsId: string; ruleCode: string;
  severity: 'critical' | 'warning';
  title: string; description: string;
  article: string;                     // 'ст. 37', 'ч.4 ст.93'…
  threshold: number; actualValue: number;
  rowIndex?: number;
}
export interface ComplianceDTO {
  totalIssues: number; critical: number; warnings: number;
  issues: ComplianceIssueDTO[];
}
```

Клиент: **оживить** существующую `getAnalyticsCompliance` (`api.ts:201`), сменив
`fetchJSON<any>` → `fetchJSON<ComplianceDTO>` и добавив `?year`. Компонент
`ComplianceCard`: группировка по `ruleCode` (бейдж-счётчики как в Analytics.tsx:1003),
внутри — адресные строки «ГРБС · строка N · статья · порог/факт»; клик по строке →
Реестр этого ГРБС (паттерн `navigateTo`). Дисклеймер «экономия — прокси от лимита,
не НМЦК» уже приходит в description — не дублировать.

### 2.4. W1-D: развёртка «Антикоррупционные индикаторы»

Не отдельная карточка: в `ScorecardCard` по клику на счётчик флагов —
догрузка `fetchJSON<Record<string, AntiCorruptionResultDTO>>('/analytics/anticorruption')`,
плоский список флагов с severity-бейджами. DTO — зеркало
`AntiCorruptionResult` (`anticorruption.ts:60`), в shared описать аналогично 2.2.
Если экономить время — в волне 1 ограничиться topFlags из scorecard (уже есть),
полный роут провести волной 2.

---

## §3. Три волны реализации

### Волна 1 — «максимум ценности, минимум кода» (~1 сессия)

| Шаг | Состав | Код |
|---|---|---|
| W1-A | Панель «Аудит данных» из `snapshot.datasetAnalyses` (§2.1) | только web: селектор + карточка + тест селектора |
| W1-B | «Рейтинг дисциплины» (scorecard, §2.2) | shared DTO + `?year` в роут + api-функция + карточка |
| W1-C | «Нарушения 44-ФЗ» (compliance, §2.3) | shared DTO + `?year` + оживить api.ts:201 + карточка |
| W1-D | topFlags-развёртка в W1-B (без нового роута) | web |

Итог волны: аудит-слой (Benford/выбросы/сезонность/дробление/композит), рейтинг
дисциплины с готовыми формулировками и юридически адресные нарушения — всё, что
сегодня «строится и выбрасывается» при каждом прогоне пайплайна, появляется на экране.
Это ~70% содержимого будущего раздела «Лаборатория» (E9) без переплавки IA.

### Волна 2 — «роут+потребитель, средняя работа» (~2 сессии)

1. **recommendations.ts wire** (№5): экспорт из `core/src/index.ts`; сборка
   `RecommendationInput` из `snapshot.recalcResults` + signalCounts + trust на сервере
   (новый блок в dashboard-DTO или `GET /api/recommendations?year`); `Recs.tsx`
   переводится с клиентской самоделки (`Recs.tsx:39-84`) на движок; клиентская
   генерация остаётся только для issue-специфичных подсказок. Это же — точка входа E7
   (стабильный ключ рекомендации: правило+ГРБС, НЕ индекс строки — §6.2.1 продукт-дизайна).
2. **Полный anticorruption-роут** в развёртку W1-D (если отложен из волны 1).
3. **История доверия** (№16): `getSnapshotHistory` уже отдаёт список — маленькая
   карточка-спарклайн «trust/issues по снапшотам» в Quality→Journal; diff-вью двух
   снапшотов — по клику (кирпич будущего changeWindow/E3).
4. **Фикс сериализации** `dataAnomalyFlags` Map→Record в `orchestrator.ts` + вывод
   row-level аномалий в панель W1-A.
5. **`?year` во все analytics-роуты** (если не добит в волне 1) + типизация их
   `Record<string, unknown>`-тел через shared DTO — гасит часть 31 server-`any`.

### Волна 3 — «новая сутевка» (эпики, не проводка)

1. **Centralization 2.0** (№13, эпик E5): движок JointProposal по спеке research §5.6
   (инверсия ЕП-фильтра, адресность ppId, same-buyer-series, риск-вето) — L, отдельная
   спека уже написана; текущая CentralizationCard остаётся до готовности v2.
2. **parseSvodGrid → сверочный модуль «сводная↔отдельные»** (№12, эпик E2) — читатель
   сводной книги в роли сверки.
3. **quarterExecution → buildReport** (№11, эпик E3 фаза 1.4) + **cell-refs →
   evidence-оверлей** Отчёта (№17).
4. **ep-reasons/subjects после классификатора** (№14, №15): доработка регексов
   `analyzeEPReasons`/`classifySubject` либо словарь причин E5 — до того на экран
   не выводить (см. §4).
5. **EWMA** (№6): появляется вместе с потребителем временных рядов — серия
   снапшотов из №16 и есть его вход.

---

## §4. Что НЕ выводить и почему (кандидаты на снос/заморозку)

### 4.1. Дубли расчётов — вывести один канон

- **Бенфорд ×3**: dataset-signals (MAD/Nigrini, в снапшоте), anomaly.ts (χ²/p-value,
  роут `/api/analytics/anomalies`), scorecard (внутри: p<0.05 → anomalyCount). На экран —
  **одна** версия: MAD из datasetAnalyses (W1-A), т.к. уже в браузере и с 4-ступенчатой
  шкалой соответствия. Роут `/api/analytics/anomalies` отдельной карточкой **не выводить**
  (Z-выбросы по ГРБС тоже есть в datasetAnalyses.outliers); роут оставить как debug либо
  снести вместе с мёртвой `getAnalyticsAnomalies` (api.ts:207) при E12-сужении.
- **`/api/analytics/profiles`** (№9): все поля до экрана доносит scorecard (role,
  execPct, epShare, riskLevel + грейд сверху). Отдельную карточку профилей не делать;
  мёртвую `getAnalyticsProfiles` (api.ts:198) — снести. Сам роут можно оставить
  (scorecard внутри переиспользует `buildGRBSProfiles`), но клиентскую обвязку не плодить.

### 4.2. Врущие данные — не выводить до фикса

- **`/api/reconciliation/quarterly`** (№19): svodValue=0 во всех парах → deltaPct
  13700% (curl-доказательство в §1). Вывод на экран = 100% ложных «high». Вердикт:
  не выводить; починить маппинг СВОД-стороны в рамках E1-семейства («сверка чиста»)
  или снести роут. Родственный `/api/reconciliation/monthly/diagnostics` — служебный,
  оставить без клиента.
- **ep-reasons** (№14): 100% «иное» у проверенных ГРБС — карточка покажет пустое
  распределение и подорвёт доверие к странице. Сначала регексы/словарь причин (E5).
- **subjects** (№15): «Другое» 71% у УЭР — та же логика; ждёт subject-classify 2.0.

### 4.3. Дубли роутов — снести

- **`/api/reconcile` + `/api/reconcile/:deptId`** (rows.ts:743,801): перегруппировка
  тех же `snapshot.deltas`, которые Recon.tsx уже показывает через `/api/reconciliation`
  (api.ts:97, Recon.tsx:267). Два фасада одной сверки = будущий дрейф. Снести оба
  роута (~120 LOC из god-файла rows.ts — заодно шаг E11).
- **`/api/trust/:deptId`** (dashboard.ts:409): pere-ГРБС trust уже едет в dashboard-DTO
  (deptTrust, dashboard.ts:115-125) и показывается в Trust.tsx. Снести роут и мёртвые
  `getTrust`/`getTrustDetail`.

### 4.4. Мёртвые клиентские функции — судьба каждой (16 живых мертвецов на HEAD)

Оживают волнами: `getAnalyticsCompliance` (W1-C), `getAnalyticsAnomalies` — нет (§4.1,
снести), `getAnalyticsProfiles` — снести (§4.1), `getAnalyticsEPReasons`/`getAnalyticsSubjects`
— заморозка до волны 3-4 (§4.2; если мешают — снести, восстановить недорого).
Снести сейчас (потребителя не будет): `getMetrics`, `getMetric` (метрики едут в
dashboard-DTO), `getIssues` (issues в DTO/issues-роуте с фильтрами страницы),
`getTrust`, `getTrustDetail` (§4.3), `updateField` (вытеснен `saveRows`),
`getJournalStats` (эрзац: uniqueUsers=0 — Журнал живёт своим списком), `testSource`
(Settings перешёл на validate-all, коммит `3800ac1`), `getReportMap`, `getHistory`,
`exportAudit`, `getCellRefs` (все четыре ждут E3-оверлей — восстановить по
report-map/cell-refs контрактам, когда появится потребитель-Отчёт).
Серверные пары к снесённым обёрткам: GET `/api/rows/:deptId/:rowIndex`,
GET `/api/issues/:id`, POST `/api/sources/:name/test` — снести; `/api/metrics*`,
`/api/report-map`, `/api/cell-refs`, `/api/history*`, `/api/export/audit` — оставить
(это провенанс-поверхность E3; роуты стабильны и дёшевы), помечены «ждёт E3».
POST `/api/load-all` (dashboard.ts:522) — операционный прогрев кэша: либо кнопка
в Системе (15 минут), либо оставить curl-only с пометкой в RUNBOOK.

### 4.5. Не-UI способности — не натягивать на экран

`quarterExecution` (№11) и `parseSvodGrid` (№12) — канон-кирпичи E3/E2 соответственно;
самостоятельной витрины у них нет, и городить её — создавать новую muda. `ewmaDetection`
— без временного ряда на входе любой вывод будет фикцией (волна 3, после №16).

---

*Проверочные команды: все curl из §1 воспроизводимы против dev-API
(`http://localhost:3000`); грепы потребителей — `grep -rn "<имя>" packages/{web,server,core}/src
--include="*.ts*" | grep -v test`. Связанные доки: REMAINING E4/E7 ·
target-architecture §2/§3/§5 · code_quality_audit §4 ·
research/joint-procurement-principles §5-§6 (централизация 2.0).*
