# Волна «Линейка» 29.08.2026 — сводка приёмки

> Пять срезов по контракту пробы (`proba.html`, согласована владельцем):
> правый угол, покрытие периодов, ставка снижения, навигация группами, заря.
> Приёмка: полный гейт, сборка, живой атлас (`pult.md` §14), матрица метрик,
> эта сводка. Коммитов волна не делала — коммитит главный контур.

## 1. Что сделано по срезам

### Срез 1 — правый угол (эфир-история + жетоны отбора)

- `packages/web/src/components/SelectionTokens.tsx` — НОВЫЙ (229 строк).
  Жетоны состояния отбора из store: срез недели (только week-режим; ✕ =
  `shiftFocusedWeek`, :72–89), даты «2026» / «2026·3 мес» / «2025+2026» +
  осиротевший квартал п.134 (✕ = `clearAllPeriods` + `setYear`, :92–140),
  организации «орг · N» (:143–162), способ/вид/бюджет (канон п.30 для ТД,
  :165–194), поиск (:198–204). Пилюля — канонный `vf-btn-active`; общий ✕ =
  `resetAllFilters` (:222–229); на умолчании молчит (`return null`, :207).
- `packages/web/src/components/live/LiveHistory.tsx` — НОВЫЙ (222 строки).
  Мини-барабан 3 строк «чч:мм:сс КНИГА что → стало» с наклоном крайних рядов;
  серая ступень до пересчёта (`recalculatedThrough`) → цветная после
  snapshot-rebuilt; счёт «N правок за час · чтение чч:мм»; клик/Enter/Space —
  журнал `api.getChanges` (было зачёркнуто → стало, автор, `humanAttribute`);
  прокрутка только от настоящего события; пустая история молчит.
- `packages/web/src/hooks/useLiveEvents.ts:69–96, 199–217` — необязательные
  поля `history` (журнал угла, потолок `HISTORY_MAX=80`, переживает
  acknowledge) и `recalculatedThrough`; `reduceLive` наполняет.
- `packages/web/src/components/Header.tsx` — угол `.hdr-ugol` (LiveHistory
  над SelectionTokens) вместо `<FilterBreadcrumb variant="inline" />`;
  `getISOWeekNumber` вынесен в `packages/web/src/lib/week-number.ts` (новый,
  код не менялся — разрыв кольца импортов).
- `packages/web/src/components/report/ChangesSection.tsx:35, 99` —
  экспортированы `fmtAt` и `humanAttribute` (одна карта HUMAN_ATTR).
- `packages/web/src/index.css` — секция «ПРАВЫЙ УГОЛ ЛИНЕЙКИ» (в текущем
  срезе :1246–1430): `.hdr-ugol`, `.lh-*`, `.sel-chip`, `.sel-clear`,
  reduced-motion.
- `packages/web/src/components/live/LiveUpdateBar.tsx:27–36` — комментарий о
  разделении ролей, код не менялся.

### Срез 2 — покрытие периодов данными

- `packages/web/src/lib/period-coverage.ts` — НОВЫЙ (160 строк). Чистая
  библиотека: `buildCoverageIndex` (счётчики строк по неделям ISO — год у
  НЕДЕЛИ, месяцам, годам; план ИЛИ факт; один период одной строки — один раз);
  `dayPartsOfDateValue` (ISO + «дд.мм.гггг» + легаси-серийники);
  `classifyPeriod`: 'has-data' | 'scarce' (1–3 строки) | 'empty' | 'future' |
  'unknown'; будущее с планом = данные; ready=false = 'unknown', не «нет».
- `packages/web/src/hooks/usePeriodCoverage.ts` — НОВЫЙ (100 строк).
  Модульный кэш (useSyncExternalStore, по образцу useLiveEvents): строки всех
  управлений через `collectAllPages` + `api.getRows` без фильтра года, один
  раз на вкладку, стартовая пауза 1500 мс; 0 строк из всех книг = 'failed' —
  сбой сети не красит год в пустоту.
- `packages/web/src/components/Header.tsx` — WeekRoller: `wr-row-empty`
  (приглушена, нажимается) / `wr-row-future` (пунктир), точка эфира `.wr-live`
  на текущей неделе (дышит, гасится reduced-motion), title/aria трёх строк
  («прямой эфир» / «срез» / «ещё не наступила» / «данных нет»); TimeDrum:
  `tg-month-empty` / `tg-month-future` (штрих) / `tg-month-scarce` (точка при
  1–3 строках), год без строк — ряд `tg-row-nodata`; до готовности индекса
  классы не вешаются — вид прежний.
- `packages/web/src/index.css` — два блока в @layer components (в текущем
  срезе месяцы :2574–2612, недели :2882–2915), обе темы у каждой краски.
- `packages/web/src/lib/period-coverage.test.ts` — НОВЫЙ, 13 тестов (индекс,
  ISO-ключ через границу года, три вида пустоты + 'unknown' + «план в
  будущем = есть данные», положение недель/месяцев, разбор дат).

### Срез 3 — ставка снижения

Честный вывод разведки: на клиенте НЕТ чисел с зашитыми 8 % (grep `0.08` —
только CSS-альфы и данные тестов); «прогнозной экономии» на Пульте не
существует. Единственное зависимое число — «Расчётная экономия по остатку»
(calc_economy_remainder) на «Отчёте». Сделан переключатель + проводка до
этого одного числа, новых чисел не выдумано.

- `packages/web/src/store.ts` — `StavkaMode` ('norm'|'live'),
  `STAVKA_NORM_PCT`, `LiveStavka` (pct/q1/q3/count/readAt); `stavkaMode`
  (умолчание 'norm'), `setStavkaMode`, `liveStavka`, `fetchLiveStavka()`
  (ленивый одноразовый: `fetchMonitoringAnalytics` →
  `analytics.reduction.portfolioPct` — средневзвешенное по деньгам, замер
  9,79 % от 18.08); `resetAllFilters` возвращает 'norm';
  `getActiveFilterCount` — необязательное `stavkaChanged`.
- `packages/web/src/components/Header.tsx:635-700` — `StavkaDrum`
  (`vf-drum vf-drum-thin`, кнопки «8 %» / «живой N,NN %»); рендер :992 на
  всех вкладках, кроме «Системы» (п.144); title обеих кнопок называет обе
  суммы ожидаемой экономии от плана года и разницу; замер не получен —
  кнопка честно выключена; `stavkaChanged` в счётчике «Сбросить».
- `packages/web/src/lib/report/mappers.ts` — `buildIntegralSummary(report,
  stavka?)`, тип `StavkaVM`; «живой» — пересчёт тем же основанием (значение
  листа ÷ 8 × живой %), бюджетная тройка масштабируется, паспорт называет
  обе суммы, ставку, дату замера, арифметику; «норматив» — число листа как
  есть, ставка названа словами. Без второго аргумента поведение прежнее.
- `packages/web/src/pages/Report.tsx` — проводка `stavkaMode`/`liveStavka`
  в `buildIntegralSummary`.
- Стражи: `packages/web/src/store.stavka.test.ts` (новый) + три теста в
  `packages/web/src/lib/report/mappers.test.ts` (норматив как есть; живой
  60→73 с паспортом; замер не получен → число не выдумывается).

### Срез 4 — навигация группами

- `packages/web/src/components/Header.tsx` — `NAV_GROUPS` :718–723 (Обзор:
  Пульс/Отчёт/Свод · Реестры: Реестр/Не обеспеченные/В течение года/
  Мониторинг · Разборы: Экономия/Конкуренция/Дисциплина/Аналитика · Надзор:
  Контроль/Система); `NavPills` :725–820 строит четыре ряда `.np-group` с
  подписью-капителью (`np-group-name`, зрительная `aria-hidden`; читалкам —
  `aria-label` держателя `role="group"`); кнопки — прежний JSX в
  `renderButton` без изменений поведения; подписи `.np-label` с многоточием;
  раздел вне групп выводится безымянным рядом, не исчезает (:744–747).
  `NAV_ITEMS` не тронут (импортирует страж контраста).
- `packages/web/src/index.css` — `.nav-pills-wrap` колонкой (max-width
  340px), `.np-group`, `.np-group-name` (капитель 10px, колонка 56px),
  `.np-group-btns`, `.np-btn { min-width:0; flex:0 1 auto }`, `.np-label`;
  в покое значок тонирован цветом раздела, на активной — чернилами подписи.

Опись умений np-btn до правки — все сохранены: клик → `setPage`; классы
np-btn/np-btn-active; пары `--np-color`/`--np-color-light`; подсказка с
хвостом «N строк во всех книгах»; `aria-current="page"`; свечение np-glow
на активной; значок 10px (2.2/1.5); чип +N замечаний на «Контроле»
(`useLiveEvents().newIssues`); честные счётчики корзин (null → без числа).

### Срез 5 — заря (только index.css, разметка не менялась)

- Токен `--lazur`: `#0ea5e9` (:root, :90) / `#38bdf8` (.dark, :121).
- Лазурный ореол (0 0 10px 24% + 0 0 22px 12% через color-mix) на кремовых
  пилюлях: `.np-btn-active .np-content`, `.vf-btn-active` (обе темы),
  `.tg-month-active` (+ кадры month-glow-pulse — лазурь постоянна, дышит
  только тёплая часть), `.tg-year-full`, `.wr-row-driving`. КБ/МБ без лазури
  (краска рода данных, канон пробы); ФБ кремовый — наследует.
- Заря-подложка `.hbar::before` (:880/:890): крем снизу-слева + лазурь
  сверху-справа, статична, z-index под стеклом; тёмная тема тише.
- Волна щита `.shield-hub::after` + `shield-lazur-wave` (:975): при чтении
  источника лазурное кольцо расходится и тает; при reduced-motion гаснет.

## 2. Что НЕ сделано и почему

1. **Построчного общего хука на клиенте нет** (разведка это и предсказала):
   покрытие грузит строки собственным кэшем `usePeriodCoverage` вторым
   заходом после дашборда. Подъём построчной загрузки из DataBrowser в общий
   хук — отдельная работа, волной не заявлялась.
2. **Ставка проведена до одного числа** — других чисел, зависящих от 8 %, на
   клиенте не существует (проверено grep'ом); новые прогнозные числа не
   выдумывались по инструкции среза. Живой коэффициент на «Мониторинге» —
   сам замер, не производное.
3. **Карточек БЗ состава 2.0 и двери к строкам торгов у переключателя ставки
   нет** — зафиксировано в матрице (готовность строки 64 %), работа слоя
   базы знаний, не линейки.
4. **`FilterBreadcrumb` не удалён** — панельный variant="panel" на Пульте
   живёт; inline-вариант больше нигде не используется.
5. **`pnpm lint`: 13 до-существующих ошибок в нетронутых файлах** (Trust.tsx,
   Dashboard.tsx `figure`, SvodView.tsx `Info`, core/change-story.ts
   irregular whitespace) — волна их не вносила и не чинила (чужой периметр).

## 3. Опись перенесённых умений (нет регрессий)

- **FilterBreadcrumb inline → SelectionTokens**: чипы организаций, подведов
  (подписи `subordinateLabel` — в title), месяцев, осиротевшего квартала,
  способа, вида (дедуп ТД по п.30), бюджета, поиска, молчание при пустом
  отборе. Панельный вариант не тронут.
- **LiveUpdateBar**: все умения на месте — предупреждение о невозможной
  (`waitingBecause` + причина словами) или сорвавшейся (`failed`) тихой
  подмене, «Показать сейчас»/«Повторить» (`seamless.applyNow`), крестик по
  `lastEventAt`, бегущий момент, признак потерянной связи. ПОКАЗ правок
  (какие, было→стало, журнал) — в углу (LiveHistory) и узле провенанса.
- **np-btn**: полная опись выше (срез 4) — сохранено всё.
- **TimeDrum/WeekRoller**: все жесты прежние (кварталы, месяцы, годы,
  крестик сброса, клавиатура, week-режим); покрытие только добавляет классы
  и title/aria, пустые периоды остаются нажимаемыми (без not-allowed).

## 4. Гейты приёмки (дословно)

`pnpm typecheck` (канон репо; корневого tsconfig нет — `pnpm tsc --noEmit`
из корня печатает справку tsc):

```
> typecheck @aemr/shared   > tsc --noEmit
> typecheck @aemr/core     > tsc --noEmit
> typecheck @aemr/server   > tsc --noEmit
> typecheck @aemr/web      > tsc --noEmit
```
(вывод пуст — 0 ошибок; чужая красная правка `packages/core/src/pipeline/
signals.ts` из отчёта среза 3 к приёмке уже исправлена)

`NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @aemr/web test`:

```
 Test Files  168 passed (168)
      Tests  1875 passed (1875)
   Start at  02:33:09
   Duration  189.37s
```

Стражи в числе прошедших: nav-contrast, activity-scope-canon,
surface-borders, tokens, store, store.stavka, period-perimeter.property,
useSeamlessRefresh, LiveUpdateBar, useUrlSync, surface-contrast,
mobile-width-guard, external-link-guard, period-coverage (новый).

`pnpm build` (все пакеты, EXIT 0):

```
packages/web build: ✓ built in 1m 15s
packages/web build: Done
```
(предупреждение размера — `index-DxDhGpGr.js` 2 414 kB / gzip 426 kB;
до-существующий долг «Split the large web bundle» из Known Residual Work,
волной не внесён)

Dev-сервер не поднимался (правило: продукт не гоняется локально).

## 5. Живые артефакты

- **Атлас**: `docs/superpowers/audits/2026-08-20-cards-map/pult.md` — новый
  раздел «§14. Линейка (шапка, Header.tsx) — карта после волны 29.08.2026»:
  14 узлов с файл:строка, канон, состояние; слабости волны названы.
- **Матрица метрик**: правка `scripts/metrics_matrix/rows_pult.py` (новая
  строка «Линейка (шапка): ставка снижения (StavkaDrum)» — два положения,
  источник живого коэффициента, честная пустота, стражи) и
  `rows_report.py` (строка calc_economy_remainder дополнена паспортом
  ставки); пересборка `python scripts/metrics_matrix/build_matrix.py`.
  Три числа по правилу 6.2.5: метрик 314 → **315**, средняя готовность
  74 % → **74 %**, инвариантов совсем без стража 1 → **1**.

**Инцидент при пересборке матрицы (найден и закрыт в этой же волне).**
Раздел 7 «Метрики самого источника (проверка 22.08.2026)» был дописан
22.08 рукой поверх собранного файла — вопреки правилу 6.1 самого файла —
и первая же честная пересборка его стёрла (класс: рукописный текст в
генерируемом файле живёт до первой сборки). Замечено по диффу, текст
восстановлен дословно из журнала сессии и перенесён в корень: константа
`SOURCE_METRICS` в `scripts/metrics_matrix/matrix_data.py`, вывод — в
`build_matrix.py` (§7 после §6). Теперь раздел переживает любую
пересборку; итоговый файл содержит все разделы 1–7 (1231 строка).

## 6. Вердикт

**ЗЕЛЕНО.** Типы 0 ошибок, тесты 1875/1875, сборка прошла, атлас и матрица
обновлены. Осталось главному контуру: коммит логическими группами; из
хвостов — lint-долг чужих файлов (п.2.5), карточки БЗ ставки и покрытия,
шов построчного общего хука.
