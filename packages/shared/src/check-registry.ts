/**
 * check-registry.ts — реестр проверок AEMR (данные, вынесено из unified-class-system.ts, чанк G).
 *
 * Только данные + их тип. Никакой логики. Типы-зависимости приходят из unified-class-system
 * через `import type` (стираются компилятором — рантайм-цикла нет).
 */
import type {
  IssueGroup,
  UnifiedSeverity,
  CheckOrigin,
  TrustComponentId,
} from './unified-class-system.js';
import type { RuleScope } from './types.js';

export interface CheckRegistryEntry {
  id: string;
  group: IssueGroup;
  name: string;
  description: string;
  severity: UnifiedSeverity;
  origin: CheckOrigin;
  scope: RuleScope;
  article44fz?: string;
  kbHint: string;
  recommendation: string;
  trustComponent: TrustComponentId;
  /** Предыдущий ID (для миграции) */
  legacyId?: string;
  /** Тип источника: rule = из RULE_BOOK, signal = из signals.ts, new = новая */
  sourceType: 'rule' | 'signal' | 'new';
}

export const CHECK_REGISTRY: CheckRegistryEntry[] = [
  // ================================================================
  // ГРУППА: data_integrity — Целостность данных
  // ================================================================
  // Проверка td_with_program («ТД с заполненной графой программы») УДАЛЕНА
  // каноном п.30 интервью 14.08.2026: заполненная графа программы (D) у
  // текущей деятельности — норма, а не ошибка; срез «ТД-ПМ» упразднён.
  // Старые issues со checkId='td_with_program' в снимках остаются как есть —
  // их метаданные записаны в самой записи, отсутствие id в реестре не ломает
  // чтение (legacy-конвертер удалён 14.08.2026 как невызываемый).
  {
    // Id остаётся plan_year_missing (уже записан в issues снапшотов).
    // Имя — канон п.23 интервью 14.08.2026: «закупки, НЕ ОБЕСПЕЧЕННЫЕ
    // финансированием» (прежнее «без подтверждённого финансирования»,
    // решение 07.08, снято тем же владельцем).
    id: 'plan_year_missing',
    group: 'data_integrity',
    name: 'Закупка, не обеспеченная финансированием',
    description: 'Способ и плановые деньги есть, а года плана (P) нет — сроки не проставлены, закупка не обеспечена финансированием. Формулы листа СВОД считают год строго и строку не видят: официальный лимит занижен ровно на её сумму.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'По всем книгам района таких строк 549 на 302 607 тыс. руб. (снимок 06.08.2026) — от кредитной линии УФБП на 32 млн до мелких заготовок. Все они входят в наш расчёт по нестрогому правилу года и не входят в официальные формулы листа.',
    recommendation: 'Разобрать судьбу строки: финансирование подтверждено — проставить плановую дату (N), квартал и год посчитаются формулами; деньги перераспределены или закупка не состоится — обнулить план либо пометить отменённой.',
    trustComponent: 'data_quality',
    sourceType: 'new',
  },
  {
    id: 'fact_quarter_missing',
    group: 'data_integrity',
    name: 'Факт без планового квартала',
    description: 'Дата факта проставлена, а плановый квартал (O) пуст или невалиден. Печатный год отчёта считается строго по плановым кварталам — такая строка из него выпадает; на Пульте она живёт только в служебной корзине «без квартала». Одна строка может смещать деньги года на десятки миллионов.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Замер 07.08.2026 (снимок 06.08): одна строка УДТХ с фактом 67 666,68 тыс. руб. без валидного квартала — ровно она и есть расхождение «год = Σ кварталов» (отчёт) против «год = Σ + строки без квартала» (Пульт).',
    recommendation: 'Проставить плановую дату (N) — квартал (O) посчитается формулой листа; если дата есть, а O пуст, восстановить формулу протяжкой из соседней строки. После этого строка войдёт в печатный год, и расхождение годовых чисел исчезнет.',
    trustComponent: 'data_quality',
    sourceType: 'new',
  },
  {
    id: 'budget_sum_plan',
    group: 'data_integrity',
    name: 'Консистентность плановых сумм бюджета',
    description: 'K (итого план) = H + I + J (ФБ + КБ + МБ). Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    kbHint: 'Итого плановой суммы должно точно совпадать с суммой компонент по бюджетам. Расхождение указывает на ошибку формулы или ручной ввод.',
    recommendation: 'Проверить формулу K = H + I + J, исправить расхождение',
    trustComponent: 'data_quality',
    legacyId: 'budget_sum_plan',
    sourceType: 'rule',
  },
  {
    id: 'budget_sum_fact',
    group: 'data_integrity',
    name: 'Консистентность фактических сумм бюджета (СВОД)',
    description: 'O (итого факт) = L + M + N (ФБ + КБ + МБ факт). Только СВОД.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'На листе СВОД ТД-ПМ столбцы L/M/N/O содержат фактические суммы по бюджетам.',
    recommendation: 'Проверить формулу O = L + M + N на листе СВОД',
    trustComponent: 'data_quality',
    legacyId: 'budget_sum_fact',
    sourceType: 'rule',
  },
  {
    id: 'dept_fact_sum',
    group: 'data_integrity',
    name: 'Консистентность фактических сумм (подразделения)',
    description: 'Y (итого факт) = V + W + X. Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'На листах подразделений Y = итого факт, V/W/X = компоненты по бюджетам.',
    recommendation: 'Проверить формулу Y = V + W + X',
    trustComponent: 'data_quality',
    legacyId: 'dept_fact_sum',
    sourceType: 'rule',
  },
  {
    id: 'dept_economy_sum',
    group: 'data_integrity',
    name: 'Консистентность сумм экономии (подразделения)',
    description: 'AC (итого экономия) = Z + AA + AB. Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Итого экономии должно совпадать с суммой ФБ + КБ + МБ экономии.',
    recommendation: 'Проверить формулу AC = Z + AA + AB',
    trustComponent: 'data_quality',
    legacyId: 'dept_economy_sum',
    sourceType: 'rule',
  },
  {
    // Канон п.98з (пакет поручений 18.08): отсутствующие и повторяющиеся
    // порядковые номера колонки A. Проверка уровня листа — одна карточка со
    // списком адресов (каскад п.53), правило rowNumbering в RULE_BOOK.
    id: 'row_numbering',
    group: 'data_integrity',
    name: 'Сквозная нумерация «№ п/п» (колонка A)',
    description:
      'Счётные строки листа несут сквозную нумерацию в колонке A. Повтор номера делает адрес двусмысленным (один № указывает на две строки), пропуск — след удалённой или невнесённой строки, пустая A оставляет строку без стабильного адреса. Одна карточка на лист со списком всех адресов.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Живой прецедент п.98б: «Опрессовка» была строкой 534, стала 155 — позиционный номер строки устаревает, как только лист живёт. Единственный адрес, переживающий перемещения строк, — «№ п/п» из колонки A; поэтому сбитая нумерация лишает замечания и сверки второго адреса.',
    recommendation:
      'Восстановить сквозную нумерацию в колонке A — № п/п это стабильный адрес строки при перемещениях (п.98б): заполнить пустые номера, развести повторы, закрыть пропуски протяжкой нумерации.',
    trustComponent: 'data_quality',
    sourceType: 'rule',
  },
  {
    id: 'formula_broken',
    group: 'data_integrity',
    name: 'Формула возвращает ошибку',
    description: 'Ячейка содержит #REF, #VALUE, #N/A, #NAME, #DIV/0 и т.д.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    kbHint: 'Формульная ошибка означает, что ячейка не может рассчитать значение. Часто — из-за удалённой строки/столбца или некорректной ссылки.',
    recommendation: 'Исправить формулу в указанной ячейке Google Sheets',
    trustComponent: 'data_quality',
    legacyId: 'formulaBroken',
    sourceType: 'signal',
  },
  // УДАЛЁН: budgetMismatch (signal) — дубль budget_sum_plan

  // ================================================================
  // ГРУППА: formula_consistency — Формульная согласованность
  // ================================================================
  {
    id: 'execution_percentage',
    group: 'formula_consistency',
    name: 'Расчёт процента исполнения (СВОД)',
    description: 'G (% исполнения) = E / D * 100 при D > 0.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Процент исполнения — ключевой KPI. Ошибка в формуле искажает отчётность перед руководством.',
    recommendation: 'Проверить формулу G = E/D*100 на указанной строке',
    trustComponent: 'formula_integrity',
    legacyId: 'execution_percentage',
    sourceType: 'rule',
  },
  {
    id: 'deviation_calc',
    group: 'formula_consistency',
    name: 'Расчёт отклонения количества (СВОД)',
    description: 'F (отклонение) = E - D (факт минус план).',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Отклонение показывает разницу между фактическим и плановым количеством процедур. Положительное = перевыполнение.',
    recommendation: 'Проверить формулу F = E - D (факт − план)',
    trustComponent: 'formula_integrity',
    legacyId: 'deviation_calc',
    sourceType: 'rule',
  },
  {
    id: 'q1_leq_year',
    group: 'formula_consistency',
    name: '1 кв не превышает Год',
    description: 'Квартальные значения D и K не должны превышать годовые.',
    severity: 'significant',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Квартал — часть года. Превышение квартального значения над годовым логически невозможно.',
    recommendation: 'Проверить корректность данных в строках 1 кв и Год',
    trustComponent: 'formula_integrity',
    legacyId: 'q1_leq_year',
    sourceType: 'rule',
  },
  // formula_continuity УДАЛЁН — дублирует budget_sum_plan (#1a) + dept_fact_sum (#10)

  // ================================================================
  // ГРУППА: field_validation — Валидация полей
  // ================================================================
  {
    id: 'method_validation',
    group: 'field_validation',
    name: 'Валидация метода закупки',
    description: 'Столбец L должен содержать ЭА, ЕП, ЭК или ЭЗК.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Метод закупки определяет правовой режим процедуры. Некорректное значение нарушает классификацию.',
    recommendation: 'Исправить значение L на одно из допустимых: ЭА, ЕП, ЭК, ЭЗК',
    trustComponent: 'rule_compliance',
    legacyId: 'method_validation',
    sourceType: 'rule',
  },
  {
    id: 'type_validation',
    group: 'field_validation',
    name: 'Валидация типа закупки',
    description: 'Столбец F должен содержать допустимый вид деятельности.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Тип закупки (текущая/программная) влияет на бюджетную классификацию.',
    recommendation: 'Исправить значение F на допустимое значение',
    trustComponent: 'rule_compliance',
    legacyId: 'type_validation',
    sourceType: 'rule',
  },
  {
    // Канон п.98д (пакет поручений 18.08) + п.95/55: сигналы гигиены текста
    // «очень хорошо понятно сделанные», чтобы помогать операторам приводить
    // данные в нормальный вид. Проверка уровня листа — одна карточка со
    // списком «ячейка → дефект → готовое исправление», правило textHygiene
    // в RULE_BOOK (формат — как у row_numbering).
    id: 'text_hygiene',
    group: 'field_validation',
    name: 'Гигиена текста (C — подвед, G — предмет)',
    description:
      'Технические дефекты набора в текстовых ячейках: двойные и краевые пробелы, пробел не с той стороны знака препинания, невидимые символы (неразрывный пробел, табуляция, символы нулевой ширины), латиница внутри кириллического слова, имя подведа с отступлением от справочника. Одна карточка на лист: адрес ячейки → дефект → готовое исправленное значение.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Такой брак глазом почти неотличим, но машина видит два разных значения: живой кейс листа «ВСЕ» книги УО — «ДС №3 „Жар-Птица“» в 5 строках против канона справочника «ДС № 3 «Жар-Птица»» в 43, фильтры и группировки считают их разными учреждениями. Латинская буква в кириллическом слове (СШОР по ЛBС с латинской B) так же ломает поиск и сличение строк.',
    recommendation:
      'Пройти по списку карточки и вставить готовые значения: каждое исправление — целое значение ячейки, копируется и вставляется без правки руками. Маркеры отсутствия «X/х/тире» — не дефект и в карточку не попадают (канон п.62).',
    trustComponent: 'data_quality',
    sourceType: 'rule',
  },
  {
    id: 'data_quality',
    group: 'completeness',
    name: 'Пустые обязательные поля',
    description: 'На строке закупки с фактом отсутствуют обязательные поля (D, K, L).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Обязательные поля: предмет (D), плановая сумма (K), метод (L). Без них строка не поддаётся анализу.',
    recommendation: 'Заполнить недостающие данные в обязательных столбцах',
    trustComponent: 'data_quality',
    legacyId: 'dataQuality',
    sourceType: 'signal',
  },

  // ================================================================
  // ГРУППА: temporal — Временные аномалии
  // ================================================================
  {
    id: 'overdue',
    group: 'temporal',
    name: 'Просрочка закупки',
    // Формулировка структурная (канон п.27 от 14.08.2026): «не подписан, не
    // отменён» выводились из текста комментариев и из определения сняты.
    description: 'Плановая дата прошла, а факта нет: ни даты заключения (Q), ни фактических сумм.',
    severity: 'critical',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Просрочка — ключевой индикатор для руководства. Требует немедленного анализа причин.',
    recommendation: 'Провести анализ причин просрочки и принять корректирующие меры',
    trustComponent: 'operational_risk',
    legacyId: 'overdue',
    sourceType: 'signal',
  },
  {
    id: 'stalled_contract',
    group: 'temporal',
    name: 'Подвисший контракт',
    // ОТКЛЮЧЕНО 14.08.2026 (канон п.27): статус «подписан» выводился из
    // свободного текста комментариев; после канона «заключено» = дата Q, и
    // «подписан без даты» структурно невыразимо. Новые замечания не
    // создаются; запись хранит подписи для исторических снимков.
    description: 'Контракт подписан, но нет факт даты и план дата просрочена > 60 дней. Отключено 14.08.2026: статус «подписан» больше не выводится из текста комментариев (канон п.27).',
    severity: 'critical',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Подвисший контракт = подписан, но не исполняется. Возможны проблемы с подрядчиком.',
    recommendation: 'Проверить статус исполнения контракта, связаться с подрядчиком',
    trustComponent: 'operational_risk',
    legacyId: 'stalledContract',
    sourceType: 'signal',
  },
  {
    id: 'early_closure',
    group: 'temporal',
    name: 'Раннее закрытие',
    description: 'Факт дата раньше плановой на > 30 дней.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Раннее закрытие может означать ошибку в дате или необычную ситуацию.',
    recommendation: 'Проверить фактическую дату завершения, возможна ошибка данных',
    trustComponent: 'operational_risk',
    legacyId: 'earlyClosure',
    sourceType: 'signal',
  },
  {
    id: 'finance_delay',
    group: 'temporal',
    name: 'Задержка финансирования',
    // ОТКЛЮЧЕНО 14.08.2026 (канон п.27): сигнал выводился из подстроки
    // «финансир» в комментариях — свободный текст исполнителей машинно не
    // интерпретируется. Необеспеченность финансированием — структурный класс
    // plan_year_missing (пустой год P). Запись хранит подписи исторических.
    description: 'В комментариях ГРБС/УЭР обнаружено упоминание задержки финансирования. Отключено 14.08.2026: свободный текст комментариев машинно не интерпретируется (канон п.27); см. класс «Закупка, не обеспеченная финансированием».',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Упоминание "финансирование" или "отсутствие финансирования" в AE/AF — индикатор задержки оплаты.',
    recommendation: 'Проверить статус финансирования, связаться с финансовым подразделением',
    trustComponent: 'operational_risk',
    legacyId: 'financeDelay',
    sourceType: 'signal',
  },
  {
    id: 'fact_date_before_plan',
    group: 'temporal',
    name: 'Факт дата раньше плана',
    // Понижено до информационного 14.08.2026 (п.28 интервью, дословно:
    // «это не ошибка» по мнению аудитории) — плановая дата ориентир,
    // раннее заключение допустимо. Было warning.
    description: 'Факт дата на 1-30 дней раньше плановой. Не ошибка (решение п.28 от 14.08.2026) — справочная информация: закупка проведена раньше ориентира плана.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Плановая дата (N) — ориентир план-графика, а не запрет: заключение раньше неё допустимо и ошибкой данных не считается. Сигнал остаётся справкой; при разрыве более 30 дней или смене года см. «Раннее закрытие» — там вероятна опечатка в дате.',
    recommendation: 'Действий не требуется. При подозрении на опечатку сверить даты N и Q со сроками контракта.',
    trustComponent: 'operational_risk',
    legacyId: 'factDateBeforePlan',
    sourceType: 'signal',
  },
  {
    id: 'future_fact_date',
    group: 'temporal',
    name: 'Дата факта в будущем',
    description: 'Договор помечен заключённым позже сегодняшнего дня — физически невозможно.',
    severity: 'significant',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Почти всегда опечатка в годе. Такая строка завышает официальный счёт заключённых: ' +
      'формулы листа СВОД дату факта ни с чем не сравнивают и считают её фактом.',
    recommendation: 'Сверить дату с контрактом и исправить год в столбце Q',
    trustComponent: 'data_quality',
    legacyId: 'futureFactDate',
    sourceType: 'signal',
  },

  // ================================================================
  // ГРУППА: financial — Финансовые аномалии
  // ================================================================
  {
    id: 'fact_vs_plan',
    group: 'financial',
    name: 'Факт превышает план',
    description: 'Фактическая сумма/количество превышает плановую на > 10%.',
    severity: 'significant',
    origin: 'bi_heuristic',
    scope: 'both',
    kbHint: 'Превышение факта над планом может означать дополнительные закупки или ошибку данных. Пороги: info >0%, warning >5%, significant >10%.',
    recommendation: 'Проверить обоснование превышения, провести бюджетную корректировку',
    trustComponent: 'operational_risk',
    // ОБЪЕДИНЯЕТ: Rule 5 (fact_leq_plan), Rule 12 (dept_fact_leq_plan), Signal (factExceedsPlan)
    legacyId: 'factExceedsPlan',
    sourceType: 'signal',
  },
  {
    // Канон п.98м + п.102 (18.08.2026): по ЕП в план (K) пишут планируемую
    // сумму договора, обязанную равняться потраченной (Y) — тезис владельца:
    // «по ЕП не может быть экономии». Без записи в реестре сигнал не рождал
    // бы замечание (orchestrator ищет проверку по id), а source-validation
    // показала бы латинский ключ вместо имени.
    id: 'ep_fact_deviation',
    group: 'financial',
    name: 'По ЕП факт не равен плану',
    description: 'Способ — единственный поставщик (ЕП), факт проставлен, но отличается от плана сверх допуска округления 0,5%. По ЕП план (K) — планируемая сумма договора, обязанная равняться потраченной (Y): торгов нет, расхождение — ошибка заполнения либо «экономия», которой по ЕП быть не должно.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Семантика плана зависит от способа (п.102 от 18.08.2026): по ЕП K — сумма договора (план = факт), у конкурентных способов K — НМЦК, и факт меньше плана там — нормальная торговая экономия. Поэтому конкурентные способы этой проверкой не трогаются.',
    recommendation: 'Сверить план (K) и факт (Y) с суммой договора: верен факт — выровнять план по нему; верен план — поправить факт.',
    trustComponent: 'data_quality',
    legacyId: 'epFactDeviation',
    sourceType: 'signal',
  },
  {
    id: 'anti_dumping',
    group: 'financial',
    name: 'Антидемпинговый сигнал (> 25%)',
    description: 'Высокая экономия (лимит−факт) > 25%. Внимание: это лимит−факт, НЕ НМЦ−факт. Антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных.',
    severity: 'significant',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'ст. 37',
    kbHint: 'При снижении цены > 25% от НМЦК заказчик обязан применить антидемпинговые меры (44-ФЗ ст.37).',
    recommendation: 'Запросить обоснование антидемпинговых мер по ст.37 44-ФЗ',
    trustComponent: 'operational_risk',
    legacyId: 'highEconomy',
    sourceType: 'signal',
  },
  {
    id: 'ep_risk',
    group: 'financial',
    name: 'ЕП-риск (> 600 тыс.)',
    description: 'Закупка у единственного поставщика с суммой > 600 000 руб. (п.4 ст.93 44-ФЗ).',
    severity: 'info',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'п.4 ст.93',
    kbHint: 'По п.4 ст.93 44-ФЗ закупка у ЕП до 600 тыс. руб. не требует обоснования. Выше — требует.',
    recommendation: 'Проверить обоснование закупки у единственного поставщика по п.4 ст.93 44-ФЗ',
    trustComponent: 'operational_risk',
    legacyId: 'epRisk',
    sourceType: 'signal',
  },
  {
    id: 'low_competition',
    group: 'financial',
    name: 'Низкая конкуренция (< 2%)',
    description: 'Экономия менее 2% — возможен предопределённый победитель.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Экономия < 2% при конкурентной процедуре — индикатор формальной конкуренции.',
    recommendation: 'Проверить условия обеспечения конкуренции',
    trustComponent: 'operational_risk',
    legacyId: 'lowCompetition',
    sourceType: 'signal',
  },
  {
    id: 'economy_sign_check',
    group: 'financial',
    name: 'Отрицательная экономия (СВОД)',
    description: 'U (экономия) < 0 — возможен перерасход.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'svod',
    kbHint: 'Отрицательная экономия означает, что фактическая стоимость превысила плановую.',
    recommendation: 'Проверить причину перерасхода',
    trustComponent: 'operational_risk',
    legacyId: 'economy_sign_check',
    sourceType: 'rule',
  },

  // ================================================================
  // ГРУППА: economy_control — Контроль экономии
  // ================================================================
  {
    id: 'economy_conflict',
    group: 'economy_control',
    name: 'Конфликт флага экономии',
    description: 'Два случая: (а) AD="экономия", но факт ≥ план — некорректный флаг; (б) экономия >15%, но финансовый орган не определил флаг экономии в столбце AD.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Случай А: AD="экономия" но факт ≥ план (некорректный флаг). Случай Б: экономия >15% но финансовый орган не определил флаг экономии (AD пуст).',
    recommendation: 'Случай А: убрать флаг экономии (факт ≥ план). Случай Б: финансовому органу необходимо установить флаг экономии в столбце AD.',
    trustComponent: 'operational_risk',
    legacyId: 'economyConflict',
    sourceType: 'signal',
  },
  {
    id: 'status_on_data_rows',
    group: 'economy_control',
    name: 'Статус (AD) на строках данных',
    description: 'Столбец AD должен быть заполнен на строках закупок с фактом.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'AD (флаг) заполняется после фактического исполнения для контроля экономии.',
    recommendation: 'Заполнить статус в столбце AD',
    trustComponent: 'rule_compliance',
    legacyId: 'status_on_data_rows',
    sourceType: 'rule',
  },
  {
    id: 'economy_hidden',
    group: 'economy_control',
    name: 'Скрытая экономия (> 15% без AD)',
    description: 'Экономия > 15% без флага AD и без комментария — потенциально скрытые средства.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Существенная экономия без флага и комментария может указывать на неучтённые средства.',
    recommendation: 'Проверить причину экономии, при необходимости установить флаг AD',
    trustComponent: 'rule_compliance',
    sourceType: 'new',
  },

  // ================================================================
  // ГРУППА: completeness — Полнота данных
  // ================================================================
  {
    id: 'fact_without_date',
    group: 'completeness',
    name: 'Факт суммы без даты',
    description: 'Есть фактические суммы (V/W/X/Y > 0), но нет факт даты (Q).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Без даты факта невозможно корректно отнести исполнение к периоду.',
    recommendation: 'Заполнить дату факта (столбец Q) для корректного учёта',
    trustComponent: 'data_quality',
    legacyId: 'factWithoutDate',
    sourceType: 'signal',
  },
  {
    id: 'date_without_fact',
    group: 'completeness',
    name: 'Факт дата без сумм',
    description: 'Есть факт дата (Q), но нет факт сумм — неполные данные.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Дата факта указана, но суммы не заполнены — возможно, данные введены частично.',
    recommendation: 'Заполнить фактические суммы (V/W/X) или удалить некорректную дату',
    trustComponent: 'data_quality',
    legacyId: 'dateWithoutFact',
    sourceType: 'signal',
  },
  {
    id: 'single_participant',
    group: 'financial',
    name: 'Единственный участник',
    // ОТКЛЮЧЕНО 14.08.2026 (канон п.27): признак «1 участник» жил только в
    // свободном тексте комментариев, структурной колонки участников нет.
    // Запись хранит подписи исторических замечаний.
    description: 'Конкурентная процедура с одним участником — формальная конкуренция. Отключено 14.08.2026: признак выводился из текста комментариев (канон п.27).',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Единственный участник — индикатор проблемы с формированием ТЗ или ограничением конкуренции.',
    recommendation: 'Проверить условия обеспечения конкуренции',
    trustComponent: 'operational_risk',
    legacyId: 'singleParticipant',
    sourceType: 'signal',
  },

  // ================================================================
  // P1: НОВЫЕ СИГНАЛЫ (из аудита 2026-04-13)
  // ================================================================
  {
    id: 'plan_without_execution',
    group: 'temporal',
    name: 'План без исполнения',
    // П.34 интервью 14.08.2026: не выставляется на строках «не обеспечено
    // финансированием» (plan_year_missing) — первопричина главнее следствия,
    // тройное замечание по одной строке путает исполнителей.
    description: 'План существует (K > 0), но нет факта, хотя год уже идёт (апрель+). На строках, не обеспеченных финансированием, не выставляется — там первопричина в классе «Закупка, не обеспеченная финансированием» (п.34).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Закупка запланирована и бюджет выделен, но исполнение не начато. При прогрессировании года это требует внимания.',
    recommendation: 'Уточнить статус закупки: планируется ли размещение, требуется ли корректировка плана',
    trustComponent: 'operational_risk',
    legacyId: 'planWithoutExecution',
    sourceType: 'signal',
  },
  {
    id: 'ep_justification_missing',
    group: 'completeness',
    name: 'ЕП без обоснования',
    description: 'Метод закупки — ЕП (единственный поставщик), но столбец M (обоснование) пуст.',
    severity: 'significant',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'ст.93',
    kbHint: 'По 44-ФЗ (ст.93) закупка у единственного поставщика требует обоснования. Отсутствие обоснования — нарушение.',
    recommendation: 'Заполнить обоснование ЕП в столбце M с указанием пункта ст.93 44-ФЗ',
    trustComponent: 'rule_compliance',
    legacyId: 'epJustificationMissing',
    sourceType: 'signal',
  },
  {
    id: 'budget_source_missing',
    group: 'data_integrity',
    name: 'Источники бюджета не указаны',
    description: 'K (план итого) > 0, но H/I/J (ФБ/КБ/МБ план) все пусты или нули.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Плановая сумма заполнена, но разбивка по уровням бюджета (федеральный/краевой/муниципальный) отсутствует. Это затрудняет анализ источников финансирования.',
    recommendation: 'Заполнить столбцы H/I/J (ФБ/КБ/МБ план) для корректной бюджетной разбивки',
    trustComponent: 'data_quality',
    legacyId: 'budgetSourceMissing',
    sourceType: 'signal',
  },
  {
    id: 'budget_underallocation',
    group: 'data_integrity',
    name: 'Факт без планового бюджета',
    description: 'Фактические суммы (Y > 0) при отсутствии планового бюджета (K = 0).',
    severity: 'significant',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Исполнение без планового бюджета — аномалия данных. Либо план не внесён, либо закупка внеплановая.',
    recommendation: 'Проверить: внести плановые суммы или обосновать внеплановую закупку',
    trustComponent: 'data_quality',
    legacyId: 'budgetUnderallocation',
    sourceType: 'signal',
  },
];

// ────────────────────────────────────────────────────────────
// 9. АГРЕГАЦИЯ — модели для dashboard
// ────────────────────────────────────────────────────────────

/** Агрегат замечаний по группе */
