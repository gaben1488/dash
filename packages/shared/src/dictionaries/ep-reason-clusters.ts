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
