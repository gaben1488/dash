# AEMR Platform — Technology Stack Reference

> Дата: 2026-04-13
> Синтез результатов 12+ исследовательских агентов

---

## 1. ТЕКУЩИЙ СТЕК (production)

| Слой | Технология | Версия | Назначение |
|------|-----------|--------|------------|
| **Runtime** | Node.js | 22 LTS | Серверная среда |
| **Монорепо** | pnpm workspaces | 9.x | 5 пакетов: shared, core, server, web, scripts |
| **Фронтенд** | React | 19.0 | UI framework |
| **Сборка** | Vite | 6.x | Dev server + production build |
| **Стили** | Tailwind CSS | 3.x | Utility-first CSS |
| **Чарты** | Recharts | 2.15 | SVG charts (Bar, Line, Pie, Composed) |
| **Стейт** | Zustand | 5.x | Глобальное состояние (~40 полей) |
| **Иконки** | Lucide React | latest | 1000+ иконок |
| **Сервер** | Fastify | 5.x | REST API |
| **ORM** | Drizzle ORM | latest | Type-safe SQL |
| **БД** | SQLite (better-sqlite3) | — | Embedded DB, 8 таблиц |
| **ID** | nanoid | — | Короткие уникальные ID |
| **TypeScript** | 5.9 | — | Строгая типизация |

---

## 2. КОМПОНЕНТНАЯ БИБЛИОТЕКА: shadcn/ui + Recharts (без Tremor)

### Решение: shadcn/ui (структура) + raw Recharts (чарты)

**Пересмотр (2026-04-13):** Tremor исключён. Уже есть `chart-colors.ts` тема + raw Recharts. Tremor = +80KB за marginal gain, запирает в свой API.

**shadcn/ui** — copy-paste компоненты на Radix UI + Tailwind:
- Card, Table, Badge, Tabs, Sheet, Dialog, Command (cmdk), Tooltip, HoverCard
- Skeleton (loading), Accordion, Popover, Select, DatePicker
- Полная WAI-ARIA доступность из коробки
- Dark mode через CSS variables

**Recharts** (уже в проде) — паттерны чартов:

| Чарт | Компонент | Где |
|------|-----------|----|
| Stacked bar (ФБ/КБ/МБ) + economy line | `ComposedChart` | Economy.tsx |
| Quarter comparison (plan/fact) | Grouped `Bar` без stackId | Analytics.tsx |
| Horizontal dept rating | `BarChart layout="vertical"` | RatingTable |
| Sparklines в ячейках таблицы | `LineChart` 80×24, no axes | RatingTable cells |
| Waterfall (план→факт→отклонение) | `BarChart` с invisible base | Dashboard |
| Export PNG | `html-to-image` (6KB) на chart ref | Кнопка экспорта |
| Click drill-down | `<Bar onClick>` → navigateTo | Все чарты |

**Sparkline для таблицы (без ResponsiveContainer):**
```tsx
<LineChart width={80} height={24} data={trend}>
  <Line dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
</LineChart>
```

### Ключевые паттерны premium UI:
- `tabular-nums` на всех числовых колонках
- `tracking-tight` на крупных метриках
- `text-muted-foreground` для лейблов
- `bg-muted/40` для sidebar
- `hover:bg-muted/50` для hover в таблицах
- `shadow-sm` на cards (минимальные тени в dark — border вместо shadow)
- `transition-colors duration-200` для smooth transitions

---

## 3. ТАБЛИЦЫ: AG Grid Community

### Решение: AG Grid Community Edition (MIT, бесплатный)

**Пересмотр (2026-04-13):** после глубокого сравнения AG Grid Community побеждает TanStack Table для нашего кейса:
- 30+ колонок, 20K строк, grouped rows, pinned columns, badges — всё из коробки
- TanStack Table = headless → 2-4 недели доп. работы на UI, виртуализацию, a11y
- AG Grid Community = MIT, бесплатный, не Enterprise

| Критерий | AG Grid Community | TanStack Table |
|----------|-------------------|----------------|
| **Grouped rows** | ✅ Из коробки | ❌ Ручная реализация |
| **Pinned columns** | ✅ Из коробки | ❌ CSS sticky вручную |
| **Virtual scrolling** | ✅ Встроенный | ⚠️ @tanstack/virtual addon |
| **Cell renderers** | ✅ cellRenderer API | ❌ Полностью вручную |
| **Sorting/Filtering** | ✅ Из коробки | ✅ Headless логика |
| **WCAG 2.1 AA** | ✅ ARIA встроен | ❌ Реализуй сам |
| **Bundle** | ~200-300KB gzip | ~15-50KB gzip |
| **Лицензия** | MIT | MIT |

**Дополнения:**
- Sparklines в ячейках: `@fnando/sparkline` (SVG) внутри `cellRenderer`
- Excel export: `sheetjs` (`XLSX.utils.aoa_to_sheet()` + `XLSX.writeFile()`)
- Тёмная тема: CSS variables через `--ag-*` custom properties
- Column resizing + reordering: drag-and-drop из коробки
- Multi-column sort: Shift+click из коробки
- Keyboard nav: arrow keys, Enter = expand — встроенный
- Референс: `sadmann7/shadcn-table` (shadcn + TanStack — полезен для лёгких таблиц)

---

## 4. АНИМАЦИИ: Motion (Framer Motion)

### Решение: motion (бывший framer-motion)

**10 паттернов для BI дашборда:**

| # | Паттерн | Механизм | Где |
|---|---------|----------|-----|
| 1 | Page/tab transitions | `AnimatePresence mode="wait"` + fade/slide | Переключение вкладок |
| 2 | Bar chart entry | `motion.rect scaleY: 0→1` с stagger | Анимация столбцов |
| 3 | KPI animated number | `useSpring` + `useTransform` → `toLocaleString()` | Hero KPI карточки |
| 4 | Table row expand | `AnimatePresence` + `height: 0→auto` | Раскрытие деталей строки |
| 5 | Filter panel slide | `motion.aside x: -280→0` | Боковая панель фильтров |
| 6 | Toast notifications | `layout` + `opacity: 0, y: 50, scale: 0.9` | Sonner интеграция |
| 7 | Skeleton→content | `AnimatePresence mode="wait"` crossfade | Загрузка данных |
| 8 | Drill-down | `layoutId` — shared element transition | Карточка→детали |
| 9 | Stagger lists | `staggerChildren: 0.04` variants | Списки, гриды карточек |
| 10 | CSS fallback | CSS `transition` для hover/focus | Простые состояния |

**Правила производительности:**
- **Только** `transform` и `opacity` — GPU-composited, без layout recalc
- `layout="position"` вместо `layout={true}` когда меняется только позиция
- `useInView` для анимации только видимых элементов (20+ одновременных)
- Для `height: "auto"` — измерить сначала, не использовать на длинных списках

**Где НЕ использовать:**
- Chart animations — у Tremor/Recharts свои
- Loading spinners — CSS animation достаточно
- Decorative effects — government BI ≠ marketing site

**KPI Animated Number:**
```tsx
function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 50, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  useEffect(() => { spring.set(value); }, [value]);
  return <motion.span>{display}</motion.span>;
}
```

**Drill-down с layoutId:**
```tsx
<motion.div layoutId={`card-${id}`} onClick={() => setSelected(id)}>
  <KpiSummary />
</motion.div>
// → при selected:
<motion.div layoutId={`card-${selected}`} className="detail-view">
  <FullDetail />
</motion.div>
```

---

## 5. DARK THEME (Premium)

### Решение: CSS variables (shadcn) + Linear/Vercel/Raycast inspired palette

**Референсы:** Linear `228 12% 8%`, Vercel `0 0% 0%`, Raycast `225 25% 7%`

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222 84% 5%;
  --card: 0 0% 100%;
  --primary: 217 91% 60%;          /* blue-500 */
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --border: 214 32% 91%;
}

.dark {
  --background: 224 71% 4%;        /* почти чёрный с синим undertone */
  --foreground: 210 20% 98%;       /* 15.4:1 contrast ✅ */
  --card: 222 47% 7%;              /* чуть светлее bg */
  --primary: 217 91% 60%;          /* blue-500 accent */
  --muted: 223 47% 11%;
  --muted-foreground: 215 15% 55%; /* 5.2:1 contrast ✅ */
  --border: 216 34% 17%;
  --ring: 217 91% 60% / 0.3;
}
```

**Semantic tokens:**
```css
.dark {
  /* Severity */
  --success: 142 71% 45%;   --warning: 38 92% 50%;
  --error: 0 84% 60%;       --info: 217 91% 60%;

  /* Chart palette (8 distinct, dark-bg safe) */
  --chart-1: 217 91% 60%;   --chart-2: 160 84% 39%;
  --chart-3: 38 92% 50%;    --chart-4: 270 76% 60%;
  --chart-5: 340 82% 52%;   --chart-6: 190 90% 50%;
  --chart-7: 25 95% 53%;    --chart-8: 142 71% 45%;

  /* Trust score gradient */
  --trust-low: 0 84% 60%;   --trust-mid: 38 92% 50%;
  --trust-high: 142 71% 45%;
}
```

**Data table dark styling:**
```css
.dark tr:nth-child(even) { background: hsl(223 47% 11% / 0.5); }
.dark tr:hover { background: hsl(217 91% 60% / 0.08); }
.dark tr[data-selected] { background: hsl(217 91% 60% / 0.15); border-left: 2px solid hsl(var(--primary)); }
```

**Glassmorphism для модалов:**
```css
.glass-modal { background: hsl(224 71% 4% / 0.7); backdrop-filter: blur(16px) saturate(180%); border: 1px solid hsl(var(--border) / 0.3); }
```

**Card elevation:** `border` вместо `box-shadow` в dark mode — subtle `hsl(var(--border) / 0.6)`.

**Переключение:** `next-themes` — `ThemeProvider attribute="class" defaultTheme="system" enableSystem`

### Конкретная hex-палитра (Tailwind zinc-based, Vercel/Linear style):

**Backgrounds & Borders:**
| Token | Hex | Tailwind | Назначение |
|-------|-----|----------|------------|
| `--bg-base` | `#09090b` | zinc-950 | Page background |
| `--bg-card` | `#18181b` | zinc-900 | Card/panel |
| `--bg-elevated` | `#27272a` | zinc-800 | Hover/popover |
| `--border` | `#3f3f46` | zinc-700 | Subtle borders |

**Text hierarchy (WCAG AA+ on #09090b):**
| Token | Hex | Contrast | Роль |
|-------|-----|----------|------|
| `--text-primary` | `#fafafa` | 15.4:1 | Headings |
| `--text-secondary` | `#a1a1aa` | 7.2:1 | Body text |
| `--text-muted` | `#71717a` | 4.6:1 | Labels |
| `--text-disabled` | `#52525b` | 3.1:1 | Disabled |

**Бюджеты (ФБ/КБ/МБ):** `#6366f1` indigo / `#8b5cf6` violet / `#06b6d4` cyan

**8 dept colors (D3-categorical для dark bg):**
`#6366f1` `#06b6d4` `#22c55e` `#eab308` `#f97316` `#ec4899` `#8b5cf6` `#14b8a6`

**Trust grade gradient:** F `#ef4444` → D `#f97316` → C `#eab308` → B `#84cc16` → A `#22c55e`

**Severity 5 levels:** critical `#ef4444` / error `#f97316` / significant `#eab308` / warning `#facc15` / info `#3b82f6`

> **Правило:** saturated mid-tones (400-500 Tailwind scale), НЕ pastel (low contrast), НЕ neon (eye strain). GitHub dark dimmed (`#22272e`) лучше dark default (`#0d1117`) для data-heavy UI.

---

## 6. COMMAND PALETTE + SHORTCUTS + TOASTS

### 6a. cmdk (Command Palette)

shadcn/ui `CommandDialog` оборачивает cmdk:

- **⌘K / Ctrl+K** — открытие палитры
- Группы поиска: Pages, Departments, Metrics, Signals/Issues, Actions
- Встроенный fuzzy matching
- Recent searches → localStorage → отдельная `CommandGroup`
- Иконки Lucide в каждом `CommandItem`

### 6b. Keyboard Shortcuts

Глобальный хук `useShortcuts`:

| Шорткат | Действие |
|---------|----------|
| `⌘K` | Command palette |
| `⌘B` | Toggle sidebar |
| `⌘E` | Export данных |
| `⌘/` | Справка по шорткатам |
| `1-9` | Переключение вкладок |

Hint в UI: `<kbd>` элементы со стилем shadcn `text-muted-foreground`.

### 6c. Sonner (Toast Notifications)

shadcn/ui `<Toaster />` оборачивает Sonner:

| Тип | Пример |
|-----|--------|
| `toast.success()` | "Отчёт сохранён" |
| `toast.error()` | "Ошибка загрузки" + description |
| `toast.promise()` | loading→success/error для async (export, sync) |
| Action toast | "Строка удалена" + кнопка "Отменить" |

- Позиция: `bottom-right`
- Dark mode: автоматически через `theme` prop
- Stacking: встроенный

---

## 7. ФИЛЬТРЫ: Apple-style

### Текущее решение (custom) — уже реализовано:
- Year roller (scrollable pills)
- Period pills (year/q1/q2/q3/q4)
- MonthStrip (12 toggleable months)

### Улучшения:
- **nuqs** — URL state sync для фильтров (shareable URLs)
- Multi-year support (`Set<number>`)
- Cycle presets (неделя пт-пт, месяц, квартал, год)
- DeptTreePicker с tri-state checkbox
- FilterBreadcrumb + "Сбросить все"
- Immediate filtering (no "Apply" button)

---

## 8. ЭКСПОРТ ДАННЫХ

| Формат | Библиотека | Назначение |
|--------|-----------|------------|
| **Excel** | ExcelJS | .xlsx с форматированием, формулами, стилями |
| **CSV** | PapaParse | Быстрый CSV export/import |
| **PDF** | Playwright (server) | Серверный рендеринг страниц в PDF |
| **PDF** | pdfmake (client) | Клиентский PDF для простых отчётов |
| **Word** | docx | .docx генерация для официальных отчётов |
| **ZIP** | JSZip | Архивирование множественных файлов |

---

## 9. НОТИФИКАЦИИ

| Канал | Технология | Когда |
|-------|-----------|-------|
| **In-app toast** | Sonner | Snapshot loaded, errors, quick feedback |
| **Notification center** | Custom (Bell + dropdown) | All events, persistent |
| **Real-time push** | @fastify/websocket | Instant browser push |
| **Telegram** | Native fetch → Bot API | Critical alerts to Viktor |
| **Email** | Nodemailer + SMTP | Weekly digest, AD approvals |
| **Threshold engine** | Custom (in orchestrator) | Auto-alert when metric crosses boundary |

---

## 10. STATE MANAGEMENT: Zustand Architecture

### Решение: Zustand 5.x (уже в проде) + TanStack Query

**Архитектура (2-4 split stores):**

| Store | Ответственность |
|-------|-----------------|
| `useFilterStore` | Departments, date range, method, severity — URL sync |
| `useUIStore` | Sidebar open, active tab, theme, command palette |
| TanStack Query | Server state (fetch, cache, refetch) — НЕ в Zustand |

**Паттерны:**
- **URL sync**: `nuqs` / `URLSearchParams` — URL = source of truth на page load, Zustand = reactive driver
- **Derived state**: selectors + `useMemo`, НЕ хранить derived в store
- **Persistence**: `persist` middleware → localStorage для filter preferences
- **DevTools**: `devtools` middleware → Redux DevTools extension
- **Immer**: `immer` middleware для nested filter objects (`state.filters.departments.push(id)`)
- **useShallow**: устранение cascade re-renders при чтении подмножества стора
- **TanStack Query связь**: `useQuery({ queryKey: ['metrics', filters] })` где `filters` из Zustand

---

## 11. PERFORMANCE

### P0 (максимальный ROI):
- **React Compiler** (babel-plugin-react-compiler) — авто-мемоизация, 15 мин setup
- **useShallow** (zustand/react/shallow) — устранение cascade re-renders
- **Lazy-load** pages (`React.lazy` + `Suspense`) — -30-40% initial bundle

### P1:
- Split `useFilteredData` (872 строки) на 4 каскадных useMemo
- AG Grid built-in virtual scrolling для DataBrowser (20K+ строк)
- `React.memo` на chart wrappers + `isAnimationActive={false}`

### P2:
- Web Worker для тяжёлых вычислений (только при 10K+ строк client-side)
- Downsampling для charts (max 200 data points)

---

## 11. ТЕСТИРОВАНИЕ

| Слой | Инструмент | Объём | Покрытие |
|------|-----------|-------|----------|
| **Unit** | Vitest | ~200+ | CalcEngine, формулы, адаптеры, фильтры |
| **Component** | Vitest + RTL | ~80+ | KPI cards, RatingTable, FilterBar, KB tooltips |
| **Visual** | Storybook + Chromatic | ~50+ stories | Chart rendering, layout, themes |
| **E2E** | Playwright | ~20-30 flows | Filter→Chart→Table, drill-down, navigation |
| **CI** | GitHub Actions | 4 parallel jobs | <8 min wall-clock |

---

## 12. SECURITY & RBAC: CASL v6

### 3 слоя защиты:

| Слой | Технология | Роль |
|------|-----------|------|
| **Frontend** | `@casl/react` (`<Can>`, `useAbility`) | UI hiding (UX only, not security) |
| **API** | `@fastify/jwt` + CASL server-side | Real enforcement |
| **Database** | PostgreSQL RLS (future) | Ultimate guarantee |

### 4 тира доступа (CASL):

| Тир | Роль | Права |
|-----|------|-------|
| **1** | Губернатор/зам | `can('read', 'all')` — read всё, без edit |
| **2** | Руководитель управления | `can('read', 'SvodSummary')` + own dept |
| **3** | Аналитик/специалист | `can(['read','edit'], 'DeptData', {deptId})` |
| **4** | Оператор ввода | `can('edit', 'Sheet', {sheetName: {$in: sheets}})` |

### Архитектура:
- **Shared**: `defineAbilityFor(user)` — единый source of truth (client + server)
- **React**: `AbilityProvider` + `useMemo` (пересоздание только при смене tier/deptId)
- **Component-level**: `<Can I="read" a="SvodSummary"><SvodPage /></Can>`
- **Row-level**: `<Can I="edit" this={subject('DeptData', {deptId: row.deptId})}>`
- **API guard**: `ForbiddenError.from(req.ability).throwUnlessCan('read', subject(...))`
- **JWT payload**: `{ sub, tier, deptId, sheets }` → `defineAbilityFor(decoded)`
- **Audit**: логирование `{ userId, action, subject, timestamp, allowed }`

### Библиотеки:
- `@casl/ability@6` + `@casl/react@4` — ~8KB gzipped
- `@fastify/jwt` — JWT sign/verify (15 min access, 7 day refresh)
- `@fastify/helmet` — security headers
- `@fastify/rate-limit` — brute-force protection
- `@casl/ability` — ABAC engine (shared server+client)
- `zod` — input validation

---

## 13. AI CHAT (Phase 3+)

### Архитектура: Claude API + Tool Use

- `/api/chat` endpoint → Claude с tool definitions
- Tools = обёртки существующих API endpoints
- System prompt с глоссарием АЕМР (ГРБС, КП, ЕП, ФБ...)
- Cost: ~$0.01/question, ~$30/month при 100 вопросов/день
- Data sovereignty: API (data stays on server) или self-hosted model

---

## 14. DRAG-DROP LAYOUT

### Решение: НЕ РЕАЛИЗОВЫВАТЬ

- Фиксированный Karpathy-validated layout — правильный выбор
- 12 персон × validated каждый элемент = нельзя "рассыпать"
- "ПУЛЬТ УПРАВЛЕНИЯ, не showroom" (Victor)
- Metabase/Looker тоже используют fixed layout для domain-specific BI
- Реализовать: collapsible sections (CSS + Zustand) + persist в localStorage

---

## 15. ДОСТУПНОСТЬ (ГОСТ)

### ГОСТ Р 52872-2019 — обязателен для госсистем:
- **WCAG 2.1 AA** minimum (shadcn/ui Radix = compliant out of box)
- Keyboard navigation на всех interactive элементах
- Screen reader support (aria-labels, roles)
- Contrast ratio 4.5:1 (text), 3:1 (UI elements)
- Focus visible indicators (`focus-visible:ring-2`)
- Responsive: отдельный mobile view mode (не responsive tables)

---

## 16. MOBILE

### Решение: отдельный mobile view mode

- НЕ responsive tables (1000 строк × 30 колонок ≠ mobile)
- Отдельные мобильные компоненты для KPI, alerts, status
- Mobile-first: hero KPI → critical alerts → org list
- Desktop: full dashboard experience

---

## 17. ТИПОГРАФИКА

### Font Stack (все с Cyrillic):

| Роль | Шрифт | Почему |
|------|-------|--------|
| **Display/Heading** | **Manrope** (variable 200-800) | Geometric, premium, full Cyrillic, Google Fonts |
| **Body/UI** | **Inter** (variable 100-900) | Industry standard для data UI, `tnum`/`ss02`/`zero` |
| **Data/Mono** | **JetBrains Mono** (variable 100-800) | Russian-heritage, beautiful at hero sizes, slashed zero |
| **Government fallback** | **Golos Text** | Если нужен "как Госуслуги" — замена Inter |

### Ключевые настройки:
```css
body { font-feature-settings: "ss02" 1; } /* всегда: disambiguation 1/l/I */
.numeric { font-feature-settings: "tnum" 1, "zero" 1, "ss02" 1; }
.hero-kpi { font-family: 'JetBrains Mono'; letter-spacing: -0.03em; }
h1, h2 { font-family: 'Manrope'; letter-spacing: -0.02em; }
.badge { text-transform: uppercase; font-feature-settings: "case" 1; }
```

### Loading:
- Self-hosted woff2 variable fonts (~600KB total)
- `font-display: swap` для Inter/Manrope
- `font-display: optional` для JetBrains Mono (нет CLS на KPI numbers)
- Preload только Inter (самый критичный)

---

## 18. ARBITRARY PERIOD SELECTION

### Решение: custom PeriodSelector

- Chip-based UX (выбранные периоды как removable chips)
- Presets: неделя пт-пт, месяц, квартал, год
- Arbitrary: любая комбинация месяцев/кварталов
- Multi-year support
- URL sync через nuqs

---

## 19. PREMIUM MICRO-INTERACTIONS

### Рекомендуемый стек (Linear-level polish, не carnival):

| Эффект | Метод | Bundle | Уместность для гос BI |
|--------|-------|--------|-----------------------|
| **Card glow + spotlight** | CSS radial-gradient + onMouseMove | 0kb | ✅ Subtle, professional |
| **KPI animated numbers** | `@number-flow/react` (FLIP animations) | ~5kb | ✅ Best-in-class |
| **Skeleton shimmer** | CSS @keyframes + linear-gradient | 0kb | ✅ shadcn Skeleton |
| **Noise texture** | SVG `<feTurbulence>` overlay (opacity: 0.03) | 0kb | ✅ Apple-style depth |
| **Border focus animation** | CSS `@property` + conic-gradient | 0kb | ✅ На active selections |
| **Glassmorphism** | `backdrop-filter: blur(12px)` | 0kb | ⚠️ 1-2 модала max |
| **Mesh gradient bg** | Static SVG (meshgradient.com) | 0kb | ✅ Только как subtle bg |
| **Polished components** | Magic UI (magicui.design, cherry-pick) | 2-5kb each | ✅ shadcn-compatible |

### ❌ НЕ использовать:
- Cursor effects / magnetic buttons — distracting, a11y проблемы
- Lenis smooth scroll — overkill, нативный CSS достаточно
- Heavy glassmorphism (>10 элементов) — performance killer
- Aceternity UI полностью — большинство для marketing, не BI

### Spotlight на карточке (CSS + 10 lines JS):
```tsx
const [pos, setPos] = useState({ x: 0, y: 0 });
<div onMouseMove={e => {
  const rect = e.currentTarget.getBoundingClientRect();
  setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
}} style={{
  background: `radial-gradient(400px at ${pos.x}px ${pos.y}px, rgba(59,130,246,0.06), transparent 80%)`
}} />
```

**Итого добавленный бандл: ~5-15kb.** Всё остальное — чистый CSS.

---

## 20. РЕФЕРЕНСЫ И ВДОХНОВЕНИЕ

### Premium Product UIs:
| Продукт | Что забрать |
|---------|------------|
| **Linear.app** | Минимальный chrome, keyboard-first, monochrome + 1 accent, ⌘K палитра |
| **Vercel Dashboard** | Чёрный bg, real-time sparklines, deployment-status row (icon+text+timestamp+badge) |
| **Stripe Dashboard** | KPI hero row (число+дельта%+sparkline), отличный table design |
| **Raycast** | Frosted-glass панели, tight spacing, list-detail split layout |
| **Bloomberg Terminal** | Max data density, grid-based, monospaced числа, color-coded severity |
| **TradingView** | Dark theme done right, resizable panels, green→red gradient |

### Government/Public Sector:
| Продукт | Что забрать |
|---------|------------|
| **UK GDS** | Accessibility-first, large single-number KPIs, plain labels |
| **USASpending.gov** | Hierarchical budget viz, drill-down treemaps |
| **Yandex DataLens** | Dark theme chart palette, кириллическая типографика |
| **Visiology** | KPI tile grid для госсектора |

### Open Source Templates:
- `ui.shadcn.com/examples/dashboard` — best starting dark template
- `ui.shadcn.com/charts` — shadcn chart patterns

### Ключевые паттерны для АЕМР:
1. **Hero KPI row**: 3-5 крупных чисел (% исполнения, количество, экономия) с trend deltas
2. **Color system**: Gray-900 bg, Gray-800 cards, один accent (blue), red только для нарушений
3. **Tables**: Compact rows, inline sparklines, status badges
4. **Interaction**: Click row → expand detail (строка=атом), не отдельные страницы
5. **Layout**: Sidebar nav (org hierarchy) + main content + collapsible filter bar

---

## ПРИОРИТЕТЫ ВНЕДРЕНИЯ (обновлено 2026-04-13)

### Phase 4 (Dashboard refactor — текущая):
1. shadcn/ui Card + Badge + Tooltip + Skeleton
2. Recharts sparklines + ComposedChart для Hero KPI
3. AG Grid Community для DataBrowser
4. Motion: AnimatePresence + layoutId для drill-down
5. Dark theme premium (Linear palette)
6. React Compiler activation + lazy-load pages
7. useShallow для Zustand

### Phase 5 (DataBrowser + Controls):
1. AG Grid Community + custom cellRenderers (badges, sparklines)
2. Inline row expansion с motion
3. ⌘K command palette (cmdk)
4. Sonner toasts
5. Keyboard shortcuts system

### Phase 6 (Economy + Advanced):
1. Recharts ComposedChart (stacked bar + economy line)
2. Waterfall chart (план→факт→отклонение)
3. html-to-image для chart export

### Phase 7 (Filters):
1. cmdk command palette
2. nuqs URL state
3. DeptTreePicker

### Phase 8 (Quality + Analytics):
1. Tremor Tracker (compliance heatmap)
2. Storybook + Chromatic setup

### Phase 9 (Infrastructure):
1. Sonner toasts
2. Notification center
3. Telegram bot
4. Security/RBAC

### Phase 10 (Future):
1. AI Chat (Claude API)
2. Playwright E2E
3. PostgreSQL migration + RLS
