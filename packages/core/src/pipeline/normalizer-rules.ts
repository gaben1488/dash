/**
 * Движок нормализации входных данных.
 *
 * Обрабатывает "грязные" данные из Google Sheets:
 * - Суммы в разных форматах ("1 250 000", "1,25 млн")
 * - Даты ("15.03.26", "2026-03-15", "15 марта")
 * - Статусы с опечатками ("подписанн" → "подписан")
 * - Предметы закупок (группировка синонимов)
 * - Пустые значения ("", "-", "н/д")
 *
 * Каждая нормализация сохраняет: originalValue + normalizedValue + ruleApplied
 */

export interface NormalizationResult {
  /** Исходное значение */
  original: unknown;
  /** Нормализованное значение */
  normalized: unknown;
  /** Было ли значение изменено */
  changed: boolean;
  /** Какое правило применено */
  rule: string | null;
  /** Тип поля */
  fieldType: FieldType;
}

export type FieldType = 'money' | 'date' | 'status' | 'number' | 'percent' | 'text' | 'empty' | 'unknown';

/**
 * Словарь нормализации статусов.
 * Ключ — нормализованная форма, значения — варианты написания.
 */
const STATUS_DICTIONARY: Record<string, string[]> = {
  'подписан': ['подписан', 'подписанн', 'подпис', 'заключен', 'заключён', 'исполнен', 'исполненн', 'контракт заключен', 'контракт подписан'],
  'планируется': ['планируется', 'планир', 'планир.', 'в планах', 'подготовка', 'подготов', 'разработка', 'разработ', 'разрабат', 'в разработке'],
  'срок не наступил': ['срок не наступил', 'не наступил', 'срок не настал'],
  'отменена': ['отменена', 'отменён', 'отмен', 'не требуется', 'снята', 'снят', 'исключена', 'исключен', 'аннулирована'],
  'в процессе': ['в процессе', 'выполняется', 'на исполнении', 'в работе', 'идет исполнение'],
  'завершена': ['завершена', 'завершён', 'выполнена', 'выполнен', 'закрыта', 'закрыт'],
  'приостановлена': ['приостановлена', 'приостановлен', 'на паузе', 'заморожена'],
};

/**
 * Словарь нормализации причин/обоснований.
 */
const REASON_TEMPLATES: Record<string, string[]> = {
  'отсутствие предложений': ['нет предложений', 'отсутствие предложений', 'не поступило предложений', 'заявки не поступили'],
  'недостаточное финансирование': ['недостаточно средств', 'нет финансирования', 'недостаток финансир', 'отсутствие финансир'],
  'перенос финансирования': ['перенос финансир', 'финансирование перенесено', 'средства перенесены'],
  'изменение потребности': ['изменение потребности', 'потребность отпала', 'не требуется', 'отпала необходимость'],
  'техническая ошибка': ['техническая ошибка', 'ошибка в документации', 'некорректные данные'],
};

/** Паттерны пустых значений */
const EMPTY_PATTERNS = ['', '-', '—', 'н/д', 'н.д.', 'нет данных', 'не применимо', 'н/п', 'null', 'undefined', 'none', '#н/д'];

/**
 * Определить тип поля по колонке.
 */
export function detectFieldType(column: string): FieldType {
  const col = column.toUpperCase();

  // Формульные колонки с суммами
  if (['G', 'H', 'I', 'J', 'K', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB'].includes(col)) {
    return 'money';
  }
  // Даты
  if (['O', 'P', 'Q'].includes(col)) {
    return 'date';
  }
  // Проценты
  if (col === 'AC') {
    return 'percent';
  }
  // Статус
  if (col === 'U') {
    return 'status';
  }
  // Числа (количество)
  if (['D', 'E'].includes(col)) {
    return 'number';
  }
  // Текст
  return 'text';
}

/**
 * Нормализовать денежное значение.
 * "1 250 000" → 1250000
 * "1,25 млн" → 1250000
 * "1250,0 тыс" → 1250000
 */
export function normalizeMoney(value: unknown): NormalizationResult {
  const original = value;

  if (value === null || value === undefined) {
    return { original, normalized: null, changed: false, rule: null, fieldType: 'money' };
  }

  if (typeof value === 'number') {
    return { original, normalized: value, changed: false, rule: null, fieldType: 'money' };
  }

  let str = String(value).trim().toLowerCase();

  // Проверка на пустое
  if (EMPTY_PATTERNS.includes(str)) {
    return { original, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'money' };
  }

  // Удаляем "руб", "руб.", "₽"
  str = str.replace(/\s*(руб\.?|₽)\s*/gi, '');

  // Обработка "млн", "млрд", "тыс"
  let multiplier = 1;
  if (str.includes('млрд')) {
    multiplier = 1_000_000_000;
    str = str.replace(/\s*млрд\.?\s*/gi, '');
  } else if (str.includes('млн')) {
    multiplier = 1_000_000;
    str = str.replace(/\s*млн\.?\s*/gi, '');
  } else if (str.includes('тыс')) {
    multiplier = 1_000;
    str = str.replace(/\s*тыс\.?\s*/gi, '');
  }

  // Убираем пробелы (разделители тысяч)
  str = str.replace(/\s/g, '');

  // Запятая → точка
  str = str.replace(/,/g, '.');

  const num = parseFloat(str);
  if (isNaN(num)) {
    return { original, normalized: null, changed: true, rule: 'invalid_money', fieldType: 'money' };
  }

  const normalized = num * multiplier;
  return {
    original,
    normalized,
    changed: normalized !== value,
    rule: multiplier > 1 ? `money_multiplier_${multiplier}` : 'money_parse',
    fieldType: 'money',
  };
}

/**
 * Нормализовать дату.
 * "15.03.26" → "2026-03-15"
 * "15 марта" → "YYYY-03-15"
 * "2026-03-15" → "2026-03-15"
 */
export function normalizeDate(value: unknown): NormalizationResult {
  const original = value;

  if (value === null || value === undefined) {
    return { original, normalized: null, changed: false, rule: null, fieldType: 'date' };
  }

  const str = String(value).trim();

  if (EMPTY_PATTERNS.includes(str.toLowerCase())) {
    return { original, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'date' };
  }

  // ISO format: 2026-03-15
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return { original, normalized: str, changed: false, rule: null, fieldType: 'date' };
  }

  // Russian format: dd.mm.yyyy or dd.mm.yy
  const ruMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (ruMatch) {
    const day = ruMatch[1].padStart(2, '0');
    const month = ruMatch[2].padStart(2, '0');
    let year = ruMatch[3];
    if (year.length === 2) {
      year = parseInt(year, 10) > 50 ? `19${year}` : `20${year}`;
    }
    const normalized = `${year}-${month}-${day}`;
    return { original, normalized, changed: true, rule: 'date_ru_to_iso', fieldType: 'date' };
  }

  // Month names
  const MONTHS: Record<string, string> = {
    'январ': '01', 'феврал': '02', 'март': '03', 'апрел': '04',
    'ма': '05', 'июн': '06', 'июл': '07', 'август': '08',
    'сентябр': '09', 'октябр': '10', 'ноябр': '11', 'декабр': '12',
  };

  for (const [prefix, monthNum] of Object.entries(MONTHS)) {
    if (str.toLowerCase().includes(prefix)) {
      const dayMatch = str.match(/(\d{1,2})/);
      const day = dayMatch ? dayMatch[1].padStart(2, '0') : '01';
      const year = new Date().getFullYear();
      const normalized = `${year}-${monthNum}-${day}`;
      return { original, normalized, changed: true, rule: 'date_month_name', fieldType: 'date' };
    }
  }

  return { original, normalized: str, changed: false, rule: 'date_unknown_format', fieldType: 'date' };
}

/**
 * Нормализовать статус.
 * "подписанн" → "подписан"
 * Fuzzy-match по словарю STATUS_DICTIONARY.
 */
export function normalizeStatus(value: unknown): NormalizationResult {
  const original = value;

  if (value === null || value === undefined) {
    return { original, normalized: null, changed: false, rule: null, fieldType: 'status' };
  }

  const str = String(value).trim().toLowerCase();

  if (EMPTY_PATTERNS.includes(str)) {
    return { original, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'status' };
  }

  // Exact match first
  for (const [normalized, variants] of Object.entries(STATUS_DICTIONARY)) {
    for (const variant of variants) {
      if (str === variant || str.includes(variant)) {
        const changed = str !== normalized;
        return { original, normalized, changed, rule: changed ? 'status_normalize' : null, fieldType: 'status' };
      }
    }
  }

  // Fuzzy match: try prefix matching
  for (const [normalized, variants] of Object.entries(STATUS_DICTIONARY)) {
    for (const variant of variants) {
      if (variant.startsWith(str) || str.startsWith(variant.slice(0, 4))) {
        return { original, normalized, changed: true, rule: 'status_fuzzy', fieldType: 'status' };
      }
    }
  }

  // No match — return as-is
  return { original, normalized: String(value).trim(), changed: false, rule: null, fieldType: 'status' };
}

/**
 * Нормализовать причину/обоснование.
 */
export function normalizeReason(value: unknown): NormalizationResult {
  const original = value;

  if (value === null || value === undefined) {
    return { original, normalized: null, changed: false, rule: null, fieldType: 'text' };
  }

  const str = String(value).trim().toLowerCase();

  if (EMPTY_PATTERNS.includes(str)) {
    return { original, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'text' };
  }

  for (const [template, variants] of Object.entries(REASON_TEMPLATES)) {
    for (const variant of variants) {
      if (str.includes(variant)) {
        return { original, normalized: template, changed: true, rule: 'reason_template', fieldType: 'text' };
      }
    }
  }

  return { original, normalized: String(value).trim(), changed: false, rule: null, fieldType: 'text' };
}

/**
 * Нормализовать число.
 */
export function normalizeNumber(value: unknown): NormalizationResult {
  const original = value;

  if (value === null || value === undefined) {
    return { original, normalized: null, changed: false, rule: null, fieldType: 'number' };
  }

  if (typeof value === 'number') {
    return { original, normalized: value, changed: false, rule: null, fieldType: 'number' };
  }

  const str = String(value).trim();

  if (EMPTY_PATTERNS.includes(str.toLowerCase())) {
    return { original, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'number' };
  }

  // Handle percentage
  if (str.includes('%')) {
    const num = parseFloat(str.replace('%', '').replace(/,/g, '.').trim());
    if (!isNaN(num)) {
      return { original, normalized: num / 100, changed: true, rule: 'percent_to_decimal', fieldType: 'percent' };
    }
  }

  const num = parseFloat(str.replace(/\s/g, '').replace(/,/g, '.'));
  if (!isNaN(num)) {
    return { original, normalized: num, changed: num !== value, rule: 'number_parse', fieldType: 'number' };
  }

  return { original, normalized: null, changed: true, rule: 'invalid_number', fieldType: 'number' };
}

// ────────────────────────────────────────────────────────
// Text normalization rules (Phase F)
// ────────────────────────────────────────────────────────

export interface TextNormalizationResult {
  cleaned: string;
  appliedRules: string[];
}

interface TextRule {
  id: string;
  apply: (text: string) => string;
}

const TEXT_RULES: TextRule[] = [
  {
    id: 'text_double_space',
    apply: (text: string) => text.replace(/\s{2,}/g, ' '),
  },
  {
    id: 'text_trailing_space',
    apply: (text: string) => text.trim(),
  },
  {
    id: 'text_quotes_normalize',
    apply: (text: string) =>
      text
        .replace(/[«»""„‟]/g, '"')
        .replace(/[''‚‛]/g, "'"),
  },
];

/**
 * Применяет все текстовые правила нормализации.
 * Возвращает очищенный текст и список применённых правил.
 */
export function applyTextNormalization(text: string): TextNormalizationResult {
  const appliedRules: string[] = [];
  let cleaned = text;

  for (const rule of TEXT_RULES) {
    const result = rule.apply(cleaned);
    if (result !== cleaned) {
      appliedRules.push(rule.id);
      cleaned = result;
    }
  }

  return { cleaned, appliedRules };
}

/**
 * Универсальная нормализация ячейки по колонке.
 */
export function normalizeCell(column: string, value: unknown): NormalizationResult {
  const fieldType = detectFieldType(column);

  switch (fieldType) {
    case 'money': return normalizeMoney(value);
    case 'date': return normalizeDate(value);
    case 'status': return normalizeStatus(value);
    case 'number': return normalizeNumber(value);
    case 'percent': return normalizeNumber(value);
    default:
      // Text — just trim
      if (value === null || value === undefined) {
        return { original: value, normalized: null, changed: false, rule: null, fieldType: 'text' };
      }
      const str = String(value).trim();
      if (EMPTY_PATTERNS.includes(str.toLowerCase())) {
        return { original: value, normalized: null, changed: true, rule: 'empty_to_null', fieldType: 'empty' };
      }
      return { original: value, normalized: str, changed: str !== value, rule: str !== value ? 'text_trim' : null, fieldType: 'text' };
  }
}
