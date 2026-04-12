# AEMR Platform — UI/UX Methodology & Design Principles

> Дата: 2026-04-13
> Синтез: data viz best practices, UX case studies, frontend architecture, CSS 2025

---

## 1. DATA VISUALIZATION PRINCIPLES

### Tufte: максимум data-ink ratio
- Убрать gridlines, decorative borders, card shadows
- Sparklines (Tufte's invention): 64×16px inline с KPI — 52-week trend
- **Small multiples** (мини-чарт per department) > одного перегруженного чарта
- Цель: **60-80 data points** видны above the fold

### Bloomberg/Linear density model
- Bloomberg: ~400 data points/screen, monospace, tight line-height (1.2), muted bg + bright data
- Linear: consistent 4px/8px spacing, no card shadows, whitespace = separator (не borders)

### Stephen Few — Bullet Chart
Идеально для «исполнение бюджета vs план»:
- Bar = actual, marker line = target, background bands = poor/satisfactory/good
- Компактнее любого bar chart, сразу видно отклонение

### Cole Nussbaumer Knaflic — Storytelling with Data
- **Waffle chart** (10×10 grid) > pie chart для процентов
- **Pre-attentive attributes**: position > length > angle > area > color
- Убрать «chart junk» — каждый пиксель должен нести информацию

### Andy Kirk — Functionality First
- **Gray = primary color** — хроматический цвет для 10-15% элементов
- Цвет кодирует только meaning: green=above target, red=below, blue=neutral

---

## 2. CHART RECOMMENDATIONS для АЕМР

| Тип чарта | Назначение | Паттерн |
|-----------|------------|---------|
| **Waterfall** | План→поправки→экономия→факт | Gray plan, blue additions, red reductions, dark result |
| **Diverging bars** | Отклонение от плана по управлениям | Центр = 0, left negative, right positive |
| **Slope chart** | Q1→Q2 рейтинг управлений | Crossing lines = attention needed |
| **Waffle 10×10** | % исполнения (альтернатива PieChart) | Лучше восприятие чем pie |
| **Bullet chart** | KPI vs target vs range | Few's design, компактный |
| **Heatmap table** | Управление × неделя compliance | GitHub-style, 5-step sequential blue |
| **Sparklines** | Inline trend в KPI/таблицах | 64×16px, no axes, no grid |

---

## 3. KPI CARD DESIGN

### Анатомия Hero KPI:
```
┌─────────────────────────┐
│ Мuted label (12px)      │
│ 1,247 (32px+ bold)      │
│ ▲ +12.3% (badge green)  │
│ ▁▂▃▅▇█▆▄▃▂ (sparkline)  │
└─────────────────────────┘
```

- **Max 4 hero KPIs** в верхнем ряду (3 cols each в 12-col grid)
- Large number (32px+), delta badge (green/red, +/-%), sparkline (12 periods), muted label
- `@number-flow/react` для FLIP-анимации при смене значения

---

## 4. LAYOUT GRID

### 12-column система:
| Ряд | Содержимое | Колонки |
|-----|-----------|---------|
| Row 1 | 4 Hero KPI cards | 3+3+3+3 |
| Row 2 | Primary trend chart + Ranked list | 8+4 |
| Row 3 | Heatmap table | 12 (full-width) |

### Responsive breakpoints:
- **1440px+**: Full layout
- **1024px**: 2-col KPIs, chart stack
- **768px**: Full stack, compact KPIs

### Spacing: 24px gutter, 4px/8px internal grid (Linear style)

---

## 5. TABLE DESIGN

### Modern consensus (Knaflic + Few):
- ❌ NO zebra stripes — `hover highlight` + `1px bottom border`
- ✅ Fixed headers always
- ✅ Right-align numbers, left-align text
- ✅ Sticky first column (department names)
- ✅ Compact rows (44px height for data density)
- ✅ Inline sparklines, badges, progress bars в ячейках

---

## 6. UX LAWS для АЕМР

### Scanning Patterns:
- **F-pattern**: Hero KPI top-left (32-48px), users scan top bar L→R, then down left edge
- **Z-pattern**: для overview pages — primary KPI top-left, secondary top-right, detail bottom
- **Miller's Law**: chunk data into groups of 5-7. **НИКОГДА** 20+ метрик одновременно

### Gestalt Principles:
| Принцип | Применение |
|---------|-----------|
| **Proximity** | 16-24px между группами, 8px внутри группы |
| **Similarity** | Одинаковый visual treatment = одинаковый тип метрик |
| **Closure** | Subtle 1px borders на cards, мозг «закрывает» группы |
| **Continuity** | Grid alignment обязателен. Broken alignment = broken relationships |

### Progressive Disclosure (Krug + Hick's Law):
- **Hick's Law**: 3-5 top-level categories → expand on click → detail on drill-down
- **Don't Make Me Think**: если пользователь задумался — UI провалил. Labels > icons
- **Drill-down**: Summary row → click → expanded detail → click → full page

### Refactoring UI (Wathan/Schoger):
- **Spacing > borders**: whitespace separates, не линии. Убрать dividers, увеличить padding
- **Typography hierarchy**: max 3 size levels (hero number, section header, body). Weight > size для emphasis
- **Color with purpose**: 1 primary accent, 1 semantic palette (green/amber/red), rest = gray
- **Shadows**: 2 levels max (card `0 1px 3px rgba(0,0,0,0.12)`, modal)

---

## 7. ATOMIC DESIGN для АЕМР

### Design Tokens (единый source of truth):
```
Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 px
Font:    12 / 14 / 16 / 20 / 24 / 32 px
Colors:  gray-50→gray-900, blue-500 primary, semantic red/amber/green
```
**Правило:** reference tokens, НИКОГДА raw values.

### Component Hierarchy:

| Уровень | Примеры |
|---------|---------|
| **Atoms** | Badge, Label, Number, Sparkline, Icon |
| **Molecules** | KPI Card, Filter Chip, Status Indicator, Signal Badge |
| **Organisms** | Rating Table, Filter Bar, Detail Panel, Heatmap |
| **Templates** | Dashboard Layout, DataBrowser Layout, Economy Layout |
| **Pages** | Dashboard, ГРБС Detail, Signal Control Center |

---

## 8. EMPTY & ERROR STATES

### Empty State:
- Illustration + single sentence: что здесь появится + action to populate
- Пример: «Выберите управление для просмотра данных» + кнопка «Выбрать»

### Error / Data Quality:
- ❌ НЕ generic «Ошибка»
- ✅ Inline amber banner: «3 из 12 управлений не загрузили данные за Q2»
- ✅ Specific signal count: «Обнаружено 7 строк с пустыми обязательными полями»

---

## 9. ACCESSIBILITY (ГОСТ / WCAG 2.1 AA)

| Требование | Значение |
|-----------|----------|
| Контраст текста | ≥ 4.5:1 (WebAIM checker) |
| Color-only encoding | ❌ Всегда цвет + icon/text label |
| Color-blind safe | Blue/orange вместо red/green; + patterns/icons |
| Keyboard navigation | Все interactive elements focusable, visible focus ring |
| Touch targets (mobile) | Minimum 44×44px (Fitts's Law) |

---

## 🔑 GOLDEN RULE

> **Reduce, then reduce again.** Если элемент дашборда не отвечает на один из TOP 5 вопросов пользователя — убрать его. Density is the enemy of comprehension.

---

## 10. ADVANCED CSS 2025

### 4 техники, превращающие «проект разработчика» в «premium BI» (0 JS overhead):

### 10a. Container Queries — карточки реагируют на СВОЙ размер, не viewport:
```css
.card { container-type: inline-size; }
@container (min-width: 400px) { .card-content { grid-template-columns: 1fr 1fr; } }
```
Tailwind v4: `@container` + `@lg:grid-cols-2` из коробки.

### 10b. oklch() + color-mix() — perceptually uniform colors (без "muddy" HSL):
```css
--brand: oklch(0.7 0.15 250);
--brand-hover: color-mix(in oklch, var(--brand) 85%, white);
--brand-muted: oklch(from var(--brand) l c h / 0.15);
```

### 10c. Fluid typography — no breakpoints:
```css
font-size: clamp(0.875rem, 0.75rem + 0.5vw, 1.125rem);
```

### 10d. Layered shadows (Josh Comeau) — натуральнее чем single box-shadow:
```css
box-shadow:
  0 1px 2px oklch(0 0 0 / 0.04),
  0 4px 8px oklch(0 0 0 / 0.04),
  0 16px 32px oklch(0 0 0 / 0.06);
```

### Бонусные техники:

| Техника | Что даёт | Пример |
|---------|---------|--------|
| `:has()` | Parent-aware hover | `.card:has(.metric:hover) { box-shadow: ... }` |
| View Transitions API | Native page transitions | `document.startViewTransition(() => navigate(url))` |
| CSS nesting + `@layer` | Clean specificity | `@layer base, components, utilities` |
| Scroll-driven animations | CSS-only progress bars | `animation-timeline: scroll()` |
| Tailwind v4 | Native CSS vars, `@theme`, Lightning CSS | 100x faster build |

---

## 11. FRONTEND ARCHITECTURE

### Feature-Sliced Design (FSD) — маппинг на АЕМР:

| FSD Layer | АЕМР Content |
|-----------|-------------|
| `shared` | Design tokens, API client, types, utils |
| `entities` | Metric, Department, Period, Issue, Signal models |
| `features` | FilterPanel, KPICard, ChartWidget, SignalBadge |
| `widgets` | HeroKPIRow, RatingTable, IssueControlPanel |
| `pages` | Dashboard, DeptDetail, Economy, DataBrowser |
| `app` | Providers, routing, global layout |

**Правило:** layers импортируют ТОЛЬКО из нижних layers.

### Compound Components для dashboard widgets:
```tsx
<KPICard>
  <KPICard.Header label="Исполнение" />
  <KPICard.Body value={1247} delta={+12.3} />
  <KPICard.Footer sparkline={trendData} />
</KPICard>
```
React context внутри — flexible composition без prop drilling.

### Error & Suspense Boundaries:
```
<PageSuspense>           ← Outer: page shell renders first
  <Header />
  <WidgetErrorBoundary>  ← Per-widget: broken chart → retry card, not white screen
    <Suspense>           ← Inner: chart streams in
      <ChartWidget />
    </Suspense>
  </WidgetErrorBoundary>
</PageSuspense>
```
- `react-error-boundary` (Bvaughn) — стандарт
- `useSuspenseQuery` (TanStack Query v5) — progressive loading

### Code Splitting Strategy:
| Уровень | Что split | Как |
|---------|-----------|-----|
| Per-route | Страницы | `React.lazy` (baseline) |
| Per-widget | Тяжёлые charts (recharts) | `IntersectionObserver` + dynamic import |
| Deferred | Heavy analytics | `startTransition` + lazy |

### Custom Hooks Architecture:
| Тип | Примеры | Ответственность |
|-----|---------|-----------------|
| Data-fetching | `useMetrics`, `useDeptData` | Wrap TanStack Query |
| State | `useFilterState`, `useUIState` | Wrap Zustand |
| Computed | `useDerivedMetrics`, `useTrustScore` | useMemo + selectors |

### Performance Budgets:
| Метрика | Бюджет |
|---------|--------|
| LCP | < 2.5s |
| INP | < 200ms (заменил FID в 2024) |
| CLS | < 0.1 |
| Filter debounce | 300ms |
| Table virtualization | > 50 rows |

### API Design for Dashboards:
- Batch endpoints: `POST /api/metrics/batch` с массивом metric IDs
- Cursor pagination для таблиц
- TanStack Query `queryKey` arrays → granular cache invalidation per dept/period

---

## 12. UX CASE STUDIES — УРОКИ ДЛЯ АЕМР

### Measurable outcomes:
| Паттерн | Эффект | Источник |
|---------|--------|----------|
| Progressive disclosure | -20-40% time-to-insight | NN/g |
| Bar вместо Pie chart | +30% accuracy of comparison | Cleveland & McGill |
| Keyboard shortcuts | -50% workflow time (power users) | Linear blog |
| Mobile-responsive dashboards | +2-3x engagement для field users | UK GDS |

### Уроки от лучших:

| Продукт | Ключевое решение | Урок для АЕМР |
|---------|-----------------|---------------|
| **Stripe** | Summary KPIs → drill-down on click | Hero metrics first, details on demand |
| **Linear** | Keyboard-first, minimal chrome | Fast navigation > pretty charts |
| **Grafana 10** | Guided exploration вместо wall-of-panels | Sane defaults > flexibility |
| **Metabase** | "Questions not queries" | Non-tech users → natural language framing |
| **UK GDS** | No pie charts, tables preferred | Clarity + accessibility > visual flair |
| **Tableau** | NN/g: max 7 KPIs per screen | 4-6 hero metrics per view |
| **Datadog** | Unified view (metrics+logs+alerts) | Cross-cutting signals together = less context-switching |

### Прямое применение к АЕМР:

| Паттерн | Источник | Применение |
|---------|----------|------------|
| Hero KPI cards (4-6 max) | Stripe, Tableau | Dashboard top row |
| Click-to-expand | Linear, GDS | Строка=атом: row → detail → raw data |
| **NO pie charts** | GDS, NN/g | Заменить на bar/sparkline/waffle |
| Traffic-light severity | Datadog, Grafana | Trust/quality signal badges |
| Progressive disclosure | All | Summary → detail → raw data |
| Keyboard navigation | Linear | ⌘K, 1-9 tabs, arrow keys |

---

## 13. ПРИНЦИП: CLICK = EXPAND, НЕ NAVIGATE

> **Железное правило:** клик по карточке, метрике, строке, элементу — РАСКРЫВАЕТ деталь IN-PLACE (drill-down внутри вкладки). НИКОГДА не переводит на другую страницу.

### Почему:
- Переход на другую страницу = потеря контекста (фильтры, scroll position, mental model)
- Пользователь кликнул чтобы **узнать больше**, а не чтобы **уйти**
- Back button ≠ undo — пользователь теряется в навигации
- Government users (тир 1-2) смотрят дашборд 5-10 мин — каждый лишний переход = раздражение

### Реализация:

| Действие | Результат |
|----------|----------|
| Click на KPI card | Раскрывается panel ПОД карточкой с breakdown (AnimatePresence) |
| Click на строку таблицы | Expand row detail inline (AG Grid master-detail) |
| Click на bar в chart | Highlight + показать tooltip/panel с деталями |
| Click на signal badge | Expand inline detail с рекомендацией |
| Click на dept в рейтинге | Expand inline с подведами и метриками |

### Исключения (только explicit text links):
- «Подробнее →» / «Открыть управление →» — текстовая ссылка ЯВНО говорит «перейти»
- Breadcrumb навигация — ожидаемое поведение
- Sidebar menu — ожидаемое поведение

### Техническая реализация:
```tsx
// ✅ ПРАВИЛЬНО: expand in-place
<KPICard onClick={() => setExpanded(!expanded)}>
  <AnimatePresence>
    {expanded && <motion.div layoutId={`detail-${id}`}><DetailPanel /></motion.div>}
  </AnimatePresence>
</KPICard>

// ❌ НЕПРАВИЛЬНО: navigate away
<KPICard onClick={() => navigate(`/dept/${id}`)}>
```

---

## ИТОГО: CHECKLIST для каждого экрана АЕМР

При проектировании каждой страницы проверять:

- [ ] **Max 4-6 hero KPIs** above the fold (Miller's Law)
- [ ] **F-pattern** — главное число top-left
- [ ] **Progressive disclosure** — summary → click → detail → drill-down
- [ ] **No pie charts** — bar/sparkline/waffle/bullet
- [ ] **Gray = primary color** — chromatic only for meaning (10-15%)
- [ ] **Spacing > borders** — whitespace separates
- [ ] **3 typography levels** max — hero number, header, body
- [ ] **WCAG AA** — 4.5:1 contrast, no color-only encoding
- [ ] **Empty state** — illustration + action + explanation
- [ ] **Error state** — specific inline message, not generic
- [ ] **Keyboard accessible** — focus ring, tab order
- [ ] **Container queries** — cards responsive to own size
- [ ] **oklch colors** — perceptually uniform
- [ ] **Layered shadows** — Comeau technique
- [ ] **@number-flow** — animated KPI transitions
- [ ] **Строка=атом** — click row → expand, not navigate away
- [ ] **Click = expand, NEVER navigate** — только «Подробнее→» text link переводит на другую страницу
