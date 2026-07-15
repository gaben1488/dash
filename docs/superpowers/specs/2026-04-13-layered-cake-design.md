# АЕМР — Дизайн «Слоёный пирог» (Layer Cake)

> Дата: 2026-04-13
> Подход: Снизу вверх с параллельным UI-ребрендингом
> Принцип: Каждый слой на 10/10

## Философия

Каждый слой = изолированный модуль с чёткими границами.
Нижние слои НЕ знают о верхних. Верхние зависят от нижних через интерфейсы.
Изменение в нижнем слое → интерфейс сохраняется → верхние слои не ломаются.

---

## СЛОЙ 1: ИСТОЧНИКИ ДАННЫХ (7/10 → 10/10)

### Текущее
- 9 Google Spreadsheets (СВОД + 8 управлений)
- ✅ BUG-2 исправлен: формулы читаются
- ✅ Реестр управлений (department-registry.ts)

### Что добавить
- [ ] Полный пересмотр архитектуры листов (XLSX анализ в процессе)
- [ ] ЕИС выгрузки (OrderSearch, ContractSearch) — парсер CSV
- [ ] Шаблон ШДЮ помесячной разбивки
- [ ] Бэкапы и версионирование снимков
- [ ] Профилирование полей (v36: input/formula/protected/validated-input)

### Файлы
- `packages/server/src/services/google-sheets.ts` — ✅ обновлён
- `packages/shared/src/department-registry.ts` — ✅ готов
- Новый: `packages/core/src/pipeline/field-profiler.ts`

---

## СЛОЙ 2: ПАРСИНГ И ИНЖЕСТ (7/10 → 10/10)

### Текущее
- `ingest.ts` — парсинг СВОД snapshot
- `shdyu-ingest.ts` — парсинг ШДЮ (переписан)
- Формулы теперь включены в данные

### Что добавить
- [ ] Валидация при первой загрузке (SIG-INT-001..003 сразу при инжесте)
- [ ] Обнаружение битых формул (#REF!, #VALUE!, #N/A) при парсинге
- [ ] Нормализация текста (trim, lowercase для сравнений)
- [ ] Определение типа строки: данные / заголовок / итого / пусто / мета
- [ ] ЕИС парсер (CSV → структурированные данные)

### Файлы
- `packages/core/src/pipeline/ingest.ts`
- `packages/core/src/pipeline/shdyu-ingest.ts` — ✅ переписан
- Новый: `packages/core/src/pipeline/eis-ingest.ts`

---

## СЛОЙ 3: РАСЧЁТНЫЙ ДВИЖОК (8/10 → 10/10)

### Текущее
- CalcEngine: 22 базовые + 12 расчётные = 34 метрики
- exec_count_pct полная цепочка
- 14 cross-dimensional карт группировки

### Что добавить
- [ ] Верификация шкалы 0-1 (как в v26 procurement_report.gs)
- [ ] Month-level фильтрация (CalcEngine ОБЯЗАН работать при ЛЮБЫХ фильтрах)
- [ ] Composite score (4 веса: исполнение 40%, EP risk 25%, аномалии 20%, комплаенс 15%)
- [ ] Метрики из v39: classifyRowState (6 состояний)
- [ ] sheetAggByFilters — гибрид official + calculated
- [ ] Дельты: текущее vs неделя назад / квартал назад

### Файлы
- `packages/core/src/pipeline/calc-engine.ts` — 740+ строк
- `packages/core/src/pipeline/orchestrator.ts`
- Новый: `packages/core/src/pipeline/composite-score.ts`

---

## СЛОЙ 4: СИГНАЛЬНАЯ СИСТЕМА (6/10 → 10/10)

### Текущее
- 16/20 сигналов реализовано
- 5 групп (Integrity, Compliance, Anomaly, Economy, Risk)

### Что добавить
- [ ] SIG-INT-004: Дублирование строки
- [ ] SIG-ANM-001: Benford test (из procurement_report.gs строка 2550)
- [ ] SIG-ANM-002: Z-score / EWMA (строка 2600)
- [ ] SIG-ECO-002: Нулевая экономия при факте
- [ ] 3-level anomaly: data → behavioral → systemic (строка 3652)
- [ ] 5-level EP risk classification (строка 4534)
- [ ] EXACT_MATCH detection (шаблонное заполнение)
- [ ] FACT_NO_PLAN detection
- [ ] Noise map (buildNoiseMap из v39) — группировка проблем
- [ ] Человекочитаемые описания на русском (SIGNAL_SYSTEM_RU.md)
- [ ] Сигнальная админка (вкл/выкл, пороги, серьёзность)

### Файлы
- `packages/core/src/pipeline/signals.ts`
- `packages/shared/src/unified-class-system.ts`
- Новый: `packages/core/src/pipeline/benford.ts`
- Новый: `packages/core/src/pipeline/noise-map.ts`
- Новый: `packages/web/src/pages/SignalAdmin.tsx`

---

## СЛОЙ 5: ВАЛИДАЦИЯ (7/10 → 10/10)

### Текущее
- rule-book.ts: 60+ правил
- Q1≤Year, budget sum, execution checks

### Что добавить
- [ ] Consistency score (из v26 строка 2636) — факт ≤ план × 1.05
- [ ] Проверка: сумма частей = итого
- [ ] Проверка: проценты вычисляются корректно
- [ ] EXACT_MATCH: |факт - план| / план < 0.0001
- [ ] 44-ФЗ проверки (из документации 08_модуль_44фз.md.docx)
- [ ] Антикоррупционные индикаторы (из 09_антикоррупционный_модуль.md.docx)

### Файлы
- `packages/shared/src/rule-book.ts`
- Новый: `packages/core/src/pipeline/compliance-44fz.ts`

---

## СЛОЙ 6: TRUST SCORING (6/10 → 10/10)

### Текущее
- 5 компонентов (data 30%, formulas 25%, rules 20%, mapping 15%, risk 10%)
- A-F грейдинг, floor=10, penalty 25

### Что добавить
- [ ] Composite score из v26 (4 веса: exec 40%, EP risk 25%, anomaly 20%, compliance 15%)
- [ ] Бинарный UI ("✓ Можно доверять" / "✗ Расхождения") вместо gauge%
- [ ] History: тренд trust по снимкам
- [ ] Department trust grid: 8 ГРБС × 5 компонентов
- [ ] Trust drivers (как в v39): что именно снижает trust

### Файлы
- `packages/core/src/pipeline/trust-scorer.ts`

---

## СЛОЙ 7: ХРАНЕНИЕ (6/10 → 10/10)

### Текущее
- SQLite через Drizzle ORM
- 8 таблиц: snapshots, metrics, issues, audit, rows + 3 доп

### Что добавить
- [ ] Exception management (из v36: _AEMR_EXCEPTIONS)
- [ ] Issue status с 6 статусами (new/in_progress/fixed/rejected/exception/closed)
- [ ] Snapshots history с диффами
- [ ] PostgreSQL адаптер (Drizzle pg)
- [ ] Миграции БД (drizzle-kit)

### Файлы
- `packages/server/src/db/schema.ts`
- `packages/server/src/db/index.ts`

---

## СЛОЙ 8: API (7/10 → 10/10)

### Текущее
- Fastify 5, 9 маршрутов
- Auth middleware (Bearer token)

### Что добавить
- [ ] Профилирование полей при записи (как v36 writeSafeField)
- [ ] Exception API (CRUD)
- [ ] Issue status API (6 статусов)
- [ ] Export API (XLSX, PPTX, PDF)
- [ ] Snapshot diff API (для дельт)
- [ ] ЕИС import API

### Файлы
- `packages/server/src/routes/*.ts`
- Новый: `packages/server/src/routes/export.ts`

---

## СЛОЙ 9: STATE MANAGEMENT (6/10 → 10/10)

### Текущее
- Zustand store с фильтрами
- React Query для API

### Что добавить
- [ ] Multi-year support (Set<number>)
- [ ] Cycle presets (неделя пт-пт, месяц, квартал, год)
- [ ] Persist фильтров в localStorage
- [ ] Реактивность на все 6 осей (dept, sub, method, activity, budget, period)
- [ ] FilterBreadcrumb + "Сбросить все"

### Файлы
- `packages/web/src/store.ts`

---

## СЛОЙ 10-12: UI (5/10 → 10/10)

### Применяется навык frontend-design
- Радикальный ребрендинг каждой страницы
- KB tooltips на каждом элементе
- Мультидименсиональность всех элементов
- Apple-style фильтры
- Дельты везде (Δ за неделю/квартал)
- Sparklines в RatingTable
- Adaptive подведы

### Подробный план — в plan файле (rustling-sniffing-lobster.md)

---

## СЛОЙ 13: ЭКСПОРТ (3/10 → 10/10)

### Что добавить (портирование из v39)
- [ ] XLSX генератор: 5 типов (нормализация, реструктуризация, свод, аудит, полный отчёт)
- [ ] PPTX генератор: 5 слайдов (PptxGenJS)
- [ ] PDF генератор (Puppeteer)
- [ ] Выдача таблиц в утверждённом виде
- [ ] Генератор текстового отчёта (как в v39 genReport)

### Файлы
- Новый: `packages/core/src/export/xlsx-generator.ts`
- Новый: `packages/core/src/export/pptx-generator.ts`
- Новый: `packages/core/src/export/report-generator.ts`

---

## СЛОЙ 14: ТЕСТИРОВАНИЕ (6/10 → 10/10)

### Текущее
- 108 unit тестов (Vitest)

### Что добавить
- [ ] E2E тесты (Playwright) — по сценариям из 07_сценарии_проверки.md.docx
- [ ] Integration тесты: API → CalcEngine → DB
- [ ] Snapshot тесты: сравнение с эталонным отчётом от 30.03
- [ ] Тесты шкалы 0-1: каждая метрика проверяется на корректный диапазон
- [ ] Visual regression тесты

---

## СЛОЙ 15: ДЕПЛОЙ (2/10 → 10/10)

### Что добавить
- [ ] Docker (Dockerfile + docker-compose)
- [ ] Nginx reverse proxy
- [ ] PM2 process manager
- [ ] CI/CD (GitHub Actions)
- [ ] Health monitoring
- [ ] Инструкция по деплою на русском

---

## ПОРЯДОК ВЫПОЛНЕНИЯ

### Волна 1: Фундамент (Слои 1-4)
Шкала 0-1, field profiling, Benford/EWMA, 3-level anomaly, noise map

### Волна 2: Middleware (Слои 5-8)
Compliance 44-ФЗ, trust composite, exceptions, export API

### Волна 3: UI Revolution (Слои 9-12)
Frontend-design ребрендинг, Apple filters, KB tooltips, дельты

### Волна 4: Экспорт + Тесты (Слои 13-14)
XLSX/PPTX/PDF генераторы, E2E тесты

### Волна 5: Деплой (Слой 15)
Docker, Nginx, PM2, CI/CD
