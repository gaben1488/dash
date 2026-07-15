# Сквозной свеп дублей-реализаций (Трек B) — 2026-07-14

Read-only анализ `packages/` (shared/core/server/web). Цель: найти РАЗОМ весь
класс «несколько реализаций/путей к одному», чтобы чинить свепом, а не по одному
при встрече. Прецедент волны: три поштучно закрытых экземпляра (резолв листа,
parseDate serial, двухисточниковость) — это один класс, у которого ещё есть
незакрытые представители.

Метод: grep широко по `packages/`, чтение регионов для сверки логики. Для каждой
семьи — таблица реализаций (file:line), вердикт, канон, план слияния.

---

## §1. Сводка

**10 семей-кандидатов. Итог:**

| Категория | Кол-во | Семьи |
|---|---|---|
| РЕАЛЬНОЕ расхождение (баг-риск, как serial-date) | **2** (+1 латентная) | №1 (seasonal), №2 (rows.ts резолв); латентно №4 (snapshot latinize) |
| Безобидный дубль (одинаково, но копипаста; drift-risk) | **5** | №3 (classifySheet-литералы), №5 (форматтеры денег/%), №6 (magic-индексы колонок), №8 (лейблы сигналов), №10 (QUARTER_MONTHS) |
| Уже консолидировано | **2** | №7 (hasFactDate), №9 (пороги 44-ФЗ; с микро-хвостом) |
| (Семья №1 и №2 = 2 семьи; счёт по строке выше не двойной — см. распределение) |

Распределение 10 семей: **2 баг-риск** (№1, №2), **1 латентная** (№4),
**5 безобидных дублей** (№3, №5, №6, №8, №10), **2 уже консолидировано** (№7, №9).

**Топ-3 опасных расхождения (каждое — одним предложением):**

1. `seasonal.ts:32` `parseDateFromCell` **не имеет ветки Excel-serial** и читает
   именно столбцы N/Q (`row[DEPT_COLUMNS.FACT_DATE/PLAN_DATE]`), которые 6 из 8
   ГРБС-листов хранят как serial-число → все 7 сезонных детекторов молча
   мертвы на этих листах (дата уходит в год ~46000) — тот же баг, что только
   что закрыт в `signals.ts`.
2. `rows.ts` в 5 местах реимплементирует резолв листа ГРБС инлайном (2 кандидата:
   `getDeptSheetName` → `dept.nameShort`), **минуя канон `readDeptSheet`** и теряя
   вариант `'Все'` (для листа `'ВСЕ'` у УАГЗО) и классификацию ошибок 429/403/5xx
   → `/api/rows`-эндпоинты могут отдать 503 там, где загрузчик успешно читает.
3. `snapshot.ts:102` латинизирует имя листа в grbsId через
   `CYRILLIC_TO_LATIN[name] ?? name.toLowerCase()`, а не через `findDept`/
   `classifySheet` → лист не из реестра (или `'Все'`) молча получает
   кириллический lowercase-ключ, который ни один downstream-потребитель не найдёт.

---

## §2. По каждой семье

### Семья №1 — Парсинг дат (РЕАЛЬНОЕ расхождение — баг)

| Реализация | Что делает | Совпадает с каноном? |
|---|---|---|
| `core/pipeline/signals.ts:179` `parseDate` | Date / `dd.mm.yyyy` (только точка, `^…$`) / **serial 40000..60000** `(n-25569)*86400000` / ISO `new Date(s)` | **КАНОН** (только что консолидирован) |
| `core/pipeline/recalculate.ts:193` `getMonthFromDate` | месяц из Date / `dd[./]mm` / ISO `^\d{4}-` / **serial 40000..60000** | да (месяц), serial-диапазон совпал |
| `core/pipeline/calc-engine.ts:221` `defaultMonthExtractor` | месяц: `dd[./]mm` (НЕ якорено) / ISO / **serial 40000..60000** | да (месяц), serial совпал; отличие — нет `^$`-якоря |
| `core/pipeline/seasonal.ts:32` `parseDateFromCell` | Date / `dd.mm.yyyy` / ISO `new Date(s)` — **serial-ветки НЕТ** | **РАСХОДИТСЯ: serial → `new Date('46023')` = год 46023** |
| `core/pipeline/normalize.ts:82` (serial-детект-предупреждение) | `rawVal > 40000 && < 50000` → warning «возможно дата» | расходится диапазоном (**50000** vs 60000), но это только warning, не конверсия |

**Вердикт.** Три «известных» сайта уже сведены к одному serial-канону
(40000..60000, `-25569`). Четвёртый — `seasonal.ts` — **пропущен** и повторяет
ровно тот баг, что чинили в signals: читает N/Q (`row[DEPT_COLUMNS.FACT_DATE]`,
`row[DEPT_COLUMNS.PLAN_DATE]`, строки 88-89), где 6/8 листов держат serial.
`normalize.ts` — безобидный хвост (порог warning, не влияет на расчёт), но
диапазон стоит выровнять до 60000 при свепе.

**Предлагаемый канон.** Вынести `parseDate` из `signals.ts` в общий модуль
(`core/pipeline/date-parse.ts` или `@aemr/shared`), экспортировать
`parseDate`/`getMonthFromDate` из одного места. `seasonal.parseDateFromCell` и
оба month-extractor'а — обёртки над ним.

**План слияния.** (1) создать единый `parseSheetDate(val): Date|null` с serial-
веткой 40000..60000; (2) `seasonal.ts` — заменить локальный `parseDateFromCell`
импортом; (3) `getMonthFromDate`/`defaultMonthExtractor` — реализовать как
`parseSheetDate(x)?.getMonth()+1`; (4) `normalize.ts:82` — поднять верхнюю
границу до 60000 для единообразия детекта.

---

### Семья №2 — Резолв листа/источника (РЕАЛЬНОЕ расхождение — баг-риск)

| Реализация | Что делает | Совпадает с каноном? |
|---|---|---|
| `server/services/google-sheets.ts:269` `readDeptSheet` | перебор `departmentSheetNameCandidates` (`ВСЕ`→`Все`→имя ГРБС) + классификация 429/403/5xx (не маскирует под «нет листа») | **КАНОН** |
| `server/services/sheet-name-candidates.ts:1` `departmentSheetNameCandidates` | `[sheetName, ('ВСЕ'→+'Все'), deptName]` уникализировано | канон-хелпер |
| `server/routes/rows.ts:104-106` | `getSheetDataFromSpreadsheet(ssId, getDeptSheetName(...))` → fallback `dept.nameShort` (2 кандидата, без класс-ошибок) | **РАСХОДИТСЯ** |
| `server/routes/rows.ts:345-347` | то же (2-й эндпоинт) | **РАСХОДИТСЯ** |
| `server/routes/rows.ts:857-859` | то же | **РАСХОДИТСЯ** |
| `server/routes/rows.ts:922-924` | то же | **РАСХОДИТСЯ** |
| `server/routes/rows.ts:1063-1065` | то же | **РАСХОДИТСЯ** |
| `server/services/snapshot.ts:171` `getSheetData(sheetName)` | чтение дефолтной книги по имени | другой путь (дефолт-книга), не dept-резолвер |
| `server/services/source-validation.ts:168` | читает через `readDeptSheet` | да (уже канон) |

**Вердикт.** `readDeptSheet` создан ровно чтобы убить «два пути к чтению листа»
(болезнь D1: валидация падала там, где загрузка работала). Но `rows.ts` держит
**5 инлайн-копий** 2-кандидатного резолва, которые:
(а) не пробуют вариант `'Все'` (capitalized-first) для листа `'ВСЕ'` УАГЗО;
(б) не отличают 429/403/5xx от «лист не найден» → маскируют rate-limit/permission
как отсутствие данных → 503 на холодном кэше там, где `readDeptSheet` бы прочёл.

**Предлагаемый канон.** `readDeptSheet(deptName, ssId)`.

**План слияния.** Заменить каждый из 5 блоков `rows.ts` на
`const { values } = await readDeptSheet(dept.nameShort, ssId); rawRows = values;`
(readDeptSheet живёт в `services/google-sheets.ts`, уже импортируемом рядом).
Удалить локальный `getDeptSheetName` (rows.ts:14) — он дублирует
`DEPARTMENT_REGISTRY[].sheetName` и не даёт кандидатов.

---

### Семья №3 — Классификация листа (безобидный дубль, drift-risk)

| Реализация | Что делает | Совпадает с каноном? |
|---|---|---|
| `shared/sheet-classifier.ts:44` `classifySheet` | имя → `{svod/shdyu_monthly/subordinates_agg/department/unknown}` через `findDept` + candidates | **КАНОН (SSOT)** |
| `server/services/source-validation.ts:148,156` | `if (name===SVOD_SHEET_NAME)` / `if (name===SHDYU_MONTHLY_SHEET_NAME || name==='ШДЮ')` | совпадает по результату, но литералами мимо classifySheet |
| `server/routes/journal.ts:383,385,432` | те же литеральные `===` + легаси `'ШДЮ'` | то же |
| `server/services/snapshot.ts:101` | `if (sheetName===SVOD_SHEET_NAME) continue` | совпадает; можно `classifySheet(...).kind==='svod'` |
| `core/pipeline/orchestrator.ts:488` | `if (sheetName===SVOD_SHEET_NAME) continue` | то же |

**Вердикт.** Безобидный дубль: результаты сходятся (легаси `'ШДЮ'` покрыт
`SHDYU_SHEET_NAME_CANDIDATES`). Но заголовок самого `sheet-classifier.ts` прямо
запрещает «литералы 'СВОД ТД-ПМ' / 'СВОД с месяцами'» — эти 5 сайтов нарушают
SSOT и создают drift-risk (переименуют лист — обновят classifySheet, а инлайн
`===` промолчит).

**Канон / план.** Заменить `name===SVOD_SHEET_NAME` → `classifySheet(name).kind==='svod'`,
`name===SHDYU… || name==='ШДЮ'` → `classifySheet(name).kind==='shdyu_monthly'` (либо
`isSvodFamily`). Никаких новых литералов имени вне classifier.

---

### Семья №4 — Нормализация ключей ГРБС латиница↔кириллица (латентное расхождение)

| Реализация | Что делает | Совпадает с каноном? |
|---|---|---|
| `shared/department-registry.ts:171` `CYRILLIC_TO_LATIN` | биекция из `DEPARTMENT_REGISTRY` (`УЭР`→`uer`) | канон-справочник |
| `shared/department-registry.ts:200` `findDept` | id ИЛИ latinId → entry (принимает обе формы) | **КАНОН-резолвер** |
| `shared/sheet-classifier.ts:50` | `findDept(name)` → `{grbsId, latinId}` | да |
| `server/services/snapshot.ts:102` | `CYRILLIC_TO_LATIN[sheetName] ?? sheetName.toLowerCase()` | **РАСХОДИТСЯ в fallback** |
| `web/store.ts:131` | `GRBS_ID_TO_DEPARTMENT_ID[sub.grbsId]` | иной справочник (grbsId→deptId формы UI), не конфликт |

**Вердикт.** Латентное. Пока ключи `sheetRows` = short-имена реестра
(`УЭР`…`УАГЗО`), `CYRILLIC_TO_LATIN[name]` попадает. Но fallback
`name.toLowerCase()` для не-реестрового или `'Все'` имени даёт **кириллический
lowercase** (`'все'`, `'уэр'`), который downstream (`computeUnifiedGrid`) не
сматчит → тихий дроп блока ГРБС. Канон `findDept` этого не допускает.

**Канон / план.** `const d = findDept(sheetName); const grbsId = d?.latinId; if (!d)
continue;` — единый резолвер, явный skip вместо кириллического мусор-ключа.

---

### Семья №5 — Форматирование денег/процентов (web) (безобидный дубль, косметика)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `web/store.ts:759` `formatMoney` (`Intl.NumberFormat('ru-RU')`, `/1e6`) | канон-ish, прокидывается через props/store | базовый |
| `web/lib/delta-format.ts:20` `NF = Intl.NumberFormat('ru-RU', {maxFrac:1})` | свой инстанс форматтера | дубль формата |
| `web/pages/SvodView.tsx:32,42,47` `fmtInt/fmtNum/fmtPct` | `Math.round(n).toLocaleString('ru-RU')`, `(n*100).toFixed(1)%` | локальные форматтеры |
| `web/hooks/useFilteredData.ts` (×~15) | `+((fact/plan)*100).toFixed(1)` инлайн-% | копипаста расчёта% |
| `web/hooks/useMultiDimMetrics.ts:124` `safePct` | `((num/den)*100).toFixed(1)` | ещё одна копия «безопасного %» |
| `web/pages/Economy.tsx` (×~30) | `.toFixed(0/1/2)`, `(v/1e6).toFixed(1)M` тик-форматтеры | инлайн |
| `web/lib/economy-copy.ts:99` | `pct.toFixed(1)` + переданный `formatMoney` | инлайн% |

**Вердикт.** Безобидный дубль, но косметическое расхождение реально (где-то
`toFixed(1)`, где-то `toFixed(0)`, где-то `Intl maxFrac:1`; `formatMoney` живёт
в store и тащится пропсами, а Svod, delta-format и все `%`-места — сами по себе).
Единого форматтера `%` нет; `safePct` продублирован. Пользователь видит
непоследовательное округление между страницами.

**Канон / план.** Вынести в `web/lib/format.ts`: `formatMoney`, `formatPct(n,
frac=1)`, `safePct(num,den,frac=1)`. Заменить локальные `fmt*` в SvodView,
`NF` в delta-format, все инлайн `+(…*100).toFixed(1)` → `safePct`/`formatPct`.
Приоритет низкий (не влияет на числа расчёта, только на отображение).

---

### Семья №6 — Доступ к колонкам по буквам/индексам (безобидный дубль, drift-risk)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `shared/column-map.ts:16` `DEPT_COLUMNS` + `:71` `buildCellDict` + `COL_LETTER_INDEX` | SSOT индексов колонок (0-based), буква→индекс, row→словарь | **КАНОН** |
| `core/*` (`COL.`/`DEPT_COLUMNS.`) | доступ через именованные константы | да |
| `server/routes/rows.ts:876,941,1082-1126` | **magic numeric** `row[2]/row[6]/row[10]/row[24]/row[11]/row[5]/row[0]/row[14]` с комментариями | **дубль (magic-индексы в prod)** |
| тест-файлы (`rows-*.test.ts`, `dataset-signals.test.ts`) | `row[13]=…//N` и т.п. | в тестах приемлемо |

**Вердикт.** Безобидный дубль сейчас (комментарии совпадают с DEPT_COLUMNS), но
`rows.ts` в проде адресует колонки числами мимо канона → если колонка сдвинется,
COL-код обновится, а `row[24]` молча прочитает не то. Тесты оставить как есть.

**Канон / план.** В `rows.ts` заменить `row[N]` на `row[DEPT_COLUMNS.<NAME>]`
(уже импортируется в пакете). ~8 обращений в 3 участках.

---

### Семья №7 — Гейт «есть факт» (УЖЕ КОНСОЛИДИРОВАНО)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `shared/fact-date.ts:17` `hasFactDate` + `FACT_DATE_PLACEHOLDERS` | канон «пустая дата факта» столбца Q (8 плейсхолдеров + пусто) | **КАНОН** |
| `core/pipeline/unified-svod.ts:37,234` | `import { hasFactDate }` → `hasFactDate(row[COL.FACT_DATE])` | да |
| (историческое) `unified-svod` `hasFact()`+`FACT_EMPTY` | — | **удалено**, заменено каноном (см. `fact-date.test.ts:4`) |

**Вердикт.** Консолидировано в прошлой волне: `hasFactDate` — единый предикат,
старый `hasFact/FACT_EMPTY` снят. `product-dictionary.ts:65 hasFact:'Есть факт'` —
это ЛЕЙБЛ сигнала, не предикат (не конфликт). Отдельно от `ORG_ITSELF_PLACEHOLDERS`
намеренно (разные колонки C vs Q). Действий не требуется; при свепе — проверить,
что новые «Y>0»-гейты факта в signals не расходятся с hasFactDate по семантике
(там гейт по сумме факта — иной вопрос, чем «есть дата»).

---

### Семья №8 — Человеческие лейблы (безобидный дубль, реальный drift-risk)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `shared/product-dictionary.ts:211` `productLabel` + агрегат карт | SSOT-обёртка (DEPT/METHOD/SIGNAL/METRIC…) | **КАНОН для id-лейблов** |
| `shared/product-dictionary.ts:62` `SIGNAL_LABELS` | «зеркало, СКОПИРОВАНО из web/core» (сам комментарий :20,58) | **дубль-зеркало** |
| `web/pages/DataBrowser.tsx:52` `SIGNAL_LABELS` (локальный) | лейблы сигналов в UI | **3-я копия** |
| `core/pipeline/signals.ts` `getSignalBadges` | лейблы бейджей сигналов | **источник, из которого копировали** |
| `web/pages/SvodView.tsx:69` `MONTH_LABEL` | массив месяцев (полные) | дубль месяцев |
| `web/pages/Analytics.tsx:87` `MONTH_LABELS` | массив месяцев (кратк. «Янв»…) | 2-й массив месяцев |
| `web/pages/Analytics.tsx:15,88` `PERIOD_LABELS`,`TREND_LABELS` | локальные карты | локальные |
| `web/pages/Trust.tsx:158` `COMPONENT_SHORT_LABELS`; `IssueList ORIGIN_LABELS` | локальные | локальные |
| `shared` `ACTIVITY_LABEL`, `unified-class-system.ts:147 SEVERITY_LABELS` | в shared | канон (ок) |

**Вердикт.** `productLabel` — канон, но лейблы **сигналов триплицированы**:
`product-dictionary.SIGNAL_LABELS` (самопризнанное зеркало) ← `web/DataBrowser.
SIGNAL_LABELS` + `core/signals.getSignalBadges`. Это реальный drift-risk:
переименуют сигнал в одном месте — два других промолчат. Плюс два разных массива
месяцев (SvodView полные vs Analytics краткие — семантически разные, но оба
захардкожены). Числа не при чём — риск рассинхрона текста.

**Канон / план.** Сделать `product-dictionary.SIGNAL_LABELS` единственным
источником; `DataBrowser` и `getSignalBadges` — импортировать оттуда (убрать
локальные копии). Месяцы — `MONTHS_FULL`/`MONTHS_SHORT` в shared, импортировать
в SvodView/Analytics. Приоритет средний.

---

### Семья №9 — Пороги 44-ФЗ (УЖЕ КОНСОЛИДИРОВАНО; микро-хвост)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `shared/constants.ts:59` `LAW_44FZ_THRESHOLDS` (`epSmallPurchaseSingleContractLimit:600_000`, `antiDumpingSavingsShare:0.25`) + `:80 THRESHOLDS` | **КАНОН** порогов | канон |
| `core/pipeline/signals.ts:119,122` | `EP_RISK_THRESHOLD = …epSmall…`; `ANTI_DUMPING_PERCENT = …*100` | да (импорт) |
| `core/pipeline/splitting.ts:30` | `EP_SPLITTING_THRESHOLD = …epSmall…` | да (импорт) |
| `core/trust/scorer.ts:78` | `THRESHOLDS.TRUST.*` | да |
| `core/pipeline/dataset-signals.ts:180,188` | литералы `0.25` (EP-excess уровни / `epRisk:0.25`) | **иная семантика** (severity-бэнды over-representation ЕП), не 44-ФЗ-порог — совпадение числа случайное |
| `shared/check-registry.ts:297` «> 25%» | текст названия/описания чека | display-строка, ок |

**Вердикт.** Пороги ЕП-лимита/антидемпинга/дробления идут из констант — канон
держится. Единственный хвост — `dataset-signals.ts` `0.25` как литерал уровней
EP-excess: это ДРУГОЙ показатель (доля превышения ЕП над нормой), совпадение с
`antiDumpingSavingsShare` числовое, не смысловое. Низкий приоритет: при желании
вынести `EP_EXCESS_LEVELS` в именованную константу, но НЕ склеивать с 44-ФЗ.

---

### Семья №10 — Расчёт квартала (безобидный дубль, тривиальный)

| Реализация | Что делает | Совпадает? |
|---|---|---|
| `shared/shdyu-map.ts:275` `QUARTER_MONTHS` (`Q1:[1,2,3]`, tuple) | квартал→месяцы, ключи UPPER | «канон» в shared |
| `web/store.ts:138` `QUARTER_MONTHS` (`q1:[1,2,3]`, number[]) | то же, ключи lower | **2-я копия** (данные идентичны, кейс ключа иной) |
| `core/pipeline/unified-svod.ts:107` `quarterOf` | столбец O (1-4) → `q{n}` | тривиальный резолвер |
| `core/pipeline/calc-engine.ts:216` `defaultQuarterExtractor` | столбец O (1-4) → `q{n}` | копия того же |
| `core/pipeline/recalculate.ts` `getQuarterKey` (зеркалит unified-svod:23,105) | столбец O → q-key | копия |

**Вердикт.** `Math.ceil(month/3)` в коде НЕТ — квартал берётся из столбца O
(явное поле), а не считается из месяца, поэтому «расчёт квартала из даты» как
источник расхождения отсутствует. Дубли: (а) `QUARTER_MONTHS` определён дважды
(shared UPPER-tuple vs web lower-number[]) — данные те же, но ключи в разном
регистре, не drop-in взаимозаменяемы; web импортирует свой из store, не из shared.
(б) три тривиальных копии «столбец O 1-4 → q{n}». Всё безобидно.

**Канон / план.** Низкий приоритет. Свести `QUARTER_MONTHS` к одному экспорту в
shared (с единым регистром ключей `q1..q4`) и импортировать в web. Три `quarterOf`
можно оставить или вынести `quarterKeyFromColumnO(raw)` в shared.

---

## §3. Приоритет слияния

**Сначала — расхождения-баги (как serial-date):**

1. **№1 seasonal serial-date** — живой баг на 6/8 листах, 1 файл, точечно.
   `core/pipeline/seasonal.ts:32`. Наивысший (тихо ломает 7 детекторов).
2. **№2 rows.ts резолв листа** — 5 инлайн-блоков, риск 503 на холодном кэше для
   УАГЗО + маскировка rate-limit. `server/routes/rows.ts` ×5.
3. **№4 snapshot latinize** — латентный тихий дроп блока ГРБС. 1 строка,
   `server/services/snapshot.ts:102`. Дёшево закрыть заодно.

**Потом — безобидные дубли с drift-risk:**

4. №8 лейблы сигналов (триплет) — рассинхрон текста, средний.
5. №3 classifySheet-литералы — SSOT-гигиена, 5 сайтов.
6. №6 magic-индексы rows.ts — drift-risk, ~8 обращений.
7. №10 QUARTER_MONTHS дубль — тривиально.
8. №5 форматтеры денег/% — косметика, много точек, низкий.
9. №9 микро-хвост `EP_EXCESS_LEVELS` — опционально.

Уже закрыто: №7 (hasFactDate), №9-ядро (пороги 44-ФЗ).

---

## §4. Готовые задачи агенту (семьи-с-расхождением)

### Задача A — Единый парсер serial-дат (закрыть №1)

**Проблема.** `packages/core/src/pipeline/seasonal.ts:32` `parseDateFromCell` не
имеет ветки Excel-serial. Читает `row[DEPT_COLUMNS.FACT_DATE]` и
`row[DEPT_COLUMNS.PLAN_DATE]` (seasonal.ts:88-89) — столбцы Q/N, которые 6 из 8
ГРБС-листов хранят как serial-число (напр. 46023 = 01.01.2026). Serial уходит в
`new Date('46023')` → год 46023 → все сезонные детекторы молча мёртвы на этих
листах. Это тот же класс бага, что закрыт в `signals.ts:179`.

**Канон.** Логика serial из `signals.ts:198-201`: `serial > 40000 && serial <
60000` → `new Date((serial-25569)*86400000)`.

**Действия.** (1) Создать `packages/core/src/pipeline/date-parse.ts` с
`export function parseSheetDate(val: unknown): Date | null` — тело = текущий
`signals.parseDate` (Date / `^\d{1,2}\.\d{1,2}\.\d{4}$` / serial 40000..60000 /
ISO `new Date(s)`). (2) `signals.ts` — импортировать `parseSheetDate`, удалить
локальный `parseDate`. (3) `seasonal.ts` — удалить `parseDateFromCell`,
использовать `parseSheetDate`. (4) Опционально: `getMonthFromDate`/
`defaultMonthExtractor` переписать как `parseSheetDate(x)?.getMonth()+1 ?? null`.

**Тесты-доказательство.** В `seasonal.test.ts` (создать/дополнить): строка с
`FACT_DATE = 46023` (serial) и `PLAN_DATE = 45999` должна давать те же сезонные
сигналы, что строка с `'01.01.2026'`/`'…'`. До фикса — 0 сигналов (год 46000),
после — корректные. Существующие `signals.test.ts:101-110` (serial) должны
остаться зелёными. `pnpm -r test`, `pnpm typecheck`.

---

### Задача B — Единственный резолвер листа ГРБС в rows.ts (закрыть №2)

**Проблема.** `packages/server/src/routes/rows.ts` реимплементирует чтение листа
ГРБС инлайном в 5 местах (строки 104-106, 345-347, 857-859, 922-924, 1063-1065):
`getSheetDataFromSpreadsheet(ssId, getDeptSheetName(dept.nameShort))` с fallback
на `getSheetDataFromSpreadsheet(ssId, dept.nameShort)`. Это 2-кандидатный резолв,
который (а) не пробует вариант `'Все'` (для листа `'ВСЕ'` УАГЗО — см.
`departmentSheetNameCandidates`), (б) не классифицирует 429/403/5xx (маскирует
rate-limit/permission под «нет данных»). Канон `readDeptSheet`
(`server/services/google-sheets.ts:269`) оба пункта решает.

**Канон.** `readDeptSheet(deptName, ssId): Promise<{values, formulas, sheetName}>`.

**Действия.** (1) В каждом из 5 блоков заменить пару вызовов на
`const { values } = await readDeptSheet(dept.nameShort, ssId); rawRows = values;`
(импорт `readDeptSheet` из `../services/google-sheets.js` — модуль уже используется
рядом). (2) Удалить локальный `getDeptSheetName` (rows.ts:14) — дублирует
`DEPARTMENT_REGISTRY[].sheetName` без кандидатов. (3) Сохранить существующую
обработку `catch → 503`, но теперь `readDeptSheet` сам бросит на 429/403/5xx с
внятной причиной.

**Тесты-доказательство.** `rows-*.test.ts` (мок `readDeptSheet`): для УАГЗО, где
реальная вкладка называется `'Все'` (не `'ВСЕ'`), эндпоинт должен вернуть строки
(до фикса — пусто/503). Мок, бросающий `{status:429}`, должен приводить к
проброшенной ошибке, а не к «пустой лист». `pnpm -r test`, `pnpm typecheck`.

---

### Задача C — Латинизация листа через findDept в snapshot.ts (закрыть №4 латентную)

**Проблема.** `packages/server/src/services/snapshot.ts:102`:
`const grbsId = (CYRILLIC_TO_LATIN as Record<string,string>)[sheetName] ??
sheetName.toLowerCase();`. Fallback `.toLowerCase()` на кириллице даёт
кириллический lowercase-ключ (`'все'`, `'уэр'`), который `computeUnifiedGrid` не
сматчит → тихий дроп блока ГРБС для листа не из реестра или с именем `'Все'`.

**Канон.** `findDept(name)` (`shared/department-registry.ts:200`) — принимает
кириллический short и латинский id, возвращает `{latinId, …}`.

**Действия.** Заменить строку на:
`const d = findDept(sheetName); if (!d) continue; const grbsId = d.latinId;`
(импорт `findDept` из `@aemr/shared`; убрать прямой импорт `CYRILLIC_TO_LATIN`,
если больше не нужен). Явный `continue` вместо кириллического мусор-ключа.

**Тесты-доказательство.** Юнит на `attachUnifiedGrid`/`snapshot`: `sheetRows` с
ключом `'Все'` и с неизвестным `'Лист1'` — первый маппится в `uagzo`, второй
пропускается (не создаёт ключ `'лист1'`). `pnpm -r test`, `pnpm typecheck`.

---

*Замечание по инфраструктуре сессии: хук `claude-mem` (PostToolUse/PreToolUse)
был нерабочим весь прогон (worker unreachable, блокировал Read); анализ выполнен
через Grep + Bash `sed`/`cat`. К коду репозитория отношения не имеет.*
