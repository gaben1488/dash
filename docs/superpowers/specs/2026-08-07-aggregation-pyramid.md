# Пирамида агрегации AEMR

> Канонический документ. Собран 07.08.2026 из семи инвентаризаций слоёв системы
> (хранение, конвейер, метрики/аналитика, отчёт, API, UI, канон памяти).
> Каждый факт снабжён источником `file:line` из инвентаризаций; пункты, которые
> существуют в каноне памяти, но не в коде, помечены словом «спека».
> Домен: госзакупки 44-ФЗ; атом системы — строка закупки; организационная
> иерархия — подвед → ГРБС (8) → итог района; временная — месяц → квартал → год.
>
> Верифицирован 07.08.2026 тремя адверсариальными линзами (формулы отношений,
> оси против кода, полнота покрытия); найденные расхождения внесены в текст.

---

## §0 Зачем пирамида: целевое качество аналитики

Формула пользователя (решение 07.08.2026, дистиллирует бриф «Отчёт++»):
итоговый продукт — **мощная аналитика: фильтруемая по-разному, выбираемая,
всегда точная, сверяемая, провенансная, с базой знаний и путём до исходников,
написанная без названий функций — с объяснениями, как они работают.**

Разложение на механизмы пирамиды:

- *фильтруемая по-разному* — реестр измерений §2 доступен на каждом слое
  (матрица §5 без ✗ в колонках API/UI);
- *всегда точная* — правила свёртки §3 (проценты не усредняются, индексы
  пересчитываются, официал не подменяется) + «одна свёртка — одно место» §4;
- *сверяемая* — двухисточниковость calc/svod с объяснением расхождений (§3.4);
- *провенансная* — у каждого числа путь до исходника: адрес ячейки листа
  (`svodCellRefs`), строки-атомы доказательства (ProofOverlay брифа
  «Отчёт++»), журнал правок источника `_ChangeLog`;
- *с базой знаний* — KbHover на METRIC_KB у каждого показателя, пустых
  попапов не бывает (бриф, шаги 1-3);
- *без названий функций* — весь пользовательский текст объясняет механику
  по-русски: «как считается», а не «какой функцией» (имена `file:line` живут
  только в доках и КБ-технических уровнях).

---

## §1 Атом — строка закупки; субатом — ячейка

Атомом всей пирамиды является одна строка листа книги ГРБС — массив сырых ячеек
`unknown[]` с позиционными колонками по канону `DEPT_COLUMNS` из `@aemr/shared`.

**Субатом — ячейка** (уточнение пользователя 07.08). Строка состоит из ячеек,
и каждая ячейка имеет фиксированную семантику по канону колонок: справочные
атрибуты (подвед C, направление F, способ L, кварталы/годы O/P/R/S) и числовые
атрибуты (тройки бюджетов H-J/V-X/Z-AB, свёртки K/U/Y). Целевая модель работы —
колоночная: фильтр по справочному столбцу × операция над числовыми столбцами =
результат; именно это делает нормализация атома в SQL-колонки (блок Е, пп. 20-21).
Для СВОДа и свода по месяцам ячейка — самостоятельный носитель значения:
официальное число живёт в конкретной ячейке листа и цитируется адресом
(`svodCellRefs`, §3.4), а не выводится из строк.
Собственного идентификатора у атома нет: строка живёт без бизнес-ключа, только с
позицией на листе (`packages/core/src/pipeline/issue-identity.ts:1-27`). Стабильная
идентичность построена лишь для замечаний: FNV-1a 64-bit от содержимого-якоря
(рег.№ A, № B, предмет G, план K, подвед C) с намеренным исключением номера
строки, чтобы вставка строки выше не орфанила статусы
(`packages/core/src/pipeline/issue-identity.ts:35-53`).

**Где рождается.** Атом читается из отдельных книг ГРБС в Google Sheets —
канонический периметр строк по решению D1 «канон — отдельные книги управлений»
(память: `memory/DESIGN_WAVE_2026-07-13.md:28-30,42-45`); зеркала IMPORTRANGE —
только фолбэк (`packages/server/src/services/snapshot.ts:26-64`). Конвейер
собирает прочитанные строки в снимок: `rowsByDept` без шапки плюс распарсенная
сетка СВОД (`packages/core/src/pipeline/orchestrator.ts:529-545`).

**Где лежит.** Здесь главный факт слоя хранения: таблица атомов
`procurement_rows` объявлена в схеме (`packages/server/src/db/schema.ts:148`),
но в продакшене **не заполняется** — `saveSnapshot` пишет только `snapshots`,
`metric_history` и `issues` (`packages/server/src/services/snapshot.ts:343`);
вставка в `procurement_rows` встречается только в тестах. Фактическое хранилище
атомов — JSON-блоб `snapshots.data.rowsByDept` внутри колонки `data` таблицы
снимков (`packages/server/src/db/schema.ts:6`;
`packages/server/src/services/snapshot.ts:345`), из SQL недоступный ни колонками,
ни индексами. Ретеншн снимков: ежедневные за 7 дней плюс четверговые срезы за
всю историю (`packages/server/src/services/snapshot-retention.ts:55`).

Следствие для всей пирамиды: у атома нет ни SQL-адресуемых осей (кроме
`department_id`, `row_state`, бинарного `procurement_type` в пустой таблице —
`schema.ts:151,158,160`), ни сквозной истории одной закупки между снимками.

---

## §2 Реестр измерений

Канон памяти задаёт шесть осей фильтра: period, dept (ГРБС), subordinate,
method, activity, budget (`memory/data/filter-coverage.md:26-46`); инвариант —
«пустой Set = Все» (`memory/data/filter-coverage.md:150-154`). Ниже — каждая ось
по слоям.

### 2.1 Организация: подвед → ГРБС → итог

- **Значения и словарь.** 8 канонических ГРБС (УО, УКСиМП, УАГиЗО, УИО, УФБП,
  УД, УЭР, УДТХ) — канон памяти `memory/data/filter-coverage.md:64-71`; в коде
  статический справочник `GRBS_BASELINES`
  (`packages/core/src/analytics/grbs-profile.ts:21`). Подвед — значение колонки C;
  классификация колонки C — только по орг-реестру, регекс-эвристики запрещены
  (память: `memory/DESIGN_WAVE_2026-07-13.md:34-35,54-55`). Пусто/плейсхолдер →
  сентинел `_org_itself` («само управление»,
  `packages/core/src/pipeline/calc-engine.ts:271-274`). Tri-mode отображения
  (grbs | org_itself | hybrid) — **спека**, в store отсутствует
  (`memory/data/filter-coverage.md:64-71`).
- **Иерархия уровней.** Строка → подвед (`bySubordinate` и пересечения,
  `calc-engine.ts:134-178`) → ГРБС (движок гоняется на каждый лист отдельно;
  ось ГРБС существует только как ключ `recalcResults[deptId]` и префикс
  `grbs.{dept}.` в строковых ключах метрик,
  `packages/core/src/pipeline/orchestrator.ts:447-468,292-416`) → итог района
  (`mergeSummaryMetrics` суммирует ключи 8 ГРБС, `orchestrator.ts:292-416`;
  в отчёте — `integralSummary` = Σ блоков ГРБС,
  `packages/core/src/report/build-report.ts:752-799`).
- **Колонка в БД.** ГРБС: `procurement_rows.department_id`
  (`packages/server/src/db/schema.ts:151`; единственная орг-ось в SQL-колонке
  атома, притом таблица пуста) и осевые колонки замечаний `issues.department_id`
  / `issues.subordinate_id` (`schema.ts:51-52`). Подвед у атома отдельной колонкой
  не существует — только внутри `cells_json` (`schema.ts:154`).
- **Параметр API.** Неоднородно: path `:deptId` (`packages/server/src/routes/rows.ts:62` —
  принимает и латиницу, и кириллицу; `dashboard.ts:409` — только латиницу),
  query `deptId` (issues, journal; у журнала deptId — CSV-мультивыбор,
  `journal.ts:156` — наряду со scatter единственный мульти-ГРБС параметр в API),
  query `dept` (scatter — CSV; reconciliation/monthly —
  равенство; cell-refs — подстрока metricKey), path `:name` у sources
  (сводка: `packages/server/src/routes`, запись «именование параметров осей»).
  Подвед-фильтр — только `subordinate` в `GET /api/rows/:deptId` (`rows.ts:62`).
- **Фильтр UI.** Отдельная левая колонка `OrgStrip` (ГРБС + подведы + режим
  «только упр.», `packages/web/src/components/OrgStrip.tsx:115`), состояние
  `selectedDepartments` / `selectedSubordinates` / `deptOnlyMode` в zustand-store
  (`packages/web/src/store.ts:168-283`). В `PAGE_FILTERS` ось подведов не
  объявлена вовсе (`packages/web/src/components/Header.tsx:17-31`); на странице
  «Отчёт» OrgStrip скрыт осознанно (`packages/web/src/App.tsx:143`). Помимо
  OrgStrip уровень агрегации переключает страница «Экономия»: таблица
  ГРБС ↔ подведы (`packages/web/src/pages/Economy.tsx:46`).

### 2.2 Время: месяц → квартал → год → весь период (+ неделя-срез)

- **Значения и деривация.** Квартал — из план-квартала, колонка O; факт без
  валидного план-квартала уходит в корзину `_orphan`
  (`packages/core/src/pipeline/calc-engine.ts:230-234,507-510`). Месяц — из
  план-даты N (`calc-engine.ts:236-259`). Год = Σ четырёх кварталов + `_orphan`
  в факте (`packages/core/src/pipeline/calc-engine-adapter.ts:119-158`); при этом
  год не является измерением ядра — `targetYear` это фильтр входа, byYear-группировки
  нет (`calc-engine.ts:417-425,467-471`). Неделя — не фильтр строк, а срез
  состояния `asOfDay`: факт засчитывается только до даты среза
  (`calc-engine.ts:182-208,426-434`); Отчёт — единственный настоящий потребитель
  недели во всём продукте (`docs/superpowers/specs/2026-08-07-time-axis-map.md:1-30`).
- **Иерархия уровней.** month → quarter → year в 14 group-by картах движка
  (`byQuarter`, `byMonth`, `byQuarterMethod` с ключами `m{N}.{method}` и др.,
  `calc-engine.ts:134-178`). Целевая модель `TimeSelection` (мультигоды ×
  кварталы × месяцы + weekStart) — **спека**
  (`docs/superpowers/specs/2026-08-07-time-axis-map.md:146-261,276`;
  тип TimeRange — `memory/data/filter-coverage.md:100-134`).
- **Колонка в БД.** Оси времени в хранении **нет вообще**: ни месяц, ни квартал,
  ни год не существуют как SQL-колонка ни в одной таблице — PLAN_QUARTER/PLAN_YEAR
  и даты живут только внутри `cells_json` и JSON-блоба `snapshots.data`
  (инвентаризация хранения, gap №1; `packages/server/src/db/schema.ts:154`).
  Единственный временной срез в БД — сам снимок и его ретеншн
  (`snapshot-retention.ts:55`).
- **Параметр API.** `year` принимают `/api/dashboard`, `/api/report`,
  `/api/reconciliation/*`, `/api/rows/:deptId` (`rows.ts:79`,
  `rows-filters.ts:29-33`) и `/api/svod/unified` (`dashboard.ts:578-585`);
  валидация 2020..2100 при этом скопирована пятикратно (`dashboard.ts:17-25`,
  `dashboard.ts:578-585`, `report.ts:135-141`, `reconciliation.ts:26-31`,
  `packages/server/src/services/rows-filters.ts:29-33`);
  `quarter` 1..4 и `asOf` YYYY-MM-DD — только у `GET /api/report`
  (`packages/server/src/routes/report.ts:21-23`); `since` у `/api/changes`
  (`changes.ts:49`); `from/to` в `/api/journal` — даты, в `/api/history/diff` —
  id снимков (одно имя, разная семантика; `journal.ts:53`, `history.ts:16`).
  Месяц как параметр не передаваем никуда (gap API №2); мультиквартал и
  мультигод — нет (проекция отчёта знает ровно один квартал,
  `packages/core/src/report/build-report.ts:80-94`).
- **Фильтр UI.** TimeDrum (год × кварталы × месяцы, multi-year) + WeekRoller
  (колесо недель) в шапке (`packages/web/src/components/Header.tsx:211-391`),
  состояние year/period/activeMonths/monthsByYear/periodMode/focusedWeekStart
  (`store.ts:168-283`). Решение пользователя Д4 (06.08.2026): ось времени
  сквозная на всех вкладках
  (`docs/superpowers/audits/2026-08-05-defect-register.md:50-68`) — реализация
  не завершена: на «Отчёте» действуют только год/квартал/неделя, месяцы не
  читаются ни разу (`docs/superpowers/specs/2026-08-07-time-axis-map.md:118` —
  localQuarter, третий источник квартала; `packages/web/src/pages/Report.tsx:488,504-506`).

### 2.3 Способ закупки

- **Значения и словарь.** Исходные коды — ЭА/ЕП/ЭК/ЭЗК (колонка L/METHOD);
  единственная дверь классификации — `classifyMethodGroup`: «ЕП» → `ep`,
  известный конкурентный код → `competitive`, пустой метод → `competitive`
  (легаси-канон формулы СВОДа `L<>"ЕП"`), неизвестный непустой → `null`
  (`packages/core/src/pipeline/calc-engine.ts:221-228`;
  `docs/METRICS_CONTRACT.md:7-13,36-68`). Семейство методов ЕП/ЭА/ЭЗК/ЭК/ЭАС/ЭЕП
  как ось — канон памяти, **спека** (`memory/data/filter-coverage.md:26-46`).
- **Иерархия уровней.** Бинарная: конкретный код → группа КП/ЕП. Полного способа
  как уровня агрегации нет ни в одном слое.
- **Колонка в БД.** Только огрублённый `procurement_rows.procurement_type`
  (competitive | single_provider) в пустой таблице
  (`packages/server/src/db/schema.ts:160`); полный код — внутри `cells_json`.
- **Параметр API.** `type=competitive|single` только в `GET /api/rows/:deptId` и
  `GET /api/rows/scatter` (`rows.ts:62`, `rows.ts:794`); конкретный способ
  (ЭА/ЭК/ЭЗК) в API не передаваем нигде (gap API №3).
- **Фильтр UI.** `selectedMethods` в store (`store.ts:168-283`), контрол
  «procurement» в `PAGE_FILTERS` большинства страниц (`Header.tsx:17-31`).

### 2.4 Направление деятельности

- **Значения и словарь.** `classifyActivity` по колонке F с учётом графы
  программы D; нераспознанный вид → честная группа `unknown`
  (`packages/core/src/pipeline/calc-engine.ts:283-285`). Параллельно в
  unified-svod — 4 среза `ACTIVITY_SCOPES` через `matchesActivityScope`
  (td_pm ⊂ td, `packages/core/src/pipeline/unified-svod.ts:258-263`).
  У замечаний ось направлением — `issues.activity_type` (`schema.ts:53`).
- **Иерархия уровней.** Плоская классификация строки; в движке группы
  `byActivity`, `byQuarterActivity` (вкл. `year.{activity}`),
  `bySubordinateActivity`, `byActivityMethod`, `byMonthActivity`
  (`calc-engine.ts:134-178`).
- **Колонка в БД.** У атома — нет (только `cells_json`); отдельной колонкой
  существует лишь у замечаний: `issues.activity_type`
  (`packages/server/src/db/schema.ts:51`).
- **Параметр API.** `activity` только в `GET /api/rows/:deptId` (подстрока) и
  `GET /api/rows/scatter` (enum из 3 значений) — `rows.ts:62`, `rows.ts:794`;
  в `/api/svod/unified` активность зашита в структуру ответа, но не в параметры
  (`dashboard.ts:577`).
- **Фильтр UI.** `selectedActivities` в store; на странице «Свод» — собственная
  несовместимая локальная ось pm/td_clean/td_pm
  (`packages/web/src/pages/SvodView.tsx:167-198`): один пользовательский выбор
  «ТД-ПМ» в шапке и на Своде — разные состояния (gap UI №6).

### 2.5 Источник бюджета (ФБ/КБ/МБ)

- **Значения.** Три бюджета: федеральный, краевой, местный — тройки колонок
  H-J (план), V-X (факт), Z-AB (экономия) внутри `cells_json`
  (`packages/server/src/db/schema.ts:154`).
- **Иерархия уровней.** Ось не иерархична; на каждом уровне присутствует как
  разрез сумм: метрики `plan_fb/kb/mb`, `fact_fb/kb/mb`, `economy_fb/kb/mb`
  (`packages/core/src/metrics/registry.ts:147,195,243`; в движке —
  `STANDARD_METRICS`, `calc-engine.ts:320-365`).
- **Колонка в БД.** Нигде: в `procurement_rows` только свёрнутые
  `plan_amount/fact_amount/economy` (`schema.ts:163-170`), побюджетная разбивка —
  только JSON (gap хранения №4).
- **Параметр API.** Не передаваем ни в один эндпоинт как фильтр — существует
  только в разрезах ответов (`/api/dashboard`, `/api/svod/unified`,
  `/api/reconciliation/monthly`; gap API №1).
- **Фильтр UI.** `selectedBudgets` в store (`store.ts:168-283`); на Своде
  бюджет-фильтр режет только деньги, количества по бюджету не делятся
  (ограничение данных, gap UI №10); на страницах Контроля и на Отчёте ось не
  объявлена в `PAGE_FILTERS` (`Header.tsx:17-31`).

### 2.6 Статус / жизненный цикл

- **Значения.** ~30 построчных сигналов `detectSignals` (signed, planning,
  notDue, canceled, overdue, hasFact и др.), сводимых `classifyRowState` в одну
  метку RowState для UI (`packages/core/src/pipeline/signals.ts:29-111,263,687`).
  У замечаний — свой жизненный цикл open → acknowledged → in_progress →
  resolved/wont_fix/false_positive (`packages/server/src/routes/issues.ts:157`).
  Этапность года в отчёте — `lifecycleOf`: заключена / в работе / просрочена /
  без плановых денег (`packages/core/src/report/build-report.ts:399-461`).
- **Колонка в БД.** `procurement_rows.row_state` (`schema.ts:158`, таблица
  пуста) + `signals_json` (`schema.ts:156`); у замечаний — `issues.status`
  (`schema.ts:59`) с историей переходов `issue_history` (`schema.ts:69`).
- **Параметр API.** `state=RowState` в `GET /api/rows/:deptId` (`rows.ts:62`);
  `status`/`severity` (`issues.ts:60`) и `category` (`issues.ts:80`) в
  `GET /api/issues`.
- **Фильтр UI.** Карточки «Сигналы и аномалии» с дрилл-дауном
  (`packages/web/src/pages/Dashboard.tsx:711-868`), фильтры вкладки «Замечания»
  (`packages/web/src/pages/Issues.tsx:193-297`).

### 2.7 Предмет закупки (SubjectCategory)

Ось существует в коде, но в каноне 6 осей фильтра не значится и до этого
документа нигде не описывалась. Классификатор `classifySubject` /
`buildSubjectAnalysis` (`packages/core/src/analytics/subject-classify.ts:48,65`);
выдача — `/api/analytics/subjects`
(`packages/server/src/routes/analytics.ts:329,345`) и `/api/rows/subjects`
(`packages/server/src/routes/rows.ts:690` — вторая свёртка предметов, дубль из
§4.3); потребитель UI — страница «Рекомендации»
(`packages/web/src/pages/Recs.tsx:245`); централизация группирует
по предметам (`packages/core/src/analytics/centralization.ts:32`). Как фильтр
не передаваема нигде; в БД отсутствует.

### 2.8 Текстовый поиск — седьмая сквозная ось UI

`searchQuery` в store (`packages/web/src/store.ts:69,388`, участвует в счётчике
активных фильтров — `store.ts:82`), входит в readonly `FilterContext` Отчёта
(`packages/web/src/lib/filter-context.ts:99,180`) и в клиентскую фильтрацию
`useFilteredData` (`packages/web/src/hooks/useFilteredData.ts:40,59`); контрол
'search' объявлен в `PAGE_FILTERS` для data и issues
(`packages/web/src/components/Header.tsx:15,21,27`). API: `search` у
`GET /api/rows/:deptId` (`rows.ts:74`) и `/api/journal` (`journal.ts:165`;
там же `action` — `journal.ts:151`, `days` у `/api/journal/stats` —
`journal.ts:201`).

Кроме осей данных, есть ось отображения: единицы денег `moneyUnit`
(тыс/млн/млрд) — контрол 'currency' в `PAGE_FILTERS` пяти страниц
(`Header.tsx:14,18-23`), состояние `store.ts:185,338`. Данные не фильтрует,
но входит в счётчик активных фильтров (`store.ts:60,75`).

---

## §3 Классы метрик и правила свёртки

Четыре класса. Правило пирамиды: класс определяет способ подъёма по любой оси —
организация, время, способ, направление, бюджет.

### 3.1 Аддитивные (суммы денег, счётчики строк)

Свёртка = сумма по любому срезу; строка → подвед → ГРБС → итог, месяц → квартал
→ год — везде простое сложение.

Реальные метрики: `plan_count` (`packages/core/src/metrics/registry.ts:47`),
`fact_count` (гейт «дата факта не пуста», атрибуция по план-кварталу —
`registry.ts:63`), `pending_count` (`registry.ts:17`), `pending_total` и
`pending_fb/kb/mb` (`registry.ts:32`), `competitive_count` / `ep_count`
(`registry.ts:79`), `comp_fact_count` / `ep_fact_count` (`registry.ts:113`),
`plan_fb/kb/mb/total` (`registry.ts:147`), `fact_fb/kb/mb/total`
(`registry.ts:195`), `economy_fb/kb/mb` (двойной гейт: дата факта И AD='да' —
`registry.ts:243`), `economy_total`/`total_economy` (`registry.ts:406`),
`comp_plan_total` / `ep_plan_total` (`registry.ts:278`), разности аддитивных:
`deviation` (`registry.ts:299`) и `amount_deviation` (`registry.ts:309`) —
⚠ у разностей registry ненадёжен как источник формулы: `registry.ts:311`
описывает amount_deviation как «plan − fact», движок считает fact − plan
(`calc-engine.ts:374`, тест `exec-count-pct.test.ts:148`); deviation в движке
plan − fact (`calc-engine.ts:370`), а в своде ГРБС fact − plan
(`orchestrator.ts:374`). Направление знака сверять со СВОД (колонка P: факт −
план) — прецедент sign-бага reconcile уже был (mulch mx-873d12),
`total_procedures` (`registry.ts:423`), сигнальные счётчики (9 ключей
`signal_*`, `registry.ts:851`), `high_economy_count` (`registry.ts:775`),
`economy_conflicts` (`registry.ts:795`), `critical_issues` (`registry.ts:498`),
`dept_issues` (`registry.ts:681`). В движке базовый слой — 24 метрики
`STANDARD_METRICS` классов count/sum
(`packages/core/src/pipeline/calc-engine.ts:320-365`), гейт экономии AD='да' —
`calc-engine.ts:301-314,556-576`.

### 3.2 Отношения (доли и проценты)

**ЗАПРЕЩЕНО усреднять проценты.** Свёртка — только раздельно: числитель и
знаменатель сворачиваются как аддитивные, процент пересчитывается на каждом
целевом уровне. Код это делает корректно (byDept/byQuarter), но сами проценты
складывать/усреднять нельзя ни по одной оси.

Нулевой знаменатель — правило пирамиды и факт кода расходятся. Целевое
правило: знаменатель 0 → `null` («нет плана»), не 0 и не 100 — так делает
только квартальная формула `quarterExecutionFromCounts`
(`packages/core/src/metrics/quarter-execution.ts:90`). Движок для всех
производных `STANDARD_DERIVED` (op 'pct'/'ratio') возвращает **0**
(`calc-engine.ts:659-669`), свод по ГРБС — тоже 0
(`orchestrator.ts:376-410`), и registry это документирует
(`registry.ts:401`: «Если plan_total = 0, показатель равен 0»). Следствие:
0 в отношении неотличим от «нет плана» везде, кроме кварталки отчёта —
кандидат в блок А плана.

Реальные метрики: главный KPI `exec_count_pct` = Σfact_count / Σplan_count × 100
(`registry.ts:339`); каноническая формула G = E/D `quarterExecution`
(`quarter-execution.ts:102`) и её чистый вариант `quarterExecutionFromCounts`
(`quarter-execution.ts:83`); `execution_pct` (`registry.ts:319`);
`comp_exec_count_pct` / `ep_exec_count_pct` (`registry.ts:360`); `savings_pct`
(`registry.ts:391`); `ep_share_pct` (`registry.ts:432`); `economy_rate`
(`registry.ts:518`); `fb_execution_pct` / `dept_fb_exec_pct`
(`registry.ts:562`); `dept_exec_count_pct` / `dept_exec_amount_pct`
(`registry.ts:597`); `dept_delta_quarter` — разность отношений
(`registry.ts:698`); производные движка `STANDARD_DERIVED` — 10 отношений и
разностей, все доли decimal (`calc-engine.ts:368-390`).

Антипримеры усреднения процентов в самом продукте (все — кандидаты на
исправление или явную оговорку «среднее по группам, не доля»):

- `avg_reduction_pct` — невзвешенное среднее процентов по ГРБС, не
  сворачивается ни вверх, ни вниз, маскирует крайности (KB-pitfall,
  `registry.ts:756`). Уточнение линзы: вопреки `registry.ts:759`
  («source: CalcEngine»), в движке этого расчёта нет — реальное среднее
  живёт в web: `packages/web/src/lib/economy/dept-economy.ts:182`
  (`avgPct = pctSum / rows.length`), вывод `EconomyHero.tsx:42-47`;
- `avgEconomy` — среднее `economyPercent` по строкам scatter
  (`packages/web/src/pages/Analytics.tsx:425-427`);
- `avgExecHeatmap` — среднее `execPct` по ячейкам теплокарты
  (`Analytics.tsx:430-432`);
- `avgTrust` — среднее trust-индекса по ГРБС (`Analytics.tsx:434-436`) —
  заодно нарушает правило §3.3 «индексы не агрегируются».

### 3.3 Индексы и оценки

Свёртка запрещена в обе стороны: на целевом уровне пересчитывается формула,
а не агрегируются готовые значения. Фактически весь analytics-слой определён
**только на уровне ГРБС** — ни подвед-версии, ни «грейда района» не существует
(инвентаризация метрик, gap №3).

Реальные метрики: `trust_overall` — взвешенный индекс 0.30/0.25/0.20/0.15/0.10 с
grade A-F и бинаризацией по порогу 75 (`registry.ts:445`), его 5 компонентов
(`registry.ts:454`); управленческий грейд A-D `gradeGRBS` — score 100 − штрафы
(`packages/core/src/analytics/grbs-grade.ts:50`; фазовая поправка
`phaseAdjustedTarget` — `grbs-grade.ts:40`); индекс дисциплины 0-100
`disciplineIndex` (`packages/core/src/analytics/discipline-index.ts:45`; веса —
`discipline-index.ts:34`); композитный балл датасета (веса
0.40/0.25/0.20/0.15, `packages/core/src/pipeline/dataset-signals.ts:238-432`);
антикор-оркестратор `detectAntiCorruption`
(`packages/core/src/analytics/anticorruption.ts:236`) с поддетекторами
`detectSplitting` (`anticorruption.ts:89`), `detectZeroCompetition` (`:139`),
`detectPriceInflation` (`:157`), `detectEpOverLimit` (`:175`),
`detectAnnualEpShare` (`:192`), `detectSupplierConcentration` (`:209`) и
весами `penaltyForSeverity` (`:70`); семейство комплаенс-проверок 44-ФЗ —
пороги закона `LAW_44FZ` (`packages/core/src/analytics/compliance-44fz.ts:23`),
`EP_SHARE_BY_ROLE` (`:53`), `checkEPContractLimits` (`:91`),
`checkAntiDumping` (`:116`), `checkEPShareLimits` (`:142`),
`classifyEPReason`/`analyzeEPReasons` (`:189,206`), выдача
`/api/analytics/compliance` (`packages/server/src/routes/analytics.ts:43`) и
`/api/analytics/ep-reasons` (`analytics.ts:97`) — все определены на уровне
ГРБС/района, свёртке не подлежат; `benfordAnalysis` (chi-square,
<30 значений → автоматически passes — на мелких выборках вырождается,
`packages/core/src/analytics/anomaly.ts:53`); `ewmaDetection`
(`anomaly.ts:111`); `zScoreAnalysis` — существует только на уровне группы ГРБС
(`anomaly.ts:153`); `dept_rank` — несворачиваем по определению
(`registry.ts:576`); профили `buildGRBSProfiles`
(`packages/core/src/analytics/grbs-profile.ts:51`); прогнозы `linearForecast` /
`seasonalForecast` / `buildScenarios`
(`packages/core/src/analytics/forecast.ts:29,68,119`); централизация
`findCentralizationOpportunities` — существует только поверх всех ГРБС
(`packages/core/src/analytics/centralization.ts:32`).

### 3.4 Last-value / снапшоты

Правило: брать последнее значение периода (или значение ячейки как есть), не
сумму. Сюда относятся все официальные числа и остатки.

Реальные метрики: официальные метрики СВОД — last-value чтение одной ячейки с
коррекцией процентов и confidence
(`packages/core/src/pipeline/normalize.ts:6`); `metric_history` — единственное
преагрегированное хранилище «значение метрики на снимок»
(`packages/server/src/db/schema.ts:25`); официал квартала в отчёте
`svodSplit`/`svodCellRefs` с адресами ячеек, origin 'svod'
(`packages/core/src/report/build-report.ts:194-211,294-310`); официальные
деньги года `svodYearMoneyOf` — строка «ИТОГО 2026:» листа
(`build-report.ts:219-237`); блок `official` — числа, которые лист считает сам
(remainderToConclude из шапки, calcEconomy), без пересчёта, честная пустота при
отсутствии яруса (`build-report.ts:693-719`); статус замечания — последний по
state-machine (`packages/server/src/routes/issues.ts:157`); серия
`dept_sparkline` — визуальный ряд, не сворачивается (`registry.ts:716`).

Двухисточниковость — сквозное правило слоя отчёта: каждое число несёт origin
'calc' | 'svod', официал не подменяется пересчётом, расхождения объясняются
полями live/afterSlice/noYearRows/unfunded и плашками notes
(`packages/core/src/report/build-report.ts:576-580,647-659,239-268`).

---

## §4 Слои конвейера: где какая свёртка живёт

Принцип пирамиды: **одна свёртка живёт в одном месте, UI не досчитывает.**
Ниже — целевое распределение и фактическое состояние по инвентаризациям.

### 4.1 Хранение (SQLite)

Атомарно должна храниться строка закупки с колонками осей; материализовать
стоит регулярные свёртки (ГРБС × период × способ × бюджет). Фактически:
атомы — в нечитаемом SQL-ом JSON-блобе `snapshots.data.rowsByDept`
(`packages/server/src/services/snapshot.ts:345`), таблица `procurement_rows`
пуста (`packages/server/src/db/schema.ts:148`), агрегатных/материализованных
таблиц и SQL views нет вообще (0 CREATE VIEW в репозитории; единственный
преагрегат — `metric_history`, `schema.ts:25`). 7 projection-views
спроектированы — **спека**, реализовано 0
(`memory/data/projection-views.md:289-300`, verified 2026-06-05). Все кэши —
в памяти процесса и теряются при рестарте
(`packages/server/src/services/snapshot.ts:16`); журнал правок источника
`_ChangeLog` (~37 тыс. записей) в БД не персистится
(`packages/server/src/routes/changes.ts:19`).

### 4.2 Обработка (core)

Каноническое место каждой свёртки — единственный расчётный движок `CalcEngine`:
один проход по строкам, 14 group-by карт за прогон
(`packages/core/src/pipeline/calc-engine.ts:394,134-178`), универсальная
свёртка произвольных комбинаций фильтров `sliceResults`
(`calc-engine.ts:758-831`). Фактические нарушения принципа «одна свёртка — одно
место»:

- параллельный второй агрегатор `computeUnifiedGrid` со своей картой колонок,
  своим `num()` (не срезающим пробелы-разряды — известный баг парсинга), своей
  копией классификатора строк (`packages/core/src/pipeline/unified-svod.ts:202-272`;
  gap конвейера №1-2);
- свод по ГРБС — ad-hoc суммирование строковых ключей `grbs.{dept}.*` в
  `mergeSummaryMetrics`, мимо group-by движка; помесячные m1-m12 в свод не
  попадают (`packages/core/src/pipeline/orchestrator.ts:292-416`; gap №3);
- три деривации «года» в одном результате: Σ кварталов без `_orphan` в
  `mergeRecalcIntoMetrics` (`orchestrator.ts:174-208`) против Σ + `_orphan` в
  адаптере (`calc-engine-adapter.ts:119-158`) — числа одного снимка могут не
  сходиться (gap №4);
- квартальная свёртка существует в четырёх местах с разными осями
  (byQuarter по план-кварталу; quarterOf unified-svod; Q_MONTHS из ШДЮ,
  `packages/core/src/pipeline/reconcile.ts:852-931`; Q4-спайк из факт-даты,
  `packages/core/src/pipeline/seasonal.ts:61-231`; gap №8).

Проекция отчёта — образец правильного слоя: чистая функция `buildReport`
делегирует всю счётную семантику канонам движка и не заводит вторых семантик
(`packages/core/src/report/build-report.ts:541-691`; pendingOf:
«иначе завелась бы вторая семантика остатка», `build-report.ts:178-186`).

### 4.3 Выдача (API)

Целевое: единый контракт параметров осей. Фактическое: 58 эндпоинтов, имена
осей неоднородны (deptId/dept/name; type вместо method; from/to с двумя
семантиками — сводка «именование параметров осей»,
`packages/server/src/routes`); оси бюджета и месяца не передаваемы никуда;
валидация year скопирована трижды (`dashboard.ts:17-25`, `report.ts:137-140`,
`reconciliation.ts:26-31`); пять семейств дублей (reconcile* deprecated vs
reconciliation; load-all = refresh; history vs history/snapshots; две свёртки
предметов; export-дубль CSV). Целевой контракт `POST /api/dashboard/query` со
всеми 6 осями — **спека** (`memory/data/filter-coverage.md:170-216`).

### 4.4 UI

Целевое: единое состояние фильтра, страницы только отображают готовые свёртки.
Фактическое: два параллельных механизма — zustand-store + `useFilteredData`
(все страницы, `packages/web/src/store.ts:168-283`;
`packages/web/src/hooks/useFilteredData.ts:29`) и readonly `FilterContext`
только у Отчёта (`packages/web/src/lib/filter-context.ts:49-183`), плюс две
несовместимые URL-схемы (`packages/web/src/hooks/useUrlSync.ts:18-176`).
UI досчитывает сам: пересчёт квартальных сводок и тоталов при фильтрах
(`useFilteredData.ts:87-124`), спарклайны циклами по q1..q4
(`packages/web/src/pages/Dashboard.tsx:462-521`), docx-выгрузка отчёта делает
4 квартальных запроса `/api/report`
(`packages/web/src/pages/Report.tsx:569-605`), клиентский квартальный фильтр
строк в Реестре (`packages/web/src/pages/DataBrowser.tsx:345-357`), взвешенный
пересчёт trust при фильтре ГРБС (`packages/web/src/pages/Trust.tsx:205-257`),
среднее экономии по ГРБС `avgPct`
(`packages/web/src/lib/economy/dept-economy.ts:182`) и три средних
Analytics (`Analytics.tsx:425-436`, см. антипримеры §3.2).
Каждый такой пересчёт — кандидат на переезд в core/API.

---

## §5 Матрица покрытия

Только из инвентаризаций. «✓» — ось представлена в слое (с источником);
«частично» — представлена с существенной оговоркой; «✗» — отсутствует.
Для БД учтено, что колонки-оси `procurement_rows` лежат в таблице, которая в
продакшене не заполняется (§1).

| Ось | БД (SQLite) | core (расчёт) | API (параметр) | UI (фильтр) |
|---|---|---|---|---|
| ГРБС | ✓ schema.ts:151 (пустая таблица); issues — schema.ts:51 | ✓ orchestrator.ts:447-468,292-416 (per-лист + ad-hoc свод) | ✓ rows.ts:62 (:deptId); имена неоднородны | ✓ OrgStrip.tsx:115; store.ts:168-283 |
| Подвед | ✗ у атома (только cells_json schema.ts:154); issues.subordinate_id — schema.ts:52 | ✓ calc-engine.ts:271-274 (bySubordinate + пересечения) | частично rows.ts:62 (только subordinate= у одного роута) | ✓ OrgStrip.tsx:115; Economy.tsx:46 (ГРБС↔подведы); ✗ в PAGE_FILTERS Header.tsx:17-31 |
| Итог района | частично metric_history schema.ts:25-34 (официальные метрики района на снимок, snapshot.ts:373-383); агрегатных таблиц по строкам нет | ✓ orchestrator.ts:292-416; build-report.ts:752-799 | ✓ dashboard.ts:13 (kpiCards/summaryByPeriod) | ✓ Dashboard.tsx:462-521 |
| Месяц | ✗ (только внутри cells_json schema.ts:154) | ✓ calc-engine.ts:236-259 (byMonth) | ✗ (не передаваем; пакет m1-m12 в ответе dashboard.ts:13) | частично Header.tsx:211-391 (TimeDrum; на Пульте месяц работает — useFilteredData.ts:75,91,106,113-116; не применяется в hero-спарклайнах Dashboard.tsx:472-487 и в Отчёте) |
| Квартал | ✗ | ✓ calc-engine.ts:230-234 (byQuarter + _orphan) | ✓ report.ts:21-23 (quarter, единственный роут) | ✓ store.ts:168-283 (period) |
| Год | ✗ | частично calc-engine.ts:417-425 (фильтр входа, не измерение; год = Σ кварталов calc-engine-adapter.ts:119-158) | ✓ dashboard.ts:13; report.ts:21-23; reconciliation.ts:177; rows.ts:79; dashboard.ts:578-585 (svod/unified) | ✓ Header.tsx:211-391; 'all' несовместим между страницами (request.ts:24-68) |
| Неделя / срез asOf | ✓ snapshots schema.ts:6 + ретеншн snapshot-retention.ts:55 | ✓ calc-engine.ts:182-208 (asOfDay, factCountsOn) | ✓ report.ts:21-23 (asOf, единственный роут) | частично Header.tsx:211-391 (WeekRoller; потребитель — только Отчёт, time-axis-map.md:1-30) |
| Способ (полный ЭА/ЕП/ЭК/ЭЗК) | ✗ (только бинарный schema.ts:160 в пустой таблице; полный — cells_json) | частично calc-engine.ts:221-228 (только бинарная группа КП/ЕП) | частично rows.ts:62, rows.ts:794 (type=competitive\|single) | частично store.ts:168-283 (selectedMethods — бинарно) |
| Направление деятельности | ✗ у атома; issues.activity_type — schema.ts:51 | ✓ calc-engine.ts:283-285 (byActivity + пересечения); unified-svod.ts:258-263 | частично rows.ts:62, rows.ts:794 (два роута) | частично store.ts:168-283; Свод — своя несовместимая ось SvodView.tsx:167-198 |
| Бюджет (ФБ/КБ/МБ) | ✗ (только свёрнутые суммы schema.ts:163-170) | ✓ calc-engine.ts:320-365 (метрики fb/kb/mb) | ✗ (только в разрезах ответов) | частично store.ts:168-283 (selectedBudgets; режет деньги, не количества) |
| Статус / жизненный цикл | ✓ row_state schema.ts:158 (пустая таблица); issues.status schema.ts:59 | ✓ signals.ts:29-111,263,687 (classifyRowState); build-report.ts:399-461 | ✓ rows.ts:62 (state=); issues.ts:60,80 (status/severity/category) | ✓ Dashboard.tsx:711-868; Issues.tsx:193-297 |
| Предмет закупки (§2.7) | ✗ | ✓ subject-classify.ts:48,65; centralization.ts:32 | частично analytics.ts:329, rows.ts:690 (готовые свёртки, фильтра нет) | частично Recs.tsx:245 (просмотр, не фильтр) |
| Текстовый поиск (§2.8) | ✗ | ✗ (клиентская фильтрация useFilteredData.ts:40,59) | частично rows.ts:74; journal.ts:165 (два роута) | ✓ store.ts:69,388; Header.tsx:15,21,27 |

Сквозной вывод матрицы: колонка «core» почти полностью зелёная — движок умеет
все оси и их пересечения; колонка «БД» почти полностью красная — атомы лежат в
JSON-блобе; колонки «API» и «UI» пятнистые — оси доезжают до пользователя
выборочно и под разными именами.

---

## §6 Разрывы и план

План согласован с курсом «Отчёт++»: основа продукта — страница Отчёт, состав
ручных отчётов живёт в единственном доме `mainReportBlocks` /
`additionalReportBlocks` (`packages/web/src/lib/report/docx/text-blocks.ts:309-461,490-573`;
`docs/superpowers/specs/2026-08-01-report-plus-plus.md:56-65,80-88,117-134`),
ось времени сквозная везде (решение Д4,
`docs/superpowers/audits/2026-08-05-defect-register.md:50-68`; фазы —
`docs/superpowers/specs/2026-08-07-time-axis-map.md:146-261`). Каждый шаг —
один коммит; порядок — от того, что кровоточит у Отчёта, к консолидации ядра и
затем к хранению.

**Блок А. Честность чисел (немедленно — дешёвые точечные фиксы).**

1. Унифицировать числовой парсинг: `num()` в
   `packages/core/src/pipeline/unified-svod.ts:76-82` и парс в
   `shdyu-ingest.ts:21-26` перевести на канонический `toNumber`
   (`calc-engine.ts:30-37`) — баг «1 234,56 → 1» жив в двух местах.
2. Выровнять «год»: kp.year/ep.year в `orchestrator.ts:174-208` привести к
   семантике адаптера (Σ кварталов + `_orphan`, `calc-engine-adapter.ts:119-158`)
   либо явно задокументировать различие — сейчас суммы одного снимка расходятся.
3. Убрать двойной прогон `detectSignals` на строку
   (`orchestrator.ts:460` и `orchestrator.ts:496-505`) — чистая экономия без
   изменения семантики.
4. Заменить фолбэк `sheetName.toLowerCase()` в `SHEET_TO_DEPT_ID`
   (`orchestrator.ts:50,448,491`) на `findDept` с честным пропуском — сервер в
   `attachUnifiedGrid` уже так делает (`snapshot.ts:152-171`).

**Блок Б. Ось времени сквозная (курс Д4 + Отчёт++).**

5. Фаза 0 целевой модели: харденинг `sliceResults`
   (`calc-engine.ts:758-831`) — типизированный адрес (ось, ключ) вместо
   каскада `getValue` (`calc-engine.ts:726-733`).
6. Тип `TimeSelection` + канонический резолвер периода в `@aemr/shared`
   (спека: `time-axis-map.md:146-261`) — один источник истины вместо трёх
   источников квартала на странице Отчёта (`Report.tsx:488,504-506`).
7. Мультиквартальный контракт `/api/report` (CSV-кварталы, фаза 3 карты):
   `sumOverQuarters` обобщается до суммы по подмножеству
   (`build-report.ts:115-136,605-623`); docx-выгрузка перестаёт делать 4
   HTTP-запроса (`Report.tsx:569-605`). Контракт `Report.period` менять только
   вместе с `mainReportBlocks`/`additionalReportBlocks`
   (`text-blocks.ts:38-46`).
8. Месяц как параметр API (сначала `/api/report` и `/api/dashboard`):
   готовый `sliceResults({months})` движка простаивает
   (карта, класс Г; `time-axis-map.md`).
9. Прошлая неделя без снимка: плашка «Снимка на … нет — показаны текущие
   данные под датой среза» и явный режим live/archive уже есть
   (`routes/report.ts:231-237`; `Report.tsx:492-506`); остаток пункта —
   серверный отказ/блокировка данных при отсутствии снимка вместо выдачи
   живых чисел под архивной датой.

**Блок В. Одна свёртка — одно место (ядро).**

10. Свод по ГРБС через движок: перевести `mergeSummaryMetrics`
    (`orchestrator.ts:292-416`) с суммирования строковых ключей на group-by
    результаты; включить в свод помесячные m1-m12.
11. Характеризационные тесты на `computeUnifiedGrid`
    (`unified-svod.ts:202-272`), затем делегирование его свёрток в CalcEngine —
    ликвидация второго агрегатора (по одному коммиту на срез: классификатор
    строк, метод, период, экономия).
12. Единая квартальная свёртка: свести четыре реализации (byQuarter,
    quarterOf, Q_MONTHS `reconcile.ts:852-931`, Q4-спайк `seasonal.ts:61-231`)
    к одной оси с явным различием план-квартал/факт-дата.
13. Типизировать шов сверки: убрать `Record<string, any>` в
    `reconcile.ts` / `reconcileMonthly` / `crossVerifyQuarterly`, вынести
    `rekeyByGrbs` в одно место (`reconcile.ts:22-31`).

**Блок Г. Единый контракт API.**

14. Одно имя оси ГРБС (`deptId`) во всех роутах с единым резолвером
    латиница/кириллица; вынести валидацию year в общий модуль
    (сейчас пять копий: `dashboard.ts:17-25`, `dashboard.ts:578-585`,
    `report.ts:135-141`, `reconciliation.ts:26-31`,
    `services/rows-filters.ts:29-33`).
15. Удалить дубли: `/api/reconcile{,/:deptId}` (DEPRECATED, `rows.ts:554,613`),
    `/api/load-all` (`dashboard.ts:529`), один из `/api/history` //
    `/api/history/snapshots` (`audit.ts:16`, `history.ts:11`); починить мёртвый
    параметр `entity` в `/api/journal` (`journal.ts:53`).
16. Ось бюджета и полного способа как параметры (после того как ядро отдаёт
    их из одной свёртки) — либо целевой `POST /api/dashboard/query` со всеми
    6 осями (**спека**, `memory/data/filter-coverage.md:170-216`).

**Блок Д. UI перестаёт досчитывать.**

17. Домиграция страниц со связки store+`useFilteredData` на `FilterContext`
    и одна URL-схема (сейчас две несовместимые: `useUrlSync.ts:18-176` vs
    `filter-context.ts:49-183`); сериализация недели в URL.
18. Свод: перевод локальных осей активности/периода
    (`SvodView.tsx:167-198`) на глобальные; Журнал: применить объявленные, но
    мёртвые контролы period/procurement/activity (`Header.tsx:17-31`,
    `Journal.tsx:44-76`).
19. По мере появления серверных свёрток — снятие клиентских пересчётов:
    summaryByPeriod/тоталы (`useFilteredData.ts:87-124`), спарклайны
    (`Dashboard.tsx:462-521`), trust-пересчёт (`Trust.tsx:205-257`).

**Блок Е. Хранение догоняет (фундамент, после стабилизации ядра).**

20. Заполнять `procurement_rows` в `saveSnapshot`
    (`services/snapshot.ts:343`) — таблица уже объявлена
    (`schema.ts:148`), ретеншн её уже чистит (`snapshot-retention.ts:55`).
21. Добавить колонки осей атома: план-квартал, план-год, месяц, полный способ,
    подвед, направление, тройки бюджетов — сейчас всё это заперто в
    `cells_json` (`schema.ts:154`); плюс индексы по осям (сейчас только dept и
    снапшот, `packages/server/src/db/index.ts:139`).
22. Стабильный бизнес-идентификатор закупки (по образцу issueIdentity,
    `issue-identity.ts:35-53`) — предусловие сквозной истории одной закупки
    между снимками и мониторинга «не заключённых» с историей план-дат
    (решение 2026-07-15, **спека**: `memory/DESIGN_WAVE_2026-07-13.md:49-53`).
23. Файловые миграции drizzle-kit вместо ad-hoc ALTER TABLE в try/catch
    (`packages/server/src/db/index.ts:16`); персист `_ChangeLog` в БД
    (сейчас 5-минутный кэш в памяти, `changes.ts:19`).
24. Материализация регулярных свёрток (ГРБС × период × способ × бюджет) —
    только после пп. 20-21 и только для свёрток, которыми реально живут
    страницы; 7 спроектированных projection-views (**спека**,
    `memory/data/projection-views.md:289-300`) пересмотреть против фактического
    списка потребителей, а не реализовывать списком.

Порядок неслучаен: блоки А-Б защищают числа, которые Отчёт печатает уже сегодня;
блок В создаёт «одну свёртку в одном месте», без которой контракт API (Г) и
разгрузка UI (Д) закрепили бы нынешний разнобой; блок Е — самый дорогой и
имеет смысл только поверх консолидированного ядра.
