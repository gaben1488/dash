/**
 * ep-reason-clusters.ts — 15 канонических кластеров обоснования ЕП.
 *
 * Источник: AEMR_EP_REASON_DICT.md (18.04.2026).
 * Колонка M («Обоснование единственного поставщика») — основной нарратив строки ЕП.
 *
 * Статистика корпуса:
 *   3 132 строки × 33 колонки в данных (всего АЕМР на 18.04.2026)
 *   ~2 330 непустых значений M (~50 % чистоты от всех строк)
 *   ~120 поверхностных вариантов → 15 кластеров → покрытие 91 %
 *   ~213 строк в «other»-корзине (UNMAPPED + CROSS без матча)
 *
 * Связь с сигналами:
 *   EP_SMALL_EL_PURCH + L=ЕП → methodReasonMismatch (27 строк)
 *   EP_CURRENT_LAW            → unmappedReasonEP (жёлтый, 17 строк)
 *   UNMAPPED                  → unmappedReasonEP (красный, ~230 строк)
 *   EMPTY + L=ЕП              → epJustificationMissing (существующий сигнал)
 *   EP_MONOPOLIST             → whitelist для epJustificationMissing (не штрафуем)
 */

import type { LegalRefId } from './legal-refs.js';

// ────────────────────────────────────────────────────────────
// 1. Канонические ID кластеров
// ────────────────────────────────────────────────────────────

export const EP_REASON_CLUSTERS = [
  'EP_LOWEST_PRICE',      // 907 строк — основное «по наименьшей цене»
  'EP_NOT_WORTHWHILE',    // 525 строк — «нецелесообразность аукциона»
  'EP_CONCLUDE_LOWEST',   // 381 строка — «Заключение с ЕП по наименьшей цене»
  'EP_DECREE_112',        // 221 строка — «пп. 5, п.1» и другие короткие ссылки на № 112
  'EP_LOCAL_PROD',        //  46 строк — «местный производитель по поручению Губернатора»
  'EP_SMALL_EL_PURCH',    //  43 строки — «малая электронная закупка» (ПРОЦЕДУРНЫЙ МИСМАТЧ)
  'EP_MONOPOLIST',        //  43 строки — «Монополист» (ФЗ-147)
  'EP_LOWEST_COST',       //  39 строк  — «наименьшая стоимость услуг»
  'EP_ART93_SUBJECT',     //  21 строка — субъект-основание ст. 93 (СМП, пп.6/8/29)
  'EP_DECREE_112_FULL',   //  19 строк  — полная цитата Распоряжения № 112
  'EP_LOCAL_VENDOR',      //  18 строк  — «у местного производителя» (синоним EP_LOCAL_PROD)
  'EP_CURRENT_LAW',       //  17 строк  — «в соответствии с действующим законодательством»
  'EP_DECREE_112_SHORT',  //  15 строк  — «пп 1 п. 1 Распоряжения АЕМР от 03.09.25 г. №112»
  'EP_SOFTWARE_DEV',      //  12 строк  — «Разработчик ПО» (авторское право)
  'EP_ART93_DIRECT',      //  10 строк  — «п. 4 ч. 1 ст. 93» (прямая ссылка)
  // ── Триаж signal_audit 2026-07-14 §3.3: местные формулировки, ранее UNMAPPED ──
  'EP_SMALL_VOLUME',           //  17 строк — «закупка малого объёма» (п.4 ч.1 ст.93)
  'EP_SOLE_SUPPLIER_RESOURCE', //  ~17 строк — «единственный поставщик <ресурса/услуги>» без слова «монополист»
  'EP_SOLE_LOCAL_PROVIDER',    //  14 строк — «на территории ЕМР только … / только одно учреждение»
  'EP_PUBLISHER_EXCLUSIVE',    //  11 строк — издательство «Просвещение» (п.14 ч.1 ст.93)
  'EP_ROSGVARDIA',             //   7 строк — охрана ФГКУ «ОВО ВНГ России» / Росгвардия (п.6 ч.1 ст.93)
  'EP_PRESCRIPTION',           //   3 строки — «закупка по предписанию УФСБ» (надзорное предписание)
  // ── Справочник обоснований v1 (документ пользователя, 04.08.2026) ──
  'EP_OFFICIAL_DEALER',    // «Официальный дилер» — авторизованный поставщик марки
  'EP_EMERGENCY',          // «Аварийные работы» (п. 9 ч. 1 ст. 93 — авария/ЧС)
  'EP_URGENCY',            // «Для оперативной закупки», срочность
  'EP_UER_APPROVED',       // «Согласовано с УЭР» — решение принято на комиссии
  'EP_AUCTION_FAILED',     // «ЭА не состоялся» / расторжение ЭА (п. 25 ч. 1 ст. 93)
  'EP_LAW_223',            // закупка идёт по положению 223-ФЗ, не по 44-ФЗ
  'EP_LOGISTICS',          // расположение поставщика, оптимизация сроков и затрат
  'EP_NO_BIDDERS',         // «поставщики на ЭА не выходят» — рынок не отзывается
  'EP_LIMITED_MARKET',     // подрядчиков в ограниченном количестве / один исполнитель
  // ── Разбор остатка живых формулировок (04.08.2026) ──
  'EP_QUOTES_LOWEST',      // цена по коммерческим предложениям оказалась ниже
  'EP_NAMED_SOLE',         // назван конкретный безальтернативный поставщик
  'EP_MIXED_NOMENCLATURE', // разнородная номенклатура: в один аукцион не собрать
  'EP_NONCOMPETITIVE',     // «неконкурентная закупка» — констатация без причины
] as const;

export type EpReasonCluster = typeof EP_REASON_CLUSTERS[number];

// ────────────────────────────────────────────────────────────
// 2. Интерфейс записи кластера
// ────────────────────────────────────────────────────────────

export interface EpReasonEntry {
  cluster: EpReasonCluster;
  /** Русское ярлыковое название (для UI и KB-tooltip) */
  label_ru: string;
  /**
   * Правовые основания (из legal-refs.ts).
   * Порядок: от более специфичного к более общему.
   */
  legal_refs: LegalRefId[];
  /**
   * Регулярные выражения в порядке приоритета.
   * Первое совпадение побеждает.
   * Regex проверяется на normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ').
   */
  regex: RegExp[];
  /**
   * Признак легитимного обоснования ЕП.
   * false = обоснование либо ошибочное, либо процедурный мисматч.
   */
  is_legitimate: boolean;
  /**
   * Только для EP_SMALL_EL_PURCH.
   * «Малая электронная закупка» — это ПРОЦЕДУРА (форма ЭА ≤ 600 тыс.),
   * а не обоснование ЕП. Строки с L=ЕП + M=EP_SMALL_EL_PURCH → сигнал methodReasonMismatch.
   */
  is_procedural_mismatch?: true;
  /**
   * Примерное число строк в датасете (снимок 18.04.2026).
   * Обновляется при пересчёте pipeline.
   */
  approx_count: number;
  /**
   * Порог, при пересечении которого watchdog генерирует предупреждение.
   * Undefined = без порога.
   */
  watchdog_threshold?: number;
}

// ────────────────────────────────────────────────────────────
// 3. Словарь кластеров
// ────────────────────────────────────────────────────────────

export const EP_REASON_DICT: Record<EpReasonCluster, EpReasonEntry> = {

  EP_LOWEST_PRICE: {
    cluster: 'EP_LOWEST_PRICE',
    label_ru: 'Закупка с ЕП по наименьшей цене',
    legal_refs: ['AEMR_112_1', '44_FZ_93_1_4'],
    regex: [
      /закупка\s+(?:с|у)\s+еп\s+предусматривает\s+заключение\s+по\s+наи[мм]ень?шей\s+цене/i,
      /закупка\s+(?:с|у)\s+еп.*наи[мм]ень?шей\s+цене/i,
      // «Закупка ЕП по наименьшей цене» — без предлога (живой лист, 2 строки)
      /закупка\s+еп\s+по\s+наи[мм]ень?шей\s+цене/i,
    ],
    is_legitimate: true,
    approx_count: 907,
  },

  EP_NOT_WORTHWHILE: {
    cluster: 'EP_NOT_WORTHWHILE',
    label_ru: 'Нецелесообразность аукциона',
    legal_refs: ['AEMR_112_5'],
    regex: [
      // Основа слова, а не перечень опечаток: ловит «нецелесообразность» (правильное
      // написание, 552 строки в проде), «нецелесобразность»/«нецелеобразность» (опечатки),
      // и прилагательно-наречные формы («нецелесообразно», «нецелесообразный»).
      /нецелес?о{1,2}бразн/i,
    ],
    is_legitimate: true,  // административно признано АЕМР, но не совпадает со ст. 93
    approx_count: 525,
    watchdog_threshold: 600,  // предупреждение если кластер пересечёт 600 строк
  },

  EP_CONCLUDE_LOWEST: {
    cluster: 'EP_CONCLUDE_LOWEST',
    label_ru: 'Заключение с ЕП по наименьшей цене',
    legal_refs: ['AEMR_112_1', '44_FZ_93_1_4'],
    regex: [
      /заключени[ея]\s+(?:с|у)\s+еп\s+по\s+наи[мм]ень?шей\s+цене/i,
      /заключени[ея]\s+(?:с|у)\s+еп.*(?:отсутстви[еи]\s+конкурентов|наи[мм]ень?шей)/i,
    ],
    is_legitimate: true,
    approx_count: 381,
  },

  EP_DECREE_112: {
    cluster: 'EP_DECREE_112',
    label_ru: 'Распоряжение АЕМР № 112 (краткая ссылка)',
    legal_refs: ['AEMR_112', 'AEMR_112_1', 'AEMR_112_5', 'AEMR_112_8', 'AEMR_112_11'],
    regex: [
      /распоряжени[ея]\s+а[ея]мр?[\s\S]{0,40}№?\s*112/i,
      // FP-fix 2026-07-17 (signal_audit §3.3): полная форма «Распоряжение Администрации ЕМР…»
      // — не слитно «АЕМР»; между «ЕМР» и «№ 112» бывает «КК от 03.09.2025».
      /распоряжени[еяю]\s+администрации\s+емр[\s\S]{0,40}№?\s*112/i,
      /пп\.?\s*(?:1|5|8|11)\s*,?\s*п\.?\s*1/i, // FP-fix 2026-06-05: убран \b (не работает с кириллицей в JS)
    ],
    is_legitimate: true,
    approx_count: 221,
  },

  EP_LOCAL_PROD: {
    cluster: 'EP_LOCAL_PROD',
    label_ru: 'Местный производитель по поручению Губернатора',
    legal_refs: ['GUBERNATOR_CAMCHATKA', '44_FZ_93_1_29'],
    regex: [
      /по\s+поручению\s+губернатор/i,
      /местн(?:ого|ый|ые)\s+производител/i,
    ],
    is_legitimate: true,
    approx_count: 46,
  },

  EP_SMALL_EL_PURCH: {
    cluster: 'EP_SMALL_EL_PURCH',
    label_ru: 'Малая электронная закупка (процедурный мисматч)',
    legal_refs: ['44_FZ_93_1_4'],
    regex: [
      // Малая электронная закупка = ч. 12 ст. 93 (формулировка справочника v1)
      /ч\.?\s*12\s*ст\.?\s*93/i,
      /мал(?:ая|ые)\s+электронн(?:ая|ые)\s+закупк[иа]/i,
    ],
    is_legitimate: false,
    is_procedural_mismatch: true,
    approx_count: 43,
  },

  EP_MONOPOLIST: {
    cluster: 'EP_MONOPOLIST',
    label_ru: 'Естественный монополист',
    legal_refs: ['44_FZ_93_1_1', '44_FZ_93_1_8', '147_FZ'],
    regex: [
      /монополист/i, // FP-fix 2026-06-05: \b (word-boundary) не матчит кириллицу в JS без флага u → был баг (монополист → UNMAPPED)
    ],
    is_legitimate: true,
    approx_count: 43,
  },

  EP_LOWEST_COST: {
    cluster: 'EP_LOWEST_COST',
    label_ru: 'Наименьшая стоимость услуг',
    legal_refs: ['AEMR_112_1'],
    regex: [
      /наи[мм]ень?шая\s+стоимость\s+оказания\s+услуг/i,
    ],
    is_legitimate: true,
    approx_count: 39,
  },

  EP_ART93_SUBJECT: {
    cluster: 'EP_ART93_SUBJECT',
    label_ru: 'Субъект-основание ст. 93 44-ФЗ',
    legal_refs: ['44_FZ_93_1_6', '44_FZ_93_1_8', '44_FZ_93_1_29'],
    regex: [
      /п\.?\s*(?:6|8|29)\s*[,.]?\s*ч\.?\s*1\s*[,.]?\s*ст\.?\s*93/i,
      /относятся\s+к\s+сфере\s+деятельности\s+субъектов/i,
    ],
    is_legitimate: true,
    approx_count: 21,
  },

  EP_DECREE_112_FULL: {
    cluster: 'EP_DECREE_112_FULL',
    label_ru: 'Полная цитата Распоряжения № 112',
    legal_refs: ['AEMR_112', 'AEMR_112_1'],
    regex: [
      /распоряжени[ея]\s+а[ея]мр\s+кк\s+№\s*112\s+от/i,
    ],
    is_legitimate: true,
    approx_count: 19,
  },

  EP_LOCAL_VENDOR: {
    cluster: 'EP_LOCAL_VENDOR',
    label_ru: 'Закупка у местного производителя',
    legal_refs: ['GUBERNATOR_CAMCHATKA'],
    regex: [
      /закупка\s+(?:с|у)\s+местн(?:ым|ого)\s+производител/i,
      /у\s+местного\s+производителя/i,
    ],
    is_legitimate: true,
    approx_count: 18,
  },

  EP_CURRENT_LAW: {
    cluster: 'EP_CURRENT_LAW',
    label_ru: 'В соответствии с действующим законодательством',
    legal_refs: [],
    regex: [
      /в\s+соответствии\s+с\s+действующим\s+законодательством/i,
    ],
    is_legitimate: false,  // мусорная формулировка без конкретной ссылки
    approx_count: 17,
  },

  EP_DECREE_112_SHORT: {
    cluster: 'EP_DECREE_112_SHORT',
    label_ru: 'Сокращённая ссылка на Распоряжение № 112',
    legal_refs: ['AEMR_112', 'AEMR_112_1'],
    regex: [
      /пп\s*1\s+п\.?\s*1\s+распоряжени/i,
    ],
    is_legitimate: true,
    approx_count: 15,
  },

  EP_SOFTWARE_DEV: {
    cluster: 'EP_SOFTWARE_DEV',
    label_ru: 'Разработчик программного обеспечения',
    legal_refs: ['44_FZ_93_1_1'],
    regex: [
      /разработчик\s+п(?:рограммного\s+)?о(?:беспечения)?/i,
    ],
    is_legitimate: true,
    approx_count: 12,
  },

  EP_ART93_DIRECT: {
    cluster: 'EP_ART93_DIRECT',
    label_ru: 'Прямая ссылка на ст. 93 44-ФЗ',
    legal_refs: ['44_FZ_93_1_1', '44_FZ_93_1_4', '44_FZ_93_1_6', '44_FZ_93_1_8', '44_FZ_93_1_23', '44_FZ_93_1_29'],
    regex: [
      /п\.?\s*(\d+)\s*[,.]?\s*ч\.?\s*1\s*[,.]?\s*ст\.?\s*93/i,
    ],
    is_legitimate: true,
    approx_count: 10,
  },

  // ── Триаж signal_audit 2026-07-14 §3.3: новые кластеры под реальные формулировки ──
  // Частотка — из дампа scripts/signal_audit_rows_2026-07-15.md (~70 ложных unmappedReasonEP).

  EP_SMALL_VOLUME: {
    cluster: 'EP_SMALL_VOLUME',
    label_ru: 'Закупка малого объёма (п. 4 ч. 1 ст. 93)',
    legal_refs: ['44_FZ_93_1_4'],
    regex: [
      // «закупка малого объема» (2) + «закупку разного назначения в малом обьеме» (15,
      // с опечаткой «обьем» через мягкий знак). Не пересекается с «малой электронной
      // закупкой» (EP_SMALL_EL_PURCH — процедура, проверяется раньше по порядку).
      /мал(?:ый|ого|ом)\s+об[ъь]?[её]м/i,
    ],
    is_legitimate: true,
    approx_count: 17,
  },

  EP_SOLE_SUPPLIER_RESOURCE: {
    cluster: 'EP_SOLE_SUPPLIER_RESOURCE',
    label_ru: 'Единственный поставщик ресурса/услуги',
    legal_refs: ['44_FZ_93_1_8', '44_FZ_93_1_1'],
    regex: [
      // «единственный поставщик тепловой энергии / электроэнергии / холодного
      // водоснабжения / по услугам местной связи / оказания услуг / предоставления услуги».
      // Строки со словом «монополист» перехватывает EP_MONOPOLIST (идёт раньше).
      // [а-яё] вместо \w: в JS \w и \b не матчат кириллицу (FP-fix 2026-06-05).
      /единственн[а-яё]+\s+поставщик/i,
      // Региональный оператор ТКО — в whitelist signals.ts был, в словаре отсутствовал.
      /региональн[а-яё]+\s+оператор[а-яё]*\s+по\s+обращению\s+с\s+тко/i,
    ],
    is_legitimate: true,
    approx_count: 17,
  },

  EP_SOLE_LOCAL_PROVIDER: {
    cluster: 'EP_SOLE_LOCAL_PROVIDER',
    label_ru: 'Единственный исполнитель на территории',
    legal_refs: [],
    regex: [
      // «На территории ЕМР только ССМП/ФБУЗ "Центр гигиены" оказывает данную услугу» (4+4)
      /на\s+территории\s+емр\s+только/i,
      // «в Камчатском крае госэкспертизу проводит только одно учреждение» (6)
      /только\s+одно\s+учреждение/i,
    ],
    is_legitimate: true,
    approx_count: 14,
  },

  EP_PUBLISHER_EXCLUSIVE: {
    cluster: 'EP_PUBLISHER_EXCLUSIVE',
    label_ru: 'Издатель с исключительными правами (п. 14 ч. 1 ст. 93)',
    legal_refs: ['44_FZ_93_1_14'],
    regex: [
      // «заключение контракта с издательством Просвещение» (11) — единственный
      // обладатель исключительных прав на учебники.
      /издательств[а-яё]*\s+[«"']?\s*просвещение/i,
      /единственн[а-яё]+\s+издател/i,
    ],
    is_legitimate: true,
    approx_count: 11,
  },

  EP_ROSGVARDIA: {
    cluster: 'EP_ROSGVARDIA',
    label_ru: 'Охрана Росгвардией / вневедомственной охраной (п. 6 ч. 1 ст. 93)',
    legal_refs: ['44_FZ_93_1_6'],
    regex: [
      // «Обязанность заключать контракты с ФГКУ "ОВО ВНГ России по Камчатскому краю"» (7)
      /ово\s+внг/i,
      /росгвард/i,
      /вневедомственн[а-яё]+\s+охран/i,
    ],
    is_legitimate: true,
    approx_count: 7,
  },

  // ── Справочник обоснований v1 (документ пользователя 04.08.2026) ──
  // Формулировки взяты дословно из документа и из живых листов; ни одна
  // не выдумана. Легитимность проставлена по 44-ФЗ: где закон прямо даёт
  // основание (авария, несостоявшийся аукцион, дилер) — true; где это
  // управленческое удобство (срочность, логистика, «согласовано с УЭР») —
  // false: такие строки должны попадать под разбор, а не в тень.

  EP_OFFICIAL_DEALER: {
    cluster: 'EP_OFFICIAL_DEALER',
    label_ru: 'Официальный дилер марки',
    legal_refs: ['44_FZ_93_1_8'],
    regex: [
      /официальн[а-яё]*\s+дил+ер/i,
      /авторизованн[а-яё]*\s+(?:дилер|сервис|поставщик)/i,
    ],
    is_legitimate: true,
    approx_count: 0,
  },

  EP_EMERGENCY: {
    cluster: 'EP_EMERGENCY',
    label_ru: 'Аварийные работы, устранение последствий',
    legal_refs: ['44_FZ_93_1_9'],
    regex: [
      /аварийн[а-яё]*\s+(?:работ|ситуац|восстановл|ремонт)/i,
      /устранени[а-яё]*\s+аварии/i,
      /чрезвычайн[а-яё]*\s+ситуац/i,
    ],
    is_legitimate: true,
    approx_count: 0,
  },

  EP_URGENCY: {
    cluster: 'EP_URGENCY',
    label_ru: 'Срочность закупки',
    legal_refs: [],
    regex: [
      /для\s+оперативн[а-яё]*\s+(?:закупк|покупк)/i,
      /оперативност[а-яё]*\s+проведени/i,
      /(?:срочн|безотлагательн|быстр)[а-яё]*\s+(?:потребност|необходимост|закупк|приобретен|оформ)/i,
      /требующ[а-яё]*\s+быстрой\s+закупк/i,
      /срочн[а-яё]*\s+закупк/i,
      /закупк[а-яё]*[,\s]+срочн/i,
      /в\s+сжат[а-яё]*\s+срок/i,
    ],
    // Срочность сама по себе основанием ст. 93 не является: это управленческое
    // объяснение, и оно должно оставаться видимым для разбора.
    is_legitimate: false,
    approx_count: 0,
  },

  EP_UER_APPROVED: {
    cluster: 'EP_UER_APPROVED',
    label_ru: 'Согласовано с УЭР',
    legal_refs: ['AEMR_112_1'],
    regex: [
      /согласован[а-яё]*\s+с\s+(?:уэр|управлением|первым\s+зам)/i,
      /обоснование\s+целесообразн[а-яё]*.*уэр/i,
    ],
    is_legitimate: true,
    approx_count: 0,
  },

  EP_AUCTION_FAILED: {
    cluster: 'EP_AUCTION_FAILED',
    label_ru: 'Аукцион не состоялся либо расторгнут',
    legal_refs: ['44_FZ_93_1_25'],
    regex: [
      /(?:эа|аукцион|процедура)\s+не\s+состо/i,
      /не\s+состо[а-яё]*\s+(?:эа|аукцион)/i,
      /расторжени[а-яё]*\s+(?:эа|аукцион|контракт)/i,
      /(?:не\s+подано|подано\s+0|отсутстви[а-яё]*)\s+заявок/i,
      /расторжени[а-яё]*\s+эа/i,
    ],
    is_legitimate: true,
    approx_count: 0,
  },

  EP_LAW_223: {
    cluster: 'EP_LAW_223',
    label_ru: 'Закупка по 223-ФЗ (вне периметра 44-ФЗ)',
    legal_refs: [],
    regex: [
      /223[\s-]*фз/i,
      /по\s+положению\s+о?\s*закупк/i,
      /по\s+положению\s+-?\s*фз/i,
      /положени[а-яё]*\s+о\s+закупках/i,
    ],
    // Строка живёт в листе 44-ФЗ, а закупка идёт по другому закону — это не
    // обоснование выбора ЕП, а иной периметр; помечаем, чтобы было видно.
    is_legitimate: false,
    approx_count: 0,
  },

  EP_LOGISTICS: {
    cluster: 'EP_LOGISTICS',
    label_ru: 'Расположение поставщика, сроки и затраты',
    legal_refs: [],
    regex: [
      /оптимизаци[а-яё]*\s+срок[а-яё]*\s+и\s+затрат/i,
      /удобн[а-яё]*\s+расположени[а-яё]*\s+поставщик/i,
      /расположени[а-яё]*\s+организаци/i,
    ],
    is_legitimate: false,
    approx_count: 0,
  },

  EP_NO_BIDDERS: {
    cluster: 'EP_NO_BIDDERS',
    label_ru: 'Поставщики на конкурентные процедуры не выходят',
    legal_refs: [],
    regex: [
      /(?:поставщик|участник)[а-яё]*\s+(?:на\s+)?(?:процедур[а-яё]*\s+)?эа\s+не\s+выход/i,
      /никто\s+не\s+(?:выход|подаёт|подает)/i,
    ],
    is_legitimate: false,
    approx_count: 0,
  },

  EP_LIMITED_MARKET: {
    cluster: 'EP_LIMITED_MARKET',
    label_ru: 'Ограниченный круг исполнителей',
    legal_refs: [],
    regex: [
      /подрядчик[а-яё]*\s+в\s+о[гр]ранич[а-яё]*\s+количеств/i,
      /(?:лишь|только)\s+один\s+(?:исполнитель|поставщик|подрядчик)/i,
      /один\s+исполнитель\s+(?:предоставляет|оказывает)/i,
      /ограничен[а-яё]*\s+(?:круг|количеств)[а-яё]*\s+(?:исполнител|поставщик|подрядчик)/i,
    ],
    is_legitimate: true,
    approx_count: 0,
  },

  EP_QUOTES_LOWEST: {
    cluster: 'EP_QUOTES_LOWEST',
    label_ru: 'Коммерческие предложения дали цену ниже',
    legal_refs: ['AEMR_112_1'],
    regex: [
      /коммерческ[а-яё]*\s+предложени[а-яё]*.*(?:ниже|низк)/i,
      /(?:ниже|низк)[а-яё]*\s+цену?.*коммерческ/i,
      /по\s+коммерческим\s+предложениям\s+сама[яю]\s+низка[яю]/i,
    ],
    is_legitimate: true,
    approx_count: 5,
  },

  EP_NAMED_SOLE: {
    cluster: 'EP_NAMED_SOLE',
    label_ru: 'Назван безальтернативный поставщик',
    legal_refs: ['44_FZ_93_1_1', '147_FZ'],
    regex: [
      /(?:почт[аеы]\s+россии|ростелеком|водоканал|камчатскэнерго|нефтепродукт)/i,
      /региональн[а-яё]*\s+оператор/i,
      /(?:фгуп|фбуз|фгку|гкп|мку)\s*["«]?[a-zа-яё]/i,
      /(?:находится|оказывается|предоставляет)\s+(?:только|лишь)/i,
      /единственн[а-яё]*\s+возможн[а-яё]*\s+поставщик/i,
    ],
    is_legitimate: true,
    approx_count: 12,
  },

  EP_MIXED_NOMENCLATURE: {
    cluster: 'EP_MIXED_NOMENCLATURE',
    label_ru: 'Разнородная номенклатура: в один аукцион не собрать',
    legal_refs: ['AEMR_112_5'],
    regex: [
      /разноплановог?[а-яё]*\s+товар/i,
      /разное\s+окпд/i,
      /объ[еи]дин[а-яё]*\s+в\s+(?:несколько\s+)?аукцион[а-яё]*\s+не\s+получ/i,
      /разного\s+назначени[а-яё]*\s+в\s+мал/i,
    ],
    is_legitimate: true,
    approx_count: 6,
  },

  EP_NONCOMPETITIVE: {
    cluster: 'EP_NONCOMPETITIVE',
    label_ru: 'Указано «неконкурентная закупка» — причина не названа',
    legal_refs: [],
    regex: [
      /^неконкурентн[а-яё]*\s+закупк/i,
    ],
    // Это не обоснование, а повтор способа: строка обязана попадать в разбор.
    is_legitimate: false,
    approx_count: 6,
  },

  EP_PRESCRIPTION: {
    cluster: 'EP_PRESCRIPTION',
    label_ru: 'Закупка по предписанию надзорного органа',
    legal_refs: [],
    regex: [
      // «закупка по предписанию УФСБ.» (3) — обязательная по предписанию.
      /по\s+предписани[юя]/i,
    ],
    is_legitimate: true,
    approx_count: 3,
  },
};

// ────────────────────────────────────────────────────────────
// 4. Функция канонизации
// ────────────────────────────────────────────────────────────

export type CanonicalizeResult =
  | { cluster: EpReasonCluster; matched_pattern: string }
  | { cluster: 'UNMAPPED' }
  | { cluster: 'EMPTY' };

/**
 * Приводит сырое значение колонки M к каноническому кластеру.
 *
 * Порядок проверки важен: EP_DECREE_112 проверяется до EP_LOWEST_PRICE,
 * т.к. в полной цитате Распоряжения может встречаться слово «цена».
 *
 * Fuzzy fallback (Levenshtein ≤ 2) намеренно отключён во всех кластерах,
 * кроме EP_NOT_WORTHWHILE («нецелеобразность») — слишком высокий риск
 * ложных срабатываний при коротких regex.
 */
export function canonicalizeReasonEp(raw: unknown): CanonicalizeResult {
  if (raw === null || raw === undefined || raw === '') {
    return { cluster: 'EMPTY' };
  }
  if (typeof raw !== 'string') return { cluster: 'UNMAPPED' };

  const cleaned = raw.trim();
  // Пустые маркеры (x, х, —, -, –)
  if (/^[xхXХ—\-–]$/.test(cleaned)) return { cluster: 'EMPTY' };

  const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');

  for (const cluster of EP_REASON_CLUSTERS) {
    const entry = EP_REASON_DICT[cluster];
    for (const re of entry.regex) {
      if (re.test(normalized)) {
        return { cluster, matched_pattern: re.source };
      }
    }
  }

  return { cluster: 'UNMAPPED' };
}

/** Является ли кластер сигналом process mismatch (L=ЕП + EP_SMALL_EL_PURCH) */
export function isProceduralMismatch(cluster: EpReasonCluster): boolean {
  return EP_REASON_DICT[cluster].is_procedural_mismatch === true;
}

/** Является ли обоснование легитимным по мнению методолога */
export function isLegitimateReason(cluster: EpReasonCluster): boolean {
  return EP_REASON_DICT[cluster].is_legitimate;
}
