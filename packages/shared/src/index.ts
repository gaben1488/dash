// Re-export everything from types (base definitions)
export * from './types.js';

// Re-export schemas (zod schemas for runtime validation, API contracts, drizzle-lite)
export * from './schemas.js';

// Re-export report-map, explicitly handling name collisions.
// report-map.ts defines its own DepartmentId (lowercase IDs), SheetData (2D array),
// and DepartmentMetrics (RowMetrics-based). We alias them to avoid conflict
// with the new domain types in types.ts.
export {
  DEPARTMENT_IDS,
  DEPARTMENT_NAMES,
  DEPARTMENT_SHORT_NAMES,
  SVOD_COLUMNS,
  FORMULA_COLUMNS,
  RULE_COLUMNS,
  DEPARTMENT_ROWS,
  SUMMARY_ROWS,
  DEPARTMENTS,
  REPORT_MAP,
  extractMetric,
  buildDepartmentMetrics,
  buildSummaryMetrics,
  getAllCellAddresses,
  getMetricsByGroup,
  getMetricsByDepartment,
  getMetricByKey,
} from './report-map.js';

export type {
  DepartmentId as ReportMapDepartmentId,
  SheetData as RawSheetData,
  DepartmentMetrics as ReportMapDepartmentMetrics,
  ColumnLetter,
  RowMetrics,
  DepartmentRowConfig,
  SummaryMetrics,
} from './report-map.js';

// Re-export rule-book
export * from './rule-book.js';

// Re-export гигиена текста (детекторы п.98д: готовые исправления ячеек для операторов)
export * from './text-hygiene.js';

// Re-export проверку русского языка — орфография и пунктуация (продолжение п.98д):
// словарь-эталон собран из живых книг, словоформы отсеиваются, низкая уверенность
// не показывается. Обоснование выбора частотного подхода — в шапке модуля.
export * from './text-language.js';

// Re-export constants
export * from './constants.js';

// Re-export production data-source defaults
export * from './data-sources.js';

// Re-export centralized column mapping
export * from './column-map.js';

// Re-export ШДЮ mapping
export * from './shdyu-map.js';

// Re-export activity scope (ось ТД/ПМ/ТД-ПМ — фильтр AN4 листа ШДЮ)
export * from './activity-scope.js';

// Re-export канон «само управление» (ось C: аппарат ГРБС vs подвед — единый предикат)
export * from './org-itself.js';

// Re-export канон маркера отсутствия «X/x/Х/х» — общесистемный, для ЛЮБЫХ ячеек
// (программы D, подпрограммы E, основания и пр.; решение владельца 14.08, п.62)
export * from './absence.js';

// Re-export орг-классификатор по ОПФ (ось C: аппарат/ПБС/бюджетное/автономное/…; см. classifyOrg)
export * from './org-classify.js';
export * from './parse-sheet-date.js';
export * from './svod-grid.js';
export * from './time-selection.js';
export * from './recon-root-cause.js';

// Re-export канон «пустая дата факта» (ось Q) — семантически отдельно от org-itself
export * from './fact-date.js';

// Re-export словари-канон владельца для колонок комментариев (п.72(г), 14.08.2026):
// 12 причин отклонения, 20 обоснований ЕП, регексы номеров процедур
export * from './comment-standards.js';

// Re-export стадия «Закупки, проводимые в течение года» (канон пп.71, 76, 81–83):
// структурный предикат, подклассы, девять видов, стартовая разметка 46 строк,
// маркер «инициативная заявка» и правило дожития
export * from './yearlong-stage.js';

// Re-export структурный парсер номера процедуры из AG (канон п.74, 14.08.2026):
// parseProcedureRef / extractProcedureRefs / detectForeignText
export * from './procedure-ref.js';

// Re-export СВОД view builder (панель просмотра — точная копия листа из officialMetrics)
export * from './svod-view.js';

// Re-export единая сетка СВОД (CalcEngine-истина: активность×метод×бюджет×период)
export * from './unified-svod.js';

// Re-export имена показателей листа СВОД ТД-ПМ (переименование владельца 18.08.2026):
// «Заключено, %», «Законтрактовано, %», «Остаток к заключ.», переключатель B1
export * from './svod-sheet-names.js';

// Re-export unified class system
export * from './unified-class-system.js';

// Re-export department registry (canonical source of truth)
export * from './department-registry.js';

// Re-export семантику плановой суммы книг (канон п.102, 18.08.2026): столбцы
// H/I/J/K несут у разных управлений НМЦК, НМЦК за вычетом изъятого или лимит —
// подпись обязана идти рядом с числом, иначе сводный план врёт молча
export * from './plan-semantics.js';

// Re-export sheet classifier (SSOT: имя листа → смысл; см. classifySheet)
export * from './sheet-classifier.js';

// Re-export словарь продукта (SSOT человеческих лейблов: внутренний ключ → русская фраза)
export * from './product-dictionary.js';

// Re-export канон явления «Экономия без отметки» (консолидация 21.08.2026):
// одно определение на ядро, правила листа, карточки и срез Реестра
export * from './economy-flag.js';

// Re-export карту происхождения метрик (канон п.104, 18.08.2026): из какого из
// пяти источников показатель родом и совпадает ли наш счёт со счётом источника
export * from './metric-provenance.js';

// Re-export степени обоснованности ЕП (канон п.98ж, 18.08.2026): кластер причины
// из колонки M → одна из четырёх степеней, и «сокращаемая доля» ЕП как их сумма
export * from './ep-justification-grade.js';

// Re-export all dictionaries (canonical methods, ГРБС aliases, EP reasons, legal refs, etc.)
// See packages/shared/src/dictionaries/index.ts for full barrel.
// Integration plan: AEMR_DICTIONARIES_PLAN.md §2.
export * from './dictionaries/index.js';

// Re-export помеченные деньги (тысячи рублей против рублей): книги ГРБС ведутся
// в тысячах, закон и мониторинг говорят в рублях, а перепутать их однажды уже
// удалось молча (БАГ #1 охоты 2026-08-08 — проверки лимитов 44-ФЗ не срабатывали
// никогда). Пометка единицы делает подмену ошибкой проверки типов
export * from './money-units.js';
// Целостность нумерации рабочего листа (канон п.118: дубль — нарушение,
// пропуск — информация о выведенной из плана закупке).
export * from './sequence-integrity.js';
// Сбитый формат ячейки даты: показано число вместо срока (разбор 19.08).
export * from './cell-format-integrity.js';
// Сверка зеркал книги — справочная (решение 19.08: работают с одним листом).
export * from './mirror-integrity.js';
// Один дом порога (М6, 21.08.2026): у каждого числа, решающего цвет и слово,
// есть имя, смысл одной фразой и источник — закон, канон документов либо
// честно названное наше решение. Литерал в тернарнике разметки — болезнь,
// ради которой реестр заведён.
export * from './threshold-registry.js';
