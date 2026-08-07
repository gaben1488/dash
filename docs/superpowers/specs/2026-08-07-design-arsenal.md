# Дизайн-арсенал дэша

> Дата: 2026-08-07. Синтез четырёх разведок (skills, библиотеки, референсы, документация)
> под задачу «вау-эффект чёрного аналитического дэша, остающегося казённым рабочим
> инструментом». Стек: React 19 + Vite 6 + Tailwind 3.4 + zustand + Recharts, тема
> zinc-950, графитовый ink-хром, цвет только у данных. Уже установлено: impeccable-*
> (18), taste-* (8), emil-design-eng, frontend-design, dataviz, canvas-design, MCP
> Shadcn_UI, context7. Ниже — только то, чего не хватает, с конкретикой установки.

---

## §1. Что ставим сейчас (топ-5)

Пять инструментов, каждый из которых закрывает подтверждённую дыру, а не «было бы
неплохо». Порядок — это и порядок установки.

### 1. TanStack Table v8 + TanStack Virtual — фундамент таблиц

```bash
pnpm add @tanstack/react-table @tanstack/react-virtual
```

Таблицы — ядро продукта, а движка таблиц в проекте нет вовсе: сортировка, фильтры,
группировка и pinning колонок сейчас пришлось бы писать руками. TanStack Table —
headless (без собственных стилей), то есть рендер полностью остаётся в нашей
ink-шкале и ничего перекрашивать не нужно; это же канонический фундамент
официального shadcn data-table паттерна, так что компоненты из Shadcn_UI MCP лягут
на него без трения. TanStack Virtual вытянет реестры процедур на тысячи строк без
пагинации. Документация: <https://tanstack.com/table/latest>.

Как эталон «взрослой» сборки поверх — tablecn
(<https://github.com/sadmann7/shadcn-table>): серверная пагинация, filter-builder с
состоянием фильтров в URL (шарибельная ссылка на разрез — прямой подарок отчётам
начальству), спредшит-режим. Ставится registry-командой, код копируется в проект:

```bash
pnpm dlx shadcn@latest add "https://tablecn.com/r/data-table"
```

Если Table Editor должен ощущаться как Excel (правка ячеек, клавиатурная навигация,
clipboard) — короткий путь без мегабайтного AG Grid это DiceUI Data Grid
(<https://diceui.com/docs/components/radix/data-grid>), тоже registry-установкой.

### 2. Recharts v3 — апгрейд уже установленного

```bash
pnpm add recharts@^3
```

Мы на 2.15, где React 19 живёт через peer-warning. Тройка (2025) — переписанное
ядро без внутреннего Redux, нативная поддержка React 19, лучшие тултипы и
доступность, меньше багов с ResizeObserver. Апгрейд на порядок дешевле миграции на
другую библиотеку и разблокирует shadcn charts (они построены на Recharts) вместе с
токенами `--chart-1..5` из канона темы. Правило: сначала v3, и только потом решать,
нужен ли visx под конкретную кастомную визуализацию (календарная heatmap, воронка
стадий) — <https://airbnb.io/visx>, ставить помодульно и только под задачу.
Сайт: <https://recharts.org>.

### 3. Motion + Motion Primitives — слой движения

```bash
pnpm add motion
npx motion-primitives@latest add transition-panel
```

В проекте нет ни одной анимационной библиотеки — весь потенциальный «вау» сейчас
ограничен CSS. Motion (преемник framer-motion, импорт из `motion/react`, React 19
поддержан; <https://motion.dev>) с LazyMotion укладывается в ~15–18 КБ и даёт три
ключевых для дэша механизма:

- count-up чисел без ре-рендеров React: `useMotionValue` + `animate()` +
  MotionValue как child — дока прямо позиционирует это для live-данных
  (<https://motion.dev/docs/react-animation>); в `useTransform` вставляется наш
  форматтер `Intl.NumberFormat("ru-RU")`, и число тикает уже отформатированным,
  пока таблица на тысячу строк рядом не перерисовывается;
- layout-анимации таблиц: `motion.tr` с `layout="position"` + `AnimatePresence` —
  строки плавно перестраиваются при сортировке и фильтрации вместо скачка
  (<https://motion.dev/docs/react-layout-animations>); включать только для видимых
  строк (виртуализация из п. 1);
- `useSpring` для метрик, обновляющихся поллингом/WebSocket: пружина догоняет цель
  без перезапуска анимации с нуля, `skipInitialAnimation` — чтобы числа не ехали с
  нуля при первом рендере (<https://motion.dev/docs/react-use-spring>).

Motion Primitives (<https://motion-primitives.com>) — registry сдержанных
продуктовых компонентов на этой базе: TransitionPanel для переключения разрезов,
AnimatedGroup для каскадного появления KPI-карточек. Дополняет уже установленный
`@number-flow/react`, не дублируя его. Рецепт спарклайна с draw-in:
<https://motion.dev/ui/components/sparkline>.

### 4. Самохостинг шрифтов: Inter Variable + Geist Mono

```bash
pnpm add @fontsource-variable/inter @fontsource-variable/geist-mono
```

Разведка по коду показала: `index.css` объявляет `'Inter'`, но пакета шрифта в
зависимостях нет — пользователи без установленного Inter видят системный фолбэк, и
весь тюнинг `tabular-nums` работает вполсилы. Самохостинг через Fontsource
(<https://fontsource.org/fonts/inter>) даёт детерминированную типографику без CDN —
существенно для казённой среды. Geist Mono — в числовые колонки (суммы НМЦК, коды):
моноширинные табличные цифры дают тот «терминальный» характер, который дорого
смотрится на zinc-950. После установки: `import '@fontsource-variable/inter'` в
`main.tsx` и утилита `font-variant-numeric: tabular-nums` на каждую числовую
колонку.

### 5. Пара skills: web-design-guidelines + interface-design

```bash
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
npx skills add https://github.com/dammyjay93/interface-design --skill interface-design --agent claude-code -g
```

Две дыры, которые не закрывает ни один из установленных 26+ дизайн-скиллов.

Первая — объективный аудит. `web-design-guidelines` от Vercel Labs
(<https://github.com/vercel-labs/agent-skills>) прогоняет UI-код по 100+ правилам
Web Interface Guidelines: видимый фокус, клавиатурная навигация по таблицам,
touch-targets, reduced-motion, контраст — с построчным выводом `file:line`.
Impeccable-audit субъективнее; здесь жёсткий чек-лист, идеальный как гейт перед
«готово». Первоисточник правил — <https://interfaces.rauno.me/>.

Вторая — память дизайн-решений. `interface-design`
(<https://github.com/Dammyjay93/interface-design>) сохраняет решения в
`.interface-design/system.md` и переиспользует между сессиями: ink-шкала, ступени
поверхностей и spacing фиксируются один раз, и агент перестаёт заново изобретать
оттенки графита в каждой новой сессии — наша главная боль консистентности.

Второй эшелон (ставить по мере надобности, не в этой волне): `hallmark` от Nutlope —
57 anti-slop гейтов и режим Study для извлечения design DNA из референсов
(<https://github.com/nutlope/hallmark>); `data-viz-2025` — чарты именно под
React/Tailwind-стек (<https://github.com/erichowens/some_claude_skills>);
скриншотный review-цикл OneRedOak
(<https://github.com/OneRedOak/claude-code-workflows>) — у нас уже есть
playwright-skill и browser-harness, workflow даёт им готовые промпты; официальный
shadcn skill (<https://github.com/shadcn-ui/ui/tree/main/skills/shadcn>,
`npx skills add shadcn/ui`) — паттерны правильной установки и композиции в
дополнение к Shadcn_UI MCP; `ui-skills` от ibelick с аудитом перфоманса анимаций по
девяти категориям (<https://github.com/ibelick/ui-skills>); принципы Refactoring UI
как исполняемые правила (<https://github.com/LovroPodobnik/refactoring-ui-skill>).

Из компонентных коллекций точечно, registry-установкой и с перекраской в графит:
Tremor (<https://tremor.so>) — Tracker для статусов процедур по неделям, BarList для
топа поставщиков, CategoryBar для исполнения лимитов; Kibo UI
(<https://www.kibo-ui.com>) — Gantt под план-график 44-ФЗ и contribution-календарь
активности; Origin UI (<https://originui.com>) — «скучные» плотные контролы (date
range picker периодов отчётности, числовые инпуты со степперами); Animate UI
(<https://animate-ui.com>) — анимированные версии самих shadcn-примитивов с
сохранением Radix-доступности. Для сквозной проверки темы — tweakcn
(<https://tweakcn.com>), при экспорте выбирать v3/hsl-режим, мы на Tailwind 3.4.

---

## §2. Приёмы вау-эффекта для тёмного data-heavy UI

Сквозной вывод разведки референсов (Linear, Vercel, Bloomberg Terminal,
enterprise-таблицы): дорогой тёмный интерфейс строится не эффектами, а дисциплиной —
светлотой вместо теней, монохромным хромом и движением, которое объясняет данные.
Всё ниже совместимо с ink-шкалой и принципом «цвет только у данных».

**Высота светлотой, а не тенью.** В тёмной теме тени не читаются: иерархию слоёв
задают ступени светлоты поверхности (страница → панель → карточка → popover, каждая
чуть светлее) плюс 1px хайрлайн-бордер. Закрепить в токенах 3–4 ступени
(page/panel/raised/overlay) и запретить box-shadow глубже 1px; popover в дарке
светлее панели, не темнее. Разбор: <https://adminlte.io/blog/dark-dashboard-templates/>.

**Shadow-border стек Vercel.** Вместо CSS border — `box-shadow: 0 0 0 1px`
(zero-offset, zero-blur, 1px-spread) плюс слой едва заметной глубины в одном стеке:
бордер живёт в тени, не влияет на layout и плавно анимируется на hover. Перевести на
это карточки, инпуты и активные фильтры. Разбор дизайн-системы:
<https://github.com/ItamarZand88/design-skills/blob/main/design-md/vercel/DESIGN.md>.

**Blueprint-грид как фактура.** Едва видимая инженерная «миллиметровка»
(linear/radial-gradient 1px, шаг 8/16/24px, белые линии 3–6% opacity на zinc-950) на
пустых зонах и шапке. Главное правило — почти сублиминально: если сетку замечаешь
сразу, она слишком яркая. Вау-эффект чертежа без единого цветного пикселя.
Гайд: <https://www.setproduct.com/blog/complete-guide-to-blueprint-grid-design>.

**Один акцент-«фонарик» (Linear).** Почти-чёрный фон, веса шрифта только 400–510
(без bold), отрицательный tracking, полупиксельные бордеры — и единственный
электрический акцент, применяемый точечно как сигнал действия (активный фильтр,
primary-кнопка, индикатор live-обновления), никогда как украшение. Плотный интерфейс
без bold выглядит машинно-точным. Разбор стиля:
<https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1>.

**Bloomberg: цвет только у дельт.** Терминал прячет сложность в muted-поверхности и
компактные сетки, а цвет зарезервирован исключительно за ростом/падением и
статусами. Это буквально наш манифест — закрепить токенами: red/green/amber легальны
только в значениях (дельты, просрочки, статусы этапов 44-ФЗ), хром всегда ink. И не
сжимать десктопную плотность ради адаптива — аналитическая станция живёт на большом
мониторе. Первоисточник:
<https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/>.

**Плотность — настройка, а не мнение.** Row-height таблиц как пользовательский
переключатель compact/comfortable/spacious с персистом (zustand persist уже есть),
compact ~32px по умолчанию для закупочных реестров. Аналитик получает
bloomberg-плотность легально, проверяющий — воздух. Анализ паттерна:
<https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables>.

**Tabular-nums в каждой числовой колонке.** `font-variant-numeric: tabular-nums`
для всех сумм и KPI: цифры одной ширины, суммы выравниваются в столбик по правому
краю и не прыгают при обновлении. Для дельт и кодов — Geist Mono (см. §1.4).
Таблица мгновенно приобретает терминальную профессиональность:
<https://www.setproduct.com/blog/data-table-ui-design>.

**Тихий hover + вторичный индикатор.** В плотной таблице громкая подсветка мерцает
при движении курсора по сотням строк. Вместо неё: hover = white 4%, выбранная
строка = 2px ink-бордер слева плюс чуть светлее фон, обязательное фокус-кольцо на
активной ячейке для клавиатуры. Живость без светомузыки:
<https://www.mindk.com/blog/better-data-table-design/>.

**Spring count-up + draw-in спарклайн.** Числа KPI анимируются пружинным count-up
(физика spring, не линейный таймер), спарклайн отрисовывается path-draw при
появлении и дотикивает при live-обновлении; рядом дельта «▲ +3.2%». Ощущение живой
системы — главный источник вау, который не выглядит лендингом. Реализация — Motion
из §1.3, рецепт: <https://motion.dev/ui/components/sparkline>.

**Real-time без дёрганья.** Live-обновления из Sheets сигналятся микро-анимацией, а
не перерисовкой блока: изменённая ячейка получает затухающий полуторасекундный
ink-флэш (не зелёную вспышку), частые обновления батчатся, дельта всегда в тройке
«стрелка + процент + спарклайн», не полагаясь на один цвет. Начальство видит
«система живая», аналитик не отвлекается:
<https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/>.

**Бенто-тайлы: одна роль на модуль.** Главный экран как 12-колоночная сетка
разноразмерных тайлов, каждый несёт ровно один тип контента: hero-тайл 2×2 под
главную сумму недели, ряд 1×1 под статусы подведов, широкий 4×1 под таймлайн этапов.
Размер тайла кодирует важность метрики — размер говорит вместо цвета:
<https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics>.

**Чек-лист невидимых деталей (Rauno Freiberg / Vercel).** Вес шрифта не меняется на
hover (нет layout shift), hover-tooltip без интерактивного содержимого, переключение
темы не триггерит hover-transitions. Прогонять перед каждым «готово» — половина
пунктов встраивается в impeccable-audit как P1-критерии; автоматизацию даёт skill из
§1.5. Источник: <https://interfaces.rauno.me/>.

---

## §3. Что НЕ тащим

Модное, но вредное или преждевременное для казённого инструмента — с причинами.

- **Aceternity UI и лендинговый флеш вообще** (3D-карты, частицы, глоу-градиенты,
  marquee). Прямо противоречит требованию «рабочий инструмент, не лендинг»:
  каждый такой эффект крадёт доверие к цифрам. Разведка библиотек исключила его
  осознанно.
- **Magic UI как коллекция** (<https://magicui.design>). По умолчанию не ставим:
  bento-заготовки и marquee — лендинговый арсенал. Допустимое исключение — один-два
  точечных эффекта на экран (BorderBeam/ShineBorder на активной карточке,
  AnimatedList для ленты событий), и только у ключевых данных; иначе дэш
  превращается в витрину.
- **Shadcnblocks-Skill** (<https://github.com/masonjames/shadcnblocks-skill>).
  Требует платный API-ключ ShadcnBlocks; ставить только если владелец решит
  покупать подписку. До того — Tremor/Kibo/Origin закрывают те же потребности
  бесплатно.
- **Motion+ AnimateNumber** (<https://motion.dev/docs/react-animate-number>).
  Платная разовая покупка, при этом бесплатный паттерн `useMotionValue + animate()`
  воспроизводит 90% эффекта, а `@number-flow/react` уже установлен. Знать о
  существовании, в код закладывать бесплатный путь; решение о покупке — владельцу.
- **Миграция на Tailwind v4 внутри переплавки.** Вердикт разведки документации —
  переезжать стоит (нативные CSS-переменные темы через `@theme`, oklch для ровных
  ступеней графита, Vite-плагин, registry-экосистема shadcn генерится под v4), но
  строго отдельной волной: своя ветка, `npx @tailwindcss/upgrade`, ручная правка
  ring/shadow, визуальный дифф (<https://tailwindcss.com/docs/upgrade-guide>,
  рецепт для shadcn: <https://ui.shadcn.com/docs/tailwind-v4>). Мешать её с
  редизайном — получить неотлаживаемую кашу. Туда же `tw-animate-css`
  (<https://github.com/Wombosvideo/tw-animate-css>) — только вместе с v4, сейчас
  наш `tailwindcss-animate` работает.
- **ui-ux-pro-max-skill** (<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>).
  114k звёзд, но его сила — генерация стилей и палитр с нуля, а наша тема решена и
  зафиксирована. Ставить не сейчас; единственный сценарий пользы — сверка палитры
  статусов по базе dashboard-паттернов, и это не оправдывает ещё один тяжёлый skill
  в наборе из 26+.
- **superdesign-skill** (<https://github.com/superdesigndev/superdesign-skill>).
  Параллельная генерация 4–6 вариантов макета на канвасе — полезный жанр, но у нас
  дизайн-канон уже утверждён (спека 22 раздела, QA D1–D20); множить варианты сейчас
  значит расшатывать канон. Вернуться, если появится задача нового экрана с чистого
  листа.
- **AG Grid и другие тяжёлые grid-рантаймы.** Спредшит-взаимодействие достигается
  DiceUI/tablecn поверх TanStack без ~1 МБ рантайма и чужой темизации.
- **Тени, bold и цветные вспышки в тёмной теме.** Drop-shadow глубже 1px даёт грязь
  на чёрном (см. §2), bold ломает машинную точность плотного набора, зелёная
  вспышка обновлённой ячейки — светомузыка вместо ink-флэша. Это не инструменты, а
  привычки из светлых тем — им запрет на уровне токенов и ревью.

---

## §4. Порядок применения при переплавке

Пять шагов; на каждом названы скиллы, библиотеки и их связка. Принцип: сначала
токены и фундамент, потом каркас, потом данные, потом движение, и только в конце —
полировка с гейтами.

**Шаг 0. Токены и канон темы.** Ink-палитра заводится не в компонентах, а
переопределением переменных shadcn-канона: HSL-триплеты в `@layer base { :root {...}
.dark {...} }`, мапинг `hsl(var(--...))` в `tailwind.config`, база zinc в тёмной
теме уже совпадает с нашей zinc-950 (`background: 240 10% 3.9%`); собственные токены
(ступени `--ink-1..9`, статусы просрочка/риск/исполнено) — тем же паттерном, что
пример `--warning` из официальной доки (<https://ui.shadcn.com/docs/theming>).
Тогда компоненты из Shadcn_UI MCP и Recharts (через `var(--chart-N)`) подхватывают
тему автоматически. Сюда же ступени поверхностей и запрет теней из §2. Прогнать
тему целиком по всем компонентам — tweakcn в v3/hsl-режиме. Зафиксировать решения:
`impeccable-teach`/`impeccable-document` генерят DESIGN.md, `interface-design`
пишет `.interface-design/system.md` — это страховка от расползания графита между
сессиями. Долгосрочно тема оформляется как `registry:theme` JSON
(<https://ui.shadcn.com/docs/registry/examples>) — единый распространяемый канон
палитры.

**Шаг 1. Каркас экрана.** `impeccable-shape` — структурированное discovery и
дизайн-бриф до кода. Затем сборка: бенто-сетка главного экрана (§2), блоки и
компоненты — из Shadcn_UI MCP (`list_blocks`/`get_block` для dashboard-паттернов,
`get_component` для примитивов), документация библиотек — через context7, не по
памяти. Таблицы — TanStack Table + Virtual с tablecn как образцом (фильтры в URL);
плотные контролы — точечно из Origin UI; специализированные виджеты (Tracker,
BarList, Gantt) — Tremor и Kibo UI с перекраской в ink-токены из шага 0.

**Шаг 2. Типографика и числа.** Подключить самохостнутые Inter Variable + Geist
Mono (§1.4), `tabular-nums` на все числовые колонки и KPI, сузить веса до 400–510,
плотность таблиц — переключателем с персистом. Здесь же `impeccable-typeset`, если
иерархия текста поплыла.

**Шаг 3. Данные и чарты.** Апгрейд Recharts до v3, затем skill `dataviz` перед
первой строкой любого чарт-кода (выбор формы, палитра через `--chart-1..5`,
правила легенд и тултипов). Кастомные визуализации сверх возможностей Recharts —
помодульный visx. Правило цвета из §2: хром монохромный, цвет несут только данные.

**Шаг 4. Движение.** Motion + Motion Primitives (§1.3): count-up KPI через
`useMotionValue`, layout-анимации строк при сортировке/фильтрации, `useSpring` для
live-метрик, TransitionPanel между разрезами, ink-флэш обновлённых ячеек с
батчингом. Вкус и мера — `emil-design-eng` (философия невидимых деталей) и
`impeccable-animate`; когда появится skill ibelick — его
`fixing-motion-performance` как аудит «почему лагает». Анимированные версии
примитивов — Animate UI, они сохраняют Radix-семантику и клавиатуру.

**Шаг 5. Полировка и гейты.** Последовательность перед «готово»:
`impeccable-craft` → `impeccable-polish` (выравнивание, отступы, микро-детали) →
`impeccable-audit` (скоринг P0/P1/P2) → `web-design-guidelines` (построчный
чек-лист a11y/UX, §1.5) → скриншотный проход по живому дэшу через
browser-harness/playwright-skill (контраст, обрезки, переполнение ячеек ломаются
именно в рендере; промпты — из OneRedOak design-review, когда установим) →
`verification-before-completion` + Canonical Commands проекта. Опционально второй
линией — hallmark в режиме Audit против «AI-generated» вида. Находки уровня
принципов возвращаются в DESIGN.md и `.interface-design/system.md` шага 0 — так
петля замыкается и каждая переплавка делает канон точнее.
