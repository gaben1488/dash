# СВОД Rebrand UI — Implementation Plan

Branch: `feature/svod-rebrand-ui`
Baseline: 600 tests passing, 0 TS errors

## BATCH 1: Foundation (design tokens + store)
- T1.1: Add design tokens CSS (elevation, radius, spacing scale) → index.css
- T1.2: Update store PageId type (7→6 pages: dashboard→pulse, data→registry, economy→economy, quality→control, analytics→analytics, settings→system) → store.ts
- T1.3: Update PAGE_FILTERS map in Header for new page IDs → Header.tsx
- T1.4: Update App.tsx renderPage switch for new page IDs
- Verify: `tsc --noEmit` passes, dev server starts

## BATCH 2: Sidebar Rebrand (АЕМР → СВОД)
- T2.1: Update Sidebar: logo "А"→"С", brand "АЕМР"→"СВОД", section headers removed, 6 nav items with new names/icons
- T2.2: Update sidebar nav items: Пульт(Gauge)/Реестр(Table2)/Экономия(Coins)/Контроль(ShieldCheck)/Аналитика(TrendingUp)/Система(Settings)
- Verify: visual check, no TS errors

## BATCH 3: Header Responsive Adaptation
- T3.1: Make header responsive (xl: 1 row, md: 2 rows, sm: collapsed)
- T3.2: Update filter visibility map for new page IDs
- Verify: filters work per page, responsive behavior

## BATCH 4: Dashboard → Пульт (assertion-driven)
- T4.1: Update Dashboard.tsx: assertion banner title (dynamic from data), hero KPI hierarchy (2 large + 2 med + 1 binary)
- T4.2: Add assertion headers to RatingTable and charts ("УО отстаёт", "Q2 просел")
- T4.3: Add 4 states (loading/empty/error/data) to all components
- T4.4: Ensure KB tooltips on all column headers
- Verify: visual check, all states work

## BATCH 5: DataBrowser → Реестр (summary + signals)
- T5.1: Add SummaryBar component (row count, critical/warning counts, plan/fact totals)
- T5.2: Add KB tooltips on signal badges (what signal means, 44-ФЗ ref)
- T5.3: Implement 4 states (empty state with filter suggestions)
- Verify: visual check

## BATCH 6: Economy → Экономия (assertion + AD-queue)
- T6.1: Refactor hero: 1 large (total ₽) + 3 contextual (avg%, >25% count, conflicts)
- T6.2: Add assertion banner ("142.3 млн экономии, 7 строк требуют проверки")
- T6.3: KB tooltips on all column headers
- Verify: visual check

## BATCH 7: Quality → Контроль (sub-tabs consolidated)
- T7.1: Update Quality page to use new "control" page ID, ensure 4 sub-tabs work
- T7.2: Add assertion header to each sub-tab
- T7.3: Ensure KB tooltips on trust matrix cells
- Verify: sub-tab navigation, visual check

## BATCH 8: Analytics → Аналитика (assertion cards)
- T8.1: Update analytics cards with assertion titles (dynamic from data)
- T8.2: Ensure collapsible cards, responsive layout
- T8.3: KB tooltips on chart sections
- Verify: visual check

## BATCH 9: Settings → Система (health dashboard)
- T9.1: Add health mini-dashboard above settings tabs
- T9.2: Assertion: "Система работает штатно" or "Ошибка подключения"
- Verify: visual check

## BATCH 10: Final Polish + Verification
- T10.1: Anti-slop audit: every component against 15-rule checklist
- T10.2: Responsive test: sm/md/lg/xl/2xl
- T10.3: Full test suite, TS check
- T10.4: Screenshot review
