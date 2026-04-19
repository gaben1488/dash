/**
 * legal-refs.ts — Канонический реестр правовых ссылок АЕМР.
 *
 * Источник: AEMR_LEGAL_REFS.md (18.04.2026), α-агент D1 Discovery Swarm.
 * Девять правовых привязок, покрывающих 91 % случаев обоснования ЕП
 * и смежных сигналов в данных АЕМР (3 132 строки на 18.04.2026).
 *
 * Включает подпункты АЕМР № 112 (1, 5, 8, 11) как самостоятельные ID,
 * чтобы UI-tooltip показывал конкретный подпункт, а не только номер акта.
 *
 * Использование:
 *   - EP_REASON_DICT[cluster].legal_refs → LegalRefId[]
 *   - parseLegalRef(raw) → LegalRefId[] (нормализация из текстовых вариантов)
 *   - LEGAL_REFS[id].official_url → ссылка для KB-tooltip «Источник»
 */

// ────────────────────────────────────────────────────────────
// 1. Тип ID правовой ссылки
// ────────────────────────────────────────────────────────────

export type LegalRefId =
  // 44-ФЗ «О контрактной системе в сфере закупок»
  | '44_FZ_93_1_1'
  | '44_FZ_93_1_4'
  | '44_FZ_93_1_6'
  | '44_FZ_93_1_8'
  | '44_FZ_93_1_23'
  | '44_FZ_93_1_29'
  // 147-ФЗ «О естественных монополиях»
  | '147_FZ'
  // Распоряжение АЕМР КК № 112 от 03.09.2025 и его подпункты
  | 'AEMR_112'
  | 'AEMR_112_1'
  | 'AEMR_112_5'
  | 'AEMR_112_8'
  | 'AEMR_112_11'
  // Поручение Губернатора Камчатского края
  | 'GUBERNATOR_CAMCHATKA';

// ────────────────────────────────────────────────────────────
// 2. Интерфейс записи
// ────────────────────────────────────────────────────────────

export interface LegalReference {
  id: LegalRefId;
  /** Тип правового акта */
  law_type: 'federal' | 'federal_special' | 'regional_decree' | 'instruction';
  /** Краткое официальное обозначение закона/акта */
  law_short: string;
  /** Номер статьи (только для 44-ФЗ и 147-ФЗ) */
  article?: string;
  /** Номер части статьи */
  part?: number;
  /** Номер пункта части */
  item?: number;
  /** Номер подпункта (для АЕМР № 112 пп.1/5/8/11) */
  subitem?: number;
  /** Дата принятия (ISO YYYY-MM-DD) */
  date_adopted: string;
  /** Полное официальное название на русском */
  title_ru: string;
  /** Орган, издавший акт */
  issuer: string;
  /**
   * Связанные правовые ссылки (ссылки друг на друга).
   * Например, 44_FZ_93_1_8 ↔ 147_FZ.
   */
  linked?: LegalRefId[];
  /** Официальный URL (pravo.gov.ru или локальный портал АЕМР) */
  official_url?: string;
  /**
   * Счётчик использования в текущем датасете.
   * Обновляется pipeline'ом при пересчёте.
   * Используется в KB-tooltip: «применено в X строках».
   */
  count_in_data?: number;
}

// ────────────────────────────────────────────────────────────
// 3. Реестр правовых ссылок
// ────────────────────────────────────────────────────────────

export const LEGAL_REFS: Record<LegalRefId, LegalReference> = {

  '44_FZ_93_1_1': {
    id: '44_FZ_93_1_1',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 1,
    date_adopted: '2013-04-05',
    title_ru: 'Осуществление закупки у единственного поставщика — п. 1 (в силу закона, монополисты)',
    issuer: 'Федеральное собрание РФ',
    linked: ['147_FZ'],
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '44_FZ_93_1_4': {
    id: '44_FZ_93_1_4',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 4,
    date_adopted: '2013-04-05',
    title_ru: 'ЕП на сумму не более 600 тыс. руб. (малый объём)',
    issuer: 'Федеральное собрание РФ',
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '44_FZ_93_1_6': {
    id: '44_FZ_93_1_6',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 6,
    date_adopted: '2013-04-05',
    title_ru: 'ЕП для субъектов малого предпринимательства (СМП)',
    issuer: 'Федеральное собрание РФ',
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '44_FZ_93_1_8': {
    id: '44_FZ_93_1_8',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 8,
    date_adopted: '2013-04-05',
    title_ru: 'ЕП в сфере деятельности субъектов естественных монополий',
    issuer: 'Федеральное собрание РФ',
    linked: ['147_FZ'],
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '44_FZ_93_1_23': {
    id: '44_FZ_93_1_23',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 23,
    date_adopted: '2013-04-05',
    title_ru: 'ЕП по содержанию и ремонту недвижимости',
    issuer: 'Федеральное собрание РФ',
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '44_FZ_93_1_29': {
    id: '44_FZ_93_1_29',
    law_type: 'federal',
    law_short: '44-ФЗ',
    article: '93', part: 1, item: 29,
    date_adopted: '2013-04-05',
    title_ru: 'ЕП у оптовых поставщиков для субъектов малого предпринимательства',
    issuer: 'Федеральное собрание РФ',
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102168247',
  },

  '147_FZ': {
    id: '147_FZ',
    law_type: 'federal_special',
    law_short: '147-ФЗ',
    date_adopted: '1995-08-17',
    title_ru: 'О естественных монополиях',
    issuer: 'Федеральное собрание РФ',
    official_url: 'http://pravo.gov.ru/proxy/ips/?docbody=&nd=102039777',
  },

  'AEMR_112': {
    id: 'AEMR_112',
    law_type: 'regional_decree',
    law_short: 'Распоряжение АЕМР КК № 112',
    date_adopted: '2025-09-03',
    title_ru: 'Об основаниях и порядке осуществления закупок у единственного поставщика в АЕМР',
    issuer: 'Администрация Елизовского муниципального района Камчатского края',
    // TODO: добавить официальный URL при получении от АЕМР
  },

  'AEMR_112_1': {
    id: 'AEMR_112_1',
    law_type: 'regional_decree',
    law_short: 'Распоряжение АЕМР КК № 112 пп. 1',
    date_adopted: '2025-09-03',
    part: 1, subitem: 1,
    title_ru: 'Закупка у единственного поставщика по наименьшей цене (подпункт 1)',
    issuer: 'Администрация Елизовского муниципального района Камчатского края',
    linked: ['AEMR_112'],
  },

  'AEMR_112_5': {
    id: 'AEMR_112_5',
    law_type: 'regional_decree',
    law_short: 'Распоряжение АЕМР КК № 112 пп. 5',
    date_adopted: '2025-09-03',
    part: 1, subitem: 5,
    title_ru: 'Нецелесообразность проведения аукциона (подпункт 5)',
    issuer: 'Администрация Елизовского муниципального района Камчатского края',
    linked: ['AEMR_112'],
  },

  'AEMR_112_8': {
    id: 'AEMR_112_8',
    law_type: 'regional_decree',
    law_short: 'Распоряжение АЕМР КК № 112 пп. 8',
    date_adopted: '2025-09-03',
    part: 1, subitem: 8,
    title_ru: 'Подпункт 8 ч. 1 Распоряжения АЕМР № 112',
    issuer: 'Администрация Елизовского муниципального района Камчатского края',
    linked: ['AEMR_112'],
  },

  'AEMR_112_11': {
    id: 'AEMR_112_11',
    law_type: 'regional_decree',
    law_short: 'Распоряжение АЕМР КК № 112 пп. 11',
    date_adopted: '2025-09-03',
    part: 1, subitem: 11,
    title_ru: 'Подпункт 11 ч. 1 Распоряжения АЕМР № 112',
    issuer: 'Администрация Елизовского муниципального района Камчатского края',
    linked: ['AEMR_112'],
  },

  'GUBERNATOR_CAMCHATKA': {
    id: 'GUBERNATOR_CAMCHATKA',
    law_type: 'instruction',
    law_short: 'Поручение Губернатора КК',
    date_adopted: '2024-01-01',   // обобщённо; в данных конкретная дата не указывается
    title_ru: 'Поручение Губернатора Камчатского края по поддержке местных производителей',
    issuer: 'Губернатор Камчатского края',
    // TODO: уточнить реквизиты поручения у методолога АЕМР
  },
};

// ────────────────────────────────────────────────────────────
// 4. Парсер текстовых вариантов → LegalRefId[]
// ────────────────────────────────────────────────────────────

/**
 * Извлекает правовые ссылки из произвольного текста (колонки M или AE).
 * Возвращает массив (одна ячейка может содержать несколько ссылок).
 *
 * Пример: «Монополист согласно 44-ФЗ ст. 93 ч. 1 п. 8 + ФЗ-147»
 *   → ['44_FZ_93_1_8', '147_FZ']
 */
export function parseLegalRef(raw: string): LegalRefId[] {
  const results: LegalRefId[] = [];
  const s = raw.trim().replace(/\s+/g, ' ');

  // 44-ФЗ ст. 93 ч. 1 п. X
  const fz44 = /п\.?\s*(\d+)\s*[,.]?\s*ч\.?\s*1\s*[,.]?\s*ст\.?\s*93/gi;
  for (const m of s.matchAll(fz44)) {
    const item = Number(m[1]);
    const id = `44_FZ_93_1_${item}` as LegalRefId;
    if (id in LEGAL_REFS) results.push(id);
  }

  // Распоряжение АЕМР № 112
  if (/распоряжени[ея]\s+а[ея]мр?[\s\S]{0,40}№?\s*112/i.test(s)) {
    results.push('AEMR_112');
    const subitem = /пп\.?\s*(1|5|8|11)\s*,?\s*п\.?\s*1/.exec(s);
    if (subitem) {
      const id = `AEMR_112_${subitem[1]}` as LegalRefId;
      if (id in LEGAL_REFS) results.push(id);
    }
  } else {
    // Краткая форма «пп. X, п. 1» без слова «Распоряжение» — тоже ссылка на № 112
    const short = /\bпп\.?\s*(1|5|8|11)\s*,?\s*п\.?\s*1\b/i.exec(s);
    if (short) {
      results.push('AEMR_112');
      const id = `AEMR_112_${short[1]}` as LegalRefId;
      if (id in LEGAL_REFS) results.push(id);
    }
  }

  // 147-ФЗ
  if (/147-?фз|\bестественн(?:ых|ые)\s+монопол/i.test(s)) {
    results.push('147_FZ');
  }

  // Поручение Губернатора
  if (/по\s+поручению\s+губернатор/i.test(s) || /местн[ыо](?:ого|ый)\s+производител/i.test(s)) {
    results.push('GUBERNATOR_CAMCHATKA');
  }

  return [...new Set(results)];
}

/** Получить запись правовой ссылки по ID */
export function getLegalRef(id: LegalRefId): LegalReference {
  return LEGAL_REFS[id];
}

/** Является ли ссылка федеральным законом */
export function isFederalRef(id: LegalRefId): boolean {
  return LEGAL_REFS[id].law_type === 'federal' || LEGAL_REFS[id].law_type === 'federal_special';
}
