# Фильтр-система: диагноз навигационных багов и целевой дизайн

> Волна анализа 2026-07-16/17, запрос пользователя: «при навигациях по сущностям
> фильтр-система всё ещё багует; глубоко изучить, как она должна работать, что и по каким
> показателям фильтровать, как подключится в целевом продукте».
> Прод-код в этой волне не менялся. Все утверждения — с привязкой file:line либо
> с живой проверкой против дев-API (http://localhost:3000, реальные данные, год 2026).

---

## §0. Как устроено сейчас (минимум, нужный для чтения реестра)

Состояние фильтров живёт в одном zustand-store (`packages/web/src/store.ts`, 779 строк).
Осей — девять, но период размазан на **четыре независимых поля**:

| Поле store | Что хранит | Кто пишет |
|---|---|---|
| `period: PeriodScope` (`year/q1..q4`) | «квартальный» скоуп | только `navigateTo` (store.ts:421); UI-кнопок нет — `grep setPeriod` по страницам пуст |
| `activeMonths: Set<number>` | активные месяцы | TimeDrum, WeekRoller, `navigateTo({months})` |
| `periodMode: 'week'\|'explicit'` | кто хозяин `activeMonths` | toggleMonth*/clearMonths/WeekRoller |
| `monthsByYear: Record<year, Set<month>>` | помесячный выбор per-год | TimeDrum (toggleMonthInYear и др.) |

Плюс `focusedWeekStart` (недельный барабан). Центральный потребитель —
`packages/web/src/hooks/useFilteredData.ts` (909 строк): резолвит эффективный
`periodKey` так — `periodKey = period`, но если `activeMonths` непуст и покрывает
ровно один квартал, **квартал из месяцев перекрывает `period`**
(useFilteredData.ts:246–268). В дефолтном режиме `'week'` `activeMonths` непуст
всегда (месяцы текущей недели, store.ts:316). Это ружьё на стене для половины багов §2.

Ключ ГРБС существует в двух формах: кириллический short (`'УЭР'` = canonical
`DepartmentId`, department-registry.ts:37) и латинский slug (`'uer'` = `latinId`,
там же :26). DTO `/api/dashboard` отдаёт `department.id='uer'`,
`nameShort='УЭР'`; `issues[].departmentId='uer'`; `subordinatesMap` ключуется
кириллицей (rows.ts:879 — `result[dept.nameShort]`). `selectedDepartments`
хранит **то, что положил последний писатель**: OrgStrip кладёт кириллицу
(OrgStrip.tsx:188,217 — ключи `subordinatesMap`), `navigateTo` со страниц —
латиницу (Analytics.tsx:572 и далее — `d.department.id`). Это второе ружьё.

## §1. Карта осей as-is: ось × страница

Легенда: ✓ уважает; ~ частично (с оговоркой); ✗ игнорирует; — не осмысленно.
Доказательства: Dashboard/Analytics/Economy/Trust/Recs — через `useFilteredData`
(Dashboard.tsx:71, Analytics.tsx:221, Economy.tsx:301, Trust.tsx:207, Recs.tsx:68);
DataBrowser — свой фетч + клиентский фильтр (DataBrowser.tsx:258–302, 327–373);
SvodView — свой срез (SvodView.tsx:169–236); Recon — свой фетч (Recon.tsx:262–307);
Journal — свой фетч (Journal.tsx:44–53).

| Ось | Пульт | СВОД | Реестр | Экономия | Аналитика | Контроль/Сверка | Контроль/Проблемы+Recs | Контроль/Доверие | Журнал |
|---|---|---|---|---|---|---|---|---|---|
| Год | ✓ (App.tsx:101–107 refetch) | ✓ (SvodView.tsx:194) | ✓ (DataBrowser.tsx:274 param) | ✓ (через dashboardData) | ✓ | ✓ (Recon.tsx:267,297) | ✓ | ✓ | ✗ |
| Период-квартал `period` | ~ мёртв при week-mode (useFilteredData.ts:264–267) | ✗ (своя локальная ось, SvodView.tsx:173) | ✓ (DataBrowser.tsx:329–340) | ~ свой periodKey (Economy.tsx:347–353) | ~ как Пульт | ~ только фильтр метрик (Recon.tsx:310–315) | ✗ | ✗ | ✗ |
| Месяцы/неделя `activeMonths` | ✓ | ✗ | ✓ (DataBrowser.tsx:343–350) | ✓ через fd | ✓ | ✗ (monthly-view игнорирует выбор) | ✗ (issues не период-скопированы; коммент Recs.tsx:71 врёт) | ✗ | ✗ |
| ГРБС | ✓ агрегаты / ~ issues-виджеты (двухформенность, §2-Б5) | ✓ обе формы (unified-svod-view.ts:177–183) | ✓ обе формы (rows.ts:54) | ✓ | ✓ | ~ deltas ломаются на кириллице (useFilteredData.ts:230–237) | ~ ломается на кириллице (useFilteredData.ts:199–203) | ✓ через fd.depts | ✗ **no-op** (param `dept` vs серверный `deptId`, §2-Б6) |
| Подвед | ✓ (кроме `_org_itself`, §2-Б4) | — | ✓ (сервер rows.ts:215–222; `_org_itself` → 0 строк) | ✓ | ✓ | ✗ | ~ по `subordinateId` | ✗ | ✗ |
| Только-орг `deptOnlyMode` | ~ маркер `_deptOnly` без вычитания (useFilteredData.ts:176–186) | ✗ | ✗ | ✓ (Economy.tsx:417) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Способ (КП/ЕП) | ✓ | ✓ (SvodView.tsx:202) | ✓ legacy-single (DataBrowser.tsx:270–272) | ✓ (Economy.tsx:333–335) | ✓ | ✗ (Header показывает контрол — ложь, Header.tsx:24) | ✗ | ✗ | ✗ |
| Вид деятельности | ✓ | ✗ | ~ только single: выбор 2 из 3 → 'all' (store.ts:335–341 + DataBrowser.tsx:267) | ✓ | ✓ | ✗ | ~ issues без activityType проходят (useFilteredData.ts:221–226) | ✗ | ✗ |
| Бюджет ФБ/КБ/МБ | ✓ | ✓ (SvodView.tsx:219) | ✓ клиентски (rows-filter.ts) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Поиск | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | свой локальный |
| Сигналы | ✓ counts по fd.depts (signal-counts) | ✗ | ✓ локальный дропдаун | ~ high/conflicts | ✗ | ✗ | ~ severity | ✗ | ✗ |
| Ед. измерения денег | ✓ везде через `formatMoney` (store.ts:761–779) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

Отдельно: Header показывает страницам набор контролов по `PAGE_FILTERS`
(Header.tsx:17–30). Для `quality/recon/trust/journal` он объявляет
`period/procurement/activity` — из которых Сверка уважает только период (частично),
а Журнал — ничего. Контролы-пустышки.

## §2. Реестр багов навигации — 15 позиций

Формат: шаги воспроизведения → корень (file:line) → класс из задания (а–д).

**Б1. Клик по кварталу на Пульте не меняет квартал в Аналитике.**
Июль (week-mode, `activeMonths={7}`). Пульт → столбик «1 кв.»
(Dashboard.tsx:323 → `navigateTo('analytics', {period:'q1'})`). Аналитика
показывает 3-й квартал. Корень: `navigateTo` пишет `period`, не трогая
`activeMonths/periodMode` (store.ts:421); `useFilteredData` перекрывает `period`
кварталом из `activeMonths` (useFilteredData.ts:264–267). Ось `period` мертва,
пока непуст `activeMonths` — то есть всегда в дефолте. Класс (а)+(д).
Это же — известный шов «KPI Q1-официал vs карточки 3 кв.» (см. Б7).

**Б2. После квартального клика Реестр пустеет.**
Продолжение Б1: перейти в Реестр. DataBrowser применяет `period` И `activeMonths`
**последовательно** (DataBrowser.tsx:329–340, затем 343–350): строки должны попасть
в месяцы {1,2,3} И в месяц {7} — остаются только строки без дат. Корень: две
конкурирующие период-оси без согласования; `period='q1'` остаётся протухшим
навсегда (сбрасывается только resetAllFilters/clearAllPeriods). Класс (б)+(д).

**Б3. «Открыть строки за месяц» из Сверки — фильтр-невидимка.**
Сверка → месяц → кнопка «Открыть строки за <месяц>» (Recon.tsx:1018 →
`navigateTo('data', {department, months:[m]})`). Строки отфильтрованы, но:
чип периода в FilterBreadcrumb не появляется (`hasExplicitPeriodFilter` требует
`periodMode==='explicit'`, store.ts:44–52 — а `navigateTo` его не ставит,
store.ts:446–448); TimeDrum не подсвечивает месяц (читает `monthsByYear`,
Header.tsx:210 — не заполнен); первый же скролл колёсиком над WeekRoller молча
перетирает `activeMonths` (store.ts:652–654, режим 'week'). Пользователь видит
урезанные данные без единой индикации почему. Класс (а)+(д).

**Б4. Клик по «Аппарат управления» даёт нули/пустоту.**
Аналитика → рейтинг подведов → строка «Аппарат управления» (Analytics.tsx:816
передаёт `subordinate: sub.name` = сырой `'_org_itself'`; то же Recon.tsx:1130).
Живая проверка: `GET /api/rows/uer?subordinate=_org_itself` → `total=0`
(колонка C у строк аппарата = `'Х'`; серверный матч — substring по C,
rows.ts:215–222). А `useFilteredData` при `selectedSubordinates={'_org_itself'}`
получает `deptIdsWithSubs=∅` (в `subordinatesMap` ключа `_org_itself` нет — сервер
его не выдаёт, rows.ts:867–874; fallback пропускает `isOrgItself`, store.ts:131)
→ `depts=[]` → все KPI/карточки нулевые. Класс (г) — ровно предсказанный.

**Б5. Двухформенность ключа ГРБС — четыре независимых поломки.**
Live-факты: `issues[].departmentId='uer'`, `issue.department=null`;
`subordinatesMap` ключи `'УЭР'`.
 a) Выбор управления в OrgStrip (кириллица) → фильтр проблем
 `selectedDepartments.has(i.departmentId /* 'uer' */)` ложен для всех →
 **страница Проблемы пустеет, счётчики критических обнуляются**
 (useFilteredData.ts:199–203).
 b) Выбор через клик в Аналитике (латиница, Analytics.tsx:572) → OrgStrip не
 подсвечивает управление (OrgStrip.tsx:188 сверяет с кириллическими ключами),
 чип в FilterBreadcrumb показывает пользователю `'uer'` (FilterBreadcrumb.tsx:88).
 c) `toggleDepartment` не авто-чистит подведы при латинице:
 `subordinatesMap['uer']` = undefined (store.ts:477–478).
 d) Deltas-фильтр при кириллице отбрасывает все `grbs.*`-метрики → вкладка
 «метрики» Сверки пустеет (useFilteredData.ts:230–237: `metricKey.split('.')[1]`
 — латиница; фолбэк `includes('уэр')` не матчится никогда).
 Класс (в): одна и та же ось то уважается, то нет — в зависимости от того,
 откуда пришёл выбор.

**Б6. Дептфильтр Журнала — полный no-op.**
Журнал шлёт `params.dept = [...selectedDepartments].join(',')` (Journal.tsx:53);
сервер читает `query.deptId` и сравнивает точным равенством с одним значением
(journal.ts:152). Неверное имя параметра + CSV + вероятная кириллица против
латинского `e.departmentId`: три несовместимости разом. Класс (в).

**Б7. Hero-KPI подсовывает Q1-официал под видом текущего периода.**
Live-факт: официальные `kpiCards` существуют только для `q1` и `year` (728 карточек,
только `*.q1.*` и `*.year.*`). В июле `periodKey='q3'` → точных ключей нет →
фолбэк «возьми первые 6 карточек» (useFilteredData.ts:318–320) молча кладёт
`competitive.q1.count` и пр., тогда как соседние карточки управлений считаются за
Q3. Один экран — два период-скоупа без пометки. Класс (б) — подтверждённый шов.

**Б8. navigateTo не сбрасывает конфликтующие оси.**
Выбрать подвед управления УО (например, в Экономии), затем в Аналитике кликнуть
бюджет-бар УЭР → `navigateTo('data', {department:'uer'})` (Analytics.tsx:572).
`selectedSubordinates` не очищен (store.ts:413–466 — только merge, никаких
сбросов) → сервер грузит строки УЭР с `subordinate=<подвед УО>` → 0 строк;
на fd-страницах пересечение депт-фильтра и подвед-фильтра тоже пусто. Класс (а).

**Б9. Экономия: навигация toggle-ами — не идемпотентна.**
`navigateToSub` = `toggleSubordinate(sub); toggleDepartment(dept); navigateTo('data')`
(Economy.tsx:601–605). Если управление уже выбрано — toggle его **снимает**
(и заодно чистит его подведы, store.ts:479–489); повторный клик по тому же подведу
снимает подвед. Навигация должна быть set-семантикой, не toggle. Класс (а).

**Б10. «Визуальный» WeekRoller в explicit-режиме меняет год данных.**
В explicit-режиме барабан недель объявлен visual-only (store.ts:36–41), но
`shiftFocusedWeek` безусловно пишет `year` при пересечении границы года
(store.ts:647–650) → App.tsx:101–107 перезагружает dashboard за другой год.
Случайный скролл над барабаном в конце декабря = подмена года всех данных
без явного действия. Класс (д).

**Б11. Клик из баннера критических проблем открывает не ту вкладку.**
Dashboard.tsx:415 передаёт `onNavigate={(category, search) => navigateTo('quality', {category, search})}`,
но `CriticalBannerV2` вызывает `onNavigate()` без аргументов
(CriticalBannerV2.tsx:37,303) → `category/search=undefined` → ветка
`page==='quality' && (category||search)` не срабатывает (store.ts:463–465) →
qualityTab остаётся дефолтным `'recon'` — открывается Сверка вместо Проблем.
Бонус: параметр `category` вообще никуда не сохраняется — мёртвый параметр
контракта `navigateTo` (store.ts:216–227). Класс (а).

**Б12. Мульти-выбор видов деятельности теряется на Реестре.**
Header позволяет выбрать 2 из 3 видов (Header.tsx:558–568), но DataBrowser шлёт
на сервер legacy-`activityFilter`, который при size≥2 схлопывается в `'all'`
(store.ts:335–341; DataBrowser.tsx:266–268) → Реестр показывает все виды, тогда
как Пульт/Аналитика честно режут по двум выбранным (`selectedActivities`).
Класс (в).

**Б13. Header рисует контролы, которые страница игнорирует.**
`PAGE_FILTERS.recon = ['period','procurement','activity']` (Header.tsx:23–28), но
Сверка не использует ни способ, ни вид деятельности, ни месяцы (Recon.tsx:262–307:
фетч только по `year`). Журнал — игнорирует всё объявленное. Пользователь крутит
барабан КП/ЕП на Сверке и не видит эффекта. Класс (в).

**Б14. Экономия резолвит период иначе, чем useFilteredData.**
Economy.tsx:347–353: месяцы из >1 квартала → скоуп «год»; fd для того же выбора
суммирует помесячно (useFilteredData.ts:359–424). Выбор «янв+апр» → hero-цифры
Экономии за год, соседние fd-цифры за 2 месяца. Класс (б).

**Б15 (minor). Recs обещает период-фильтр, которого нет.**
Recs.tsx:71 — коммент «respects … period»; в fd проблемы вообще не режутся по
месяцам/кварталам (useFilteredData.ts:197–226). Ложная документация в коде.

Итого: **15 багов** (12 поведенческих + Б13/Б14/Б15 — согласованность/индикация),
корни концентрируются в трёх местах: `navigateTo` (store.ts:413–466),
период-резолюция (useFilteredData.ts:246–268 + DataBrowser.tsx:327–350),
двухформенность ключа ГРБС.

## §3. Целевой дизайн

### 3.1 Принципы

1. **Один объект-значение `FilterContext`** вместо девяти разрозненных полей.
   Страницы не читают сырые поля store — только контекст и производные селекторы.
2. **Одна период-ось** (discriminated union) — неделя, месяцы, квартал, год суть
   варианты одной оси, а не четыре поля с гонками.
3. **Одна каноническая форма каждого ключа** на границе store: ГРБС — canonical
   `DepartmentId` (кириллица, как в department-registry); подвед — стабильный ID
   из `SUBORDINATE_REGISTRY` (после D1-переезда на отдельные книги — ключ строки
   реестра подведов), а не displayName; аппарат управления — легальный юнит
   (`isOrgItself`), не сырой sentinel. Латиница живёт только в metricKey/URL
   и конвертится биекцией на краях.
4. **Навигация — транзакция**: `navigate(page, patch)` применяет патч к контексту
   атомарно и сбрасывает оси, конфликтующие с патчем (сменил ГРБС → подведы
   чужого ГРБС очищены; задал месяцы → квартальная/недельная ось вытеснена).
5. **Page Contract** (принцип из docs-решения пользователя: страницы — связные
   проекции реестра элементов): каждая страница декларирует `consumes`/`ignores`
   по осям; Header рендерит только `consumes`; активная, но игнорируемая ось
   показывается приглушённым чипом «не действует на этой странице» — честность
   вместо контролов-пустышек (закрывает Б13 системно).

### 3.2 Оси и их показатели (что каждая ось режет, где истина)

Истина везде — строки книг управлений (канон D1: 1 строка = 1 закупка, колонки
H–K план ФБ/КБ/МБ/итого, V–Y факт, Z–AB экономия, L способ, F+D вид деятельности,
N/P план-дата/год, C подвед). Агрегаты (кварталы/месяцы/byActivity/bySubordinate)
— проекции этих строк; официал СВОД ТД-ПМ — эталон сверки, не источник фильтра.

| Ось | Тип | Что режет | Замечание |
|---|---|---|---|
| Год | единственный `number` | всё: деньги, счётчики, %, сигналы, сверку | источник двухлетний — строка несёт `planYear` (колонка P, rows.ts:255); официал существует только для года AO4 (год-гейт f291e6) — сверка вне этого года = «эталона нет», не «расхождение» |
| Период | `{kind:'week', monday} \| {kind:'months', months[]} \| {kind:'quarter', q} \| {kind:'year'}` | деньги/счётчики/% (через план/факт-даты строк), помесячную сверку | официальные KPI существуют только для q1/year → карточка обязана нести бейдж своего скоупа (закрывает Б7) |
| ГРБС | `DepartmentId[]` (мульти) | всё, включая issues/deltas/journal | единая форма ключа (закрывает Б5) |
| Подвед | `UnitId[]`, куда входит аппарат (`org-itself`) | деньги/счётчики/% (колонка C), issues по subordinateId | фильтр «аппарат» = C ∈ {'', 'Х', 'X'} на сервере (закрывает Б4) |
| Скоуп орг | `'with-units' \| 'org-only'` (замена deptOnlyMode) | вычитание подвед-агрегатов | сейчас deptOnly — только маркер без математики (useFilteredData.ts:176–186) |
| Способ | `('kp'\|'ep')[]`, позже детально ЭА/ЭК/ЭЗК/ЕП | счётчики/деньги/доли КП-ЕП | сервер уже умеет L-колонку (rows.ts:204–212) |
| Вид деятельности | `ActivityKey[]` (мульти) | деньги/% через byActivity; строки через F+D | мульти доводится до сервера (закрывает Б12) |
| Бюджет | `('fb'\|'kb'\|'mb')[]` | деньги (план/факт/экономия по H–J/V–X/Z–AB), НЕ счётчики (строка не делится) | правило «строка проходит, если план ИЛИ факт в выбранном бюджете» уже канонизировано в rows-filter.ts |
| Статус строки | `RowState[]` | счётчики, списки строк | сейчас есть только на сервере (`state` param, rows.ts:63) и локальном дропдауне сигналов |
| Сигналы | `SignalKey[]` | списки строк, signal-counts | глобализуется из локального стейта DataBrowser |
| Поиск | `string` | строки/issues/kpi по тексту | |
| Ед. денег | презентационная, не режет данные | форматирование | остаётся вне FilterContext (view-настройка) |

### 3.3 Контракт FilterContext (TS-эскиз)

```ts
// packages/web/src/filter/context.ts (целевое место)
export type PeriodSel =
  | { kind: 'week'; monday: string /* ISO */ }
  | { kind: 'months'; months: number[] }        // в рамках year
  | { kind: 'quarter'; q: 1 | 2 | 3 | 4 }
  | { kind: 'year' };

export interface FilterContext {
  year: number;                       // 'all' уходит: двухлетний срез = {kind:'year'} + year-переключатель
  period: PeriodSel;
  grbs: DepartmentId[];               // кириллический канон, [] = все
  units: UnitId[];                    // ID реестра подведов; аппарат = {grbsId, orgItself:true}
  orgScope: 'with-units' | 'org-only';
  methods: MethodKey[];               // [] = все
  activities: ActivityKey[];
  budgets: BudgetKey[];
  rowStates: RowState[];
  signals: SignalKey[];
  search: string;
}

export function applyNavPatch(ctx: FilterContext, patch: Partial<FilterContext>): FilterContext;
// Инварианты applyNavPatch:
//  - patch.period вытесняет прежний период целиком (нет наложения quarter+months);
//  - patch.grbs очищает units, чей grbsId ∉ patch.grbs;
//  - ключи нормализуются к канону (латиница → кириллица) на входе;
//  - результат — новый объект; никакой частичной записи в store.
```

**URL-сериализация** (для шаринга срезов начальству и для «Отчёта»):
`?y=2026&p=q1|m7,8|w2026-07-13&grbs=УЭР,УО&unit=<id>&org=only&mtd=kp&act=pm,tdpm&bud=fb,kb&sig=overdue&q=шкаф`.
Один parse/serialize-модуль, состояние восстановимо из адресной строки —
это одновременно и recovery после перезагрузки, и передаваемая ссылка.

### 3.4 Подключение страниц

Один хук `useFilterContext()` + пакет **чистых селекторов** (трек E11 — резка
useFilteredData): `selectDepts(data, ctx)`, `selectTotals(data, ctx)`,
`selectIssues(data, ctx)`, `selectRows(rows, ctx)`, `selectSummary(data, ctx)`.
Из нынешнего useFilteredData **переживёт** (как чистые функции с тестами):
budgetPlanFact (:458–474), смешанная агрегация полных кварталов + частичных
месяцев (:355–424), подвед-оверрайд агрегатов (:76–172), signal-counts
(уже вынесен, signal-counts.ts). **Умрёт**: резолюция periodKey из четырёх полей
(:246–268), двухформенный матчинг депт-ключей (:41–46, 199–237), фолбэк topKpis
(:318–320), мутирование kpi-карточек на месте (:727–738 — sparkData/trend пишутся
в объекты store).

**Page Contract** — декларация рядом со страницей:

```ts
export const DataBrowserContract: PageContract = {
  consumes: ['year', 'period', 'grbs', 'units', 'orgScope', 'methods',
             'activities', 'budgets', 'rowStates', 'signals', 'search'],
  ignores:  [],
};
export const ReconContract: PageContract = {
  consumes: ['year', 'grbs'],
  ignores:  ['period', 'methods', 'activities'], // Header покажет приглушённо
};
```

Header строит контролы из контракта активной страницы — PAGE_FILTERS умирает.

### 3.5 Стык с «Отчётом 2.0» и Реестром Sheets+

`buildReport(snapshot, filterCtx)` (EXECUTION_PLAN Phase 1.4–1.6) принимает тот же
FilterContext: отчётная неделя = `{kind:'week'}`, квартальный официал =
`{kind:'quarter'}` + бейдж источника. Серверный `/api/report` принимает
сериализованный контекст из URL-схемы §3.3 — фронт и сервер разговаривают одним
языком фильтра. Для Реестра Sheets+ (77 подведов, отдельные книги) ось `units`
уже готова: ID из реестра подведов, аппарат — валидная сущность, displayName —
только подпись (`subordinateLabel`).

## §4. Миграционный план

### Топ-5 быстрых фиксов (сейчас, до E11-резки; каждый ≤ ~30 строк)

1. **navigateTo: период — атомарно** (закрывает Б1, Б2, Б3). В store.ts:413–466:
   при `filters.months` → также `periodMode:'explicit'`, `monthsByYear:{[year]: new Set(months)}`,
   `period:'year'`; при `filters.period='qN'` → также `activeMonths:new Set(QUARTER_MONTHS[qN])`,
   `monthsByYear` синхронно, `periodMode:'explicit'`; при `period:'year'` → очистка месяцев.
   Тест: navigateTo({period:'q1'}) → useFilteredData().periodKey==='q1' при любом стартовом режиме.
2. **Канонизация ключа ГРБС на входе в store** (закрывает Б5a–d). Хелпер
   `toCanonicalDeptId(key)` (через `LATIN_TO_CYRILLIC` из department-registry) в
   `navigateTo`/`toggleDepartment`; в useFilteredData один раз строить
   `selectedDeptBothForms` (кириллица+латиница) и использовать в issues- (:199–203)
   и deltas- (:230–237) фильтрах. FilterBreadcrumb перестаёт показывать 'uer'.
3. **Аппарат управления как валидный фильтр** (закрывает Б4). Сервер rows.ts:215–222:
   `subordinate=_org_itself` → матч `C ∈ {'', 'Х', 'X'}` (регистронезависимо, кир/лат);
   фронт useFilteredData:58–66: `_org_itself` в selectedSubordinates не требует
   присутствия в subordinatesMap (дептфильтр — по управлению юнита). Живой признак
   починки: `GET /api/rows/uer?subordinate=_org_itself` возвращает строки с C='Х'.
4. **Журнал: dept → deptId + CSV** (закрывает Б6). Journal.tsx:53 →
   `params.deptId = [...].map(toLatinDeptId).join(',')`; journal.ts:152 →
   `const set = new Set(query.deptId.split(','))` + `set.has(e.departmentId)`.
5. **Честный KPI-фолбэк** (закрывает видимую часть Б7). useFilteredData.ts:304–320:
   если точных ключей `*.{periodKey}.*` нет — брать `*.year.*` (не первые 6 = q1)
   и помечать карточку `periodBadge: 'год'`/`'Q1 · официал'`; HeroKPICard рендерит бейдж.

Быстрые довески того же порядка (не входят в топ-5, но дешёвые): Economy
toggle→set (Б9, Economy.tsx:601–605 переписать на navigateTo с department+subordinate);
CriticalBannerV2 прокинуть аргументы или заменить Dashboard.tsx:415 на
`navigateTo('quality', {qualityTab:'issues'})` (Б11); shiftFocusedWeek — не менять
`year` в explicit-режиме (Б10, store.ts:647–650 обернуть в `if (periodMode==='week')`).

### Ждёт E11-резки (структурное)

- FilterContext + applyNavPatch + URL-сериализация (§3.3) — вместо девяти полей.
- Резка useFilteredData на чистые селекторы (список выживших/умирающих — §3.4);
  прекращение мутации kpi-карточек.
- Page Contract + генерация Header-контролов из контракта (убивает PAGE_FILTERS и Б13).
- Единый резолвер периода: DataBrowser перестаёт применять две период-оси
  (умирает Б2 как класс), Economy теряет собственный periodKey (Б14).
- `selectedActivities` до сервера (Б12): параметр `activity` принимает CSV.
- deptOnlyMode → orgScope с настоящей математикой вычитания.
- Подвед-ID вместо displayName (готовит D1-переезд и Реестр Sheets+).

## §5. Что поменять концептуально

1. **Период — одна ось, а не четыре поля.** Нынешняя модель
   (`period`+`activeMonths`+`periodMode`+`monthsByYear`+`focusedWeekStart`)
   порождает гонки по построению: два хозяина одного значения и приоритет
   «месяцы бьют квартал» зашиты в потребителе, а не в модели. Дискриминированное
   объединение делает нелегальные состояния непредставимыми — Б1/Б2/Б3/Б10/Б14
   перестают быть возможными, а не «починенными».
2. **Навигация — это патч контекста с инвариантами, а не набор set-ов.**
   Половина реестра (Б3, Б8, Б9, Б11) — следствия того, что `navigateTo`
   выставляет поля по одному и не знает о связях осей. Транзакционный
   `applyNavPatch` с правилами сброса — единственное место, где эти связи живут.
3. **Ключи сущностей канонизируются на границе.** Двухформенность ГРБС и сырой
   `_org_itself` — это утечка серверных представлений в UI-состояние. Правило:
   store хранит только канон (DepartmentId, UnitId), конвертация — в API-слое.
4. **Честность интерфейса важнее полноты контролов.** Контрол, который страница
   игнорирует (Б13), хуже отсутствующего: он разрушает доверие к остальным.
   Page Contract делает «что здесь действует» проверяемым артефактом (юнит-тест:
   каждая ось из consumes реально меняет выдачу селектора страницы).
5. **Фильтр — сериализуемое значение, а не сессионное настроение.** URL-схема
   даёт шаринг срезов, воспроизводимость багрепортов («вот ссылка — вот цифры»)
   и естественный контракт для `buildReport(snapshot, filterCtx)` и `/api/report`.

---
*Верификация фактов: dev-API live-пробы 2026-07-17 (`/api/dashboard`: 8 управлений,
950 issues c `departmentId='uer'`, 728 kpiCards только q1/year;
`/api/rows/uer?subordinate=_org_itself` → total=0, колонка C='Х').
Полный прогон pnpm-гейта в этой волне не выполнялся (анализ без правок кода).*
