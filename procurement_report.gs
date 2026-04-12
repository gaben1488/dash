/**
 * ============================================================================
 * ГЕНЕРАТОР ЗАКУПОЧНЫХ ОТЧЁТОВ — v2.0
 * ============================================================================
 * Система аналитики закупочной деятельности для муниципальных ГРБС.
 * Два режима: ТИПОВОЙ (шаблонный) и УМНЫЙ (аналитический).
 *
 * Конвейер обработки: 11 стадий
 * СВОД → Доверие → Метрики → Контекст → Динамика → Аномалии →
 * 44-ФЗ → Классификация → Профилирование → Текст → Сборка
 *
 * Модульная структура: 15 модулей (М1-М15)
 * Этот файл содержит все модули в одном файле для Google Apps Script.
 * ============================================================================
 */

'use strict';

// =============================================================================
// М2: КОНФИГУРАЦИЯ И КОНСТАНТЫ
// =============================================================================

var CFG_ = {
  VERSION: '2.0.0',
  SPREADSHEET_ID: null,
  SHEETS: {
    SVOD: 'СВОД ТД-ПМ',
    KONTEKST: 'КОНТЕКСТ',
    RASCHET: 'РАСЧЕТ',
    HISTORY: 'ИСТОРИЯ',
    OTLADKA: 'ОТЛАДКА',
    SPRAVKA: 'СПРАВКА',
    REPORT_DATA: 'REPORT_DATA',
    GRBS_DATA: 'GRBS_DATA'
  },
  TARGET_EXEC_Q_END: 0.70,
  TRUST_WEIGHTS: {
    completeness: 0.25,
    plausibility: 0.25,
    consistency: 0.20,
    freshness: 0.15,
    volatility: 0.15
  },
  TRUST_GRADES: {
    A: { min: 90, label: 'Отличное качество', action: 'Полное доверие' },
    B: { min: 75, label: 'Хорошее', action: 'Доверие с предупреждениями' },
    C: { min: 60, label: 'Удовлетворительное', action: 'Осторожная аналитика' },
    D: { min: 40, label: 'Низкое', action: 'Аналитика с оговорками' },
    F: { min: 0,  label: 'Непригодное', action: 'Только диагностика' }
  },
  BENFORD_MAD_SUSPICIOUS: 0.015,
  BENFORD_MAD_CRITICAL: 0.030,
  BENFORD_MIN_SAMPLES: 50,
  EWMA_LAMBDA: 0.3,
  EWMA_ANOMALY_THRESHOLD: 0.15,
  MIN_SNAPSHOTS_REGRESSION: 3,
  MIN_SNAPSHOTS_ACCELERATION: 3
};

var GRBS_BASELINES_ = {
  'УЭР':    { expectedExecQ1: 0.65, normalEpShare: 0.35, role: 'ОПЕРАЦИОННЫЙ',      fullName: 'УЭР АЕМР + МКУ «ЦЭР»' },
  'УИО':    { expectedExecQ1: 0.55, normalEpShare: 0.40, role: 'ИМУЩЕСТВО',          fullName: 'УИО АЕМР' },
  'УАГЗО':  { expectedExecQ1: 0.70, normalEpShare: 0.30, role: 'ЗАКАЗЧИК',           fullName: 'УАГЗО АЕМР' },
  'УФБП':   { expectedExecQ1: 0.60, normalEpShare: 0.25, role: 'ФИНАНСЫ',            fullName: 'УФБП АЕМР' },
  'УД':     { expectedExecQ1: 0.50, normalEpShare: 0.45, role: 'ДЕЛОПРОИЗВОДСТВО',   fullName: 'УД АЕМР' },
  'УДТХ':   { expectedExecQ1: 0.45, normalEpShare: 0.50, role: 'ХОЗЯЙСТВО',         fullName: 'УДТХ АЕМР' },
  'УКСиМП': { expectedExecQ1: 0.40, normalEpShare: 0.35, role: 'СТРОИТЕЛЬСТВО',      fullName: 'УКСиМП АЕМР' },
  'УО':     { expectedExecQ1: 0.30, normalEpShare: 0.55, role: 'ОБРАЗОВАНИЕ',        fullName: 'Управление образования' }
};

var GRBS_ORDER_ = ['УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП'];

var LAW_44FZ_ = {
  EP_SINGLE_CONTRACT_LIMIT: 600000,
  EP_YEAR_LIMIT_DEFAULT: 2000000,
  EP_YEAR_PCT_DEFAULT: 0.10,
  EP_YEAR_CAP_DEFAULT: 50000000,
  EP_YEAR_LIMIT_EDUCATION: 5000000,
  EP_YEAR_PCT_EDUCATION: 0.50,
  EP_YEAR_CAP_EDUCATION: 30000000,
  ESHOP_SINGLE_LIMIT: 5000000,
  ESHOP_YEAR_LIMIT: 100000000,
  QUOTATION_LIMIT: 10000000,
  COMPETITIVE_MANDATORY: 10000000,
  ANTIDUMPING_THRESHOLD: 0.25,
  ANTIDUMPING_HIGH_NMC: 15000000,
  COLLUSION_LOW_ECONOMY: 0.01,
  SPLITTING_MIN_CONTRACTS: 3,
  SPLITTING_PERIOD_DAYS: 30
};

var EP_SHARE_THRESHOLDS_ = {
  'ОБРАЗОВАНИЕ':      { share: 0.55, amount: 5000000 },
  'МЕДИЦИНА':         { share: 0.45, amount: 3000000 },
  'КУЛЬТУРА':         { share: 0.45, amount: 3000000 },
  'СТАНДАРТ':         { share: 0.30, amount: 2000000 },
  'ОПЕРАЦИОННЫЙ':     { share: 0.35, amount: 2000000 },
  'ИМУЩЕСТВО':        { share: 0.40, amount: 3000000 },
  'ЗАКАЗЧИК':         { share: 0.30, amount: 2000000 },
  'ФИНАНСЫ':          { share: 0.25, amount: 2000000 },
  'ДЕЛОПРОИЗВОДСТВО': { share: 0.45, amount: 2000000 },
  'ХОЗЯЙСТВО':       { share: 0.50, amount: 2000000 },
  'СТРОИТЕЛЬСТВО':    { share: 0.35, amount: 3000000 }
};

// ═══ СТИЛЬ ДОКУМЕНТА (дизайнерские кириллические шрифты Google Fonts) ═══
var DOC_STYLE_ = {
  FONT_TITLE:   'Playfair Display',
  FONT_HEADING: 'Montserrat',
  FONT_BODY:    'Commissioner',
  FONT_TABLE:   'Nunito',
  FONT_MONO:    'Fira Code',

  SIZE_TITLE: 18,
  SIZE_H1:    14,
  SIZE_H2:    11.5,
  SIZE_H3:    11,
  SIZE_BODY:  10,
  SIZE_TABLE: 9,
  SIZE_SMALL: 8.5,

  COLOR_H1:       '#1A237E',
  COLOR_H2:       '#283593',
  COLOR_H3:       '#303F9F',
  COLOR_ACCENT:   '#1565C0',
  COLOR_OK:       '#2E7D32',
  COLOR_WARN:     '#E65100',
  COLOR_CRIT:     '#B71C1C',
  COLOR_MUTED:    '#616161',

  COLOR_TBL_HEADER_BG: '#E8EAF6',
  COLOR_TBL_ALT_BG:    '#F5F5F5',
  COLOR_TBL_BORDER:    '#BDBDBD',

  SPACING_AFTER_H1: 8,
  SPACING_AFTER_H2: 4,
  SPACING_BODY:     2,
  SPACING_SECTION:  12
};

var SEVERITY_WEIGHTS_ = {
  'ИНФОРМАЦИЯ': 1,
  'СРЕДНЯЯ': 2,
  'ВЫСОКАЯ': 3,
  'КРИТИЧЕСКАЯ': 5
};

var LAW_44FZ_BASE_ = {
  'ст.93': {
    title: 'Закупка у единственного поставщика',
    parts: {
      'ч.1.п.1': { text: 'Монополисты (водо-, тепло-, газо-, электроснабжение)', limit: 'без ограничений по сумме', risk: 'LOW' },
      'ч.1.п.4': { text: 'Малые закупки', limit: 'до 600 тыс., не более 2 млн/год или 10% СГОЗ', risk: 'MEDIUM' },
      'ч.1.п.5': { text: 'Образование, культура, спорт', limit: 'до 600 тыс., не более 5 млн/год или 50% СГОЗ', risk: 'MEDIUM' },
      'ч.1.п.8': { text: 'Имущество в пользовании', limit: 'арендные платежи', risk: 'LOW' },
      'ч.1.п.23': { text: 'Аренда нежилых помещений', limit: 'без конкуренции', risk: 'LOW' },
      'ч.1.п.29': { text: 'Содержание и ремонт', limit: 'до 1 млн', risk: 'MEDIUM' }
    }
  },
  'ст.16': { title: 'Планирование закупок', thesis: 'План закупок формируется на срок закона о бюджете' },
  'ст.17': { title: 'План-график', thesis: 'Включает все закупки, ведётся в ЕИС' },
  'ст.22': { title: 'Определение НМЦ', thesis: '5 методов: сопоставимых рыночных цен, нормативный, тарифный, проектно-сметный, затратный' },
  'ст.24': { title: 'Способы определения поставщиков', thesis: 'Конкурентные: конкурс, аукцион, запрос котировок. ЕП — исключение' },
  'ст.25': { title: 'Совместные закупки', thesis: 'Два и более заказчика могут провести совместную закупку (ст. 25 44-ФЗ)' },
  'ст.37': { title: 'Антидемпинговые меры', thesis: 'При снижении > 25%: обеспечение × 1.5 или подтверждение добросовестности' },
  'ст.94': { title: 'Исполнение контракта', thesis: 'Заказчик обязан провести экспертизу результатов' },
  'ст.99': { title: 'Контроль в сфере закупок', thesis: 'ФАС, Казначейство, органы аудита' },
  'ст.103': { title: 'Реестр контрактов', thesis: 'Регистрация в ЕИС — 5 рабочих дней. Нарушение — штраф 20 тыс. (КоАП 7.31)' },
  'ст.104': { title: 'Реестр недобросовестных поставщиков', thesis: 'Включение на 2 года за уклонение от контракта' }
};

var SUBJECT_CATEGORIES_ = {
  'канцелярия|канцтовар|бумага|картридж|тонер': 'Канцелярские товары',
  'мебель|стол|стул|шкаф|кресло': 'Мебель',
  'компьютер|ноутбук|монитор|принтер|мфу|орг.?техник': 'Оргтехника',
  'уборк|клининг|содержан.*помещ|хоз.*нужд': 'Хозобслуживание',
  'охран|безопасн|видеонаблюд': 'Охрана',
  'связь|интернет|телефон': 'Услуги связи',
  'ремонт|строительн|отделочн': 'Ремонт',
  'транспорт|автомобил|бензин|гсм|топлив': 'Транспорт и ГСМ',
  'программ|лицензи|софт|1с|антивирус': 'ПО и лицензии',
  'коммунал|электричеств|водоснабж|теплоснабж': 'Коммунальные услуги',
  'питан|продукт|продовольств': 'Продукты питания',
  'медик|лекарств|медицинск': 'Медицинские товары',
  'форм|одежд|обмундир|спецодежд': 'Одежда и форма'
};


// =============================================================================
// М15: УТИЛИТЫ (форматирование, даты, ввод-вывод листов, логирование)
// =============================================================================
// Модуль вспомогательных функций, используемых всеми остальными модулями.
// Вынесен первым, потому что от него зависят все последующие модули.
// =============================================================================

/**
 * Форматирование числа с разделителем тысяч (пробел) и десятичной запятой.
 * Нужно для единообразного представления сумм и количеств в отчётах —
 * российский стандарт: «1 234 567,89» вместо «1,234,567.89».
 *
 * @param {*} value — число или строка, которую нужно отформатировать
 * @param {number} [decimals=2] — количество знаков после запятой
 * @returns {string} — отформатированная строка или '—' при ошибке
 */
function fmtNum_(value, decimals) {
  // Защита: если значение некорректно, показываем прочерк вместо «NaN»
  if (value === null || value === undefined || value === '') return '—';
  decimals = (decimals !== undefined && decimals !== null) ? decimals : 2;

  let num = typeof value === 'string' ? parseFloat(value.replace(/\s/g, '').replace(',', '.')) : Number(value);
  if (isNaN(num)) return '—';

  // Разделяем целую и дробную части, затем вставляем пробелы-разделители тысяч
  let fixed = num.toFixed(decimals);
  let parts = fixed.split('.');
  let intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Если знаки после запятой не нужны, возвращаем только целую часть
  if (decimals === 0) return intPart;
  return intPart + ',' + parts[1];
}

/**
 * Форматирование целого числа (без дробной части): 1234 → "1 234".
 * Удобно для отображения количества контрактов, закупок и т.д.
 */
function fmtInt_(value) {
  return fmtNum_(value, 0);
}

/**
 * Склонение слова «процедура» по числу: 1 процедура, 2 процедуры, 5 процедур.
 */
function pluralProc_(n) {
  n = Math.abs(Math.floor(toNumber_(n)));
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return n + ' процедур';
  if (mod10 === 1) return n + ' процедура';
  if (mod10 >= 2 && mod10 <= 4) return n + ' процедуры';
  return n + ' процедур';
}

/**
 * Склонение «договор/контракт» по числу.
 */
function pluralContract_(n) {
  n = Math.abs(Math.floor(toNumber_(n)));
  var mod10 = n % 10;
  var mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return n + ' договоров/контрактов';
  if (mod10 === 1) return n + ' договор/контракт';
  if (mod10 >= 2 && mod10 <= 4) return n + ' договора/контракта';
  return n + ' договоров/контрактов';
}

/**
 * Форматирование процентов: 0.6789 → "67,89%".
 * Входное значение — доля (0..1), не процент (0..100).
 * Это важно, потому что данные в СВОД хранятся как доли.
 *
 * @param {*} value — доля (0..1)
 * @param {number} [decimals=2] — знаки после запятой
 * @returns {string} — процент с символом % или '—'
 */
function fmtPct_(value, decimals) {
  if (value === null || value === undefined || value === '') return '—';
  decimals = (decimals !== undefined && decimals !== null) ? decimals : 2;

  let num = toNumber_(value);
  if (num === null) return '—';

  // Умножаем на 100 для перевода доли в проценты
  return fmtNum_(num * 100, decimals) + '%';
}

/**
 * Форматирование денежных сумм с единицей измерения.
 * Суммы в СВОД хранятся в тысячах рублей — добавляем «тыс. руб.» для ясности.
 *
 * @param {*} value — сумма в тысячах рублей
 * @returns {string} — "1 234 567,89 тыс. руб." или '—'
 */
function fmtMoney_(value) {
  if (value === null || value === undefined || value === '') return '—';
  let formatted = fmtNum_(value, 2);
  if (formatted === '—') return '—';
  return formatted + ' тыс. руб.';
}

/**
 * Форматирование даты в российском формате: ДД.ММ.ГГГГ.
 * Google Sheets может вернуть дату как строку или объект Date —
 * обрабатываем оба случая.
 *
 * @param {Date|string|*} date — дата для форматирования
 * @returns {string} — "30.03.2026" или '—'
 */
function fmtDate_(date) {
  if (!date) return '—';

  try {
    // Если строка — пытаемся распарсить
    let d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';

    // Форматируем с ведущими нулями: 05.04.2026, а не 5.4.2026
    let day = ('0' + d.getDate()).slice(-2);
    let month = ('0' + (d.getMonth() + 1)).slice(-2);
    let year = d.getFullYear();
    return day + '.' + month + '.' + year;
  } catch (e) {
    return '—';
  }
}

/**
 * Безопасное преобразование значения ячейки в число.
 * Ячейки Google Sheets могут содержать строки с пробелами, запятые
 * вместо точек, пустые значения — всё это нужно обработать.
 *
 * @param {*} value — значение из ячейки
 * @returns {number|null} — число или null, если преобразование невозможно
 */
function toNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;

  // Очищаем строку: убираем пробелы, заменяем запятую на точку, убираем «%»
  let cleaned = String(value).replace(/\s/g, '').replace(',', '.').replace('%', '');
  let num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Безопасное сложение двух значений, устойчивое к null/undefined.
 * Нужно для суммирования данных, где часть ячеек может быть пуста.
 */
function safeAdd_(a, b) {
  let na = toNumber_(a);
  let nb = toNumber_(b);
  if (na === null && nb === null) return null;
  return (na || 0) + (nb || 0);
}

/**
 * Безопасный расчёт процента выполнения: факт / план.
 * Возвращает null при нулевом плане, чтобы не делить на ноль.
 * Результат — доля (0..1), не процент (0..100).
 */
function calcPct_(fact, plan) {
  let f = toNumber_(fact);
  let p = toNumber_(plan);
  if (p === null || p === 0) return null;
  if (f === null) return 0;
  return f / p;
}

/**
 * Разница между двумя датами в днях.
 * Используется для оценки свежести данных и расчёта динамики.
 */
function dateDiffDays_(date1, date2) {
  try {
    let d1 = (date1 instanceof Date) ? date1 : new Date(date1);
    let d2 = (date2 instanceof Date) ? date2 : new Date(date2);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;

    // Отбрасываем время, считаем только полные дни
    let msPerDay = 86400000;
    return Math.round((d2.getTime() - d1.getTime()) / msPerDay);
  } catch (e) {
    return null;
  }
}

/**
 * Начало квартала для заданной даты.
 * Нужно для определения отчётного периода: Q1 = 01.01, Q2 = 01.04 и т.д.
 */
function quarterStart_(date) {
  try {
    let d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;

    let q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1);
  } catch (e) {
    return null;
  }
}

/**
 * Конец квартала для заданной даты (последний день последнего месяца квартала).
 * Нужно для расчёта оставшегося времени до конца отчётного периода.
 */
function quarterEnd_(date) {
  try {
    let d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;

    let q = Math.floor(d.getMonth() / 3);
    // Последний день квартала = день 0 следующего квартала
    return new Date(d.getFullYear(), (q + 1) * 3, 0);
  } catch (e) {
    return null;
  }
}

/**
 * Номер квартала (1-4) для заданной даты.
 */
function quarterNumber_(date) {
  try {
    let d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return Math.floor(d.getMonth() / 3) + 1;
  } catch (e) {
    return null;
  }
}

/**
 * Проверка: является ли дата пятницей.
 * Пятничные срезы — основной механизм сбора исторических данных
 * для анализа динамики (лист ИСТОРИЯ).
 */
function isFriday_(date) {
  try {
    let d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return false;
    return d.getDay() === 5;
  } catch (e) {
    return false;
  }
}

/**
 * Нормализация строки: обрезаем пробелы, схлопываем множественные пробелы в один.
 * Нужно для корректного сравнения наименований ГРБС из разных источников.
 */
function normalizeString_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Чтение key-value листа, где столбец A = ключ, B = значение.
 * Используется для чтения листов REPORT_SETTINGS, КОНТЕКСТ и подобных.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} sheetName — имя листа
 * @returns {Object} — словарь { ключ: значение }
 */
function readKeyValueSheet_(ss, sheetName) {
  let result = {};
  try {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) return result;

    let data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      let key = normalizeString_(data[i][0]);
      if (key) {
        // Значение может быть числом, датой или строкой — сохраняем как есть
        result[key] = data[i][1] !== undefined ? data[i][1] : null;
      }
    }
  } catch (e) {
    // Лист не существует или ошибка чтения — возвращаем пустой словарь,
    // чтобы вызывающий код мог безопасно проверить наличие ключей
  }
  return result;
}

/**
 * Чтение таблицы с заголовками: первая строка = заголовки, остальные = данные.
 * Возвращает массив объектов, где ключи — значения из заголовков.
 * Удобно для чтения данных по ГРБС, где структура фиксирована.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} sheetName — имя листа
 * @returns {Array<Object>} — массив объектов с данными
 */
function readTableSheet_(ss, sheetName) {
  let result = [];
  try {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) return result;

    let data = sheet.getDataRange().getValues();
    if (data.length < 2) return result;

    // Первая строка — заголовки
    let headers = data[0].map(function(h) { return normalizeString_(h); });

    // Остальные строки — данные
    for (let r = 1; r < data.length; r++) {
      let row = {};
      let hasData = false;
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) {
          row[headers[c]] = data[r][c] !== undefined ? data[r][c] : null;
          // Проверяем, что строка не полностью пустая
          if (data[r][c] !== null && data[r][c] !== undefined && data[r][c] !== '') {
            hasData = true;
          }
        }
      }
      // Пропускаем полностью пустые строки, чтобы не засорять массив
      if (hasData) {
        result.push(row);
      }
    }
  } catch (e) {
    // Ошибка чтения — возвращаем пустой массив
  }
  return result;
}

/**
 * Логирование событий в лист ОТЛАДКА для диагностики работы системы.
 * Каждая запись включает: время, модуль, стадию, сообщение, данные, серьёзность.
 * Лист ОТЛАДКА автоматически создаётся при первом вызове, если его нет.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} module — имя модуля (М1-М15)
 * @param {string} stage — стадия конвейера
 * @param {string} message — сообщение (на русском)
 * @param {Object} [data] — дополнительные данные (будут сериализованы в JSON)
 * @param {string} [severity='ИНФО'] — серьёзность: ИНФО / ВНИМАНИЕ / ОШИБКА / КРИТИЧЕСКАЯ
 */
function log_(ss, module, stage, message, data, severity) {
  severity = severity || 'ИНФО';
  try {
    let sheet = ss.getSheetByName(CFG_.SHEETS.OTLADKA);

    // Создаём лист ОТЛАДКА, если его ещё нет — система должна работать
    // даже при первом запуске, когда вспомогательные листы не настроены
    if (!sheet) {
      sheet = ss.insertSheet(CFG_.SHEETS.OTLADKA);
      sheet.appendRow(['Время', 'Модуль', 'Стадия', 'Сообщение', 'Данные', 'Серьёзность']);
      // Форматируем заголовок для удобства чтения
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }

    // Сериализуем дополнительные данные, но не допускаем утечки чувствительной информации
    let dataStr = '';
    if (data !== undefined && data !== null) {
      dataStr = safeJsonStringify_(data, 1000);
    }

    sheet.appendRow([
      new Date(),
      module || '',
      stage || '',
      // Обрезаем длинные сообщения, чтобы не перегружать лист
      String(message || '').substring(0, 500),
      dataStr,
      severity
    ]);
  } catch (e) {
    // Если не удалось записать лог — молча продолжаем работу.
    // Падение логирования не должно останавливать основной процесс.
    // Используем console.log как запасной канал для разработчика.
    console.log('[' + severity + '] ' + module + '/' + stage + ': ' + message);
  }
}

/**
 * Безопасная сериализация объекта в JSON.
 * Встроенный JSON.stringify падает на циклических ссылках —
 * эта версия перехватывает ошибку и возвращает fallback-строку.
 * Также ограничивает длину вывода, чтобы не забить ячейку листа.
 *
 * @param {*} obj — объект для сериализации
 * @param {number} [maxLength=2000] — максимальная длина строки
 * @returns {string} — JSON-строка или сообщение об ошибке
 */
function safeJsonStringify_(obj, maxLength) {
  maxLength = maxLength || 2000;
  try {
    // Используем Set для отслеживания уже посещённых объектов (защита от циклов)
    let seen = new WeakSet();
    let json = JSON.stringify(obj, function(key, value) {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      // Не логируем потенциально чувствительные поля
      if (typeof key === 'string' && /password|token|secret|api.?key/i.test(key)) {
        return '[REDACTED]';
      }
      return value;
    });
    // Обрезаем слишком длинный JSON, добавляя маркер обрезки
    if (json && json.length > maxLength) {
      return json.substring(0, maxLength) + '... [обрезано]';
    }
    return json || '';
  } catch (e) {
    return '[Ошибка сериализации: ' + e.message + ']';
  }
}


// =============================================================================
// М2: КОНФИГУРАЦИЯ И КОНСТАНТЫ (ИСПРАВЛЕННАЯ ВЕРСИЯ)
// =============================================================================
// Исправлены ссылки на ячейки СВОД ТД-ПМ по результатам глубокого анализа
// реального содержимого таблицы. Старые ссылки были ПОЛНОСТЬЮ НЕВЕРНЫ:
// они указывали на несуществующие столбцы и строки.
//
// ФАКТИЧЕСКАЯ структура СВОД ТД-ПМ (колонки):
//   A=ГРБС, B=Квартал, C=Год, D=План(кол), E=Факт(кол), F=Отклонение(кол),
//   G=Исполнение%, H=План ФБ, I=План КБ, J=План МБ, K=План ИТОГО,
//   L=Факт ФБ, M=Факт КБ, N=Факт МБ, O=Факт ИТОГО, P=Отклонение сумма,
//   Q=Расход%, R=Экономия ФБ, S=Экономия КБ, T=Экономия МБ, U=Экономия ИТОГО
// =============================================================================

'use strict';

/**
 * Карта ячеек листа СВОД ТД-ПМ для извлечения глобальных показателей (блок "ВСЕ").
 *
 * ВАЖНО: Предыдущая версия ссылалась на D14/E14/F14/G14 и т.д., что было
 * ПОЛНОСТЬЮ НЕВЕРНО. Фактически в колонке D — план (кол-во), E — факт (кол-во),
 * а суммы начинаются с колонки H (план ФБ) и K (план ИТОГО).
 *
 * Блок "ВСЕ" в СВОД ТД-ПМ:
 *   Строка 9  = ЭА Q1 2026
 *   Строка 14 = Итого ЭА 2026
 *   Строка 21 = ЕП Q1 2026
 *   Строка 26 = Итого ЕП 2026
 *   Строка 29 = ИТОГО 2026 (ЭА + ЕП)
 *   Строка 31 = Доля ЭА, строка 32 = Доля ЕП
 */
var DATA_SCHEMA_ = {

  // =====================================================================
  // КОНКУРЕНТНЫЕ (ЭА) — ИТОГО ЗА 2026 ГОД (строка 14)
  // =====================================================================
  all_comp_year_plan_count:   { sheet: 'СВОД ТД-ПМ', cell: 'D14',  description: 'ЭА 2026: план (кол-во)' },
  all_comp_year_fact_count:   { sheet: 'СВОД ТД-ПМ', cell: 'E14',  description: 'ЭА 2026: факт (кол-во)' },
  all_comp_year_deviation:    { sheet: 'СВОД ТД-ПМ', cell: 'F14',  description: 'ЭА 2026: отклонение (кол-во)' },
  all_comp_year_exec_pct:     { sheet: 'СВОД ТД-ПМ', cell: 'G14',  description: 'ЭА 2026: исполнение (%)' },
  all_comp_year_plan_fb:      { sheet: 'СВОД ТД-ПМ', cell: 'H14',  description: 'ЭА 2026: план ФБ (тыс. руб.)' },
  all_comp_year_plan_kb:      { sheet: 'СВОД ТД-ПМ', cell: 'I14',  description: 'ЭА 2026: план КБ (тыс. руб.)' },
  all_comp_year_plan_mb:      { sheet: 'СВОД ТД-ПМ', cell: 'J14',  description: 'ЭА 2026: план МБ (тыс. руб.)' },
  all_comp_year_plan_sum:     { sheet: 'СВОД ТД-ПМ', cell: 'K14',  description: 'ЭА 2026: план ИТОГО (тыс. руб.)' },
  all_comp_year_fact_fb:      { sheet: 'СВОД ТД-ПМ', cell: 'L14',  description: 'ЭА 2026: факт ФБ (тыс. руб.)' },
  all_comp_year_fact_kb:      { sheet: 'СВОД ТД-ПМ', cell: 'M14',  description: 'ЭА 2026: факт КБ (тыс. руб.)' },
  all_comp_year_fact_mb:      { sheet: 'СВОД ТД-ПМ', cell: 'N14',  description: 'ЭА 2026: факт МБ (тыс. руб.)' },
  all_comp_year_fact_sum:     { sheet: 'СВОД ТД-ПМ', cell: 'O14',  description: 'ЭА 2026: факт ИТОГО (тыс. руб.)' },
  all_comp_year_deviation_sum:{ sheet: 'СВОД ТД-ПМ', cell: 'P14',  description: 'ЭА 2026: отклонение (тыс. руб.)' },
  all_comp_year_spent_pct:    { sheet: 'СВОД ТД-ПМ', cell: 'Q14',  description: 'ЭА 2026: расход (%)' },
  all_comp_year_economy_fb:   { sheet: 'СВОД ТД-ПМ', cell: 'R14',  description: 'ЭА 2026: экономия ФБ (тыс. руб.)' },
  all_comp_year_economy_kb:   { sheet: 'СВОД ТД-ПМ', cell: 'S14',  description: 'ЭА 2026: экономия КБ (тыс. руб.)' },
  all_comp_year_economy_mb:   { sheet: 'СВОД ТД-ПМ', cell: 'T14',  description: 'ЭА 2026: экономия МБ (тыс. руб.)' },
  all_comp_year_economy_sum:  { sheet: 'СВОД ТД-ПМ', cell: 'U14',  description: 'ЭА 2026: экономия ИТОГО (тыс. руб.)' },

  // =====================================================================
  // КОНКУРЕНТНЫЕ (ЭА) — Q1 2026 (строка 9)
  // =====================================================================
  all_comp_q1_plan_count:     { sheet: 'СВОД ТД-ПМ', cell: 'D9',   description: 'ЭА Q1 2026: план (кол-во)' },
  all_comp_q1_fact_count:     { sheet: 'СВОД ТД-ПМ', cell: 'E9',   description: 'ЭА Q1 2026: факт (кол-во)' },
  all_comp_q1_exec_pct:       { sheet: 'СВОД ТД-ПМ', cell: 'G9',   description: 'ЭА Q1 2026: исполнение (%)' },
  all_comp_q1_plan_fb:        { sheet: 'СВОД ТД-ПМ', cell: 'H9',   description: 'ЭА Q1 2026: план ФБ' },
  all_comp_q1_plan_kb:        { sheet: 'СВОД ТД-ПМ', cell: 'I9',   description: 'ЭА Q1 2026: план КБ' },
  all_comp_q1_plan_mb:        { sheet: 'СВОД ТД-ПМ', cell: 'J9',   description: 'ЭА Q1 2026: план МБ' },
  all_comp_q1_plan_sum:       { sheet: 'СВОД ТД-ПМ', cell: 'K9',   description: 'ЭА Q1 2026: план ИТОГО' },
  all_comp_q1_fact_fb:        { sheet: 'СВОД ТД-ПМ', cell: 'L9',   description: 'ЭА Q1 2026: факт ФБ' },
  all_comp_q1_fact_kb:        { sheet: 'СВОД ТД-ПМ', cell: 'M9',   description: 'ЭА Q1 2026: факт КБ' },
  all_comp_q1_fact_mb:        { sheet: 'СВОД ТД-ПМ', cell: 'N9',   description: 'ЭА Q1 2026: факт МБ' },
  all_comp_q1_fact_sum:       { sheet: 'СВОД ТД-ПМ', cell: 'O9',   description: 'ЭА Q1 2026: факт ИТОГО' },
  all_comp_q1_economy_sum:    { sheet: 'СВОД ТД-ПМ', cell: 'U9',   description: 'ЭА Q1 2026: экономия ИТОГО' },

  // =====================================================================
  // ЕДИНСТВЕННЫЙ ПОСТАВЩИК (ЕП) — ИТОГО ЗА 2026 ГОД (строка 26)
  // =====================================================================
  all_ep_year_plan_count:     { sheet: 'СВОД ТД-ПМ', cell: 'D26',  description: 'ЕП 2026: план (кол-во)' },
  all_ep_year_fact_count:     { sheet: 'СВОД ТД-ПМ', cell: 'E26',  description: 'ЕП 2026: факт (кол-во)' },
  all_ep_year_deviation:      { sheet: 'СВОД ТД-ПМ', cell: 'F26',  description: 'ЕП 2026: отклонение (кол-во)' },
  all_ep_year_exec_pct:       { sheet: 'СВОД ТД-ПМ', cell: 'G26',  description: 'ЕП 2026: исполнение (%)' },
  all_ep_year_plan_fb:        { sheet: 'СВОД ТД-ПМ', cell: 'H26',  description: 'ЕП 2026: план ФБ' },
  all_ep_year_plan_kb:        { sheet: 'СВОД ТД-ПМ', cell: 'I26',  description: 'ЕП 2026: план КБ' },
  all_ep_year_plan_mb:        { sheet: 'СВОД ТД-ПМ', cell: 'J26',  description: 'ЕП 2026: план МБ' },
  all_ep_year_plan_sum:       { sheet: 'СВОД ТД-ПМ', cell: 'K26',  description: 'ЕП 2026: план ИТОГО' },
  all_ep_year_fact_fb:        { sheet: 'СВОД ТД-ПМ', cell: 'L26',  description: 'ЕП 2026: факт ФБ' },
  all_ep_year_fact_kb:        { sheet: 'СВОД ТД-ПМ', cell: 'M26',  description: 'ЕП 2026: факт КБ' },
  all_ep_year_fact_mb:        { sheet: 'СВОД ТД-ПМ', cell: 'N26',  description: 'ЕП 2026: факт МБ' },
  all_ep_year_fact_sum:       { sheet: 'СВОД ТД-ПМ', cell: 'O26',  description: 'ЕП 2026: факт ИТОГО' },
  all_ep_year_deviation_sum:  { sheet: 'СВОД ТД-ПМ', cell: 'P26',  description: 'ЕП 2026: отклонение (тыс. руб.)' },
  all_ep_year_spent_pct:      { sheet: 'СВОД ТД-ПМ', cell: 'Q26',  description: 'ЕП 2026: расход (%)' },
  all_ep_year_economy_fb:     { sheet: 'СВОД ТД-ПМ', cell: 'R26',  description: 'ЕП 2026: экономия ФБ' },
  all_ep_year_economy_kb:     { sheet: 'СВОД ТД-ПМ', cell: 'S26',  description: 'ЕП 2026: экономия КБ' },
  all_ep_year_economy_mb:     { sheet: 'СВОД ТД-ПМ', cell: 'T26',  description: 'ЕП 2026: экономия МБ' },
  all_ep_year_economy_sum:    { sheet: 'СВОД ТД-ПМ', cell: 'U26',  description: 'ЕП 2026: экономия ИТОГО' },

  // =====================================================================
  // ЕП — Q1 2026 (строка 21)
  // =====================================================================
  all_ep_q1_plan_count:       { sheet: 'СВОД ТД-ПМ', cell: 'D21',  description: 'ЕП Q1 2026: план (кол-во)' },
  all_ep_q1_fact_count:       { sheet: 'СВОД ТД-ПМ', cell: 'E21',  description: 'ЕП Q1 2026: факт (кол-во)' },
  all_ep_q1_exec_pct:         { sheet: 'СВОД ТД-ПМ', cell: 'G21',  description: 'ЕП Q1 2026: исполнение (%)' },
  all_ep_q1_plan_fb:          { sheet: 'СВОД ТД-ПМ', cell: 'H21',  description: 'ЕП Q1 2026: план ФБ' },
  all_ep_q1_plan_kb:          { sheet: 'СВОД ТД-ПМ', cell: 'I21',  description: 'ЕП Q1 2026: план КБ' },
  all_ep_q1_plan_mb:          { sheet: 'СВОД ТД-ПМ', cell: 'J21',  description: 'ЕП Q1 2026: план МБ' },
  all_ep_q1_plan_sum:         { sheet: 'СВОД ТД-ПМ', cell: 'K21',  description: 'ЕП Q1 2026: план ИТОГО' },
  all_ep_q1_fact_fb:          { sheet: 'СВОД ТД-ПМ', cell: 'L21',  description: 'ЕП Q1 2026: факт ФБ' },
  all_ep_q1_fact_kb:          { sheet: 'СВОД ТД-ПМ', cell: 'M21',  description: 'ЕП Q1 2026: факт КБ' },
  all_ep_q1_fact_mb:          { sheet: 'СВОД ТД-ПМ', cell: 'N21',  description: 'ЕП Q1 2026: факт МБ' },
  all_ep_q1_fact_sum:         { sheet: 'СВОД ТД-ПМ', cell: 'O21',  description: 'ЕП Q1 2026: факт ИТОГО' },
  all_ep_q1_economy_sum:      { sheet: 'СВОД ТД-ПМ', cell: 'U21',  description: 'ЕП Q1 2026: экономия ИТОГО' },

  // =====================================================================
  // ГРАНД-ТОТАЛ (ЭА + ЕП) — 2026 (строка 29)
  // =====================================================================
  all_total_2026_plan_count:  { sheet: 'СВОД ТД-ПМ', cell: 'D29',  description: 'ИТОГО 2026: план (кол-во)' },
  all_total_2026_fact_count:  { sheet: 'СВОД ТД-ПМ', cell: 'E29',  description: 'ИТОГО 2026: факт (кол-во)' },
  all_total_2026_exec_pct:    { sheet: 'СВОД ТД-ПМ', cell: 'G29',  description: 'ИТОГО 2026: исполнение (%)' },
  all_total_2026_plan_sum:    { sheet: 'СВОД ТД-ПМ', cell: 'K29',  description: 'ИТОГО 2026: план ИТОГО' },
  all_total_2026_fact_sum:    { sheet: 'СВОД ТД-ПМ', cell: 'O29',  description: 'ИТОГО 2026: факт ИТОГО' },
  all_total_2026_economy_sum: { sheet: 'СВОД ТД-ПМ', cell: 'U29',  description: 'ИТОГО 2026: экономия ИТОГО' },

  // =====================================================================
  // ДОЛИ ЭА / ЕП (строки 31-32)
  // =====================================================================
  all_comp_share:             { sheet: 'СВОД ТД-ПМ', cell: 'G31',  description: 'Доля ЭА (0..1)' },
  all_ep_share:               { sheet: 'СВОД ТД-ПМ', cell: 'G32',  description: 'Доля ЕП (0..1)' }
};


/**
 * Карта блоков ГРБС в листе СВОД ТД-ПМ.
 *
 * Каждый ГРБС имеет свой блок строк с фиксированной структурой, аналогичной
 * блоку "ВСЕ". Ключевое отличие: у УД есть 2 дополнительные строки
 * (вероятно, подразделения), из-за чего все ГРБС после УД сдвинуты на +2.
 *
 * Поля:
 *   blockStart — первая строка блока (заголовки)
 *   compQ1     — строка ЭА за Q1 текущего квартала
 *   compYear   — строка "Итого ЭА 2026"
 *   epQ1       — строка ЕП за Q1
 *   epYear     — строка "Итого ЕП 2026"
 *   total2026  — строка "ИТОГО 2026" (ЭА + ЕП)
 *   compShare  — ячейка доли ЭА (в A1-нотации)
 *   epShare    — ячейка доли ЕП (в A1-нотации)
 *
 * ПРОВЕРЕНО: значения совпадают с реальными данными таблицы.
 * Например, УЭР compQ1=42 даёт plan=15, fact=13 — корректно.
 */
var GRBS_BLOCK_MAP_ = {
  'УЭР': {
    blockStart: 37,
    compQ1: 42,   compYear: 47,
    epQ1: 53,     epYear: 58,
    total2026: 61,
    compShare: 'G63', epShare: 'G64'
  },
  'УИО': {
    blockStart: 67,
    compQ1: 72,   compYear: 77,
    epQ1: 83,     epYear: 88,
    total2026: 91,
    compShare: 'G93', epShare: 'G94'
  },
  'УАГЗО': {
    blockStart: 97,
    compQ1: 102,  compYear: 107,
    epQ1: 113,    epYear: 118,
    total2026: 121,
    compShare: 'G123', epShare: 'G124'
  },
  'УФБП': {
    blockStart: 127,
    compQ1: 132,  compYear: 137,
    epQ1: 143,    epYear: 148,
    total2026: 151,
    compShare: 'G153', epShare: 'G154'
  },
  'УД': {
    // У УД на 2 строки больше — это сдвигает все последующие блоки
    blockStart: 157,
    compQ1: 163,  compYear: 168,
    epQ1: 175,    epYear: 180,
    total2026: 183,
    compShare: 'G185', epShare: 'G186'
  },
  'УДТХ': {
    blockStart: 190,
    compQ1: 195,  compYear: 200,
    epQ1: 206,    epYear: 211,
    total2026: 214,
    compShare: 'G216', epShare: 'G217'
  },
  'УКСиМП': {
    blockStart: 220,
    compQ1: 225,  compYear: 230,
    epQ1: 236,    epYear: 241,
    total2026: 244,
    compShare: 'G246', epShare: 'G247'
  },
  'УО': {
    blockStart: 250,
    compQ1: 255,  compYear: 260,
    epQ1: 266,    epYear: 271,
    total2026: 274,
    compShare: 'G276', epShare: 'G277'
  }
};


/**
 * Смещения кварталов ВНУТРИ блока ЭА и ЕП каждого ГРБС.
 *
 * Внутри каждого блока ГРБС строки кварталов идут последовательно:
 * Q1, Q2, Q3, Q4 — с шагом 1. Например, если compQ1=42, то Q2=43, Q3=44, Q4=45.
 * Аналогично для ЕП.
 *
 * В блоке "ВСЕ" (строки 7-32):
 *   ЭА: Q1=9, Q2=10, Q3=11, Q4=12, ИтогоГод=14
 *   ЕП: Q1=21, Q2=22, Q3=23, Q4=24, ИтогоГод=26
 */
var QUARTER_OFFSETS_ = {
  // Смещение от Q1 для каждого квартала (Q1=0, Q2=+1, Q3=+2, Q4=+3)
  1: 0,
  2: 1,
  3: 2,
  4: 3
};


/**
 * Карта блоков в листе ШДЮ (помесячные данные).
 *
 * ШДЮ содержит те же колонки, что и СВОД, но разбивка по месяцам (1-12).
 * Используется для анализа трендов и прогнозирования экономии.
 *
 * Структура: каждый блок содержит 12 строк (месяцы) + строку итого.
 *   ВСЕ ЭА: строки 4-15 (данные), 16 (итого)
 *   ВСЕ ЕП: строки 20-31 (данные), 32 (итого)
 */
var MONTHLY_BLOCK_MAP_ = {
  'ВСЕ': {
    compStart: 4,  compEnd: 15, compTotal: 16,
    epStart: 20,   epEnd: 31,   epTotal: 32
  },
  'УЭР':    { compStart: 34,  compEnd: 45,  compTotal: 46,  epStart: 50,  epEnd: 61,  epTotal: 62 },
  'УИО':    { compStart: 67,  compEnd: 78,  compTotal: 79,  epStart: 83,  epEnd: 94,  epTotal: 95 },
  'УАГЗО':  { compStart: 100, compEnd: 111, compTotal: 112, epStart: 116, epEnd: 127, epTotal: 128 },
  'УФБП':   { compStart: 133, compEnd: 144, compTotal: 145, epStart: 149, epEnd: 160, epTotal: 161 },
  'УД':     { compStart: 166, compEnd: 177, compTotal: 178, epStart: 182, epEnd: 193, epTotal: 194 },
  'УДТХ':   { compStart: 199, compEnd: 210, compTotal: 211, epStart: 215, epEnd: 226, epTotal: 227 },
  'УКСиМП': { compStart: 232, compEnd: 243, compTotal: 244, epStart: 248, epEnd: 259, epTotal: 260 },
  'УО':     { compStart: 265, compEnd: 276, compTotal: 277, epStart: 280, epEnd: 291, epTotal: 292 }
};


/**
 * Маппинг колонок для чтения построчных данных из per-ГРБС листов.
 *
 * Каждый ГРБС имеет собственный лист (УЭР, УИО, УАГЗО, УФБП, УД, УДТХ, УКСиМП, УО)
 * с 33 колонками детализации по отдельным закупкам. Колонки пронумерованы с 0 (A).
 *
 * ВАЖНО: индексы здесь 0-based (для работы с массивом values[][]).
 */
var RAW_SHEET_COLS_ = {
  rowNum:         0,   // A — порядковый номер строки
  department:     1,   // B — наименование подразделения
  activity:       6,   // G — описание предмета закупки
  planFB:         7,   // H — план ФБ
  planKB:         8,   // I — план КБ
  planMB:         9,   // J — план МБ
  planTotal:     10,   // K — план ИТОГО
  procMethod:    11,   // L — способ закупки (ЭА, ЕП и т.д.)
  procReason:    12,   // M — основание способа закупки
  plannedDate:   13,   // N — планируемая дата
  plannedQ:      14,   // O — планируемый квартал
  plannedYear:   15,   // P — планируемый год
  actualDate:    16,   // Q — фактическая дата
  actualQ:       17,   // R — фактический квартал
  actualYear:    18,   // S — фактический год
  deviationNote: 20,   // U — причина отклонения
  factFB:        21,   // V — факт ФБ
  factKB:        22,   // W — факт КБ
  factMB:        23,   // X — факт МБ
  factTotal:     24,   // Y — факт ИТОГО
  econFB:        25,   // Z — экономия ФБ
  econKB:        26,   // AA — экономия КБ
  econMB:        27,   // AB — экономия МБ
  econTotal:     28,   // AC — экономия ИТОГО
  grbsComment:   30    // AE — комментарий ГРБС
};


// =============================================================================
// М3: ИЗВЛЕЧЕНИЕ ДАННЫХ (ПОЛНОСТЬЮ ПЕРЕПИСАНО)
// =============================================================================
// Стадия 1 конвейера: СВОД ТД-ПМ + per-ГРБС листы → ctx.rawData + ctx.grbsRows
//
// Ключевые изменения по сравнению со старой версией:
// 1. Читаем данные НАПРЯМУЮ из СВОД ТД-ПМ, а не из несуществующих листов
//    REPORT_DATA / GRBS_DATA / CELL_MAP / REPORT_SETTINGS
// 2. Используем GRBS_BLOCK_MAP_ с точными номерами строк вместо поиска по меткам
// 3. Читаем per-ГРБС детализацию (строки закупок) из индивидуальных листов
// 4. Читаем помесячные данные из ШДЮ для трендового анализа
// 5. Автоопределение текущего квартала по дате отчёта
// 6. Бюджетная разбивка ФБ/КБ/МБ для каждой метрики
// =============================================================================


/**
 * Автоопределение текущего квартала по дате.
 *
 * Квартал определяется из месяца:
 *   январь-март = Q1, апрель-июнь = Q2, июль-сентябрь = Q3, октябрь-декабрь = Q4.
 *
 * @param {Date} reportDate — дата отчёта (или текущая дата, если не задана)
 * @returns {number} — номер квартала (1-4)
 */
function detectCurrentQuarter_(reportDate) {
  try {
    let d = reportDate instanceof Date ? reportDate : new Date(reportDate);
    if (isNaN(d.getTime())) {
      d = new Date();
    }
    return Math.floor(d.getMonth() / 3) + 1;
  } catch (e) {
    // Fallback: определяем по текущей дате
    return Math.floor(new Date().getMonth() / 3) + 1;
  }
}


/**
 * Возвращает номера строк для заданного квартала в блоке "ВСЕ" листа СВОД ТД-ПМ.
 *
 * Строки кварталов ЭА идут подряд: 9 (Q1), 10 (Q2), 11 (Q3), 12 (Q4).
 * Строки кварталов ЕП идут подряд: 21 (Q1), 22 (Q2), 23 (Q3), 24 (Q4).
 * Итоговые строки всегда одинаковы: 14 (ЭА год), 26 (ЕП год), 29 (ИТОГО).
 *
 * @param {number} quarter — номер квартала (1-4)
 * @returns {Object} — { compQ, compYear, epQ, epYear, total2026, compShare, epShare }
 */
function getQuarterRows_(quarter) {
  let q = Math.max(1, Math.min(4, quarter || 1));
  let offset = QUARTER_OFFSETS_[q] || 0;

  return {
    compQ:     9 + offset,    // ЭА текущий квартал
    compYear:  14,            // Итого ЭА 2026 (всегда строка 14)
    epQ:       21 + offset,   // ЕП текущий квартал
    epYear:    26,            // Итого ЕП 2026 (всегда строка 26)
    total2026: 29,            // ИТОГО 2026 (всегда строка 29)
    compShare: 'G31',         // Доля ЭА
    epShare:   'G32'          // Доля ЕП
  };
}


/**
 * Возвращает номера строк для заданного квартала в блоке конкретного ГРБС.
 *
 * Аналогично getQuarterRows_, но с использованием GRBS_BLOCK_MAP_.
 * Квартальные строки ЭА и ЕП идут подряд от compQ1/epQ1 с шагом +1.
 *
 * @param {string} grbsCode — код ГРБС (напр. 'УЭР')
 * @param {number} quarter — номер квартала (1-4)
 * @returns {Object|null} — строки для квартала или null, если ГРБС не найден
 */
function getGrbsQuarterRows_(grbsCode, quarter) {
  let block = GRBS_BLOCK_MAP_[grbsCode];
  if (!block) return null;

  let q = Math.max(1, Math.min(4, quarter || 1));
  let offset = QUARTER_OFFSETS_[q] || 0;

  return {
    compQ:     block.compQ1 + offset,
    compYear:  block.compYear,
    epQ:       block.epQ1 + offset,
    epYear:    block.epYear,
    total2026: block.total2026,
    compShare: block.compShare,
    epShare:   block.epShare
  };
}


/**
 * Чтение полной строки данных из листа СВОД ТД-ПМ (колонки A-U).
 *
 * Возвращает объект со всеми метриками для одной строки: количества,
 * суммы по бюджетам, проценты, экономия.
 *
 * @param {Sheet} sheet — объект листа СВОД ТД-ПМ
 * @param {number} row — номер строки (1-based)
 * @returns {Object} — полный набор метрик строки
 */
function readSvodRow_(sheet, row) {
  try {
    // Читаем весь диапазон A:U за один вызов — это быстрее, чем 21 вызов getRange
    let range = sheet.getRange(row, 1, 1, 21); // A-U = 21 колонка
    let vals = range.getValues()[0];

    return {
      grbs:        vals[0],               // A — метка ГРБС
      quarter:     toNumber_(vals[1]),     // B — квартал
      year:        toNumber_(vals[2]),     // C — год
      planCount:   toNumber_(vals[3]),     // D — план (кол-во)
      factCount:   toNumber_(vals[4]),     // E — факт (кол-во)
      deviation:   toNumber_(vals[5]),     // F — отклонение (кол-во)
      execPct:     toNumber_(vals[6]),     // G — исполнение %
      planFB:      toNumber_(vals[7]),     // H — план ФБ
      planKB:      toNumber_(vals[8]),     // I — план КБ
      planMB:      toNumber_(vals[9]),     // J — план МБ
      planSum:     toNumber_(vals[10]),    // K — план ИТОГО
      factFB:      toNumber_(vals[11]),    // L — факт ФБ
      factKB:      toNumber_(vals[12]),    // M — факт КБ
      factMB:      toNumber_(vals[13]),    // N — факт МБ
      factSum:     toNumber_(vals[14]),    // O — факт ИТОГО
      deviationSum:toNumber_(vals[15]),    // P — отклонение (сумма)
      spentPct:    toNumber_(vals[16]),    // Q — расход %
      econFB:      toNumber_(vals[17]),    // R — экономия ФБ
      econKB:      toNumber_(vals[18]),    // S — экономия КБ
      econMB:      toNumber_(vals[19]),    // T — экономия МБ
      econSum:     toNumber_(vals[20])     // U — экономия ИТОГО
    };
  } catch (e) {
    // Если строка не существует или ошибка чтения — возвращаем пустой объект
    // с null-значениями, чтобы вызывающий код мог безопасно обратиться к полям
    return {
      grbs: null, quarter: null, year: null,
      planCount: null, factCount: null, deviation: null, execPct: null,
      planFB: null, planKB: null, planMB: null, planSum: null,
      factFB: null, factKB: null, factMB: null, factSum: null,
      deviationSum: null, spentPct: null,
      econFB: null, econKB: null, econMB: null, econSum: null
    };
  }
}


/**
 * Пакетное чтение нескольких строк СВОД для минимизации обращений к API.
 *
 * Google Sheets API имеет квоту на количество вызовов — лучше читать
 * большой блок за один раз, чем делать десятки мелких запросов.
 *
 * @param {Sheet} sheet — объект листа СВОД ТД-ПМ
 * @param {number} startRow — первая строка (1-based)
 * @param {number} endRow — последняя строка (1-based)
 * @returns {Object} — карта { номерСтроки: объектМетрик }
 */
function readSvodBlock_(sheet, startRow, endRow) {
  let result = {};
  try {
    let numRows = endRow - startRow + 1;
    if (numRows <= 0) return result;

    let range = sheet.getRange(startRow, 1, numRows, 21);
    let allVals = range.getValues();

    for (let i = 0; i < allVals.length; i++) {
      let rowNum = startRow + i;
      let vals = allVals[i];
      result[rowNum] = {
        grbs:        vals[0],
        quarter:     toNumber_(vals[1]),
        year:        toNumber_(vals[2]),
        planCount:   toNumber_(vals[3]),
        factCount:   toNumber_(vals[4]),
        deviation:   toNumber_(vals[5]),
        execPct:     toNumber_(vals[6]),
        planFB:      toNumber_(vals[7]),
        planKB:      toNumber_(vals[8]),
        planMB:      toNumber_(vals[9]),
        planSum:     toNumber_(vals[10]),
        factFB:      toNumber_(vals[11]),
        factKB:      toNumber_(vals[12]),
        factMB:      toNumber_(vals[13]),
        factSum:     toNumber_(vals[14]),
        deviationSum:toNumber_(vals[15]),
        spentPct:    toNumber_(vals[16]),
        econFB:      toNumber_(vals[17]),
        econKB:      toNumber_(vals[18]),
        econMB:      toNumber_(vals[19]),
        econSum:     toNumber_(vals[20])
      };
    }
  } catch (e) {
    // Ошибка пакетного чтения — возвращаем то, что успели прочитать
  }
  return result;
}


/**
 * Чтение глобальных метрик из блока "ВСЕ" листа СВОД ТД-ПМ.
 *
 * Читает ВСЕ данные из блока "ВСЕ" одним пакетным запросом (строки 7-32),
 * затем извлекает нужные строки по номерам. Это в 10+ раз быстрее, чем
 * читать каждую ячейку по отдельности через DATA_SCHEMA_.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {Sheet} sheet — объект листа СВОД ТД-ПМ
 * @param {number} quarter — текущий квартал (1-4)
 * @returns {Object} — глобальные метрики для rawData
 */
function readGlobalMetrics_(ss, sheet, quarter) {
  let metrics = {};

  try {
    // Пакетное чтение строк 7-32 — весь блок "ВСЕ" за один API-вызов
    let block = readSvodBlock_(sheet, 7, 32);
    let qRows = getQuarterRows_(quarter);

    // --- ЭА: текущий квартал ---
    let compQ = block[qRows.compQ] || {};
    metrics.allCompQPlanCount  = compQ.planCount;
    metrics.allCompQFactCount  = compQ.factCount;
    metrics.allCompQExecPct    = compQ.execPct;
    metrics.allCompQPlanFB     = compQ.planFB;
    metrics.allCompQPlanKB     = compQ.planKB;
    metrics.allCompQPlanMB     = compQ.planMB;
    metrics.allCompQPlanSum    = compQ.planSum;
    metrics.allCompQFactFB     = compQ.factFB;
    metrics.allCompQFactKB     = compQ.factKB;
    metrics.allCompQFactMB     = compQ.factMB;
    metrics.allCompQFactSum    = compQ.factSum;
    metrics.allCompQEconomyFB  = compQ.econFB;
    metrics.allCompQEconomyKB  = compQ.econKB;
    metrics.allCompQEconomyMB  = compQ.econMB;
    metrics.allCompQEconomy    = compQ.econSum;

    // --- ЭА: год ---
    let compYear = block[qRows.compYear] || {};
    metrics.allCompYearPlanCount   = compYear.planCount;
    metrics.allCompYearFactCount   = compYear.factCount;
    metrics.allCompYearExecPct     = compYear.execPct;
    metrics.allCompYearPlanFB      = compYear.planFB;
    metrics.allCompYearPlanKB      = compYear.planKB;
    metrics.allCompYearPlanMB      = compYear.planMB;
    metrics.allCompYearPlanSum     = compYear.planSum;
    metrics.allCompYearFactFB      = compYear.factFB;
    metrics.allCompYearFactKB      = compYear.factKB;
    metrics.allCompYearFactMB      = compYear.factMB;
    metrics.allCompYearFactSum     = compYear.factSum;
    metrics.allCompYearDeviationSum = compYear.deviationSum;
    metrics.allCompYearSpentPct    = compYear.spentPct;
    metrics.allCompYearEconomyFB   = compYear.econFB;
    metrics.allCompYearEconomyKB   = compYear.econKB;
    metrics.allCompYearEconomyMB   = compYear.econMB;
    metrics.allCompYearEconomy     = compYear.econSum;

    // --- ЕП: текущий квартал ---
    let epQ = block[qRows.epQ] || {};
    metrics.allEpQPlanCount  = epQ.planCount;
    metrics.allEpQFactCount  = epQ.factCount;
    metrics.allEpQExecPct    = epQ.execPct;
    metrics.allEpQPlanFB     = epQ.planFB;
    metrics.allEpQPlanKB     = epQ.planKB;
    metrics.allEpQPlanMB     = epQ.planMB;
    metrics.allEpQPlanSum    = epQ.planSum;
    metrics.allEpQFactFB     = epQ.factFB;
    metrics.allEpQFactKB     = epQ.factKB;
    metrics.allEpQFactMB     = epQ.factMB;
    metrics.allEpQFactSum    = epQ.factSum;
    metrics.allEpQEconomyFB  = epQ.econFB;
    metrics.allEpQEconomyKB  = epQ.econKB;
    metrics.allEpQEconomyMB  = epQ.econMB;
    metrics.allEpQEconomy    = epQ.econSum;

    // --- ЕП: год ---
    let epYear = block[qRows.epYear] || {};
    metrics.allEpYearPlanCount   = epYear.planCount;
    metrics.allEpYearFactCount   = epYear.factCount;
    metrics.allEpYearExecPct     = epYear.execPct;
    metrics.allEpYearPlanFB      = epYear.planFB;
    metrics.allEpYearPlanKB      = epYear.planKB;
    metrics.allEpYearPlanMB      = epYear.planMB;
    metrics.allEpYearPlanSum     = epYear.planSum;
    metrics.allEpYearFactFB      = epYear.factFB;
    metrics.allEpYearFactKB      = epYear.factKB;
    metrics.allEpYearFactMB      = epYear.factMB;
    metrics.allEpYearFactSum     = epYear.factSum;
    metrics.allEpYearDeviationSum = epYear.deviationSum;
    metrics.allEpYearSpentPct    = epYear.spentPct;
    metrics.allEpYearEconomyFB   = epYear.econFB;
    metrics.allEpYearEconomyKB   = epYear.econKB;
    metrics.allEpYearEconomyMB   = epYear.econMB;
    metrics.allEpYearEconomy     = epYear.econSum;

    // --- Гранд-тотал (ЭА + ЕП) за 2026 ---
    let total2026 = block[qRows.total2026] || {};
    metrics.allTotalPlanCount2026  = total2026.planCount;
    metrics.allTotalFactCount2026  = total2026.factCount;
    metrics.allTotalExecPct2026    = total2026.execPct;
    metrics.allTotalPlanSum2026    = total2026.planSum;
    metrics.allTotalFactSum2026    = total2026.factSum;
    metrics.allTotalEconomy2026    = total2026.econSum;

    // --- Доли ЭА / ЕП ---
    // Доли хранятся в отдельных строках, а не в основном блоке данных
    let shareRow31 = block[31] || {};
    let shareRow32 = block[32] || {};
    metrics.allCompShare = shareRow31.execPct;  // G31 — доля ЭА (в колонке G)
    metrics.allEpShare   = shareRow32.execPct;  // G32 — доля ЕП (в колонке G)

  } catch (e) {
    log_(ss, 'М3', 'ГЛОБАЛЬНЫЕ', 'Ошибка чтения блока ВСЕ: ' + e.message, null, 'ОШИБКА');
  }

  return metrics;
}


/**
 * Чтение метрик всех 8 ГРБС из листа СВОД ТД-ПМ.
 *
 * Для каждого ГРБС из GRBS_BLOCK_MAP_ читаем блок строк пакетно,
 * затем извлекаем данные по квартальным и годовым строкам.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {Sheet} sheet — объект листа СВОД ТД-ПМ
 * @param {number} quarter — текущий квартал
 * @returns {Array<Object>} — массив объектов ГРБС с полными метриками
 */
function readGrbsMetrics_(ss, sheet, quarter) {
  let grbsList = [];
  let grbsCodes = Object.keys(GRBS_BLOCK_MAP_);

  for (let g = 0; g < grbsCodes.length; g++) {
    let code = grbsCodes[g];
    let blockDef = GRBS_BLOCK_MAP_[code];
    let baseline = GRBS_BASELINES_[code] || {};

    try {
      // Определяем диапазон строк для пакетного чтения:
      // от начала блока до строки доли ЕП (последняя значимая строка)
      let shareRow = parseInt(blockDef.epShare.replace(/[A-Z]/g, ''), 10);
      let blockData = readSvodBlock_(sheet, blockDef.blockStart, shareRow);

      // Определяем строки для текущего квартала
      let qRows = getGrbsQuarterRows_(code, quarter);
      if (!qRows) continue;

      // --- ЭА: текущий квартал ---
      let compQ = blockData[qRows.compQ] || {};

      // --- ЭА: год ---
      let compYear = blockData[qRows.compYear] || {};

      // --- ЕП: текущий квартал ---
      let epQ = blockData[qRows.epQ] || {};

      // --- ЕП: год ---
      let epYear = blockData[qRows.epYear] || {};

      // --- ИТОГО 2026 ---
      let total2026 = blockData[qRows.total2026] || {};

      // --- Доли ---
      let compShareRow = parseInt(blockDef.compShare.replace(/[A-Z]/g, ''), 10);
      let epShareRow = parseInt(blockDef.epShare.replace(/[A-Z]/g, ''), 10);
      let compShareData = blockData[compShareRow] || {};
      let epShareData = blockData[epShareRow] || {};

      // Собираем единый объект ГРБС
      let grbsEntry = {
        code: code,
        name: baseline.fullName || code,
        role: baseline.role || 'НЕИЗВЕСТНО',
        include: true,  // Все 8 ГРБС включаются в отчёт

        // ЭА квартал
        compPlanCountQ:   compQ.planCount,
        compFactCountQ:   compQ.factCount,
        compExecPctQ:     compQ.execPct,
        compPlanFBQ:      compQ.planFB,
        compPlanKBQ:      compQ.planKB,
        compPlanMBQ:      compQ.planMB,
        compPlanSumQ:     compQ.planSum,
        compFactFBQ:      compQ.factFB,
        compFactKBQ:      compQ.factKB,
        compFactMBQ:      compQ.factMB,
        compFactSumQ:     compQ.factSum,
        compEconomyQ:     compQ.econSum,

        // ЭА год
        compPlanCountYear:  compYear.planCount,
        compFactCountYear:  compYear.factCount,
        compExecPctYear:    compYear.execPct,
        compPlanFBYear:     compYear.planFB,
        compPlanKBYear:     compYear.planKB,
        compPlanMBYear:     compYear.planMB,
        compPlanSumYear:    compYear.planSum,
        compFactFBYear:     compYear.factFB,
        compFactKBYear:     compYear.factKB,
        compFactMBYear:     compYear.factMB,
        compFactSumYear:    compYear.factSum,
        compEconomyFBYear:  compYear.econFB,
        compEconomyKBYear:  compYear.econKB,
        compEconomyMBYear:  compYear.econMB,
        compEconomyYear:    compYear.econSum,
        compSpentPctYear:   compYear.spentPct,

        // ЕП квартал
        epPlanCountQ:     epQ.planCount,
        epFactCountQ:     epQ.factCount,
        epExecPctQ:       epQ.execPct,
        epPlanFBQ:        epQ.planFB,
        epPlanKBQ:        epQ.planKB,
        epPlanMBQ:        epQ.planMB,
        epPlanSumQ:       epQ.planSum,
        epFactFBQ:        epQ.factFB,
        epFactKBQ:        epQ.factKB,
        epFactMBQ:        epQ.factMB,
        epFactSumQ:       epQ.factSum,
        epEconomyQ:       epQ.econSum,

        // ЕП год
        epPlanCountYear:  epYear.planCount,
        epFactCountYear:  epYear.factCount,
        epExecPctYear:    epYear.execPct,
        epPlanFBYear:     epYear.planFB,
        epPlanKBYear:     epYear.planKB,
        epPlanMBYear:     epYear.planMB,
        epPlanSumYear:    epYear.planSum,
        epFactFBYear:     epYear.factFB,
        epFactKBYear:     epYear.factKB,
        epFactMBYear:     epYear.factMB,
        epFactSumYear:    epYear.factSum,
        epEconomyFBYear:  epYear.econFB,
        epEconomyKBYear:  epYear.econKB,
        epEconomyMBYear:  epYear.econMB,
        epEconomyYear:    epYear.econSum,
        epSpentPctYear:   epYear.spentPct,

        // ИТОГО 2026
        totalPlanCount2026: total2026.planCount,
        totalFactCount2026: total2026.factCount,
        totalExecPct2026:   total2026.execPct,
        totalPlanSum2026:   total2026.planSum,
        totalFactSum2026:   total2026.factSum,
        totalEconomy2026:   total2026.econSum,

        // Доли
        compShare: compShareData.execPct,  // G-колонка
        epShare:   epShareData.execPct,

        // Вычисляемые поля (для обратной совместимости со старым форматом)
        compPlanCount: compYear.planCount,
        compPlanSum:   compYear.planSum,
        compFactCount: compYear.factCount,
        compFactSum:   compYear.factSum,
        compEconomy:   compYear.econSum,
        compExecPct:   calcPct_(compYear.factSum, compYear.planSum),
        epPlanCount:   epYear.planCount,
        epPlanSum:     epYear.planSum,
        epFactCount:   epYear.factCount,
        epFactSum:     epYear.factSum,
        totalFactSum:  safeAdd_(compYear.factSum, epYear.factSum),

        // Базелайны для сравнения
        expectedExecQ1: baseline.expectedExecQ1 || null,
        normalEpShare:  baseline.normalEpShare || null,

        // Плейсхолдеры для данных из per-ГРБС листов (заполняются позже)
        lineItems:     [],
        epBreakdown:   {},
        grbsComments:  [],
        procInProgress: {}
      };

      // Вычисляем долю ЕП от общего факта (для случая, когда нет в СВОД)
      if (grbsEntry.epShare === null || grbsEntry.epShare === undefined) {
        let totalFact = grbsEntry.totalFactSum;
        if (totalFact && totalFact > 0 && grbsEntry.epFactSum) {
          grbsEntry.epShare = grbsEntry.epFactSum / totalFact;
        }
      }

      grbsList.push(grbsEntry);

    } catch (e) {
      // Не прерываем обработку остальных ГРБС из-за ошибки в одном
      log_(ss, 'М3', 'ГРБС_МЕТРИКИ', 'Ошибка чтения блока ' + code + ': ' + e.message,
           null, 'ОШИБКА');

      // Добавляем ГРБС с минимальными данными, чтобы он не пропал из отчёта
      grbsList.push({
        code: code,
        name: (GRBS_BASELINES_[code] || {}).fullName || code,
        role: (GRBS_BASELINES_[code] || {}).role || 'НЕИЗВЕСТНО',
        include: true,
        _error: e.message,
        lineItems: [], epBreakdown: {}, grbsComments: [], procInProgress: {}
      });
    }
  }

  return grbsList;
}


/**
 * Чтение детальных строк закупок из per-ГРБС листа.
 *
 * Каждый ГРБС имеет отдельный лист (напр. "УЭР") с построчной детализацией
 * всех закупок: предмет, суммы, способ, даты, статус, комментарии.
 *
 * Извлекаемая информация:
 * 1. lineItems — незаключённые конкурентные закупки (остаток)
 * 2. epBreakdown — группировка ЕП по основаниям (п.4, п.5 и т.д.)
 * 3. grbsComments — комментарии ГРБС по закупкам
 * 4. procInProgress — закупки в процессе (по стадиям)
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} grbsCode — код ГРБС (имя листа)
 * @param {number} quarter — текущий квартал
 * @param {number} year — отчётный год
 * @returns {Object} — { lineItems, epBreakdown, grbsComments, procInProgress }
 */
function readGrbsLineItems_(ss, grbsCode, quarter, year) {
  let result = {
    lineItems: [],
    epBreakdown: {},
    grbsComments: [],
    procInProgress: {
      announced: [],    // объявлены (есть дата, нет факта)
      underReview: [],  // на рассмотрении
      contracted: [],   // заключены
      notStarted: []    // не начаты
    }
  };

  try {
    let sheet = ss.getSheetByName(grbsCode);
    if (!sheet) {
      // Лист ГРБС не найден — это нормально для первого запуска или тестового режима
      return result;
    }

    let lastRow = sheet.getLastRow();
    if (lastRow < 2) return result; // Только заголовок или пусто

    // Пакетное чтение всех строк (начиная со 2-й, т.к. 1-я = заголовки)
    // Читаем до колонки AE (31 колонка, 0-indexed до 30)
    let numCols = 31;
    let data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    let cols = RAW_SHEET_COLS_;

    for (let i = 0; i < data.length; i++) {
      let row = data[i];

      // Пропускаем полностью пустые строки (нет номера и нет описания)
      let rowNum = row[cols.rowNum];
      let activity = normalizeString_(row[cols.activity]);
      if (!rowNum && !activity) continue;

      let procMethod = normalizeString_(row[cols.procMethod]);
      let procReason = normalizeString_(row[cols.procReason]);
      let planTotal = toNumber_(row[cols.planTotal]);
      let factTotal = toNumber_(row[cols.factTotal]);
      let plannedQ = toNumber_(row[cols.plannedQ]);
      let plannedYear = toNumber_(row[cols.plannedYear]);
      let actualDate = row[cols.actualDate];
      let actualQ = toNumber_(row[cols.actualQ]);
      let comment = normalizeString_(row[cols.grbsComment]);
      let econTotal = toNumber_(row[cols.econTotal]);

      // Бюджетная разбивка
      let planFB = toNumber_(row[cols.planFB]);
      let planKB = toNumber_(row[cols.planKB]);
      let planMB = toNumber_(row[cols.planMB]);
      let factFB = toNumber_(row[cols.factFB]);
      let factKB = toNumber_(row[cols.factKB]);
      let factMB = toNumber_(row[cols.factMB]);
      let deviationNote = normalizeString_(row[cols.deviationNote]);

      // Определяем, относится ли строка к текущему/прошедшим кварталам отчётного года
      let isRelevantYear = (plannedYear === year);
      let isCurrentOrPastQ = isRelevantYear && (plannedQ !== null) && (plannedQ <= quarter);

      // --- 1. ЕП: группировка по основаниям ---
      if (procMethod && isEpMethod_(procMethod)) {
        let reasonKey = classifyEpReason_(procReason);
        if (!result.epBreakdown[reasonKey]) {
          result.epBreakdown[reasonKey] = {
            reason: reasonKey,
            reasonFull: procReason || 'Не указано',
            count: 0,
            planSum: 0,
            factSum: 0,
            items: []
          };
        }
        result.epBreakdown[reasonKey].count++;
        result.epBreakdown[reasonKey].planSum += (planTotal || 0);
        result.epBreakdown[reasonKey].factSum += (factTotal || 0);

        // Сохраняем первые 10 записей для детализации (больше не нужно)
        if (result.epBreakdown[reasonKey].items.length < 10) {
          result.epBreakdown[reasonKey].items.push({
            activity: activity,
            planSum: planTotal,
            factSum: factTotal,
            reason: procReason
          });
        }
      }

      // --- 2. Незаключённые конкурентные закупки (остаток на текущий квартал) ---
      if (procMethod && isCompMethod_(procMethod) && isCurrentOrPastQ) {
        let hasContract = (factTotal !== null && factTotal > 0) || (actualDate && actualDate !== '');

        if (!hasContract) {
          result.lineItems.push({
            activity: activity,
            department: normalizeString_(row[cols.department]),
            planSum: planTotal,
            planFB: planFB,
            planKB: planKB,
            planMB: planMB,
            plannedQ: plannedQ,
            procMethod: procMethod,
            deviationNote: deviationNote
          });
        }
      }

      // --- 3. Закупки в процессе (по стадиям) ---
      if (procMethod && isCompMethod_(procMethod) && isRelevantYear) {
        let stage = classifyProcStage_(row, cols, quarter);
        if (stage && result.procInProgress[stage]) {
          result.procInProgress[stage].push({
            activity: activity,
            planSum: planTotal,
            procMethod: procMethod,
            plannedQ: plannedQ
          });
        }
      }

      // --- 4. Комментарии ГРБС ---
      if (comment) {
        result.grbsComments.push({
          activity: activity,
          comment: comment,
          planSum: planTotal,
          procMethod: procMethod
        });
      }
    }

    // Сортируем незаключённые по убыванию суммы (самые дорогие — первые)
    result.lineItems.sort(function(a, b) {
      return (b.planSum || 0) - (a.planSum || 0);
    });

  } catch (e) {
    // Ошибка чтения per-ГРБС листа — не критично, просто не будет детализации
    log_(ss, 'М3', 'СТРОКИ_ГРБС', 'Ошибка чтения листа ' + grbsCode + ': ' + e.message,
         null, 'ВНИМАНИЕ');
  }

  return result;
}


/**
 * Определяет, является ли способ закупки конкурентным (ЭА / аукцион / конкурс).
 *
 * Конкурентные способы — это всё, что НЕ единственный поставщик.
 * В СВОД встречаются: "ЭА" (электронный аукцион), "ОК" (открытый конкурс),
 * "ЗК" (запрос котировок) и т.п.
 *
 * @param {string} method — способ закупки из колонки L
 * @returns {boolean}
 */
function isCompMethod_(method) {
  if (!method) return false;
  let m = method.toUpperCase().trim();
  // Конкурентные: ЭА, ОК, ЗК, КОН, АУКЦ и т.д.
  // НЕ конкурентные: ЕП, ед. поставщик
  return m !== 'ЕП' && m.indexOf('ЕДИНСТВ') === -1 && m.indexOf('ЕД.') === -1;
}


/**
 * Определяет, является ли способ закупки единственным поставщиком.
 *
 * @param {string} method — способ закупки из колонки L
 * @returns {boolean}
 */
function isEpMethod_(method) {
  if (!method) return false;
  let m = method.toUpperCase().trim();
  return m === 'ЕП' || m.indexOf('ЕДИНСТВ') !== -1 || m.indexOf('ЕД.') !== -1;
}


/**
 * Классифицирует основание ЕП по категориям для группировки в отчёте.
 *
 * Основания ЕП определены в ст. 93 44-ФЗ. Наиболее частые:
 * - п.4 ч.1 ст.93 — малые закупки до 600 тыс.
 * - п.5 ч.1 ст.93 — образовательные организации
 * - п.8 ч.1 ст.93 — содержание имущества
 * - п.1 ч.1 ст.93 — естественные монополии
 *
 * @param {string} reason — текст основания из колонки M
 * @returns {string} — ключ категории
 */
function classifyEpReason_(reason) {
  if (!reason) return 'прочие';
  let r = reason.toLowerCase();

  if (r.indexOf('п.4') !== -1 || r.indexOf('п. 4') !== -1 || r.indexOf('п4') !== -1) return 'п4_малые';
  if (r.indexOf('п.5') !== -1 || r.indexOf('п. 5') !== -1 || r.indexOf('п5') !== -1) return 'п5_образование';
  if (r.indexOf('п.8') !== -1 || r.indexOf('п. 8') !== -1 || r.indexOf('п8') !== -1) return 'п8_имущество';
  if (r.indexOf('п.1') !== -1 || r.indexOf('п. 1') !== -1 || r.indexOf('п1') !== -1) return 'п1_монополии';
  if (r.indexOf('п.6') !== -1 || r.indexOf('п. 6') !== -1 || r.indexOf('п6') !== -1) return 'п6_работы';
  if (r.indexOf('п.9') !== -1 || r.indexOf('п. 9') !== -1 || r.indexOf('п9') !== -1) return 'п9_культура';
  if (r.indexOf('п.2') !== -1 || r.indexOf('п. 2') !== -1 || r.indexOf('п2') !== -1) return 'п2_оборона';
  if (r.indexOf('п.3') !== -1 || r.indexOf('п. 3') !== -1 || r.indexOf('п3') !== -1) return 'п3_ликвидация';
  if (r.indexOf('п.23') !== -1 || r.indexOf('п. 23') !== -1) return 'п23_аренда';
  if (r.indexOf('п.29') !== -1 || r.indexOf('п. 29') !== -1) return 'п29_содержание';

  // Поиск по ключевым словам, если номер пункта не найден
  if (r.indexOf('монопол') !== -1) return 'п1_монополии';
  if (r.indexOf('содержан') !== -1 || r.indexOf('коммунал') !== -1) return 'п29_содержание';
  if (r.indexOf('аренд') !== -1) return 'п23_аренда';

  return 'прочие';
}


/**
 * Классифицирует стадию закупочной процедуры.
 *
 * Логика определения стадии:
 * - Если есть фактическая дата и факт > 0 → contracted (заключена)
 * - Если есть плановая дата, но нет фактической, и квартал <= текущего → announced
 * - Если запланировано на текущий квартал, но нет никаких признаков начала → notStarted
 *
 * @param {Array} row — строка данных из листа ГРБС
 * @param {Object} cols — маппинг колонок RAW_SHEET_COLS_
 * @param {number} currentQ — текущий квартал
 * @returns {string|null} — стадия: 'announced', 'contracted', 'notStarted' или null
 */
function classifyProcStage_(row, cols, currentQ) {
  let factTotal = toNumber_(row[cols.factTotal]);
  let actualDate = row[cols.actualDate];
  let plannedQ = toNumber_(row[cols.plannedQ]);

  // Уже заключена
  if ((factTotal !== null && factTotal > 0) || (actualDate && actualDate !== '')) {
    return 'contracted';
  }

  // Запланирована на прошедший или текущий квартал, но не заключена
  if (plannedQ !== null && plannedQ <= currentQ) {
    let plannedDate = row[cols.plannedDate];
    // Если есть плановая дата — считаем объявленной (хотя бы запланированной)
    if (plannedDate && plannedDate !== '') {
      return 'announced';
    }
    return 'notStarted';
  }

  return null; // Будущий квартал — не учитываем
}


/**
 * Чтение помесячных данных из листа ШДЮ для трендового анализа.
 *
 * ШДЮ содержит те же колонки, что и СВОД, но в разрезе по месяцам (1-12).
 * Используется для:
 * - Помесячной динамики исполнения
 * - Прогнозирования экономии на оставшиеся месяцы
 * - Выявления сезонных паттернов
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @returns {Object} — { global: { comp: [...], ep: [...] }, byGrbs: { code: { comp: [...], ep: [...] } } }
 */
function readMonthlyData_(ss) {
  let result = {
    global: { comp: [], ep: [] },
    byGrbs: {}
  };

  try {
    let sheet = ss.getSheetByName('ШДЮ');
    if (!sheet) {
      // Лист ШДЮ не обязателен — трендовый анализ просто не будет доступен
      return result;
    }

    let lastRow = sheet.getLastRow();
    if (lastRow < 4) return result;

    // Читаем все данные ШДЮ одним пакетом — до 300 строк, 21 колонка
    let numRows = Math.min(lastRow, 300);
    let allData = sheet.getRange(1, 1, numRows, 21).getValues();

    // --- Глобальные ЭА по месяцам (строки 4-15 = индексы 3-14) ---
    let globalBlock = MONTHLY_BLOCK_MAP_['ВСЕ'];
    for (let row = globalBlock.compStart; row <= globalBlock.compEnd; row++) {
      let idx = row - 1; // 1-based → 0-based
      if (idx >= 0 && idx < allData.length) {
        let vals = allData[idx];
        result.global.comp.push({
          month: row - globalBlock.compStart + 1,
          planCount: toNumber_(vals[3]),
          factCount: toNumber_(vals[4]),
          execPct:   toNumber_(vals[6]),
          planSum:   toNumber_(vals[10]),
          factSum:   toNumber_(vals[14]),
          econSum:   toNumber_(vals[20])
        });
      }
    }

    // --- Глобальные ЕП по месяцам (строки 20-31 = индексы 19-30) ---
    for (let row = globalBlock.epStart; row <= globalBlock.epEnd; row++) {
      let idx = row - 1;
      if (idx >= 0 && idx < allData.length) {
        let vals = allData[idx];
        result.global.ep.push({
          month: row - globalBlock.epStart + 1,
          planCount: toNumber_(vals[3]),
          factCount: toNumber_(vals[4]),
          execPct:   toNumber_(vals[6]),
          planSum:   toNumber_(vals[10]),
          factSum:   toNumber_(vals[14]),
          econSum:   toNumber_(vals[20])
        });
      }
    }

    // --- Per-ГРБС помесячные данные ---
    let grbsCodes = Object.keys(MONTHLY_BLOCK_MAP_);
    for (let g = 0; g < grbsCodes.length; g++) {
      let code = grbsCodes[g];
      if (code === 'ВСЕ') continue; // Глобальные уже обработаны выше

      let mBlock = MONTHLY_BLOCK_MAP_[code];
      if (!mBlock) continue;

      result.byGrbs[code] = { comp: [], ep: [] };

      // ЭА по месяцам
      for (let row = mBlock.compStart; row <= mBlock.compEnd; row++) {
        let idx = row - 1;
        if (idx >= 0 && idx < allData.length) {
          let vals = allData[idx];
          result.byGrbs[code].comp.push({
            month: row - mBlock.compStart + 1,
            planCount: toNumber_(vals[3]),
            factCount: toNumber_(vals[4]),
            planSum:   toNumber_(vals[10]),
            factSum:   toNumber_(vals[14]),
            econSum:   toNumber_(vals[20])
          });
        }
      }

      // ЕП по месяцам
      for (let row = mBlock.epStart; row <= mBlock.epEnd; row++) {
        let idx = row - 1;
        if (idx >= 0 && idx < allData.length) {
          let vals = allData[idx];
          result.byGrbs[code].ep.push({
            month: row - mBlock.epStart + 1,
            planCount: toNumber_(vals[3]),
            factCount: toNumber_(vals[4]),
            planSum:   toNumber_(vals[10]),
            factSum:   toNumber_(vals[14]),
            econSum:   toNumber_(vals[20])
          });
        }
      }
    }

  } catch (e) {
    log_(ss, 'М3', 'ШДЮ', 'Ошибка чтения помесячных данных: ' + e.message, null, 'ВНИМАНИЕ');
  }

  return result;
}


/**
 * Расчёт прогнозной экономии на оставшиеся кварталы.
 *
 * Логика: берём среднюю экономию за завершённые месяцы текущего года
 * и экстраполируем на оставшиеся. Если данных мало (< 2 месяцев),
 * используем годовой план как fallback.
 *
 * @param {Object} monthlyData — данные из readMonthlyData_
 * @param {number} currentMonth — текущий месяц (1-12)
 * @returns {Object} — { compRemaining, epRemaining, totalRemaining, method }
 */
function calcRemainingEconomy_(monthlyData, currentMonth) {
  let result = {
    compRemaining: null,
    epRemaining: null,
    totalRemaining: null,
    method: 'нет данных'
  };

  try {
    if (!monthlyData || !monthlyData.global) return result;

    // Считаем накопленную экономию ЭА за прошедшие месяцы
    let compEconTotal = 0;
    let compMonthsWithData = 0;
    let compMonths = monthlyData.global.comp || [];
    for (let i = 0; i < compMonths.length && i < currentMonth; i++) {
      let econ = compMonths[i].econSum;
      if (econ !== null && econ !== undefined) {
        compEconTotal += econ;
        compMonthsWithData++;
      }
    }

    // Аналогично для ЕП
    let epEconTotal = 0;
    let epMonthsWithData = 0;
    let epMonths = monthlyData.global.ep || [];
    for (let i = 0; i < epMonths.length && i < currentMonth; i++) {
      let econ = epMonths[i].econSum;
      if (econ !== null && econ !== undefined) {
        epEconTotal += econ;
        epMonthsWithData++;
      }
    }

    // Экстраполяция: средняя за месяц * оставшиеся месяцы
    let remainingMonths = 12 - currentMonth;
    if (remainingMonths <= 0) {
      // Год закончился — экономия уже полная
      result.compRemaining = 0;
      result.epRemaining = 0;
      result.totalRemaining = 0;
      result.method = 'год завершён';
      return result;
    }

    if (compMonthsWithData >= 2) {
      let avgCompEcon = compEconTotal / compMonthsWithData;
      result.compRemaining = avgCompEcon * remainingMonths;
      result.method = 'экстраполяция';
    }

    if (epMonthsWithData >= 2) {
      let avgEpEcon = epEconTotal / epMonthsWithData;
      result.epRemaining = avgEpEcon * remainingMonths;
      result.method = 'экстраполяция';
    }

    // Если оба компонента рассчитаны — суммируем
    if (result.compRemaining !== null && result.epRemaining !== null) {
      result.totalRemaining = result.compRemaining + result.epRemaining;
    } else if (result.compRemaining !== null) {
      result.totalRemaining = result.compRemaining;
    } else if (result.epRemaining !== null) {
      result.totalRemaining = result.epRemaining;
    }

  } catch (e) {
    // При ошибке — оставляем null, отчёт просто не покажет прогноз
  }

  return result;
}


/**
 * ОСНОВНАЯ ФУНКЦИЯ ИЗВЛЕЧЕНИЯ ДАННЫХ — стадия 1 конвейера.
 *
 * Полностью переписана. Теперь читает данные напрямую из СВОД ТД-ПМ
 * и per-ГРБС листов, без обращения к несуществующим промежуточным листам.
 *
 * Порядок чтения:
 * 1. Определяем дату отчёта, квартал, год
 * 2. Читаем глобальные метрики из блока "ВСЕ" (строки 7-32)
 * 3. Читаем метрики каждого ГРБС из именных блоков (строки 37-277)
 * 4. Читаем per-ГРБС строки закупок из индивидуальных листов
 * 5. Читаем помесячные данные из ШДЮ
 * 6. Рассчитываем прогноз экономии
 * 7. Валидируем полноту данных
 *
 * @param {Spreadsheet} ss — объект таблицы Google Sheets
 * @returns {Object} — { rawData: {...}, grbsRows: [...], issues: [...] }
 */
function extractData_(ss) {
  let issues = [];
  let rawData = {};

  log_(ss, 'М3', 'ИЗВЛЕЧЕНИЕ', 'Начало извлечения данных (v2.0 с исправленными ссылками)', null, 'ИНФО');

  // ===================================================================
  // ШАГ 1: Определяем отчётный период
  // ===================================================================
  // Дата отчёта — текущая дата (листы REPORT_SETTINGS не существуют)
  let reportDate = new Date();
  let reportYear = reportDate.getFullYear();
  let reportQuarter = detectCurrentQuarter_(reportDate);
  let reportMonth = reportDate.getMonth() + 1; // 1-12

  rawData.report_date = reportDate;
  rawData.report_year = reportYear;
  rawData.report_quarter = reportQuarter;
  rawData.report_month = reportMonth;

  log_(ss, 'М3', 'ПЕРИОД',
       'Отчётный период: Q' + reportQuarter + ' ' + reportYear + ', месяц ' + reportMonth,
       null, 'ИНФО');

  // ===================================================================
  // ШАГ 2: Открываем лист СВОД ТД-ПМ
  // ===================================================================
  let svodSheet = null;
  try {
    svodSheet = ss.getSheetByName(CFG_.SHEETS.SVOD);
    if (!svodSheet) {
      issues.push({
        field: 'SVOD_SHEET',
        severity: 'КРИТИЧЕСКАЯ',
        message: 'Лист "' + CFG_.SHEETS.SVOD + '" не найден в таблице. Извлечение данных невозможно.'
      });
      log_(ss, 'М3', 'СВОД', 'КРИТИЧЕСКАЯ ОШИБКА: лист СВОД ТД-ПМ не найден', null, 'КРИТИЧЕСКАЯ');
      return { rawData: rawData, grbsRows: [], issues: issues };
    }
  } catch (e) {
    issues.push({
      field: 'SVOD_SHEET',
      severity: 'КРИТИЧЕСКАЯ',
      message: 'Ошибка доступа к листу СВОД: ' + e.message
    });
    return { rawData: rawData, grbsRows: [], issues: issues };
  }

  // ===================================================================
  // ШАГ 3: Глобальные метрики (блок "ВСЕ")
  // ===================================================================
  try {
    let globalMetrics = readGlobalMetrics_(ss, svodSheet, reportQuarter);

    // Копируем все глобальные метрики в rawData
    let metricKeys = Object.keys(globalMetrics);
    for (let i = 0; i < metricKeys.length; i++) {
      rawData[metricKeys[i]] = globalMetrics[metricKeys[i]];
    }

    // Обратная совместимость: заполняем поля в формате старой DATA_SCHEMA_
    // чтобы модули М4-М15 могли работать без переделки
    rawData.all_comp_year_plan_count = globalMetrics.allCompYearPlanCount;
    rawData.all_comp_year_plan_sum   = globalMetrics.allCompYearPlanSum;
    rawData.all_comp_year_fact_count = globalMetrics.allCompYearFactCount;
    rawData.all_comp_year_fact_sum   = globalMetrics.allCompYearFactSum;
    rawData.all_comp_year_exec_pct   = globalMetrics.allCompYearExecPct;
    rawData.all_comp_year_economy_sum = globalMetrics.allCompYearEconomy;
    rawData.all_ep_year_plan_count   = globalMetrics.allEpYearPlanCount;
    rawData.all_ep_year_plan_sum     = globalMetrics.allEpYearPlanSum;
    rawData.all_ep_year_fact_count   = globalMetrics.allEpYearFactCount;
    rawData.all_ep_year_fact_sum     = globalMetrics.allEpYearFactSum;
    rawData.all_ep_year_exec_pct     = globalMetrics.allEpYearExecPct;

    // Квартальные данные — с динамическим именованием (Q1, Q2 и т.д.)
    rawData['all_comp_q' + reportQuarter + '_plan_count'] = globalMetrics.allCompQPlanCount;
    rawData['all_comp_q' + reportQuarter + '_fact_count'] = globalMetrics.allCompQFactCount;
    rawData['all_comp_q' + reportQuarter + '_plan_sum']   = globalMetrics.allCompQPlanSum;
    rawData['all_comp_q' + reportQuarter + '_fact_sum']   = globalMetrics.allCompQFactSum;
    rawData['all_comp_q' + reportQuarter + '_exec_pct']   = globalMetrics.allCompQExecPct;
    rawData['all_ep_q' + reportQuarter + '_plan_count']   = globalMetrics.allEpQPlanCount;
    rawData['all_ep_q' + reportQuarter + '_fact_count']   = globalMetrics.allEpQFactCount;
    rawData['all_ep_q' + reportQuarter + '_plan_sum']     = globalMetrics.allEpQPlanSum;
    rawData['all_ep_q' + reportQuarter + '_fact_sum']     = globalMetrics.allEpQFactSum;
    rawData['all_ep_q' + reportQuarter + '_exec_pct']     = globalMetrics.allEpQExecPct;

    log_(ss, 'М3', 'ГЛОБАЛЬНЫЕ', 'Глобальные метрики прочитаны', {
      compYearPlan: globalMetrics.allCompYearPlanCount,
      compYearFact: globalMetrics.allCompYearFactCount,
      epYearPlan: globalMetrics.allEpYearPlanCount,
      epYearFact: globalMetrics.allEpYearFactCount,
      totalPlan: globalMetrics.allTotalPlanCount2026,
      totalFact: globalMetrics.allTotalFactCount2026
    }, 'ИНФО');

  } catch (e) {
    issues.push({
      field: 'global_metrics',
      severity: 'ОШИБКА',
      message: 'Ошибка чтения глобальных метрик: ' + e.message
    });
    log_(ss, 'М3', 'ГЛОБАЛЬНЫЕ', 'ОШИБКА: ' + e.message, null, 'ОШИБКА');
  }

  // ===================================================================
  // ШАГ 4: Метрики ГРБС из СВОД ТД-ПМ
  // ===================================================================
  let grbsRows = [];
  try {
    grbsRows = readGrbsMetrics_(ss, svodSheet, reportQuarter);

    if (grbsRows.length === 0) {
      issues.push({
        field: 'grbsRows',
        severity: 'ОШИБКА',
        message: 'Не удалось прочитать ни одного блока ГРБС из СВОД ТД-ПМ'
      });
    } else {
      log_(ss, 'М3', 'ГРБС_СВОД', 'Прочитано блоков ГРБС: ' + grbsRows.length, null, 'ИНФО');

      // UO compat: заполняем uo_* ключи в rawData для buildUoGlobalMetrics_
      for (let gi = 0; gi < grbsRows.length; gi++) {
        if (grbsRows[gi].code === 'УО') {
          let uo = grbsRows[gi];
          rawData.uo_comp_year_plan_count = uo.compPlanCount || 0;
          rawData.uo_comp_year_fact_count = uo.compFactCount || 0;
          rawData.uo_comp_year_plan_sum   = uo.compPlanSum || 0;
          rawData.uo_comp_year_fact_sum   = uo.compFactSum || 0;
          rawData.uo_comp_year_economy_sum = uo.compEconomy || 0;
          rawData.uo_ep_year_plan_count   = uo.epPlanCount || 0;
          rawData.uo_ep_year_fact_count   = uo.epFactCount || 0;
          rawData.uo_ep_year_plan_sum     = uo.epPlanSum || 0;
          rawData.uo_ep_year_fact_sum     = uo.epFactSum || 0;
          break;
        }
      }
    }
  } catch (e) {
    issues.push({
      field: 'grbsRows',
      severity: 'КРИТИЧЕСКАЯ',
      message: 'Ошибка чтения блоков ГРБС: ' + e.message
    });
  }

  // ===================================================================
  // ШАГ 5: Per-ГРБС строки закупок из индивидуальных листов
  // ===================================================================
  for (let g = 0; g < grbsRows.length; g++) {
    let grbs = grbsRows[g];
    try {
      let lineData = readGrbsLineItems_(ss, grbs.code, reportQuarter, reportYear);

      grbs.lineItems = lineData.lineItems;
      grbs.epBreakdown = lineData.epBreakdown;
      grbs.grbsComments = lineData.grbsComments;
      grbs.procInProgress = lineData.procInProgress;

      // Считаем суммарные показатели по строкам
      grbs.remainingCompCount = lineData.lineItems.length;
      grbs.remainingCompSum = 0;
      for (let j = 0; j < lineData.lineItems.length; j++) {
        grbs.remainingCompSum += (lineData.lineItems[j].planSum || 0);
      }

      // Количество ЕП по категориям
      grbs.epCategoryCount = Object.keys(lineData.epBreakdown).length;
      grbs.grbsCommentCount = lineData.grbsComments.length;

    } catch (e) {
      // Ошибка чтения деталей одного ГРБС не блокирует остальных
      issues.push({
        field: 'grbs_lines_' + grbs.code,
        severity: 'ВНИМАНИЕ',
        message: 'Не удалось прочитать строки закупок для ' + grbs.code + ': ' + e.message
      });
    }
  }

  log_(ss, 'М3', 'СТРОКИ', 'Детализация закупок прочитана для ' + grbsRows.length + ' ГРБС',
       null, 'ИНФО');

  // ===================================================================
  // ШАГ 6: Помесячные данные из ШДЮ
  // ===================================================================
  let monthlyData = null;
  try {
    monthlyData = readMonthlyData_(ss);
    rawData.monthlyData = monthlyData;

    // Считаем помесячную статистику
    let globalCompMonths = (monthlyData.global && monthlyData.global.comp) ?
                           monthlyData.global.comp.length : 0;
    let globalEpMonths = (monthlyData.global && monthlyData.global.ep) ?
                         monthlyData.global.ep.length : 0;

    log_(ss, 'М3', 'ШДЮ', 'Помесячные данные: ЭА=' + globalCompMonths + ' мес., ЕП=' + globalEpMonths + ' мес.',
         null, 'ИНФО');

  } catch (e) {
    issues.push({
      field: 'monthly_data',
      severity: 'ВНИМАНИЕ',
      message: 'Ошибка чтения ШДЮ (помесячные данные): ' + e.message
    });
  }

  // ===================================================================
  // ШАГ 7: Прогноз экономии
  // ===================================================================
  try {
    let econProj = calcRemainingEconomy_(monthlyData, reportMonth);
    rawData.remainingEconomy = econProj.totalRemaining;
    rawData.remainingEconomyComp = econProj.compRemaining;
    rawData.remainingEconomyEp = econProj.epRemaining;
    rawData.economyProjectionMethod = econProj.method;

    if (econProj.totalRemaining !== null) {
      log_(ss, 'М3', 'ПРОГНОЗ', 'Прогноз экономии: ' + econProj.totalRemaining +
           ' тыс. руб. (метод: ' + econProj.method + ')', null, 'ИНФО');
    }
  } catch (e) {
    issues.push({
      field: 'economy_projection',
      severity: 'ВНИМАНИЕ',
      message: 'Ошибка расчёта прогноза экономии: ' + e.message
    });
  }

  // ===================================================================
  // ШАГ 8: Валидация контракта данных
  // ===================================================================
  let contractIssues = validateDataContract_(rawData, grbsRows);
  issues = issues.concat(contractIssues);

  // ===================================================================
  // ШАГ 9: Обогащение rawData доп. полями для обратной совместимости
  // ===================================================================
  // Модули М4-М15 ожидают определённые поля — заполняем их
  enrichRawDataCompat_(rawData);

  // ===================================================================
  // Итоговое логирование
  // ===================================================================
  let criticalIssues = issues.filter(function(iss) {
    return iss.severity === 'КРИТИЧЕСКАЯ' || iss.severity === 'ОШИБКА';
  });

  log_(ss, 'М3', 'ИЗВЛЕЧЕНИЕ', 'Извлечение завершено', {
    grbsCount: grbsRows.length,
    issuesTotal: issues.length,
    issuesCritical: criticalIssues.length,
    quarter: reportQuarter,
    year: reportYear,
    monthlyDataAvailable: monthlyData !== null
  }, criticalIssues.length > 0 ? 'ВНИМАНИЕ' : 'ИНФО');

  return {
    rawData: rawData,
    grbsRows: grbsRows,
    issues: issues
  };
}


/**
 * Обогащение rawData полями обратной совместимости.
 *
 * Модули М4-М15 написаны в расчёте на определённую структуру rawData.
 * Чтобы не переписывать все 12 модулей, заполняем ожидаемые ими поля
 * из новых (правильных) данных.
 *
 * @param {Object} rawData — объект с извлечёнными данными
 */
function enrichRawDataCompat_(rawData) {
  // Суммарный план и факт (для расчёта % исполнения на верхнем уровне)
  rawData.totalPlanCount = rawData.allTotalPlanCount2026;
  rawData.totalFactCount = rawData.allTotalFactCount2026;
  rawData.totalPlanSum = rawData.allTotalPlanSum2026;
  rawData.totalFactSum = rawData.allTotalFactSum2026;

  // Общее исполнение (по количеству)
  rawData.totalExecPct = calcPct_(rawData.totalFactCount, rawData.totalPlanCount);

  // Доли — могут быть как долями (0..1), так и процентами (0..100)
  // Нормализуем: всегда храним как доли (0..1)
  if (rawData.allCompShare !== null && rawData.allCompShare > 1) {
    rawData.allCompShare = rawData.allCompShare / 100;
  }
  if (rawData.allEpShare !== null && rawData.allEpShare > 1) {
    rawData.allEpShare = rawData.allEpShare / 100;
  }

  // Суммарная экономия за текущий период
  rawData.totalEconomy = safeAdd_(rawData.allCompYearEconomy, rawData.allEpYearEconomy);
}


/**
 * Проверка контракта данных: все ли обязательные поля заполнены.
 *
 * Переписана для работы с новой структурой rawData.
 * Проверяет наличие критических полей и корректность значений.
 *
 * @param {Object} rawData — глобальные показатели
 * @param {Array} grbsRows — строки ГРБС
 * @returns {Array} — список проблем
 */
function validateDataContract_(rawData, grbsRows) {
  let issues = [];

  // --- Критические глобальные поля ---
  let criticalFields = [
    { key: 'allCompYearPlanCount', label: 'ЭА год: план (кол-во)' },
    { key: 'allCompYearPlanSum',   label: 'ЭА год: план (сумма)' },
    { key: 'allCompYearFactCount', label: 'ЭА год: факт (кол-во)' },
    { key: 'allCompYearFactSum',   label: 'ЭА год: факт (сумма)' },
    { key: 'allEpYearPlanCount',   label: 'ЕП год: план (кол-во)' },
    { key: 'allEpYearPlanSum',     label: 'ЕП год: план (сумма)' },
    { key: 'allEpYearFactCount',   label: 'ЕП год: факт (кол-во)' },
    { key: 'allEpYearFactSum',     label: 'ЕП год: факт (сумма)' }
  ];

  for (let i = 0; i < criticalFields.length; i++) {
    let field = criticalFields[i];
    let val = rawData[field.key];
    if (val === null || val === undefined) {
      issues.push({
        field: field.key,
        severity: 'ОШИБКА',
        message: 'Критическое поле "' + field.label + '" отсутствует в данных СВОД'
      });
    }
  }

  // --- Проверка наличия всех ГРБС ---
  if (grbsRows.length > 0) {
    let grbsCodes = grbsRows.map(function(r) { return r.code; });
    let expectedGrbs = Object.keys(GRBS_BLOCK_MAP_);
    for (let i = 0; i < expectedGrbs.length; i++) {
      if (grbsCodes.indexOf(expectedGrbs[i]) === -1) {
        issues.push({
          field: 'grbs_' + expectedGrbs[i],
          severity: 'ВНИМАНИЕ',
          message: 'ГРБС "' + expectedGrbs[i] + '" отсутствует в прочитанных данных'
        });
      }
    }
  }

  // --- Проверка правдоподобности значений ---
  // План не может быть отрицательным
  if (rawData.allCompYearPlanCount !== null && rawData.allCompYearPlanCount < 0) {
    issues.push({
      field: 'allCompYearPlanCount',
      severity: 'ВНИМАНИЕ',
      message: 'План ЭА (кол-во) отрицательный: ' + rawData.allCompYearPlanCount
    });
  }
  // Факт не должен быть больше плана (предупреждение, не ошибка)
  if (rawData.allCompYearFactCount > rawData.allCompYearPlanCount) {
    issues.push({
      field: 'allCompYearFactCount',
      severity: 'ВНИМАНИЕ',
      message: 'Факт ЭА (' + rawData.allCompYearFactCount + ') > плана (' +
               rawData.allCompYearPlanCount + ')'
    });
  }

  // --- Проверка суммарной согласованности ---
  // Гранд-тотал должен примерно равняться сумме ЭА + ЕП
  if (rawData.allCompYearPlanCount !== null && rawData.allEpYearPlanCount !== null &&
      rawData.allTotalPlanCount2026 !== null) {
    let calcTotal = rawData.allCompYearPlanCount + rawData.allEpYearPlanCount;
    let diff = Math.abs(calcTotal - rawData.allTotalPlanCount2026);
    if (diff > 5) { // Допуск: 5 единиц (из-за округлений)
      issues.push({
        field: 'total_consistency',
        severity: 'ВНИМАНИЕ',
        message: 'ИТОГО план (' + rawData.allTotalPlanCount2026 + ') != ЭА (' +
                 rawData.allCompYearPlanCount + ') + ЕП (' + rawData.allEpYearPlanCount +
                 '). Разница: ' + diff
      });
    }
  }

  // --- Проверка мета-информации ---
  if (!rawData.report_date) {
    issues.push({
      field: 'report_date',
      severity: 'ВНИМАНИЕ',
      message: 'Не удалось определить дату отчёта — используется текущая дата'
    });
  }

  return issues;
}


/**
 * Безопасное чтение одной ячейки по имени листа и A1-нотации.
 *
 * Сохранена для обратной совместимости с другими модулями,
 * которые могут вызывать readCell_ напрямую.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} sheetName — имя листа
 * @param {string} cellNotation — A1-нотация ячейки (напр. 'D14')
 * @returns {*} — значение ячейки или null
 */
function readCell_(ss, sheetName, cellNotation) {
  try {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) return null;
    let value = sheet.getRange(cellNotation).getValue();
    if (value === '') return null;
    return value;
  } catch (e) {
    return null;
  }
}


/**
 * Fallback-чтение через DATA_SCHEMA_ и именованные диапазоны.
 *
 * Сохранена для обратной совместимости. Используется другими модулями,
 * которые могут вызывать readFromCellMap_ для получения конкретных ячеек.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {string} key — ключ из DATA_SCHEMA_
 * @returns {*} — значение или null
 */
function readFromCellMap_(ss, key) {
  let spec = DATA_SCHEMA_[key];
  if (!spec) return null;

  try {
    return readCell_(ss, spec.sheet, spec.cell);
  } catch (e) {
    try {
      let namedRange = ss.getRangeByName(key);
      if (namedRange) return namedRange.getValue() || null;
    } catch (e2) {
      // Ни один метод не сработал
    }
    return null;
  }
}
// =============================================================================
// М4: СКОРИНГ ДОВЕРИЯ К ДАННЫМ (стадия 2 конвейера)
// =============================================================================
// Оценивает качество входных данных по 5 измерениям (0-100 баллов).
// Это критически важно: если данные плохого качества, аналитика будет
// вводить в заблуждение. Лучше честно сказать «данные ненадёжны»,
// чем выдать красивый, но ложный отчёт.
// =============================================================================

/**
 * Основная функция скоринга доверия — стадия 2 конвейера.
 * Вычисляет взвешенную оценку качества данных по 5 измерениям:
 * полнота, правдоподобность, согласованность, свежесть, волатильность.
 *
 * @param {Object} rawData — глобальные показатели из стадии 1
 * @param {Array} grbsRows — строки ГРБС из стадии 1
 * @param {Object|null} previousSnapshot — предыдущий срез для оценки волатильности
 * @returns {Object} — { total, grade, completeness, plausibility, consistency, freshness, volatility, issues }
 */
function scoreTrust_(rawData, grbsRows, previousSnapshot) {
  let issues = [];

  // Вычисляем каждое измерение независимо (0-100)
  let compResult = completenessScore_(rawData, grbsRows);
  let plausResult = plausibilityScore_(grbsRows);
  let consResult = consistencyScore_(rawData, grbsRows);
  let freshResult = freshnessScore_(rawData);
  let volResult = volatilityScore_(rawData, previousSnapshot);

  // Собираем проблемы от каждого измерения
  issues = issues
    .concat(compResult.issues || [])
    .concat(plausResult.issues || [])
    .concat(consResult.issues || [])
    .concat(freshResult.issues || [])
    .concat(volResult.issues || []);

  // Взвешенная сумма по весам из конфигурации
  let w = CFG_.TRUST_WEIGHTS;
  let total = Math.round(
    compResult.score * w.completeness +
    plausResult.score * w.plausibility +
    consResult.score * w.consistency +
    freshResult.score * w.freshness +
    volResult.score * w.volatility
  );

  // Ограничиваем диапазоном 0-100
  total = Math.max(0, Math.min(100, total));

  let grade = trustGrade_(total);

  return {
    total: total,
    grade: grade,
    completeness: compResult.score,
    plausibility: plausResult.score,
    consistency: consResult.score,
    freshness: freshResult.score,
    volatility: volResult.score,
    issues: issues
  };
}

/**
 * 1. ПОЛНОТА: процент заполненных обязательных ячеек.
 * Пустые ячейки — первый признак проблем с данными.
 * 100 = все поля заполнены, 0 = все пусты.
 *
 * @param {Object} rawData — глобальные показатели
 * @param {Array} grbsRows — строки ГРБС
 * @returns {Object} — { score: 0-100, issues: [] }
 */
function completenessScore_(rawData, grbsRows) {
  let issues = [];
  let totalFields = 0;
  let filledFields = 0;

  // Проверяем глобальные поля из DATA_SCHEMA_
  let schemaKeys = Object.keys(DATA_SCHEMA_);
  for (let i = 0; i < schemaKeys.length; i++) {
    totalFields++;
    if (rawData[schemaKeys[i]] !== null && rawData[schemaKeys[i]] !== undefined) {
      filledFields++;
    }
  }

  // Проверяем ключевые поля в каждой строке ГРБС
  let grbsFieldKeys = ['compPlanCount', 'compPlanSum', 'compFactCount', 'compFactSum',
                        'epPlanCount', 'epPlanSum', 'epFactCount', 'epFactSum'];

  for (let i = 0; i < grbsRows.length; i++) {
    for (let j = 0; j < grbsFieldKeys.length; j++) {
      totalFields++;
      if (grbsRows[i][grbsFieldKeys[j]] !== null && grbsRows[i][grbsFieldKeys[j]] !== undefined) {
        filledFields++;
      }
    }
  }

  // Если нет полей вообще — считаем полноту нулевой
  let score = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;

  if (score < 80) {
    issues.push({
      dimension: 'completeness',
      severity: score < 50 ? 'ОШИБКА' : 'ВНИМАНИЕ',
      message: 'Заполнено ' + filledFields + ' из ' + totalFields + ' обязательных полей (' + score + '%)'
    });
  }

  return { score: score, issues: issues };
}

/**
 * 2. ПРАВДОПОДОБНОСТЬ: тест Бенфорда + проверка выбросов.
 * Закон Бенфорда: в реальных финансовых данных первая цифра «1» встречается
 * в ~30% случаев, «9» — в ~5%. Отклонение от этого распределения может
 * указывать на подделку данных или систематические ошибки.
 *
 * @param {Array} grbsRows — строки ГРБС
 * @returns {Object} — { score: 0-100, issues: [] }
 */
function plausibilityScore_(grbsRows) {
  let issues = [];

  // Собираем все денежные суммы для теста Бенфорда
  let amounts = [];
  for (let i = 0; i < grbsRows.length; i++) {
    let row = grbsRows[i];
    let fields = [row.compPlanSum, row.compFactSum, row.epPlanSum, row.epFactSum, row.compEconomy];
    for (let j = 0; j < fields.length; j++) {
      let val = toNumber_(fields[j]);
      // Бенфорд работает только с положительными числами > 0
      if (val !== null && val > 0) {
        amounts.push(val);
      }
    }
  }

  let score = 100; // Начинаем с идеальной оценки и вычитаем за проблемы

  // Тест Бенфорда — только если достаточно данных для статистической значимости
  if (amounts.length >= CFG_.BENFORD_MIN_SAMPLES) {
    let benford = benfordTest_(amounts);
    if (benford.mad > CFG_.BENFORD_MAD_CRITICAL) {
      score -= 40;
      issues.push({
        dimension: 'plausibility',
        severity: 'ОШИБКА',
        message: 'Тест Бенфорда: критическое отклонение (MAD=' + benford.mad.toFixed(4) + '). Данные могут быть недостоверны.'
      });
    } else if (benford.mad > CFG_.BENFORD_MAD_SUSPICIOUS) {
      score -= 15;
      issues.push({
        dimension: 'plausibility',
        severity: 'ВНИМАНИЕ',
        message: 'Тест Бенфорда: подозрительное отклонение (MAD=' + benford.mad.toFixed(4) + ')'
      });
    }
  } else {
    // Недостаточно данных для теста — снижаем уверенность, но не критично
    score -= 10;
    issues.push({
      dimension: 'plausibility',
      severity: 'ИНФОРМАЦИЯ',
      message: 'Недостаточно данных для теста Бенфорда (' + amounts.length + ' из ' + CFG_.BENFORD_MIN_SAMPLES + ' необходимых)'
    });
  }

  // Проверка выбросов через Z-score: если значение отклоняется от среднего
  // более чем на 3 стандартных отклонения, это подозрительно
  if (amounts.length >= 5) {
    let outliers = detectOutliers_(amounts);
    if (outliers.count > 0) {
      let pctOutliers = outliers.count / amounts.length;
      if (pctOutliers > 0.15) {
        score -= 25;
        issues.push({
          dimension: 'plausibility',
          severity: 'ВНИМАНИЕ',
          message: 'Обнаружено ' + outliers.count + ' выбросов (' + fmtPct_(pctOutliers, 0) + ' значений)'
        });
      } else if (pctOutliers > 0.05) {
        score -= 10;
      }
    }
  }

  return { score: Math.max(0, score), issues: issues };
}

/**
 * Тест Бенфорда: сравнивает распределение первых цифр с теоретическим.
 * Теоретическое распределение: P(d) = log10(1 + 1/d) для d = 1..9.
 *
 * @param {Array<number>} amounts — массив сумм
 * @returns {Object} — { mad: число, observed: массив, expected: массив }
 */
function benfordTest_(amounts) {
  // Теоретические частоты первой цифры по Бенфорду
  let expected = [];
  for (let d = 1; d <= 9; d++) {
    expected.push(Math.log10(1 + 1 / d));
  }

  // Считаем фактические частоты первой значащей цифры
  let counts = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // для цифр 1-9
  let validCount = 0;

  for (let i = 0; i < amounts.length; i++) {
    let firstDigit = getFirstDigit_(amounts[i]);
    if (firstDigit >= 1 && firstDigit <= 9) {
      counts[firstDigit - 1]++;
      validCount++;
    }
  }

  if (validCount === 0) return { mad: 0, observed: counts, expected: expected };

  // Нормализуем в частоты
  let observed = counts.map(function(c) { return c / validCount; });

  // Вычисляем MAD (Mean Absolute Deviation)
  let mad = 0;
  for (let i = 0; i < 9; i++) {
    mad += Math.abs(observed[i] - expected[i]);
  }
  mad /= 9;

  return { mad: mad, observed: observed, expected: expected };
}

/**
 * Извлечение первой значащей цифры числа (для теста Бенфорда).
 */
function getFirstDigit_(num) {
  if (!num || num <= 0) return 0;
  let s = Math.abs(num).toExponential();
  return parseInt(s.charAt(0), 10) || 0;
}

/**
 * Обнаружение выбросов через Z-score (метод стандартных отклонений).
 * Значение считается выбросом, если |Z| > 3.
 *
 * @param {Array<number>} values — массив чисел
 * @returns {Object} — { count: число_выбросов, indices: массив_индексов }
 */
function detectOutliers_(values) {
  if (values.length < 3) return { count: 0, indices: [] };

  // Вычисляем среднее
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  let mean = sum / values.length;

  // Вычисляем стандартное отклонение
  let sqDiffSum = 0;
  for (let i = 0; i < values.length; i++) {
    sqDiffSum += (values[i] - mean) * (values[i] - mean);
  }
  let stddev = Math.sqrt(sqDiffSum / values.length);

  // Если все значения одинаковые — выбросов нет
  if (stddev === 0) return { count: 0, indices: [] };

  let outlierIndices = [];
  for (let i = 0; i < values.length; i++) {
    let z = Math.abs((values[i] - mean) / stddev);
    if (z > 3) outlierIndices.push(i);
  }

  return { count: outlierIndices.length, indices: outlierIndices };
}

/**
 * 3. СОГЛАСОВАННОСТЬ: проверка внутренней логики данных.
 * plan >= fact (нельзя выполнить больше, чем запланировано),
 * сумма частей = итого, проценты вычисляются корректно.
 *
 * @param {Object} rawData — глобальные показатели
 * @param {Array} grbsRows — строки ГРБС
 * @returns {Object} — { score: 0-100, issues: [] }
 */
function consistencyScore_(rawData, grbsRows) {
  let issues = [];
  let checks = 0;
  let passed = 0;

  // Проверка 1: факт не превышает план по суммам (для каждого ГРБС)
  for (let i = 0; i < grbsRows.length; i++) {
    let row = grbsRows[i];

    // Конкурентные: факт <= план
    if (row.compPlanSum !== null && row.compFactSum !== null) {
      checks++;
      if (row.compFactSum <= row.compPlanSum * 1.05) { // допуск 5% на округления
        passed++;
      } else {
        issues.push({
          dimension: 'consistency',
          severity: 'ВНИМАНИЕ',
          message: row.code + ': факт конкурентных (' + fmtMoney_(row.compFactSum) +
                   ') превышает план (' + fmtMoney_(row.compPlanSum) + ')'
        });
      }
    }

    // ЕП: факт <= план
    if (row.epPlanSum !== null && row.epFactSum !== null) {
      checks++;
      if (row.epFactSum <= row.epPlanSum * 1.05) {
        passed++;
      } else {
        issues.push({
          dimension: 'consistency',
          severity: 'ВНИМАНИЕ',
          message: row.code + ': факт ЕП (' + fmtMoney_(row.epFactSum) +
                   ') превышает план (' + fmtMoney_(row.epPlanSum) + ')'
        });
      }
    }
  }

  // Проверка 2: глобальные суммы согласованы с суммой по ГРБС
  let compFactSumTotal = 0;
  let epFactSumTotal = 0;
  for (let i = 0; i < grbsRows.length; i++) {
    compFactSumTotal += (grbsRows[i].compFactSum || 0);
    epFactSumTotal += (grbsRows[i].epFactSum || 0);
  }

  let globalCompFactSum = toNumber_(rawData.all_comp_year_fact_sum);
  if (globalCompFactSum !== null && compFactSumTotal > 0) {
    checks++;
    // Допуск 10%: ГРБС в таблице может быть подмножеством всех ГРБС
    let ratio = compFactSumTotal / globalCompFactSum;
    if (ratio >= 0.5 && ratio <= 1.5) {
      passed++;
    } else {
      issues.push({
        dimension: 'consistency',
        severity: 'ВНИМАНИЕ',
        message: 'Сумма конкурентных факт по ГРБС (' + fmtMoney_(compFactSumTotal) +
                 ') существенно отличается от глобального итога (' + fmtMoney_(globalCompFactSum) + ')'
      });
    }
  }

  // Проверка 3: проценты исполнения в допустимом диапазоне (0-150%)
  for (let i = 0; i < grbsRows.length; i++) {
    let pct = grbsRows[i].compExecPct;
    if (pct !== null) {
      checks++;
      if (pct >= 0 && pct <= 1.5) {
        passed++;
      } else {
        issues.push({
          dimension: 'consistency',
          severity: 'ОШИБКА',
          message: grbsRows[i].code + ': процент исполнения вне допустимого диапазона (' + fmtPct_(pct) + ')'
        });
      }
    }
  }

  let score = checks > 0 ? Math.round((passed / checks) * 100) : 50;
  return { score: score, issues: issues };
}

/**
 * 4. СВЕЖЕСТЬ: как давно обновлялись данные.
 * Чем свежее данные, тем выше оценка. Данные старше 14 дней — подозрительно.
 *
 * @param {Object} rawData — должен содержать report_date
 * @returns {Object} — { score: 0-100, issues: [] }
 */
function freshnessScore_(rawData) {
  let issues = [];

  // Если дата отчёта не задана, считаем данные условно свежими
  // (это может быть первый запуск или тестовая среда)
  if (!rawData.report_date) {
    return {
      score: 70,
      issues: [{
        dimension: 'freshness',
        severity: 'ИНФОРМАЦИЯ',
        message: 'Дата отчёта не указана — свежесть оценена условно'
      }]
    };
  }

  try {
    let reportDate = (rawData.report_date instanceof Date)
      ? rawData.report_date
      : new Date(rawData.report_date);

    if (isNaN(reportDate.getTime())) {
      return { score: 50, issues: [{ dimension: 'freshness', severity: 'ВНИМАНИЕ', message: 'Некорректная дата отчёта' }] };
    }

    let now = new Date();
    let daysSinceReport = dateDiffDays_(reportDate, now);

    // Оценка: 100 за сегодня, -5 баллов за каждый день задержки, минимум 0
    let score;
    if (daysSinceReport === null || daysSinceReport < 0) {
      // Дата в будущем — странно, но не критично
      score = 80;
      issues.push({
        dimension: 'freshness',
        severity: 'ИНФОРМАЦИЯ',
        message: 'Дата отчёта в будущем — возможно, это плановый срез'
      });
    } else if (daysSinceReport <= 1) {
      score = 100;
    } else if (daysSinceReport <= 7) {
      score = Math.max(70, 100 - daysSinceReport * 5);
    } else if (daysSinceReport <= 14) {
      score = Math.max(40, 70 - (daysSinceReport - 7) * 5);
    } else {
      score = Math.max(0, 40 - (daysSinceReport - 14) * 3);
      issues.push({
        dimension: 'freshness',
        severity: 'ВНИМАНИЕ',
        message: 'Данные устарели на ' + daysSinceReport + ' дней'
      });
    }

    return { score: score, issues: issues };
  } catch (e) {
    return {
      score: 50,
      issues: [{
        dimension: 'freshness',
        severity: 'ВНИМАНИЕ',
        message: 'Ошибка при оценке свежести: ' + e.message
      }]
    };
  }
}

/**
 * 5. ВОЛАТИЛЬНОСТЬ: стабильность данных между срезами.
 * Если значения скачут от среза к срезу — это подозрительно:
 * либо данные корректируются задним числом, либо есть ошибки.
 *
 * @param {Object} rawData — текущий срез
 * @param {Object|null} previousSnapshot — предыдущий срез
 * @returns {Object} — { score: 0-100, issues: [] }
 */
function volatilityScore_(rawData, previousSnapshot) {
  let issues = [];

  // Если нет предыдущего среза, волатильность нельзя оценить —
  // даём нейтральную оценку (не наказываем и не поощряем)
  if (!previousSnapshot) {
    return {
      score: 75,
      issues: [{
        dimension: 'volatility',
        severity: 'ИНФОРМАЦИЯ',
        message: 'Нет предыдущего среза — волатильность не оценена'
      }]
    };
  }

  let score = 100;
  let fieldsChecked = 0;

  // Сравниваем ключевые показатели между срезами
  let fieldsToCompare = [
    'all_comp_year_plan_sum', 'all_comp_year_fact_sum',
    'all_ep_year_plan_sum', 'all_ep_year_fact_sum'
  ];

  for (let i = 0; i < fieldsToCompare.length; i++) {
    let key = fieldsToCompare[i];
    let current = toNumber_(rawData[key]);
    let previous = toNumber_(previousSnapshot[key]);

    if (current === null || previous === null) continue;
    if (previous === 0) continue;

    fieldsChecked++;

    // Процент изменения
    let changePct = Math.abs((current - previous) / previous);

    // План не должен сильно меняться между срезами (макс допуск 20%)
    if (key.indexOf('plan') !== -1 && changePct > 0.20) {
      score -= 15;
      issues.push({
        dimension: 'volatility',
        severity: 'ВНИМАНИЕ',
        message: 'Плановая сумма «' + key + '» изменилась на ' + fmtPct_(changePct, 0) + ' между срезами'
      });
    }

    // Факт может расти, но не должен резко уменьшаться (допуск 5% снижения)
    if (key.indexOf('fact') !== -1 && current < previous * 0.95) {
      score -= 20;
      issues.push({
        dimension: 'volatility',
        severity: 'ОШИБКА',
        message: 'Фактическая сумма «' + key + '» уменьшилась с ' + fmtMoney_(previous) + ' до ' + fmtMoney_(current)
      });
    }
  }

  // Если не удалось проверить ни одного поля — снижаем оценку
  if (fieldsChecked === 0) {
    score = 60;
    issues.push({
      dimension: 'volatility',
      severity: 'ИНФОРМАЦИЯ',
      message: 'Не удалось сравнить данные с предыдущим срезом'
    });
  }

  return { score: Math.max(0, score), issues: issues };
}

/**
 * Определение буквенного грейда по числовому баллу доверия.
 * Грейды настроены в CFG_.TRUST_GRADES.
 *
 * @param {number} score — балл доверия (0-100)
 * @returns {string} — грейд ('A', 'B', 'C', 'D', 'F')
 */
function trustGrade_(score) {
  if (score >= CFG_.TRUST_GRADES.A.min) return 'A';
  if (score >= CFG_.TRUST_GRADES.B.min) return 'B';
  if (score >= CFG_.TRUST_GRADES.C.min) return 'C';
  if (score >= CFG_.TRUST_GRADES.D.min) return 'D';
  return 'F';
}


// =============================================================================
// М5: ВЫЧИСЛЕНИЕ МЕТРИК (стадия 3 конвейера)
// =============================================================================
// Рассчитывает все аналитические показатели на основе извлечённых данных.
// Метрики вычисляются глобально (по всем ГРБС) и по каждому ГРБС отдельно.
// Результат используется всеми последующими стадиями: динамикой, аномалиями,
// классификацией и генерацией текста.
// =============================================================================

/**
 * Основная функция вычисления метрик — стадия 3 конвейера.
 * Производит два уровня агрегации:
 * 1. Глобальные метрики (сводные по всем ГРБС)
 * 2. Метрики по каждому ГРБС отдельно (для сравнительного анализа)
 *
 * @param {Object} rawData — глобальные показатели из стадии 1
 * @param {Array} grbsRows — строки ГРБС из стадии 1
 * @returns {Object} — { global: {...}, byGrbs: { 'УЭР': {...}, ... } }
 */
function buildMetrics_(rawData, grbsRows) {
  let globalMetrics = buildGlobalMetrics_(rawData);
  let byGrbs = {};

  for (let i = 0; i < grbsRows.length; i++) {
    let row = grbsRows[i];
    if (row.code) {
      byGrbs[row.code] = buildGrbsMetrics_(row);
    }
  }

  return {
    global: globalMetrics,
    byGrbs: byGrbs
  };
}

/**
 * Формирование глобальных метрик из rawData.
 * Эти показатели отражают общую картину закупочной деятельности
 * всех ГРБС вместе. Используются в шапке отчёта и для сравнения.
 *
 * @param {Object} rawData — глобальные показатели
 * @returns {Object} — глобальные метрики
 */
function buildGlobalMetrics_(rawData) {
  // Извлекаем числовые значения с безопасным приведением
  let allCompYearPlanCount = toNumber_(rawData.all_comp_year_plan_count || rawData.allCompYearPlanCount) || 0;
  let allCompYearPlanSum = toNumber_(rawData.all_comp_year_plan_sum || rawData.allCompYearPlanSum) || 0;
  let allCompYearFactCount = toNumber_(rawData.all_comp_year_fact_count || rawData.allCompYearFactCount) || 0;
  let allCompYearFactSum = toNumber_(rawData.all_comp_year_fact_sum || rawData.allCompYearFactSum) || 0;
  let allCompYearExecPct = calcPct_(allCompYearFactSum, allCompYearPlanSum);
  let allCompYearExecPctCount = allCompYearPlanCount > 0 ? (allCompYearFactCount / allCompYearPlanCount) : 0;
  let allCompYearEconomySum = toNumber_(rawData.all_comp_year_economy_sum || rawData.allCompYearEconomy) || 0;

  // Квартальные метрики: используем прямые ключи из readGlobalMetrics_ (allCompQ*)
  // ИЛИ compat-мост (all_comp_q{N}_*). Работает в любом квартале.
  let q = rawData.report_quarter || 1;
  let allCompQ1PlanCount = toNumber_(rawData.allCompQPlanCount || rawData['all_comp_q' + q + '_plan_count'] || rawData.all_comp_q1_plan_count) || 0;
  let allCompQ1PlanSum = toNumber_(rawData.allCompQPlanSum || rawData['all_comp_q' + q + '_plan_sum'] || rawData.all_comp_q1_plan_sum) || 0;
  let allCompQ1FactCount = toNumber_(rawData.allCompQFactCount || rawData['all_comp_q' + q + '_fact_count'] || rawData.all_comp_q1_fact_count) || 0;
  let allCompQ1FactSum = toNumber_(rawData.allCompQFactSum || rawData['all_comp_q' + q + '_fact_sum'] || rawData.all_comp_q1_fact_sum) || 0;
  let allCompQ1ExecPct = calcPct_(allCompQ1FactSum, allCompQ1PlanSum);

  let allEpYearPlanCount = toNumber_(rawData.all_ep_year_plan_count || rawData.allEpYearPlanCount) || 0;
  let allEpYearPlanSum = toNumber_(rawData.all_ep_year_plan_sum || rawData.allEpYearPlanSum) || 0;
  let allEpYearFactCount = toNumber_(rawData.all_ep_year_fact_count || rawData.allEpYearFactCount) || 0;
  let allEpYearFactSum = toNumber_(rawData.all_ep_year_fact_sum || rawData.allEpYearFactSum) || 0;

  // Общий фактический объём закупок = конкурентные + ЕП
  let allFactTotalSum = allCompYearFactSum + allEpYearFactSum;

  // Доли: какую часть общего объёма составляют конкурентные закупки и ЕП.
  // Высокая доля ЕП — сигнал для контрольных органов.
  let allFactCompShare = allFactTotalSum > 0 ? (allCompYearFactSum / allFactTotalSum) : null;
  let allFactEpShare = allFactTotalSum > 0 ? (allEpYearFactSum / allFactTotalSum) : null;

  // Метрики по Управлению образования (УО) — выделяются отдельно,
  // потому что для образования действуют повышенные лимиты ЕП (п.5 ч.1 ст.93)
  let uoMetrics = buildUoGlobalMetrics_(rawData);

  return {
    allCompYearPlanCount: allCompYearPlanCount,
    allCompYearFactCount: allCompYearFactCount,
    allCompYearPlanSum: allCompYearPlanSum,
    allCompYearFactSum: allCompYearFactSum,
    allCompYearExecPct: allCompYearExecPct,
    allCompYearEconomySum: allCompYearEconomySum,
    allCompQ1PlanCount: allCompQ1PlanCount,
    allCompQ1FactCount: allCompQ1FactCount,
    allCompQ1PlanSum: allCompQ1PlanSum,
    allCompQ1FactSum: allCompQ1FactSum,
    allCompQ1ExecPct: allCompQ1ExecPct,
    allEpYearPlanCount: allEpYearPlanCount,
    allEpYearFactCount: allEpYearFactCount,
    allEpYearPlanSum: allEpYearPlanSum,
    allEpYearFactSum: allEpYearFactSum,
    allFactTotalSum: allFactTotalSum,
    allFactCompShare: allFactCompShare,
    allFactEpShare: allFactEpShare,
    // УО — отдельный блок
    uoCompYearPlanCount: uoMetrics.compPlanCount,
    uoCompYearFactCount: uoMetrics.compFactCount,
    uoCompYearPlanSum: uoMetrics.compPlanSum,
    uoCompYearFactSum: uoMetrics.compFactSum,
    uoCompYearEconomySum: uoMetrics.compEconomy,
    uoEpYearPlanCount: uoMetrics.epPlanCount,
    uoEpYearFactCount: uoMetrics.epFactCount,
    uoEpYearPlanSum: uoMetrics.epPlanSum,
    uoEpYearFactSum: uoMetrics.epFactSum,
    uoFactTotalSum: uoMetrics.totalFactSum,
    uoFactCompShare: uoMetrics.compShare,
    uoFactEpShare: uoMetrics.epShare,
    allCompYearExecPctCount: allCompYearExecPctCount,
    // Алиас для М7 analyzeDynamics_ (ожидает global.execPct)
    execPct: allCompYearExecPctCount,
    // ЕП квартальные
    allEpQ1PlanCount: toNumber_(rawData.allEpQPlanCount || rawData['all_ep_q' + (rawData.report_quarter || 1) + '_plan_count'] || rawData.all_ep_q1_plan_count) || 0,
    allEpQ1PlanSum: toNumber_(rawData.allEpQPlanSum || rawData['all_ep_q' + (rawData.report_quarter || 1) + '_plan_sum'] || rawData.all_ep_q1_plan_sum) || 0,
    allEpQ1FactCount: toNumber_(rawData.allEpQFactCount || rawData['all_ep_q' + (rawData.report_quarter || 1) + '_fact_count'] || rawData.all_ep_q1_fact_count) || 0,
    allEpQ1FactSum: toNumber_(rawData.allEpQFactSum || rawData['all_ep_q' + (rawData.report_quarter || 1) + '_fact_sum'] || rawData.all_ep_q1_fact_sum) || 0
  };
}

/**
 * Извлечение метрик УО из rawData.
 * УО обрабатывается отдельно, потому что:
 * 1) Для образования действуют повышенные лимиты ЕП по 44-ФЗ
 * 2) В человеческих отчётах УО всегда выделяется отдельным блоком
 *
 * Если отдельных данных по УО нет — возвращаем нули,
 * данные будут взяты из grbsRows на более поздней стадии.
 *
 * @param {Object} rawData — глобальные данные
 * @returns {Object} — метрики УО
 */
function buildUoGlobalMetrics_(rawData) {
  // УО: данные берутся из rawData (заполняются в extractData_ из ГРБС-блока УО)
  // Пробуем прямые ключи, потом uo_* ключи, потом 0
  let compPlanCount = toNumber_(rawData.uo_comp_year_plan_count) || 0;
  let compFactCount = toNumber_(rawData.uo_comp_year_fact_count) || 0;
  let compPlanSum = toNumber_(rawData.uo_comp_year_plan_sum) || 0;
  let compFactSum = toNumber_(rawData.uo_comp_year_fact_sum) || 0;
  let compEconomy = toNumber_(rawData.uo_comp_year_economy_sum) || 0;
  let epPlanCount = toNumber_(rawData.uo_ep_year_plan_count) || 0;
  let epFactCount = toNumber_(rawData.uo_ep_year_fact_count) || 0;
  let epPlanSum = toNumber_(rawData.uo_ep_year_plan_sum) || 0;
  let epFactSum = toNumber_(rawData.uo_ep_year_fact_sum) || 0;
  let totalFactSum = compFactSum + epFactSum;
  return {
    compPlanCount: compPlanCount,
    compFactCount: compFactCount,
    compPlanSum: compPlanSum,
    compFactSum: compFactSum,
    compEconomy: compEconomy,
    epPlanCount: epPlanCount,
    epFactCount: epFactCount,
    epPlanSum: epPlanSum,
    epFactSum: epFactSum,
    totalFactSum: totalFactSum,
    compShare: totalFactSum > 0 ? (compFactSum / totalFactSum) : null,
    epShare: totalFactSum > 0 ? (epFactSum / totalFactSum) : null
  };
}

/**
 * Формирование метрик по одному ГРБС.
 * Каждый ГРБС получает набор абсолютных и процентных показателей,
 * которые затем используются для классификации, профилирования и текста.
 *
 * @param {Object} row — строка ГРБС из grbsRows
 * @returns {Object} — метрики ГРБС
 */
function buildGrbsMetrics_(row) {
  let compPlanCount = row.compPlanCount || 0;
  let compFactCount = row.compFactCount || 0;
  let compPlanSum = row.compPlanSum || 0;
  let compFactSum = row.compFactSum || 0;
  let compEconomy = row.compEconomy || 0;
  let epPlanCount = row.epPlanCount || 0;
  let epFactCount = row.epFactCount || 0;
  let epPlanSum = row.epPlanSum || 0;
  let epFactSum = row.epFactSum || 0;

  let totalFactSum = compFactSum + epFactSum;

  // Доля конкурентных и ЕП в общем объёме — главный индикатор для 44-ФЗ
  let compShare = totalFactSum > 0 ? (compFactSum / totalFactSum) : null;
  let epShareCalc = totalFactSum > 0 ? (epFactSum / totalFactSum) : null;

  // Процент исполнения конкурентных закупок
  let compExecPct = calcPct_(compFactSum, compPlanSum);  // по суммам
  let compExecPctCount = compPlanCount > 0 ? (compFactCount / compPlanCount) : 0;  // по штукам

  let metrics = {
    code: row.code,
    name: row.name,
    compPlanCount: compPlanCount,
    compFactCount: compFactCount,
    compPlanSum: compPlanSum,
    compFactSum: compFactSum,
    compEconomy: compEconomy,
    compExecPct: compExecPct,
    compExecPctCount: compExecPctCount,
    epPlanCount: epPlanCount,
    epFactCount: epFactCount,
    epPlanSum: epPlanSum,
    epFactSum: epFactSum,
    epShare: epShareCalc,
    totalFactSum: totalFactSum,
    compShare: compShare,
    // Алиасы для совместимости с М4-М11 (ожидают короткие имена)
    execPct: compExecPctCount,
    fact: compFactSum,
    plan: compPlanSum,
    procedureCount: compFactCount,
    competitivePct: compShare !== null ? compShare : 0,
    epContractCount: epFactCount,
    epAmount: epFactSum,
    // Квартальные данные
    compPlanCountQ: row.compPlanCountQ || 0,
    compFactCountQ: row.compFactCountQ || 0,
    compExecPctQ: row.compExecPctQ || null,
    compPlanSumQ: row.compPlanSumQ || 0,
    compFactSumQ: row.compFactSumQ || 0,
    compEconomyQ: row.compEconomyQ || 0,
    epPlanCountQ: row.epPlanCountQ || 0,
    epFactCountQ: row.epFactCountQ || 0,
    epPlanSumQ: row.epPlanSumQ || 0,
    epFactSumQ: row.epFactSumQ || 0,
    // Бюджетная разбивка год
    compPlanFBYear: row.compPlanFBYear || 0,
    compPlanKBYear: row.compPlanKBYear || 0,
    compPlanMBYear: row.compPlanMBYear || 0,
    compFactFBYear: row.compFactFBYear || 0,
    compFactKBYear: row.compFactKBYear || 0,
    compFactMBYear: row.compFactMBYear || 0,
    compEconomyFBYear: row.compEconomyFBYear || 0,
    compEconomyKBYear: row.compEconomyKBYear || 0,
    compEconomyMBYear: row.compEconomyMBYear || 0,
    // Бюджетная разбивка квартал
    compPlanFBQ: row.compPlanFBQ || 0,
    compPlanKBQ: row.compPlanKBQ || 0,
    compPlanMBQ: row.compPlanMBQ || 0,
    compFactFBQ: row.compFactFBQ || 0,
    compFactKBQ: row.compFactKBQ || 0,
    compFactMBQ: row.compFactMBQ || 0,
    epPlanFBYear: row.epPlanFBYear || 0,
    epPlanKBYear: row.epPlanKBYear || 0,
    epPlanMBYear: row.epPlanMBYear || 0,
    epFactFBYear: row.epFactFBYear || 0,
    epFactKBYear: row.epFactKBYear || 0,
    epFactMBYear: row.epFactMBYear || 0,
    epEconomyFBYear: row.epEconomyFBYear || 0,
    epEconomyKBYear: row.epEconomyKBYear || 0,
    epEconomyMBYear: row.epEconomyMBYear || 0
  };

  // Дополняем процентными метриками для удобства текстовых шаблонов
  calcPercentages_(metrics);

  return metrics;
}

/**
 * Дополняет объект метрик процентными показателями.
 * Вычисляет проценты безопасно (с защитой от деления на ноль)
 * и добавляет их к существующему объекту.
 *
 * @param {Object} metrics — объект метрик (модифицируется in-place)
 */
function calcPercentages_(metrics) {
  // Процент исполнения по количеству контрактов
  metrics.compExecPctCount = calcPct_(metrics.compFactCount, metrics.compPlanCount);

  // Процент исполнения ЕП по сумме
  metrics.epExecPct = calcPct_(metrics.epFactSum, metrics.epPlanSum);

  // Процент исполнения ЕП по количеству
  metrics.epExecPctCount = calcPct_(metrics.epFactCount, metrics.epPlanCount);

  // Процент экономии от плана конкурентных (показывает эффективность торгов)
  metrics.economyPct = calcPct_(metrics.compEconomy, metrics.compPlanSum);

  // Средняя сумма одного конкурентного контракта (для анализа дробления)
  metrics.avgCompContractSum = metrics.compFactCount > 0
    ? (metrics.compFactSum / metrics.compFactCount)
    : null;

  // Средняя сумма одного контракта ЕП
  metrics.avgEpContractSum = metrics.epFactCount > 0
    ? (metrics.epFactSum / metrics.epFactCount)
    : null;
}
// ============================================================================
// ЧАСТЬ 2: АНАЛИТИЧЕСКОЕ ЯДРО (M6–M11)
// Модули контекста, динамики, аномалий, комплаенса, классификации, профилирования
// Конвейер: loadContext_ → analyzeDynamics_ → detectAnomalies_ →
//           checkCompliance44FZ_ → classify_ → buildProfiles_
// ============================================================================

// ========================== M6: КОНТЕКСТ И УСИЛИТЕЛИ =========================
// Зачем: человеческий контекст (пояснения аналитика) меняет интерпретацию цифр.
// Если аналитик написал «плановая задержка ОП — перенос на Q2», система НЕ должна
// ставить красный флаг. Предыдущий срез нужен для расчёта дельт и тренда.
// =============================================================================

/**
 * Стадия 4 конвейера: загрузка человеческого контекста и предыдущего среза.
 * Человеческий контекст приоритетнее автоматических выводов — если аналитик
 * объяснил причину, система использует мягкий режим оценки.
 * @param {Spreadsheet} ss — активная таблица
 * @param {string[]} grbsCodes — коды ГРБС из реестра
 * @return {{ humanContext: Object, previousSnapshot: Object|null }}
 */
function loadContext_(ss, grbsCodes) {
  try {
    // Читаем лист КОНТЕКСТ — пояснения аналитика по каждому ГРБС
    const humanInput = readKontekstSheet_(ss);

    // Собираем контекст только для известных ГРБС (защита от мусорных строк)
    const humanContext = {};
    for (const code of grbsCodes) {
      if (humanInput[code]) {
        humanContext[code] = humanInput[code];
      }
    }

    // Последний сохранённый срез — нужен для дельт «неделя к неделе»
    const previousSnapshot = readPreviousSnapshot_(ss);

    log_('M6', `Контекст загружен: ${Object.keys(humanContext).length} ГРБС, ` +
         `предыдущий срез: ${previousSnapshot ? fmtDate_(previousSnapshot.date) : 'нет'}`);

    return { humanContext, previousSnapshot };
  } catch (e) {
    log_('M6', `Ошибка загрузки контекста: ${e.message}`, 'WARN');
    return { humanContext: {}, previousSnapshot: null };
  }
}

/**
 * Чтение листа КОНТЕКСТ.
 * Структура колонок:
 *   A=код ГРБС, B=название, C=авто:исполн%, D=авто:доляЕП%, E=авто:тренд, F=авто:грейд,
 *   G=пояснения[жёлтый], H=процедуры[жёлтый], I=позиции[жёлтый], J=рекомендации[жёлтый]
 * Колонки G–J заполняются вручную аналитиком (жёлтый фон = «заполни»).
 * @param {Spreadsheet} ss
 * @return {Object} — { 'УЭР': { explanation, procedures, items, recommendations }, ... }
 */
function readKontekstSheet_(ss) {
  const result = {};
  try {
    const sheet = ss.getSheetByName('КОНТЕКСТ');
    if (!sheet) {
      log_('M6', 'Лист КОНТЕКСТ не найден — контекст пуст', 'INFO');
      return result;
    }
    const data = sheet.getDataRange().getValues();
    // Первая строка — заголовки, пропускаем
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const code = normalizeString_(String(row[0] || ''));
      if (!code) continue;

      // Санитизация: убираем потенциально опасные символы из пользовательского ввода
      const sanitize = (val) => String(val || '').replace(/[<>]/g, '').trim();

      const explanation    = sanitize(row[6]);
      const procedures     = sanitize(row[7]);
      const items          = sanitize(row[8]);
      const recommendations = sanitize(row[9]);

      // Сохраняем только если хотя бы одно поле заполнено
      if (explanation || procedures || items || recommendations) {
        result[code] = { explanation, procedures, items, recommendations };
      }
    }
  } catch (e) {
    log_('M6', `Ошибка чтения листа КОНТЕКСТ: ${e.message}`, 'WARN');
  }
  return result;
}

/**
 * Объединение человеческого контекста с автоматическими данными.
 * Зачем: если аналитик дал пояснение — оно встраивается в профиль ГРБС
 * и смягчает автоматические флаги (например, 0% исполнения объяснено переносом).
 * @param {Object} humanInput — данные из листа КОНТЕКСТ
 * @param {Object} metrics — рассчитанные метрики ГРБС
 * @return {Object} — обогащённый контекст с флагом hasHumanContext
 */
function mergeHumanContext_(humanInput, metrics) {
  if (!humanInput) return { hasHumanContext: false };
  const merged = {
    hasHumanContext: !!(humanInput.explanation || humanInput.procedures ||
                        humanInput.items || humanInput.recommendations),
    explanation:     humanInput.explanation || '',
    procedures:      humanInput.procedures || '',
    items:           humanInput.items || '',
    recommendations: humanInput.recommendations || '',
    // Флаг: если есть пояснение, снижаем серьёзность автоматических аномалий
    softensAnomalies: !!(humanInput.explanation && humanInput.explanation.length > 10)
  };
  return merged;
}

/**
 * Чтение последнего среза из листа ИСТОРИЯ.
 * Формат листа: строка 1 — заголовки, далее JSON-срезы с датой в колонке A.
 * @param {Spreadsheet} ss
 * @return {Object|null} — { date: Date, metrics: {...}, profiles: {...} }
 */
function readPreviousSnapshot_(ss) {
  try {
    const sheet = ss.getSheetByName('ИСТОРИЯ');
    if (!sheet || sheet.getLastRow() < 2) return null;

    // Последняя строка — самый свежий срез
    const lastRow = sheet.getLastRow();
    const row = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    const date = row[0] instanceof Date ? row[0] : new Date(row[0]);
    const jsonStr = String(row[1] || '');
    if (!jsonStr) return null;

    const snapshot = JSON.parse(jsonStr);
    snapshot.date = date;
    return snapshot;
  } catch (e) {
    log_('M6', `Не удалось прочитать предыдущий срез: ${e.message}`, 'WARN');
    return null;
  }
}

/**
 * Чтение нескольких последних срезов для расчёта EWMA.
 * Зачем: EWMA требует как минимум 3-4 точки для сглаживания,
 * а регрессия — минимум 5 для приемлемого R².
 * @param {Spreadsheet} ss
 * @param {number} maxCount — максимум срезов (по умолчанию 10)
 * @return {Array<Object>} — массив срезов, отсортированных по дате по возрастанию
 */
function readHistoricalSnapshots_(ss, maxCount) {
  const limit = maxCount || 10;
  const snapshots = [];
  try {
    const sheet = ss.getSheetByName('ИСТОРИЯ');
    if (!sheet || sheet.getLastRow() < 2) return snapshots;

    const lastRow = sheet.getLastRow();
    const startRow = Math.max(2, lastRow - limit + 1);
    const numRows = lastRow - startRow + 1;
    const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

    for (const row of data) {
      try {
        const date = row[0] instanceof Date ? row[0] : new Date(row[0]);
        const jsonStr = String(row[1] || '');
        if (!jsonStr || isNaN(date.getTime())) continue;
        const snap = JSON.parse(jsonStr);
        snap.date = date;
        snapshots.push(snap);
      } catch (ignore) {
        // Битая строка — пропускаем, не ломаем весь массив
      }
    }
    // Сортировка по дате по возрастанию — важно для EWMA и регрессии
    snapshots.sort((a, b) => a.date - b.date);
  } catch (e) {
    log_('M6', `Ошибка чтения истории: ${e.message}`, 'WARN');
  }
  return snapshots;
}


// ======================== M7: ДВИГАТЕЛЬ НЕДЕЛЬНОЙ ДИНАМИКИ ====================
// Зачем: статичные цифры не показывают НАПРАВЛЕНИЕ. 20% исполнения в начале
// квартала — норма, а 20% за неделю до конца — катастрофа. Динамика — это
// «куда мы движемся», а не «где мы сейчас».
// Методы: EWMA (λ=0.3) сглаживает шум, линейная регрессия даёт тренд,
// вторая производная — ускорение/замедление.
// =============================================================================

/**
 * Стадия 5 конвейера: анализ динамики для всех ГРБС и глобально.
 * Для каждого ГРБС и для общего показателя рассчитываем тренд, EWMA, наклон,
 * R², ускорение, прогноз к концу квартала.
 * @param {Object} metrics — текущие метрики (global + byGrbs)
 * @param {Array} snapshots — исторические срезы из readHistoricalSnapshots_
 * @return {{ global: Object, byGrbs: Object }}
 */
function analyzeDynamics_(metrics, snapshots) {
  const result = { global: {}, byGrbs: {} };

  try {
    // Глобальная динамика — общий % исполнения
    const globalTimeline = extractTimeline_(snapshots, null, 'execPct');
    if (metrics && metrics.global) {
      globalTimeline.push({ date: new Date(), value: toNumber_(metrics.global.allCompYearExecPct || metrics.global.execPct) });
    }
    result.global = analyzeWeeklyDynamics_(globalTimeline);

    // Динамика по каждому ГРБС
    const grbsCodes = metrics && metrics.byGrbs ? Object.keys(metrics.byGrbs) : [];
    for (const code of grbsCodes) {
      try {
        const timeline = extractTimeline_(snapshots, code, 'execPct');
        const currentVal = toNumber_((metrics.byGrbs[code] || {}).execPct);
        timeline.push({ date: new Date(), value: currentVal });
        result.byGrbs[code] = analyzeWeeklyDynamics_(timeline);

        // Прогноз к концу квартала
        const daysLeft = dateDiffDays_(new Date(), quarterEnd_(new Date()));
        result.byGrbs[code].forecast = buildForecast_(
          currentVal, result.byGrbs[code], Math.max(0, daysLeft)
        );
      } catch (e) {
        log_('M7', `Ошибка динамики для ${code}: ${e.message}`, 'WARN');
        result.byGrbs[code] = defaultDynamics_();
      }
    }

    // Глобальный прогноз
    const globalDaysLeft = dateDiffDays_(new Date(), quarterEnd_(new Date()));
    result.global.forecast = buildForecast_(
      toNumber_((metrics.global || {}).execPct),
      result.global,
      Math.max(0, globalDaysLeft)
    );

    log_('M7', `Динамика рассчитана: глобальный тренд=${result.global.trend}, ` +
         `${grbsCodes.length} ГРБС`);

  } catch (e) {
    log_('M7', `Критическая ошибка анализа динамики: ${e.message}`, 'ERROR');
    result.global = defaultDynamics_();
  }
  return result;
}

/**
 * Извлечение временного ряда одного показателя из массива снэпшотов.
 * @param {Array} snapshots — исторические срезы
 * @param {string|null} grbsCode — код ГРБС или null для глобального
 * @param {string} field — имя поля (execPct, epShare и т.д.)
 * @return {Array<{date: Date, value: number}>}
 */
function extractTimeline_(snapshots, grbsCode, field) {
  const timeline = [];
  for (const snap of (snapshots || [])) {
    try {
      let val;
      if (!grbsCode) {
        val = snap.metrics && snap.metrics.global ? snap.metrics.global[field] : undefined;
      } else {
        val = snap.metrics && snap.metrics.byGrbs && snap.metrics.byGrbs[grbsCode]
              ? snap.metrics.byGrbs[grbsCode][field] : undefined;
      }
      if (val !== undefined && val !== null && !isNaN(toNumber_(val))) {
        timeline.push({ date: snap.date, value: toNumber_(val) });
      }
    } catch (ignore) { /* битый срез — пропускаем */ }
  }
  return timeline;
}

/**
 * Анализ динамики одного показателя по массиву исторических значений.
 * Три метода: EWMA (λ=0.3) — сглаженное текущее, линейная регрессия — тренд,
 * вторая производная — ускорение/замедление.
 * @param {Array<{date: Date, value: number}>} snapshots — отсортированные по дате
 * @return {Object} — { trend, ewma, slope, rSquared, acceleration, confidence, isAnomaly, weekOverWeek }
 */
function analyzeWeeklyDynamics_(snapshots) {
  const result = defaultDynamics_();
  if (!snapshots || snapshots.length < 2) {
    result.trend = 'НЕДОСТАТОЧНО_ДАННЫХ';
    return result;
  }

  const values = snapshots.map(s => s.value);
  const n = values.length;

  // --- EWMA (λ=0.3): экспоненциально взвешенное скользящее среднее ---
  // Зачем: сглаживает случайные колебания, давая больший вес последним точкам
  const lambda = 0.3;
  let ewma = values[0];
  for (let i = 1; i < n; i++) {
    ewma = lambda * values[i] + (1 - lambda) * ewma;
  }
  result.ewma = ewma;

  // --- Линейная регрессия методом наименьших квадратов ---
  // x — порядковый номер (0, 1, 2...), y — значение показателя
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
    sumY2 += values[i] * values[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom !== 0) {
    result.slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - result.slope * sumX) / n;

    // R² — коэффициент детерминации (насколько линейная модель объясняет данные)
    const ssTot = sumY2 - (sumY * sumY) / n;
    if (ssTot > 0) {
      let ssRes = 0;
      for (let i = 0; i < n; i++) {
        const predicted = intercept + result.slope * i;
        ssRes += (values[i] - predicted) ** 2;
      }
      result.rSquared = Math.max(0, 1 - ssRes / ssTot);
    }
  }

  // --- Вторая производная (ускорение) ---
  // Зачем: положительное ускорение = набираем обороты, отрицательное = теряем темп
  if (n >= 3) {
    const d1_last = values[n - 1] - values[n - 2];
    const d1_prev = values[n - 2] - values[n - 3];
    result.acceleration = d1_last - d1_prev;
  }

  // --- Изменение неделя к неделе ---
  result.weekOverWeek = values[n - 1] - values[n - 2];

  // --- Определение уверенности модели ---
  // Больше точек + выше R² = больше уверенности
  result.confidence = Math.min(1, (n / 10) * (result.rSquared || 0.5));

  // --- Аномальный скачок: если WoW > 3σ ---
  if (n >= 4) {
    const diffs = [];
    for (let i = 1; i < n - 1; i++) diffs.push(values[i] - values[i - 1]);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const std = Math.sqrt(diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / diffs.length);
    if (std > 0 && Math.abs(result.weekOverWeek - mean) > 3 * std) {
      result.isAnomaly = true;
    }
  }

  // --- Классификация тренда ---
  result.trend = classifyTrend_(result);

  return result;
}

/**
 * Значения по умолчанию для динамики (когда данных нет или ошибка).
 */
function defaultDynamics_() {
  return {
    trend: 'НЕДОСТАТОЧНО_ДАННЫХ', ewma: 0, slope: 0, rSquared: 0,
    acceleration: 0, confidence: 0, isAnomaly: false, weekOverWeek: 0,
    forecast: null
  };
}

/**
 * Прогноз к концу квартала: три сценария.
 * Зачем: руководителю нужно знать не «где мы», а «где будем» через N дней.
 * @param {number} currentExec — текущее исполнение %
 * @param {Object} trajectory — результат analyzeWeeklyDynamics_
 * @param {number} daysRemaining — дней до конца квартала
 * @return {{ projectedExec, optimistic, pessimistic, probabilityTarget, text }}
 */
function buildForecast_(currentExec, trajectory, daysRemaining) {
  const weeksLeft = Math.max(0, daysRemaining / 7);
  const weeklySlope = trajectory.slope || 0;

  let projected, optimistic, pessimistic;
  if (weeklySlope === 0 && (trajectory.confidence || 0) < 0.1) {
    // Нет исторических данных — оценочная дифференциация сценариев
    projected = currentExec;
    optimistic = Math.min(1.0, currentExec * 1.3 + 0.05);
    pessimistic = Math.max(0, currentExec * 0.7 - 0.02);
  } else {
    // Базовый прогноз: текущее + наклон × оставшиеся недели
    projected = currentExec + weeklySlope * weeksLeft;
    // Оптимистичный: учитываем ускорение (если положительное)
    var accelBonus = Math.max(0, (trajectory.acceleration || 0)) * weeksLeft * 0.5;
    optimistic = projected + accelBonus + Math.abs(weeklySlope) * 0.3 * weeksLeft;
    // Пессимистичный: наклон уменьшается с каждой неделей
    pessimistic = currentExec + weeklySlope * weeksLeft * 0.5;
  }

  // Вероятность достижения 100% — грубая, но полезная
  const target = 1.0;
  let probability = 0;
  if (projected >= target) {
    probability = Math.min(0.95, 0.7 + trajectory.confidence * 0.25);
  } else if (optimistic >= target) {
    probability = Math.min(0.6, 0.3 + trajectory.confidence * 0.3);
  } else {
    probability = Math.max(0.05, (projected / target) * 0.3);
  }

  // Текстовое описание для отчёта
  let text;
  if (weeksLeft < 0.5) {
    text = `Квартал завершается. Текущее исполнение: ${fmtPct_(currentExec)}`;
  } else if (projected >= 0.90) {
    text = `Прогноз: ${fmtPct_(projected)} к концу квартала (${fmtPct_(probability)} вероятность достижения плана)`;
  } else if (projected >= 0.60) {
    text = `Прогноз: ${fmtPct_(projected)} к концу квартала. Отставание от плана вероятно`;
  } else {
    text = `Прогноз: ${fmtPct_(projected)} к концу квартала. Существенное отставание`;
  }

  return {
    projectedExec: Math.max(0, Math.min(1.5, projected)),
    optimistic:    Math.max(0, Math.min(1.5, optimistic)),
    pessimistic:   Math.max(0, Math.min(1.5, pessimistic)),
    probabilityTarget: probability,
    text
  };
}

/**
 * Классификация тренда для отображения в отчёте.
 * Комбинирует наклон (slope) и ускорение (acceleration) для определения
 * качественной характеристики движения.
 * @param {Object} dynamics — объект из analyzeWeeklyDynamics_
 * @return {string} — одно из: УСКОРЯЮЩИЙСЯ_РОСТ, УСТОЙЧИВЫЙ_РОСТ, СТАБИЛЬНО,
 *         УСТОЙЧИВОЕ_СНИЖЕНИЕ, УСКОРЯЮЩЕЕСЯ_ПАДЕНИЕ, АНОМАЛЬНЫЙ_СКАЧОК, НЕДОСТАТОЧНО_ДАННЫХ
 */
function classifyTrend_(dynamics) {
  if (dynamics.isAnomaly) return 'АНОМАЛЬНЫЙ_СКАЧОК';

  const slope = dynamics.slope || 0;
  const accel = dynamics.acceleration || 0;
  // Порог «значимого» изменения — 0.5 п.п. в неделю
  const threshold = 0.5;

  if (Math.abs(slope) < threshold) return 'СТАБИЛЬНО';
  if (slope > threshold && accel > 0.1) return 'УСКОРЯЮЩИЙСЯ_РОСТ';
  if (slope > threshold) return 'УСТОЙЧИВЫЙ_РОСТ';
  if (slope < -threshold && accel < -0.1) return 'УСКОРЯЮЩЕЕСЯ_ПАДЕНИЕ';
  if (slope < -threshold) return 'УСТОЙЧИВОЕ_СНИЖЕНИЕ';

  return 'СТАБИЛЬНО';
}


// ======================== M8: ОБНАРУЖЕНИЕ АНОМАЛИЙ ===========================
// Зачем: автоматический «третий глаз» — выявляет то, что человек может пропустить
// из-за объёма данных. Три уровня: данные → поведение → система.
// КРИТИЧНО: формулировки ТОЛЬКО «ТРЕБУЕТ ПРОВЕРКИ», никаких обвинений!
// =============================================================================

/**
 * Стадия 6 конвейера: обнаружение аномалий на трёх уровнях.
 * Уровень 1 — целостность данных (ошибки ввода).
 * Уровень 2 — поведенческие паттерны (подозрительная динамика).
 * Уровень 3 — системные проблемы (структурные перекосы).
 * @return {Array<Object>} — массив аномалий
 */
function detectAnomalies_(metrics, dynamics, previousSnapshot) {
  let anomalies = [];
  try {
    // Уровень 1: Аномалии данных — самый надёжный, проверяем всегда
    const dataAnomalies = checkDataIntegrity_(metrics);
    anomalies = anomalies.concat(dataAnomalies);

    // Уровень 2: Аномалии поведения — нужны dynamics и previousSnapshot
    const behaviorAnomalies = checkBehavioralPatterns_(metrics, dynamics, previousSnapshot);
    anomalies = anomalies.concat(behaviorAnomalies);

    // Уровень 3: Системные аномалии — анализ картины в целом
    const systemicAnomalies = checkSystemicIssues_(metrics);
    anomalies = anomalies.concat(systemicAnomalies);

    log_('M8', `Обнаружено аномалий: ${anomalies.length} ` +
         `(данные: ${dataAnomalies.length}, поведение: ${behaviorAnomalies.length}, ` +
         `система: ${systemicAnomalies.length})`);
  } catch (e) {
    log_('M8', `Ошибка обнаружения аномалий: ${e.message}`, 'ERROR');
  }
  return anomalies;
}

/**
 * Создание объекта аномалии со стандартной структурой.
 * Централизуем, чтобы формат был единообразным во всех проверках.
 */
function makeAnomaly_(grbs, type, level, rule, description, severity, source) {
  return { grbs, type, level, rule, description, severity, source };
}

/**
 * Уровень 1: Аномалии данных.
 * Проверяем математическую корректность — факт vs план,
 * отрицательные значения, подозрительные совпадения.
 */
function checkDataIntegrity_(metrics) {
  const anomalies = [];
  if (!metrics || !metrics.byGrbs) return anomalies;

  for (const [code, m] of Object.entries(metrics.byGrbs)) {
    try {
      const fact = toNumber_(m.fact);
      const plan = toNumber_(m.plan);
      const execPct = toNumber_(m.execPct);
      const epShare = toNumber_(m.epShare);

      // Правило 1: Факт > План × 2 — возможна ошибка данных
      if (plan > 0 && fact > plan * 2) {
        anomalies.push(makeAnomaly_(
          code, 'ДАННЫЕ', 1, 'EXEC_OVER_200',
          `Исполнение свыше 200% (${fmtPct_(execPct)}) — ТРЕБУЕТ ПРОВЕРКИ: возможна ошибка данных`,
          'КРИТИЧЕСКАЯ', 'М8:checkDataIntegrity_'
        ));
      }

      // Правило 2: План = 0, но Факт > 0 — закупка без плана
      if (plan === 0 && fact > 0) {
        anomalies.push(makeAnomaly_(
          code, 'ДАННЫЕ', 1, 'FACT_NO_PLAN',
          `Закупка без плана (факт ${fmtMoney_(fact)}) — ТРЕБУЕТ ПРОВЕРКИ`,
          'ВЫСОКАЯ', 'М8:checkDataIntegrity_'
        ));
      }

      // Правило 3: Отрицательный план — возможна корректировка или ошибка
      if (plan < 0) {
        anomalies.push(makeAnomaly_(
          code, 'ДАННЫЕ', 1, 'NEGATIVE_PLAN',
          `Отрицательное плановое значение (${fmtMoney_(plan)}) — ТРЕБУЕТ ПРОВЕРКИ`,
          'СРЕДНЯЯ', 'М8:checkDataIntegrity_'
        ));
      }

      // Правило 4: Идеальное совпадение Факт = План (±0.01%) — шаблонное заполнение
      if (plan > 0 && Math.abs(fact - plan) / plan < 0.0001) {
        anomalies.push(makeAnomaly_(
          code, 'ДАННЫЕ', 1, 'EXACT_MATCH',
          'Точное совпадение факта и плана — возможно шаблонное заполнение',
          'ИНФОРМАЦИЯ', 'М8:checkDataIntegrity_'
        ));
      }

      // Правило 5: Доля ЕП вне допустимого диапазона 0-100%
      if (epShare < 0 || epShare > 1) {
        anomalies.push(makeAnomaly_(
          code, 'ДАННЫЕ', 1, 'EP_SHARE_RANGE',
          `Доля ЕП вне диапазона: ${fmtPct_(epShare)} — ТРЕБУЕТ ПРОВЕРКИ`,
          'СРЕДНЯЯ', 'М8:checkDataIntegrity_'
        ));
      }
    } catch (e) {
      log_('M8', `Ошибка проверки данных ${code}: ${e.message}`, 'WARN');
    }
  }
  return anomalies;
}

/**
 * Уровень 2: Аномалии поведения.
 * Анализируем динамику — стагнация, обратный ход, аномальная экономия.
 * Для этого нужны данные из предыдущего среза и расчёт динамики.
 */
function checkBehavioralPatterns_(metrics, dynamics, previousSnapshot) {
  const anomalies = [];
  if (!metrics || !metrics.byGrbs) return anomalies;

  const prevMetrics = previousSnapshot && previousSnapshot.metrics
                    ? previousSnapshot.metrics.byGrbs || {} : {};

  for (const [code, m] of Object.entries(metrics.byGrbs)) {
    try {
      const execPct = toNumber_(m.execPct);
      const epShare = toNumber_(m.epShare);
      const economy = toNumber_(m.economyPct);
      const procedureCount = toNumber_(m.procedureCount);
      const prevM = prevMetrics[code];

      // Правило 1: Стагнация — 0% исполнения при наличии процедур
      // Зачем: процедуры объявлены, но ничего не закуплено — может быть блокировка
      if (execPct === 0 && procedureCount > 0) {
        anomalies.push(makeAnomaly_(
          code, 'ПОВЕДЕНИЕ', 2, 'STAGNATION',
          `0% исполнения при наличии процедур (${procedureCount} шт.) — ТРЕБУЕТ ПРОВЕРКИ: возможна блокировка`,
          'СРЕДНЯЯ', 'М8:checkBehavioralPatterns_'
        ));
      }

      // Правило 2: Обратный ход — исполнение снизилось по сравнению с предыдущим срезом
      if (prevM) {
        const prevExec = toNumber_(prevM.execPct);
        if (prevExec > 0 && execPct < prevExec - 0.5) {
          anomalies.push(makeAnomaly_(
            code, 'ПОВЕДЕНИЕ', 2, 'REVERSE',
            `Исполнение снизилось: ${fmtPct_(prevExec)} → ${fmtPct_(execPct)} — ТРЕБУЕТ ПРОВЕРКИ`,
            'ВЫСОКАЯ', 'М8:checkBehavioralPatterns_'
          ));
        }
      }

      // Правило 3: Аномальная экономия > 30% — возможно занижение начальной цены
      // economyPct хранится как доля 0-1 (НЕ проценты)
      if (economy > 0.30) {
        anomalies.push(makeAnomaly_(
          code, 'ПОВЕДЕНИЕ', 2, 'HIGH_ECONOMY',
          `Аномальная экономия ${fmtPct_(economy)} — ТРЕБУЕТ ПРОВЕРКИ: возможно завышение НМЦК`,
          'СРЕДНЯЯ', 'М8:checkBehavioralPatterns_'
        ));
      }

      // Правило 4: Нулевая экономия при конкурентных процедурах
      // Зачем: конкурентные торги всегда дают хоть какую-то экономию
      // Порог 0.005 = 0.5% — экономия ниже этого считается «нулевой»
      const competitivePct = toNumber_(m.competitivePct);
      if (competitivePct > 0.50 && economy < 0.005 && toNumber_(m.fact) > 0) {
        anomalies.push(makeAnomaly_(
          code, 'ПОВЕДЕНИЕ', 2, 'ZERO_ECONOMY_COMPETITIVE',
          `Нулевая экономия при ${fmtPct_(competitivePct)} конкурентных процедур — ТРЕБУЕТ ПРОВЕРКИ`,
          'СРЕДНЯЯ', 'М8:checkBehavioralPatterns_'
        ));
      }

      // Правило 5: Аномальный скачок по данным EWMA
      const dyn = dynamics && dynamics.byGrbs ? dynamics.byGrbs[code] : null;
      if (dyn && dyn.isAnomaly) {
        anomalies.push(makeAnomaly_(
          code, 'ПОВЕДЕНИЕ', 2, 'EWMA_ANOMALY',
          `Аномальный скачок показателя (отклонение > 3σ) — ТРЕБУЕТ ПРОВЕРКИ`,
          'ВЫСОКАЯ', 'М8:checkBehavioralPatterns_'
        ));
      }
    } catch (e) {
      log_('M8', `Ошибка поведенческой проверки ${code}: ${e.message}`, 'WARN');
    }
  }
  return anomalies;
}

/**
 * Уровень 3: Системные аномалии.
 * Смотрим картину целиком: все блоки одинаково плохо, один выбивается,
 * системный рост ЕП, концентрация экономии.
 */
function checkSystemicIssues_(metrics) {
  const anomalies = [];
  if (!metrics || !metrics.byGrbs) return anomalies;

  try {
    const codes = Object.keys(metrics.byGrbs);
    if (codes.length < 2) return anomalies;

    // Собираем массивы показателей для статистического анализа
    const execValues = codes.map(c => toNumber_(metrics.byGrbs[c].execPct));
    const epValues   = codes.map(c => toNumber_(metrics.byGrbs[c].epShare));
    const econValues = codes.map(c => toNumber_(metrics.byGrbs[c].economyPct || 0));

    // --- Статистики ---
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const std  = (arr) => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
    };

    const execMean = mean(execValues);
    const execStd  = std(execValues);
    const epMean   = mean(epValues);

    // Правило 1: Все блоки одинаково плохо (разброс < 5 п.п.)
    // Зачем: если все одинаково отстают — проблема системная, а не в конкретном блоке
    if (execStd < 5 && execMean < 50) {
      anomalies.push(makeAnomaly_(
        'ВСЕ', 'СИСТЕМА', 3, 'UNIFORM_LOW',
        `Все блоки одинаково низко (${fmtPct_(execMean)} ± ${fmtPct_(execStd)}) — ТРЕБУЕТ ПРОВЕРКИ: возможна системная проблема`,
        'СРЕДНЯЯ', 'М8:checkSystemicIssues_'
      ));
    }

    // Правило 2: Один блок выбивается (> 2σ от среднего)
    if (execStd > 0) {
      for (let i = 0; i < codes.length; i++) {
        const deviation = Math.abs(execValues[i] - execMean) / execStd;
        if (deviation > 2) {
          const direction = execValues[i] > execMean ? 'выше' : 'ниже';
          anomalies.push(makeAnomaly_(
            codes[i], 'СИСТЕМА', 3, 'OUTLIER',
            `Блок значительно ${direction} среднего (${fmtPct_(execValues[i])} при среднем ${fmtPct_(execMean)}) — ТРЕБУЕТ ПРОВЕРКИ`,
            'ВЫСОКАЯ', 'М8:checkSystemicIssues_'
          ));
        }
      }
    }

    // Правило 3: Системный рост доли ЕП — когда средняя доля ЕП слишком высока
    if (epMean > 40) {
      anomalies.push(makeAnomaly_(
        'ВСЕ', 'СИСТЕМА', 3, 'SYSTEMIC_EP',
        `Средняя доля ЕП по всем блокам ${fmtPct_(epMean)} — ТРЕБУЕТ ПРОВЕРКИ: возможно системное предпочтение ЕП`,
        'СРЕДНЯЯ', 'М8:checkSystemicIssues_'
      ));
    }

    // Правило 4: Экономия концентрируется (> 80% в одном блоке)
    const totalEcon = econValues.reduce((a, b) => a + Math.max(0, b), 0);
    if (totalEcon > 0) {
      for (let i = 0; i < codes.length; i++) {
        const share = Math.max(0, econValues[i]) / totalEcon;
        if (share > 0.80) {
          anomalies.push(makeAnomaly_(
            codes[i], 'СИСТЕМА', 3, 'ECONOMY_CONCENTRATION',
            `${fmtPct_(share)} всей экономии сконцентрировано в одном блоке — ТРЕБУЕТ ПРОВЕРКИ`,
            'СРЕДНЯЯ', 'М8:checkSystemicIssues_'
          ));
        }
      }
    }
  } catch (e) {
    log_('M8', `Ошибка системной проверки: ${e.message}`, 'WARN');
  }
  return anomalies;
}


// ======================= M9: ДВИГАТЕЛЬ КОМПЛАЕНСА 44-ФЗ =====================
// Зачем: 44-ФЗ устанавливает жёсткие правила закупок. Нарушение карается штрафами,
// предписаниями ФАС, уголовной ответственностью. Раннее выявление рисков
// позволяет скорректировать действия ДО проверки контролирующих органов.
// =============================================================================

/**
 * Стадия 7 конвейера: проверка на соответствие 44-ФЗ.
 * Пять типов проверок: пороги ЕП, дробление, антидемпинг, сроки, совместные.
 * @return {Array<Object>} — массив флагов комплаенса
 */
function checkCompliance44FZ_(metrics, grbsRows) {
  const flags = [];
  try {
    if (!metrics || !metrics.byGrbs) return flags;

    for (const [code, m] of Object.entries(metrics.byGrbs)) {
      // Определяем роль ГРБС для правильного порога ЕП
      const role = detectGrbsRole_(code);
      const grbsData = grbsRows ? (grbsRows[code] || []) : [];

      // Проверка 1: Пороги ЕП (ст. 93 44-ФЗ)
      const epFlags = check44FZ_Thresholds_(code, m, role);
      flags.push(...epFlags);

      // Проверка 2: Признаки дробления закупок
      const splitResult = calcSplittingRisk_(toNumber_(m.epContractCount), toNumber_(m.periodDays || 90), m.epBreakdown);
      const splitRisk = splitResult.score || 0;
      if (splitRisk > 50) {
        var splitFactors = (splitResult.factors || []).map(function(f) { return f.name + ': ' + f.detail; }).join('; ');
        flags.push({
          grbs: code, severity: splitRisk > 80 ? 'ВЫСОКАЯ' : 'СРЕДНЯЯ',
          article: 'ст. 93 ч. 1',
          text: `Индекс риска дробления: ${splitRisk}/100 — ТРЕБУЕТ ПРОВЕРКИ: возможно искусственное дробление` + (splitFactors ? ' (' + splitFactors + ')' : ''),
          type: 'ДРОБЛЕНИЕ'
        });
      }

      // Проверка 3: Антидемпинг (ст. 37)
      const antiDumpFlags = checkAntiDumping_(m);
      flags.push(...antiDumpFlags);

      // Проверка 4: Сроки (если данные доступны)
      const timeFlags = checkTimelines_(grbsData);
      flags.push(...timeFlags.map(f => ({ ...f, grbs: code })));
    }

    // Проверка 5: Анализ централизации закупок (ст. 25)
    const centrFlags = analyzeCentralization_(metrics, grbsRows);
    flags.push(...centrFlags);

    log_('M9', `Комплаенс 44-ФЗ: ${flags.length} флагов`);
  } catch (e) {
    log_('M9', `Ошибка проверки комплаенса: ${e.message}`, 'ERROR');
  }
  return flags;
}

/**
 * Определение роли ГРБС для применения правильных порогов.
 * Зачем: лимиты ЕП (ст. 93) зависят от статуса организации —
 * образовательные, медицинские, культурные учреждения имеют повышенные пороги.
 * @param {string} grbsCode — код ГРБС
 * @return {string} — 'СТАНДАРТ' | 'ОБРАЗОВАНИЕ' | 'МЕДИЦИНА' | 'КУЛЬТУРА'
 */
function detectGrbsRole_(grbsCode) {
  var bl = GRBS_BASELINES_[grbsCode];
  if (bl && bl.role) return bl.role;
  return 'СТАНДАРТ';
}

/**
 * Проверка 1: Пороги единственного поставщика (ст. 93 44-ФЗ).
 * Закон устанавливает годовые лимиты: до 600 тыс. на одну закупку,
 * до 2 млн (или 10%) совокупного годового объёма.
 * @return {Array} — массив флагов нарушений
 */
function check44FZ_Thresholds_(grbsCode, metrics, role) {
  const flags = [];
  try {
    const epShare = toNumber_(metrics.epShare);
    const epAmount = toNumber_(metrics.epAmount || metrics.epFactSum || metrics.epFactSumYear);
    const compPlan = toNumber_(metrics.plan || metrics.compPlanSum);
    const epPlan = toNumber_(metrics.epPlanSum || metrics.epPlanSumYear) || 0;
    const sgoz = compPlan + epPlan;  // СГОЗ = конкурентные + ЕП

    // Пороги из конфигурации по роли ГРБС (шкала 0-1)
    const thresholds = EP_SHARE_THRESHOLDS_ || {};
    const limit = thresholds[role] || thresholds['СТАНДАРТ'] || { share: 0.30, amount: 2000000 };

    // Проверка доли ЕП по роли
    if (epShare > limit.share) {
      const severity = epShare > limit.share * 1.5 ? 'ВЫСОКАЯ' : 'СРЕДНЯЯ';
      flags.push({
        grbs: grbsCode, severity,
        article: 'ст. 93 ч. 1 п. 4-5',
        text: `Доля ЕП ${fmtPct_(epShare)} превышает порог ${fmtPct_(limit.share)} для категории «${role}» — ТРЕБУЕТ ПРОВЕРКИ`,
        type: 'ПОРОГ',
        action: `${grbsCode}: запросить реестр обоснований ЕП — доля ${fmtPct_(epShare)} при допустимых ${fmtPct_(limit.share)} (${role})`
      });
    }

    // Проверка абсолютной суммы ЕП
    if (epAmount > 0 && limit.amount > 0 && epAmount > limit.amount) {
      flags.push({
        grbs: grbsCode, severity: 'СРЕДНЯЯ',
        article: 'ст. 93 ч. 1 п. 4',
        text: `Сумма ЕП ${fmtMoney_(epAmount)} превышает лимит ${fmtMoney_(limit.amount)} — рекомендуется проверить обоснования`,
        type: 'ПОРОГ',
        action: `${grbsCode}: проверить обоснования ЕП на сумму ${fmtMoney_(epAmount)} (лимит ${fmtMoney_(limit.amount)})`
      });
    }

    // 44-ФЗ: 10% от СГОЗ (comp + EP)
    if (sgoz > 0 && epAmount > sgoz * 0.1) {
      flags.push({
        grbs: grbsCode, severity: 'ВЫСОКАЯ',
        article: 'ст. 93 ч. 1 п. 5',
        text: `ЕП составляет ${fmtPct_(epAmount / sgoz)} от СГОЗ (лимит 10%) — ТРЕБУЕТ ПРОВЕРКИ`,
        type: 'ПОРОГ',
        action: `${grbsCode}: проверить обоснования ЕП на ${fmtMoney_(epAmount)} — доля от СГОЗ ${fmtPct_(epAmount / sgoz)}, превышает 10%. Запросить реестр обоснований по ст. 93`
      });
    }

    // === НОВЫЕ ПРОВЕРКИ (H2) ===

    // Проверка 4: Разбивка ЕП по основаниям — если «прочие» > 30%
    var epBreakdown = metrics.epBreakdown || {};
    var bdKeys = Object.keys(epBreakdown);
    var totalEpCount = 0, otherCount = 0;
    for (var bk = 0; bk < bdKeys.length; bk++) {
      var bdItem = epBreakdown[bdKeys[bk]];
      var cnt = (bdItem && typeof bdItem === 'object') ? (bdItem.count || 0) : 0;
      totalEpCount += cnt;
      if (/проч|other|иное/i.test(bdKeys[bk])) otherCount += cnt;
    }
    if (totalEpCount > 0 && otherCount / totalEpCount > 0.30) {
      flags.push({
        grbs: grbsCode, severity: 'СРЕДНЯЯ',
        article: 'ст. 93 ч. 1',
        text: 'Более ' + fmtPct_(otherCount / totalEpCount) + ' ЕП классифицировано как «прочие» — недостаточная детализация оснований',
        type: 'ПОРОГ',
        action: grbsCode + ': запросить детализацию оснований ЕП — ' + otherCount + ' из ' + totalEpCount + ' контрактов без чёткой классификации'
      });
    }

    // Проверка 5: Концентрация на одном основании > 80%
    if (totalEpCount > 3) {
      for (var bk2 = 0; bk2 < bdKeys.length; bk2++) {
        var bdItem2 = epBreakdown[bdKeys[bk2]];
        var cnt2 = (bdItem2 && typeof bdItem2 === 'object') ? (bdItem2.count || 0) : 0;
        if (cnt2 / totalEpCount > 0.80) {
          flags.push({
            grbs: grbsCode, severity: 'СРЕДНЯЯ',
            article: 'ст. 93 ч. 1',
            text: 'Более 80% ЕП сосредоточено в одной категории «' + bdKeys[bk2] + '» (' + cnt2 + ' из ' + totalEpCount + ') — рекомендуется анализ',
            type: 'ПОРОГ',
            action: grbsCode + ': провести анализ обоснованности концентрации ЕП в категории «' + bdKeys[bk2] + '»'
          });
          break;
        }
      }
    }

    // Проверка 6: Перекрёстная ЕП + экономия
    var econPct = toNumber_(metrics.economyPct || 0);
    if (econPct > 1) econPct = econPct / 100;  // нормализуем
    if (epShare > 0.50 && econPct < 0.03) {
      flags.push({
        grbs: grbsCode, severity: 'СРЕДНЯЯ',
        article: 'ст. 93, ст. 22',
        text: 'Доля ЕП ' + fmtPct_(epShare) + ' при экономии ' + fmtPct_(econPct) + ' — структурный сигнал: высокая доля неконкурентных закупок при минимальной экономии',
        type: 'ПОРОГ',
        action: grbsCode + ': проанализировать связь между долей ЕП и экономией. Рассмотреть перевод части ЕП в конкурентные процедуры'
      });
    }
  } catch (e) {
    log_('M9', `Ошибка проверки порогов ЕП для ${grbsCode}: ${e.message}`, 'WARN');
  }
  return flags;
}

/**
 * Проверка 2: Признаки дробления закупок.
 * Зачем: дробление — разбивка одной крупной закупки на несколько мелких
 * для обхода конкурентных процедур. Является нарушением 44-ФЗ.
 * Индекс риска 0-100: чем больше мелких однотипных ЕП за короткий период, тем выше риск.
 * @param {number} epContracts — количество ЕП-контрактов
 * @param {number} periodDays — период в днях
 * @return {number} — индекс риска 0-100
 */
function calcSplittingRisk_(epContracts, periodDays, epBreakdown) {
  if (epContracts <= 0 || periodDays <= 0) return { score: 0, factors: [] };

  var factors = [];
  var totalScore = 0;

  // Фактор 1: Частота (текущая логика)
  var weeklyRate = epContracts / (periodDays / 7);
  var freqScore = 0;
  if (weeklyRate > 7) freqScore = 90;
  else if (weeklyRate > 5) freqScore = 70;
  else if (weeklyRate > 3) freqScore = 50;
  else if (weeklyRate > 2) freqScore = 30;
  else freqScore = Math.max(0, weeklyRate * 10);
  if (freqScore > 20) factors.push({ name: 'Частота', score: freqScore, detail: fmtNum_(weeklyRate, 1) + ' ЕП/неделю' });
  totalScore += freqScore * 0.4;

  // Фактор 2: Кластеризация сумм вблизи порога 600 тыс. (из epBreakdown)
  if (epBreakdown && typeof epBreakdown === 'object') {
    var nearThreshold = 0, totalItems = 0;
    var bdKeys = Object.keys(epBreakdown);
    for (var i = 0; i < bdKeys.length; i++) {
      var cat = epBreakdown[bdKeys[i]];
      if (cat && cat.items) {
        for (var j = 0; j < cat.items.length; j++) {
          var sum = cat.items[j].planSum || cat.items[j].factSum || 0;
          totalItems++;
          if (sum >= 400000 && sum <= 600000) nearThreshold++;
        }
      }
    }
    if (totalItems > 0) {
      var clusterPct = nearThreshold / totalItems;
      var clusterScore = clusterPct > 0.50 ? 80 : (clusterPct > 0.30 ? 50 : (clusterPct > 0.15 ? 25 : 0));
      if (clusterScore > 0) factors.push({ name: 'Кластеризация у порога', score: clusterScore, detail: nearThreshold + ' из ' + totalItems + ' в диапазоне 400-600 тыс.' });
      totalScore += clusterScore * 0.3;
    }
  }

  // Фактор 3: Однотипность предмета (из epBreakdown categories)
  if (epBreakdown && typeof epBreakdown === 'object') {
    var bdKeys2 = Object.keys(epBreakdown);
    var maxCatCount = 0, maxCatName = '';
    var totalCatCount = 0;
    for (var i2 = 0; i2 < bdKeys2.length; i2++) {
      var cat2 = epBreakdown[bdKeys2[i2]];
      var cnt = (cat2 && cat2.count) ? cat2.count : 0;
      totalCatCount += cnt;
      if (cnt > maxCatCount) { maxCatCount = cnt; maxCatName = bdKeys2[i2]; }
    }
    if (totalCatCount > 3 && maxCatCount / totalCatCount > 0.60) {
      var monoScore = maxCatCount / totalCatCount > 0.80 ? 70 : 40;
      factors.push({ name: 'Однотипность', score: monoScore, detail: maxCatCount + ' из ' + totalCatCount + ' в категории «' + maxCatName + '»' });
      totalScore += monoScore * 0.3;
    }
  }

  var finalScore = Math.min(100, Math.round(totalScore));
  return { score: finalScore, factors: factors };
}

/**
 * Проверка 3: Антидемпинг (ст. 37 44-ФЗ).
 * Если цена контракта снижена > 25% от НМЦК, поставщик обязан предоставить
 * обеспечение в 1.5x размере. Мы проверяем экономию как прокси.
 * @return {Array} — массив флагов
 */
function checkAntiDumping_(metrics) {
  const flags = [];
  try {
    const economy = toNumber_(metrics.economyPct);
    const fact = toNumber_(metrics.fact);

    // Экономия > 25% — возможен демпинг (шкала 0-1)
    var econThreshold = economy > 1 ? economy / 100 : economy;  // нормализуем к 0-1
    if (econThreshold > 0.25 && fact > 0) {
      flags.push({
        grbs: metrics.code || '', severity: 'СРЕДНЯЯ',
        article: 'ст. 37 44-ФЗ',
        text: `Экономия ${fmtPct_(econThreshold)} превышает 25% — рекомендуется проверить наличие повышенного обеспечения исполнения (ст. 37)`,
        type: 'ДЕМПИНГ',
        action: `${metrics.code || ''}: запросить документы по обеспечению исполнения контрактов с экономией > 25% (ст. 37 44-ФЗ)`
      });
    }

    // Экономия > 40% — повышенный риск
    if (econThreshold > 0.40 && fact > 0) {
      flags.push({
        grbs: metrics.code || '', severity: 'ВЫСОКАЯ',
        article: 'ст. 37 44-ФЗ',
        text: `Экономия ${fmtPct_(econThreshold)} — ТРЕБУЕТ ПРОВЕРКИ: повышенный риск ненадлежащего исполнения контракта`,
        type: 'ДЕМПИНГ',
        action: `${metrics.code || ''}: провести выборочную проверку качества исполнения контрактов с экономией > 40%. Запросить акты приёмки`
      });
    }
  } catch (e) {
    log_('M9', `Ошибка проверки антидемпинга: ${e.message}`, 'WARN');
  }
  return flags;
}

/**
 * Проверка 4: Сроки (ст. 42, 94, 103 44-ФЗ).
 * Контролируем: срок размещения извещения, срок подписания контракта,
 * срок внесения в реестр контрактов. Данные могут быть неполными.
 * @param {Array} grbsData — строки данных ГРБС
 * @return {Array} — массив флагов
 */
function checkTimelines_(grbsData) {
  const flags = [];
  try {
    if (!Array.isArray(grbsData) || grbsData.length === 0) return flags;

    for (const row of grbsData) {
      // Проверяем только если есть даты
      const publishDate = row.publishDate instanceof Date ? row.publishDate : null;
      const signDate = row.signDate instanceof Date ? row.signDate : null;
      const registerDate = row.registerDate instanceof Date ? row.registerDate : null;

      // Ст. 103: реестр контрактов — 5 рабочих дней после подписания
      if (signDate && registerDate) {
        const days = dateDiffDays_(signDate, registerDate);
        if (days > 7) { // 7 календарных ≈ 5 рабочих
          flags.push({
            severity: 'СРЕДНЯЯ', article: 'ст. 103',
            text: `Контракт внесён в реестр через ${days} дней — ТРЕБУЕТ ПРОВЕРКИ (норматив 5 р.д.)`,
            type: 'СРОКИ',
            action: 'Проверить соблюдение сроков внесения в реестр контрактов (ст. 103 44-ФЗ, штраф по ч. 2 ст. 7.31 КоАП)'
          });
        }
      }

      // Ст. 94: подписание контракта — не ранее 10 дней после протокола
      if (publishDate && signDate) {
        const days = dateDiffDays_(publishDate, signDate);
        if (days < 5 && days >= 0) {
          flags.push({
            severity: 'СРЕДНЯЯ', article: 'ст. 94',
            text: `Контракт подписан через ${days} дней после публикации — рекомендуется проверить соблюдение сроков`,
            type: 'СРОКИ',
            action: 'Проверить соблюдение минимальных сроков между публикацией извещения и подписанием контракта (ст. 94 44-ФЗ)'
          });
        }
      }
    }
  } catch (e) {
    log_('M9', `Ошибка проверки сроков: ${e.message}`, 'WARN');
  }
  return flags;
}

/**
 * Классификация предмета закупки по текстовому описанию.
 * Используется для выявления пересечений между ГРБС по однотипным закупкам.
 * @param {string} activityText — описание предмета закупки
 * @return {string|null} — категория или null
 */
function classifySubjectCategory_(activityText) {
  if (!activityText) return null;
  var text = String(activityText).toLowerCase();
  var patterns = Object.keys(SUBJECT_CATEGORIES_);
  for (var i = 0; i < patterns.length; i++) {
    if (new RegExp(patterns[i], 'i').test(text)) {
      return SUBJECT_CATEGORIES_[patterns[i]];
    }
  }
  return null;
}

/**
 * Проверка 5: Анализ централизации закупок (ст. 25 44-ФЗ).
 * Заменяет checkJointOpportunities_. Строит карту предметных категорий,
 * находит пересечения где ≥2 ГРБС закупают одно и то же, рассчитывает
 * потенциальную экономию от совместных закупок.
 * @param {Object} allGrbsMetrics — метрики все�� ГРБС
 * @param {Object} allLineItems — строки закупок по ГРБС (из ctx.grbsRows)
 * @return {Array} — массив флагов
 */
function analyzeCentralization_(allGrbsMetrics, allLineItems) {
  var flags = [];
  try {
    if (!allGrbsMetrics || !allGrbsMetrics.byGrbs) return flags;

    // Строим карту: категория → [{grbs, count, sum, epCount, epSum}]
    var subjectMap = {};
    var grbsCodes = Object.keys(allGrbsMetrics.byGrbs);

    // allLineItems может быть массивом (grbsRows) или объектом — нормализуем
    var lineItemsMap = {};
    if (Array.isArray(allLineItems)) {
      for (var r = 0; r < allLineItems.length; r++) {
        if (allLineItems[r] && allLineItems[r].code) lineItemsMap[allLineItems[r].code] = allLineItems[r];
      }
    } else if (allLineItems && typeof allLineItems === 'object') {
      lineItemsMap = allLineItems;
    }

    for (var g = 0; g < grbsCodes.length; g++) {
      var code = grbsCodes[g];
      var gm = allGrbsMetrics.byGrbs[code];
      var items = lineItemsMap[code] || {};

      // Анализ lineItems (конкурентные незаключённые)
      if (items.lineItems) {
        for (var li = 0; li < items.lineItems.length; li++) {
          var cat = classifySubjectCategory_(items.lineItems[li].activity);
          if (cat) {
            if (!subjectMap[cat]) subjectMap[cat] = {};
            if (!subjectMap[cat][code]) subjectMap[cat][code] = { compCount: 0, compSum: 0, epCount: 0, epSum: 0 };
            subjectMap[cat][code].compCount++;
            subjectMap[cat][code].compSum += (items.lineItems[li].planSum || 0);
          }
        }
      }

      // Анализ epBreakdown
      if (items.epBreakdown) {
        var bdKeys = Object.keys(items.epBreakdown);
        for (var b = 0; b < bdKeys.length; b++) {
          var bdCat = items.epBreakdown[bdKeys[b]];
          if (bdCat && bdCat.items) {
            for (var ei = 0; ei < bdCat.items.length; ei++) {
              var epCat = classifySubjectCategory_(bdCat.items[ei].activity);
              if (epCat) {
                if (!subjectMap[epCat]) subjectMap[epCat] = {};
                if (!subjectMap[epCat][code]) subjectMap[epCat][code] = { compCount: 0, compSum: 0, epCount: 0, epSum: 0 };
                subjectMap[epCat][code].epCount++;
                subjectMap[epCat][code].epSum += (bdCat.items[ei].planSum || bdCat.items[ei].factSum || 0);
              }
            }
          }
        }
      }
    }

    // Находим пересечения: категории с ≥ 2 ГРБС
    var opportunities = [];
    var catKeys = Object.keys(subjectMap);
    for (var c = 0; c < catKeys.length; c++) {
      var catName = catKeys[c];
      var grbsMap = subjectMap[catName];
      var grbsInCat = Object.keys(grbsMap);
      if (grbsInCat.length < 2) continue;

      var totalSum = 0, totalCount = 0, totalEpSum = 0, totalEpCount = 0;
      var grbsDetails = [];
      for (var gi = 0; gi < grbsInCat.length; gi++) {
        var entry = grbsMap[grbsInCat[gi]];
        totalSum += entry.compSum + entry.epSum;
        totalCount += entry.compCount + entry.epCount;
        totalEpSum += entry.epSum;
        totalEpCount += entry.epCount;
        grbsDetails.push(grbsInCat[gi]);
      }

      if (totalSum > 0) {
        var savingPct = totalSum > 2000 ? 0.15 : (totalSum > 600 ? 0.10 : 0.05);
        opportunities.push({
          category: catName,
          grbsList: grbsDetails,
          totalSum: totalSum,
          totalCount: totalCount,
          totalEpSum: totalEpSum,
          totalEpCount: totalEpCount,
          potentialSaving: totalSum * savingPct,
          severity: totalEpSum > 2000 ? 'ВЫСОКАЯ' : (totalEpSum > 600 ? 'СРЕДНЯЯ' : 'ИНФОРМАЦИЯ')
        });
      }
    }

    // Сортируем по потенциальной экономии
    opportunities.sort(function(a, b) { return b.potentialSaving - a.potentialSaving; });

    // Генерируем flags
    for (var i = 0; i < opportunities.length; i++) {
      var opp = opportunities[i];
      flags.push({
        grbs: opp.grbsList.join('+'),
        severity: opp.severity,
        article: 'ст. 25 44-ФЗ',
        text: opp.grbsList.length + ' ГРБС закупают «' + opp.category + '» (общий объём ' + fmtMoney_(opp.totalSum) + ', ' + pluralProc_(opp.totalCount) + '). Рекомендуется совместная закупка',
        type: 'ЦЕНТРАЛИЗАЦИЯ',
        action: opp.grbsList.join(', ') + ': объединить закупки «' + opp.category + '» в совместный ЭА. Потенциальная экономия: ' + fmtMoney_(opp.potentialSaving),
        interpretation: opp.totalEpCount > 0 ?
          'Из ' + opp.totalCount + ' процедур ' + opp.totalEpCount + ' — через ЕП (' + fmtMoney_(opp.totalEpSum) + '). Централизация позволит перевести в конкурентные' :
          'Объединение повысит конкуренцию за счёт увеличения объёма лота',
        potentialSaving: opp.potentialSaving
      });
    }

    // Сводный flag
    if (opportunities.length > 0) {
      var totalPotential = 0;
      for (var i2 = 0; i2 < opportunities.length; i2++) totalPotential += opportunities[i2].potentialSaving;
      flags.unshift({
        grbs: 'ВСЕ', severity: 'ИНФОРМАЦИЯ',
        article: 'ст. 25 44-ФЗ',
        text: 'Выявлено ' + opportunities.length + ' возможностей централизации закупок. Суммарный потенциал экономии: ' + fmtMoney_(totalPotential),
        type: 'ЦЕНТРАЛИЗАЦИЯ_СВОДКА',
        action: 'По��готовить план централизации по ' + opportunities.length + ' категориям'
      });
    }
  } catch (e) {
    log_('M9', 'Ошибка анализа централизации: ' + e.message, 'WARN');
  }
  return flags;
}


// ============================ M10: КЛАССИФИКАЦИЯ =============================
// Зачем: сырые цифры нужно перевести в понятные уровни — «хорошо / средне / плохо».
// Но статичные пороги не работают: 20% в начале квартала — норма, в конце — провал.
// Адаптивные пороги учитывают фазу квартала.
// =============================================================================

/**
 * Стадия 8 конвейера: классификация с адаптивными порогами.
 * Каждому ГРБС присваиваем уровни по трём осям:
 *   execLevel — исполнение плана, epRiskLevel — риск ЕП, economyLevel — экономия.
 * Композитный балл — взвешенная сумма для итогового ранжирования.
 * @return {{ byGrbs: Object }}
 */
function classify_(metrics, reportDate) {
  const result = { byGrbs: {} };
  try {
    const date = reportDate || new Date();
    const thresholds = getAdaptiveExecThresholds_(date);

    for (const [code, m] of Object.entries(metrics.byGrbs || {})) {
      const execPct = toNumber_(m.execPct);
      const epShare = toNumber_(m.epShare);
      const economy = toNumber_(m.economyPct || 0);

      // Уровень исполнения — адаптивный к фазе квартала
      let execLevel;
      if (execPct >= thresholds.ОТЛИЧНОЕ) execLevel = 'ОТЛИЧНОЕ';
      else if (execPct >= thresholds.ХОРОШЕЕ) execLevel = 'ХОРОШЕЕ';
      else if (execPct >= thresholds.СРЕДНЕЕ) execLevel = 'СРЕДНЕЕ';
      else if (execPct >= thresholds.НИЗКОЕ) execLevel = 'НИЗКОЕ';
      else execLevel = 'КРИТИЧЕСКОЕ';

      // Уровень риска ЕП — с учётом baseline ГРБС (если есть)
      const baseline = GRBS_BASELINES_ ? (GRBS_BASELINES_[code] || {}) : {};
      const normalEP = toNumber_(baseline.normalEpShare || 0.30);
      const epRiskLevel = classifyEpRisk_(epShare, normalEP);

      // Уровень экономии — слишком мало или слишком много — подозрительно
      let economyLevel;
      if (economy >= 0.05 && economy <= 0.25) economyLevel = 'НОРМА';
      else if (economy > 0.25) economyLevel = 'АНОМАЛЬНО_ВЫСОКАЯ';
      else if (economy > 0) economyLevel = 'НИЗКАЯ';
      else economyLevel = 'ОТСУТСТВУЕТ';

      result.byGrbs[code] = { execLevel, epRiskLevel, economyLevel, compositeScore: 0 };
    }

    log_('M10', `Классификация: ${Object.keys(result.byGrbs).length} ГРБС`);
  } catch (e) {
    log_('M10', `Ошибка классификации: ${e.message}`, 'ERROR');
  }
  return result;
}

/**
 * Адаптивные пороги исполнения с учётом фазы квартала.
 * Зачем: 20% в первую неделю квартала — нормально (закупки ещё не завершились).
 * 20% за неделю до конца — критично.
 * Пороги линейно интерполируются от начала к концу квартала.
 * @param {Date} reportDate — дата отчёта
 * @return {{ КРИТИЧЕСКОЕ, НИЗКОЕ, СРЕДНЕЕ, ХОРОШЕЕ, ОТЛИЧНОЕ }}
 */
function getAdaptiveExecThresholds_(reportDate) {
  const qStart = quarterStart_(reportDate);
  const qEnd = quarterEnd_(reportDate);
  const totalDays = dateDiffDays_(qStart, qEnd) || 90;
  const elapsed = dateDiffDays_(qStart, reportDate);
  // Фаза: 0 = начало квартала, 1 = конец
  const phase = Math.max(0, Math.min(1, elapsed / totalDays));

  // Пороги линейно растут от начала к концу квартала
  // Начало квартала (phase=0) → Конец квартала (phase=1)
  return {
    КРИТИЧЕСКОЕ: lerp_(0, 30, phase),     //  0% → 30% — порог «критического»
    НИЗКОЕ:      lerp_(5, 50, phase),      //  5% → 50%
    СРЕДНЕЕ:     lerp_(10, 65, phase),     // 10% → 65%
    ХОРОШЕЕ:     lerp_(20, 80, phase),     // 20% → 80%
    ОТЛИЧНОЕ:    lerp_(40, 90, phase)      // 40% → 90%
  };
}

/**
 * Линейная интерполяция — вспомогательная для адаптивных порогов.
 * @param {number} a — значение при t=0
 * @param {number} b — значение при t=1
 * @param {number} t — фаза [0, 1]
 * @return {number}
 */
function lerp_(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Оценка отклонения от baseline ГРБС.
 * Зачем: у каждого ГРБС своя «норма». ОП обычно 0-10% в Q1 (и это нормально),
 * а РХ должен быть 60%+ к середине квартала.
 * @param {number} actual — текущее значение
 * @param {number} baseline — историческое нормальное значение
 * @param {Object} trajectory — динамика из M7
 * @return {string}
 */
function classifyDeviation_(actual, baseline, trajectory) {
  if (baseline <= 0) return 'НОРМА';
  const delta = actual - baseline;
  const relativeDelta = delta / baseline * 100;

  if (relativeDelta > 30) return 'ЗНАЧИТЕЛЬНО_ВЫШЕ';
  if (relativeDelta > 10) return 'ВЫШЕ_НОРМЫ';
  if (relativeDelta > -10) return 'НОРМА';
  if (relativeDelta > -30) return 'НИЖЕ_НОРМЫ';
  return 'ЗНАЧИТЕЛЬНО_НИЖЕ';
}

/**
 * Оценка риска доли ЕП с учётом нормальной доли для данного ГРБС.
 * @param {number} epShare — текущая доля ЕП %
 * @param {number} normalShare — нормальная доля для этого ГРБС %
 * @return {string} — 'НИЗКИЙ' | 'УМЕРЕННЫЙ' | 'ПОВЫШЕННЫЙ' | 'ВЫСОКИЙ' | 'КРИТИЧЕСКИЙ'
 */
function classifyEpRisk_(epShare, normalShare) {
  const excess = epShare - normalShare;
  if (excess <= 0) return 'НИЗКИЙ';
  if (excess <= 0.10) return 'УМЕРЕННЫЙ';
  if (excess <= 0.25) return 'ПОВЫШЕННЫЙ';
  if (excess <= 0.40) return 'ВЫСОКИЙ';
  return 'КРИТИЧЕСКИЙ';
}

/**
 * Взвешенный композитный балл серьёзности (0-100).
 * Учитывает классификацию, аномалии и флаги комплаенса.
 * Чем выше — тем больше внимания требует ГРБС от руководства.
 * @return {number} — 0 (всё отлично) ... 100 (максимальная тревога)
 */
function compositeScore_(classification, anomalyFlags, complianceFlags) {
  let score = 0;

  // Компонент 1: Уровень исполнения (вес 40%)
  const execScores = { ОТЛИЧНОЕ: 0, ХОРОШЕЕ: 15, СРЕДНЕЕ: 40, НИЗКОЕ: 70, КРИТИЧЕСКОЕ: 100 };
  score += (execScores[classification.execLevel] || 50) * 0.4;

  // Компонент 2: Риск ЕП (вес 25%)
  const epScores = { НИЗКИЙ: 0, УМЕРЕННЫЙ: 20, ПОВЫШЕННЫЙ: 50, ВЫСОКИЙ: 75, КРИТИЧЕСКИЙ: 100 };
  score += (epScores[classification.epRiskLevel] || 40) * 0.25;

  // Компонент 3: Аномалии (вес 20%)
  const severityPoints = { ИНФОРМАЦИЯ: 5, СРЕДНЯЯ: 15, ВЫСОКАЯ: 30, КРИТИЧЕСКАЯ: 50 };
  let anomalyScore = 0;
  for (const a of (anomalyFlags || [])) {
    anomalyScore += severityPoints[a.severity] || 10;
  }
  score += Math.min(100, anomalyScore) * 0.2;

  // Компонент 4: Комплаенс (вес 15%)
  let complianceScore = 0;
  for (const f of (complianceFlags || [])) {
    complianceScore += severityPoints[f.severity] || 10;
  }
  score += Math.min(100, complianceScore) * 0.15;

  return Math.round(Math.max(0, Math.min(100, score)));
}


// ============================ M11: ПРОФИЛИРОВАНИЕ ============================
// Зачем: все предыдущие модули дали «кирпичики» — метрики, динамику, аномалии,
// комплаенс, классификацию. Профиль — это СИНТЕЗ: что главное для этого ГРБС,
// как об этом написать, что порекомендовать руководству.
// Профиль определяет текст отчёта в Part 3.
// =============================================================================

/**
 * Стадия 9 конвейера: профилирование каждого ГРБС.
 * Собирает все данные в единый профиль, определяет доминантный фактор,
 * режим повествования и управленческое действие.
 * @return {Object} — { 'УЭР': { ... }, 'ОП': { ... }, ... }
 */
function buildProfiles_(metrics, classifications, dynamics, anomalies, complianceFlags, humanContext) {
  const profiles = {};
  try {
    const codes = Object.keys((metrics && metrics.byGrbs) || {});

    for (const code of codes) {
      try {
        const m = metrics.byGrbs[code];
        const baseline = GRBS_BASELINES_ ? (GRBS_BASELINES_[code] || {}) : {};
        const trajectory = dynamics && dynamics.byGrbs ? (dynamics.byGrbs[code] || defaultDynamics_()) : defaultDynamics_();
        const classification = classifications && classifications.byGrbs
                             ? (classifications.byGrbs[code] || {}) : {};

        // Фильтруем аномалии и флаги для конкретного ГРБС
        const grbsAnomalies = (anomalies || []).filter(a => a.grbs === code || a.grbs === 'ВСЕ');
        const grbsCompliance = (complianceFlags || []).filter(f => f.grbs === code || f.grbs === 'ВСЕ');
        const context = humanContext ? (humanContext[code] || null) : null;

        profiles[code] = buildGrbsProfile_(
          code, m, baseline, trajectory, grbsAnomalies, context, classification
        );

        // Расчёт композитного балла с учётом всех факторов
        profiles[code].compositeScore = compositeScore_(
          classification, grbsAnomalies, grbsCompliance
        );

        // Обновляем compositeScore и в классификации
        if (classifications && classifications.byGrbs && classifications.byGrbs[code]) {
          classifications.byGrbs[code].compositeScore = profiles[code].compositeScore;
        }
      } catch (e) {
        log_('M11', `Ошибка профилирования ${code}: ${e.message}`, 'WARN');
        profiles[code] = defaultProfile_(code);
      }
    }

    log_('M11', `Профилировано: ${Object.keys(profiles).length} ГРБС`);
  } catch (e) {
    log_('M11', `Критическая ошибка профилирования: ${e.message}`, 'ERROR');
  }
  return profiles;
}

/**
 * Построение профиля одного ГРБС.
 * Объединяет все аналитические срезы в единую картину.
 */
function buildGrbsProfile_(code, metrics, baseline, trajectory, anomalies, context, classification) {
  const execPct = toNumber_(metrics.execPct);
  const epShare = toNumber_(metrics.epShare);
  const economy = toNumber_(metrics.economyPct || 0);

  const profile = {
    code,
    // Ось 1: Дисциплина исполнения — насколько план выполняется
    execDiscipline: {
      current: execPct,
      baseline: toNumber_(baseline.normalExec || 0.50),
      deviation: classifyDeviation_(execPct, toNumber_(baseline.normalExec || 0.50), trajectory),
      level: classification.execLevel || 'СРЕДНЕЕ'
    },
    // Ось 2: Структурный риск — перекос к ЕП
    structuralRisk: {
      epShare,
      normalEP: toNumber_(baseline.normalEpShare || 0.30),
      riskLevel: classification.epRiskLevel || 'УМЕРЕННЫЙ',
      trend: trajectory.trend || 'НЕДОСТАТОЧНО_ДАННЫХ'
    },
    // Ось 3: Экономический эффект — экономия на торгах
    economicEffect: {
      economy,
      level: classification.economyLevel || 'НОРМА'
    },
    // Ось 4: Моментум — куда движемся
    momentum: {
      trend: trajectory.trend || 'НЕДОСТАТОЧНО_ДАННЫХ',
      slope: trajectory.slope || 0,
      acceleration: trajectory.acceleration || 0,
      forecast: trajectory.forecast || null
    },
    // Флаги аномалий
    anomalyFlags: anomalies || [],
    // Человеческий контекст (если есть)
    humanContext: context ? mergeHumanContext_(context, metrics) : { hasHumanContext: false },
    // Определяются ниже
    dominantFactor: null,
    narrativeMode: null,
    riskLevel: null,
    managementAction: null,
    disciplineIndex: 0
  };

  // Определяем доминантный фактор, режим текста и управленческое действие
  profile.dominantFactor = selectDominantFactor_(profile);
  profile.narrativeMode = selectNarrativeMode_(profile);
  profile.riskLevel = determineRiskLevel_(profile);
  profile.managementAction = selectManagementAction_(profile, trajectory, [], metrics);
  profile.disciplineIndex = calcDisciplineIndex_(profile, anomalies, trajectory);

  return profile;
}

/**
 * Профиль по умолчанию (при ошибке) — безопасные значения.
 */
function defaultProfile_(code) {
  return {
    code, execDiscipline: { current: 0, baseline: 0.50, deviation: 'НОРМА', level: 'СРЕДНЕЕ' },
    structuralRisk: { epShare: 0, normalEP: 0.30, riskLevel: 'УМЕРЕННЫЙ', trend: 'НЕДОСТАТОЧНО_ДАННЫХ' },
    economicEffect: { economy: 0, level: 'НОРМА' },
    momentum: { trend: 'НЕДОСТАТОЧНО_ДАННЫХ', slope: 0, acceleration: 0, forecast: null },
    anomalyFlags: [], humanContext: { hasHumanContext: false },
    dominantFactor: 'ИСПОЛНЕНИЕ_ПЛАНА', narrativeMode: 'ШТАТНЫЙ',
    riskLevel: 'СРЕДНИЙ', managementAction: 'Мониторинг в штатном режиме',
    disciplineIndex: 50, compositeScore: 50
  };
}

/**
 * Определение главного фактора ситуации.
 * Зачем: в отчёте нужно говорить о ГЛАВНОМ, а не перечислять всё подряд.
 * Приоритет: контекст > аномалия > исполнение > ЕП > динамика > экономия.
 * @return {string} — код доминантного фактора
 */
var DOMINANT_FACTOR_LABELS_ = {
  'КОНТЕКСТ': 'контекстные факторы',
  'АНОМАЛИЯ': 'выявлены аномалии',
  'ИСПОЛНЕНИЕ_ПЛАНА': 'отставание от плана закупок',
  'ДОЛЯ_ЕП': 'высокая доля единственного поставщика',
  'ДИНАМИКА': 'резкое изменение динамики',
  'ЭКОНОМИЯ': 'аномальный уровень экономии'
};

function selectDominantFactor_(profile) {
  // Если человек дал контекст — это перекрывает автоматику
  if (profile.humanContext && profile.humanContext.hasHumanContext &&
      profile.humanContext.softensAnomalies) {
    return 'КОНТЕКСТ';
  }
  // Критические аномалии перекрывают всё остальное
  const criticalAnomalies = (profile.anomalyFlags || [])
    .filter(a => a.severity === 'КРИТИЧЕСКАЯ' || a.severity === 'ВЫСОКАЯ');
  if (criticalAnomalies.length > 0) return 'АНОМАЛИЯ';

  // Исполнение — основной показатель для руководства
  if (profile.execDiscipline.level === 'КРИТИЧЕСКОЕ' ||
      profile.execDiscipline.level === 'НИЗКОЕ') return 'ИСПОЛНЕНИЕ_ПЛАНА';

  // Высокая доля ЕП — структурный риск
  if (profile.structuralRisk.riskLevel === 'ВЫСОКИЙ' ||
      profile.structuralRisk.riskLevel === 'КРИТИЧЕСКИЙ') return 'ДОЛЯ_ЕП';

  // Сильная динамика (ускорение или падение) — важнее экономии
  if (profile.momentum.trend === 'УСКОРЯЮЩЕЕСЯ_ПАДЕНИЕ' ||
      profile.momentum.trend === 'УСКОРЯЮЩИЙСЯ_РОСТ') return 'ДИНАМИКА';

  // Аномальная экономия
  if (profile.economicEffect.level === 'АНОМАЛЬНО_ВЫСОКАЯ') return 'ЭКОНОМИЯ';

  // По умолчанию — фокус на исполнении
  return 'ИСПОЛНЕНИЕ_ПЛАНА';
}

/**
 * Определение режима повествования.
 * Зачем: текст отчёта должен СООТВЕТСТВОВАТЬ ситуации.
 * Хвалить за 90% исполнения, тревожиться за 10%, быть нейтральным для 50%.
 * @return {string} — 'ПОХВАЛА' | 'ШТАТНЫЙ' | 'ВНИМАНИЕ' | 'ТРЕВОГА' | 'КОНТЕКСТНЫЙ'
 */
function selectNarrativeMode_(profile) {
  // Контекст от человека — специальный режим с учётом пояснений
  if (profile.dominantFactor === 'КОНТЕКСТ') return 'КОНТЕКСТНЫЙ';

  const exec = profile.execDiscipline;
  const risk = profile.structuralRisk;
  const anomalyCount = (profile.anomalyFlags || [])
    .filter(a => a.severity === 'КРИТИЧЕСКАЯ' || a.severity === 'ВЫСОКАЯ').length;

  // Тревога: критическое исполнение ИЛИ критический ЕП ИЛИ тяжёлые аномалии
  if (exec.level === 'КРИТИЧЕСКОЕ' || risk.riskLevel === 'КРИТИЧЕСКИЙ' || anomalyCount >= 2) {
    return 'ТРЕВОГА';
  }
  // Внимание: низкое исполнение ИЛИ высокий ЕП ИЛИ одна тяжёлая аномалия
  if (exec.level === 'НИЗКОЕ' || risk.riskLevel === 'ВЫСОКИЙ' || anomalyCount >= 1) {
    return 'ВНИМАНИЕ';
  }
  // Похвала: отличное исполнение при низком риске ЕП
  if ((exec.level === 'ОТЛИЧНОЕ' || exec.level === 'ХОРОШЕЕ') && risk.riskLevel === 'НИЗКИЙ') {
    return 'ПОХВАЛА';
  }
  // Всё остальное — штатный режим
  return 'ШТАТНЫЙ';
}

/**
 * Определение уровня риска — для итогового светофора в отчёте.
 */
function determineRiskLevel_(profile) {
  const mode = profile.narrativeMode;
  if (mode === 'ТРЕВОГА') return 'ВЫСОКИЙ';
  if (mode === 'ВНИМАНИЕ') return 'ПОВЫШЕННЫЙ';
  if (mode === 'ПОХВАЛА') return 'НИЗКИЙ';
  return 'СРЕДНИЙ';
}

/**
 * Определение конкретного управленческого действия.
 * Зачем: руководителю нужен не абстрактный «красный флаг», а конкретное
 * «позвоните в ОП и запросите график закупок на Q2».
 * @return {string} — текст рекомендованного действия
 */
function selectManagementAction_(profile, dynamics, complianceFlags, metrics) {
  const exec = profile.execDiscipline;
  const risk = profile.structuralRisk;
  const forecast = profile.momentum.forecast;
  const code = profile.code || '';
  const gm = metrics || {};

  // Вспомогательные данные для адресных рекомендаций
  var remain = Math.max(0, (gm.compPlanCount || 0) - (gm.compFactCount || 0));
  var remainSum = Math.max(0, (gm.compPlanSum || 0) - (gm.compFactSum || 0));
  var epCount = gm.epFactCount || gm.epPlanCount || 0;
  var epSum = gm.epFactSum || gm.epPlanSum || 0;

  // Критические аномалии — срочные действия
  const critAnoms = (profile.anomalyFlags || []).filter(a => a.severity === 'КРИТИЧЕСКАЯ');
  if (critAnoms.length > 0) {
    return `${code}: срочная проверка — ${critAnoms[0].description}. Запросить пояснения в течение 3 рабочих дней`;
  }

  // Комплаенс 44-ФЗ — правовой приоритет
  const critCompliance = (complianceFlags || []).filter(f => f.severity === 'ВЫСОКАЯ' || f.severity === 'КРИТИЧЕСКАЯ');
  if (critCompliance.length > 0) {
    var cf = critCompliance[0];
    return `${code}: правовая проверка — ${cf.action || cf.text}`;
  }

  // Низкое исполнение — запросить план-график с конкретикой
  if (exec.level === 'КРИТИЧЕСКОЕ') {
    return `${code}: запросить план-график на ${pluralProc_(remain)} (${fmtMoney_(remainSum)}). Назначить ответственного с еженедельной отчётностью`;
  }
  if (exec.level === 'НИЗКОЕ') {
    return `${code}: запросить пояснения о причинах отставания (выполнено ${gm.compFactCount || 0} из ${gm.compPlanCount || 0}) и план наверстывания`;
  }

  // Высокая доля ЕП — перевести на конкурентные
  if (risk.riskLevel === 'ВЫСОКИЙ' || risk.riskLevel === 'КРИТИЧЕСКИЙ') {
    return `${code}: провести ревизию ${epCount} ЕП-контрактов (${fmtMoney_(epSum)}), выявить позиции для перевода в конкурентные процедуры`;
  }

  // Ускоряющееся падение — вмешательство
  if (dynamics && dynamics.trend === 'УСКОРЯЮЩЕЕСЯ_ПАДЕНИЕ') {
    return `${code}: провести совещание контрактной службы — темп падает, ${pluralProc_(remain)} на ${fmtMoney_(remainSum)} под угрозой срыва`;
  }

  // Контекст от аналитика
  if (profile.humanContext && profile.humanContext.recommendations) {
    return `${code}: ${profile.humanContext.recommendations}`;
  }

  // Хороший результат
  if (exec.level === 'ОТЛИЧНОЕ' || exec.level === 'ХОРОШЕЕ') {
    return `${code}: мониторинг в штатном режиме (${gm.compFactCount || 0} из ${gm.compPlanCount || 0})`;
  }

  return `${code}: мониторинг в штатном режиме`;
}

/**
 * Индекс дисциплины блока (0-100).
 * Зачем: единое число для ранжирования ГРБС — кто требует внимания первым.
 * 100 = идеальный блок, 0 = максимальные проблемы.
 * Учитывает исполнение, ЕП, аномалии, динамику.
 * @return {number} — 0..100
 */
function calcDisciplineIndex_(profile, anomalies, dynamics) {
  let index = 50; // Базовый уровень

  // Исполнение: основной вклад (±30 пунктов)
  const execPct = profile.execDiscipline.current;
  index += (execPct - 50) * 0.6; // от -30 до +30

  // Доля ЕП: штраф за высокую долю (до -15 пунктов)
  const epExcess = Math.max(0, profile.structuralRisk.epShare - profile.structuralRisk.normalEP);
  index -= epExcess * 0.3;

  // Аномалии: штраф (до -20 пунктов)
  const severityPenalty = { ИНФОРМАЦИЯ: 1, СРЕДНЯЯ: 3, ВЫСОКАЯ: 7, КРИТИЧЕСКАЯ: 15 };
  for (const a of (anomalies || [])) {
    index -= severityPenalty[a.severity] || 2;
  }

  // Динамика: бонус за рост, штраф за падение (±10 пунктов)
  if (dynamics) {
    const slope = dynamics.slope || 0;
    index += Math.max(-10, Math.min(10, slope * 2));
  }

  // Человеческий контекст: смягчение (+5 пунктов если есть пояснение)
  if (profile.humanContext && profile.humanContext.softensAnomalies) {
    index += 5;
  }

  return Math.round(Math.max(0, Math.min(100, index)));
}
/**
 * ============================================================================
 * ГЕНЕРАТОР ЗАКУПОЧНЫХ ОТЧЁТОВ — v2.0, Часть 3 из 3
 * ============================================================================
 * М12: Типовой отчёт (шаблонная генерация — воспроизводит человеческий формат)
 * М13: Умный отчёт (InsightBuilder — аналитическая генерация)
 * М14: Сборка и вывод (Google Doc, листы, история, PDF)
 * М1:  Точки входа и меню
 *
 * Зависимости из Частей 1-2:
 *   Утилиты: fmtNum_(), fmtInt_(), fmtPct_(), fmtMoney_(), fmtDate_(),
 *            toNumber_(), safeAdd_(), calcPct_(), dateDiffDays_(),
 *            quarterStart_(), quarterEnd_(), isFriday_(), normalizeString_(),
 *            log_(), safeJsonStringify_()
 *   Конвейер: extractData_(), scoreTrust_(), buildMetrics_(), loadContext_(),
 *             analyzeDynamics_(), detectAnomalies_(), checkCompliance44FZ_(),
 *             classify_(), buildProfiles_()
 *   Константы: CFG_, GRBS_BASELINES_, GRBS_ORDER_, LAW_44FZ_,
 *              EP_SHARE_THRESHOLDS_, SEVERITY_WEIGHTS_, DATA_SCHEMA_
 * ============================================================================
 */


// =============================================================================
// М12: ТИПОВОЙ ОТЧЁТ — TemplateReportGenerator (полная замена)
// =============================================================================
// Структура повторяет эталонный человеческий отчёт от 30.03.2026:
//   шапка → конкурентные (глобально) → ЕП (глобально) → рекомендации →
//   выводы по ЕП → блоки по 7 ГРБС → УО → заключение.
//
// Зависимости:
//   fmtNum_(), fmtInt_(), fmtPct_(), fmtMoney_(), fmtDate_(),
//   toNumber_(), calcPct_(), safeAdd_()
//   GRBS_ORDER_, GRBS_BASELINES_
//   ctx.rawData, ctx.grbsRows, ctx.metrics, ctx.humanContext
// =============================================================================

// --- Точка входа ---
function renderTemplateReport_(ctx) {
  try {
    var rd = ctx.rawData || {};
    var dateStr = fmtDate_(rd.report_date || new Date());
    var qNum = toNumber_(rd.report_quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
    var yearStr = rd.report_year || new Date().getFullYear();
    var p = [];

    p.push('ОТЧЕТ ПО ЗАКУПКАМ ' + dateStr);
    p.push('');
    p.push('ВСЕ ГРБС');
    p.push('');

    // Конкурентные (глобально)
    p.push(sec_CompGlobal_(ctx, qNum, yearStr));
    p.push('');
    // Единственный поставщик (глобально)
    p.push(sec_EpGlobal_(ctx, qNum, yearStr));
    p.push('');
    // Рекомендации
    var recs = sec_Recommendations_(ctx);
    if (recs) { p.push(recs); p.push(''); }
    // Выводы по ЕП
    var epf = sec_EpFacts_(ctx);
    if (epf) { p.push(epf); p.push(''); }
    // 7 основных ГРБС
    for (var i = 0; i < GRBS_ORDER_.length; i++) {
      var s = sec_GrbsFull_(ctx, GRBS_ORDER_[i], qNum, yearStr);
      if (s) { p.push(s); p.push(''); }
    }
    // УО — отдельный блок (образование, особые лимиты ЕП)
    var uo = sec_GrbsFull_(ctx, 'УО', qNum, yearStr);
    if (uo) { p.push(uo); p.push(''); }
    // Заключение
    p.push(sec_Conclusion_(ctx, qNum));

    return p.join('\n');
  } catch (e) {
    return 'ОТЧЕТ ПО ЗАКУПКАМ ' + fmtDate_(new Date()) +
      '\n\n[Ошибка генерации типового отчёта: ' + e.message + ']';
  }
}

// ─── Утилиты доступа к данным ───────────────────────────────────────────────

// Поиск строки grbsRow по коду (в ней есть квартальные данные)
function findRow_(ctx, code) {
  if (!ctx.grbsRows) return null;
  for (var i = 0; i < ctx.grbsRows.length; i++) {
    if (ctx.grbsRows[i].code === code) return ctx.grbsRows[i];
  }
  return null;
}

// Безопасное чтение из rawData
function rd_(ctx, key, fb) {
  var v = toNumber_((ctx.rawData || {})[key]);
  return v !== null ? v : (fb !== undefined ? fb : 0);
}

// Чтение из humanContext
function hc_(ctx, key) {
  return ctx.humanContext ? (ctx.humanContext[key] || null) : null;
}

// Строка бюджетной разбивки: «ФБ – X, КБ – Y, МБ – Z»
function budgetStr_(fb, kb, mb) {
  return 'ФБ – ' + fmtMoney_(fb || 0) + ', КБ – ' + fmtMoney_(kb || 0) +
    ', МБ – ' + fmtMoney_(mb || 0);
}

// Разбивка в скобках (пусто, если все null)
function budgetP_(fb, kb, mb) {
  if (fb === null && kb === null && mb === null) return '';
  return ' (' + budgetStr_(fb || 0, kb || 0, mb || 0) + ')';
}

// Глобальная бюджетная разбивка — пробует rawData (snake_case, camelCase), humanContext
function gBudget_(ctx, pfx) {
  var r = ctx.rawData || {}, h = ctx.humanContext || {};
  var fb = toNumber_(r[pfx + '_fb']) || toNumber_(r['all_' + pfx + '_fb']);
  var kb = toNumber_(r[pfx + '_kb']) || toNumber_(r['all_' + pfx + '_kb']);
  var mb = toNumber_(r[pfx + '_mb']) || toNumber_(r['all_' + pfx + '_mb']);
  if (fb === null && kb === null && mb === null) {
    fb = toNumber_(r[pfx + 'FB'] || r[pfx + '_sum_fb']);
    kb = toNumber_(r[pfx + 'KB'] || r[pfx + '_sum_kb']);
    mb = toNumber_(r[pfx + 'MB'] || r[pfx + '_sum_mb']);
  }
  if (fb === null && kb === null && mb === null) {
    fb = toNumber_(h[pfx + '_fb']); kb = toNumber_(h[pfx + '_kb']); mb = toNumber_(h[pfx + '_mb']);
  }
  return { fb: fb, kb: kb, mb: mb };
}

// Бюджетная разбивка для ГРБС: grbsRow → humanContext
function rBudget_(ctx, row, pfx) {
  var fb = null, kb = null, mb = null;
  if (row) {
    fb = toNumber_(row[pfx + 'FB'] || row[pfx + '_fb']);
    kb = toNumber_(row[pfx + 'KB'] || row[pfx + '_kb']);
    mb = toNumber_(row[pfx + 'MB'] || row[pfx + '_mb']);
  }
  if (fb === null && kb === null && mb === null && ctx.humanContext && row) {
    var k = row.code + '_' + pfx;
    fb = toNumber_(ctx.humanContext[k + '_fb']);
    kb = toNumber_(ctx.humanContext[k + '_kb']);
    mb = toNumber_(ctx.humanContext[k + '_mb']);
  }
  return { fb: fb, kb: kb, mb: mb };
}

// ─── СЕКЦИЯ 1: Конкурентные процедуры (все ГРБС) ────────────────────────────

function sec_CompGlobal_(ctx, qNum, yearStr) {
  try {
    var g = ctx.metrics.global, rd = ctx.rawData || {}, L = [];

    L.push('ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:');

    // План на год
    var yb = gBudget_(ctx, 'comp_year_plan');
    L.push('  Всего на год запланировано ' + fmtInt_(g.allCompYearPlanCount) +
      ' процедур на сумму ' + fmtMoney_(g.allCompYearPlanSum) +
      budgetP_(yb.fb, yb.kb, yb.mb));

    // План на квартал
    var qPC = toNumber_(rd.allCompQPlanCount) || g.allCompQ1PlanCount || 0;
    var qPS = toNumber_(rd.allCompQPlanSum) || g.allCompQ1PlanSum || 0;
    var qb = { fb: toNumber_(rd.allCompQPlanFB), kb: toNumber_(rd.allCompQPlanKB), mb: toNumber_(rd.allCompQPlanMB) };
    if (qb.fb === null) qb = gBudget_(ctx, 'comp_q1_plan');
    L.push('  Всего на ' + qNum + ' квартал ' + yearStr +
      ' года запланировано ' + fmtInt_(qPC) +
      ' конкурентных процедур на общую сумму ' + fmtMoney_(qPS) + budgetP_(qb.fb, qb.kb, qb.mb));

    // Факт
    var qFC = toNumber_(rd.allCompQFactCount) || g.allCompQ1FactCount || 0;
    var qFS = toNumber_(rd.allCompQFactSum) || g.allCompQ1FactSum || 0;
    var fb = { fb: toNumber_(rd.allCompQFactFB), kb: toNumber_(rd.allCompQFactKB), mb: toNumber_(rd.allCompQFactMB) };
    if (fb.fb === null) fb = gBudget_(ctx, 'comp_q1_fact');

    var notes = hc_(ctx, 'comp_fact_notes') || hc_(ctx, 'примечания_факт');
    var gap = qPC - qFC;
    var execPct = qPC > 0 ? calcPct_(qFC, qPC) : null;

    L.push('  Фактически обязательства заключены по ' + fmtInt_(qFC) +
      (notes ? ' (' + notes + ')' : '') +
      ' конкурентным процедурам на общую сумму ' + fmtMoney_(qFS) +
      budgetP_(fb.fb, fb.kb, fb.mb) +
      '. Отклонение от плана ' + qNum + ' квартала – ' +
      fmtInt_(Math.abs(gap)) + ' процедур (общее исполнение плана ' +
      qNum + ' квартала – ' + fmtPct_(execPct) + ')');
    L.push('');

    // Исполнение по ГРБС (сортировка по % возрастанию)
    L.push(list_ExecByGrbs_(ctx, qNum));
    L.push('');

    // Остаток
    var remY = toNumber_(rd.remainingCompCount);
    if (remY === null) remY = Math.max(0, (g.allCompYearPlanCount || 0) - (g.allCompYearFactCount || 0));
    L.push('Остаток незаключенных договоров по конкурентным процедурам до конца года – ' +
      fmtInt_(remY) + '.');

    // Текущая работа отдела
    var wip = text_WIP_(ctx);
    if (wip) L.push(wip);

    // Расчётная экономия
    var eco = text_EconomyForecast_(ctx, remY);
    if (eco) L.push(eco);

    return L.join('\n');
  } catch (e) {
    return 'ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:\n[Ошибка: ' + e.message + ']';
  }
}

// Таблица исполнения по ГРБС, сортировка по % возрастанию
function list_ExecByGrbs_(ctx, qNum) {
  try {
    var dt = (ctx.rawData || {}).report_date || new Date();
    var L = ['По состоянию на ' + fmtDate_(dt) +
      ' фактическое исполнение плана ' + qNum + ' квартала по ГРБС:'];
    var codes = GRBS_ORDER_.concat(['УО']), entries = [];

    for (var i = 0; i < codes.length; i++) {
      var c = codes[i], row = findRow_(ctx, c), gm = ctx.metrics.byGrbs[c];
      var pQ = 0, fQ = 0, pY = 0;
      if (row) { pQ = row.compPlanCountQ || 0; fQ = row.compFactCountQ || 0; pY = row.compPlanCount || 0; }
      else if (gm) { pQ = gm.compPlanCountQ || 0; fQ = gm.compFactCountQ || 0; pY = gm.compPlanCount || 0; }
      if (!row && !gm) continue;
      entries.push({ code: c, pQ: pQ, fQ: fQ, pY: pY, pct: pQ > 0 ? fQ / pQ : 0 });
    }
    entries.sort(function(a, b) { return a.pct - b.pct; });

    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      L.push('- ' + e.code + ' – ' + fmtPct_(e.pct) +
        ' (план на ' + qNum + ' квартал – ' + fmtInt_(e.pQ) +
        ', исполнено ' + fmtInt_(e.fQ) +
        ', план на год – ' + fmtInt_(e.pY) + ')');
    }
    return L.join('\n');
  } catch (e) {
    return '[Ошибка списка ГРБС: ' + e.message + ']';
  }
}

// Текущая работа отдела закупок
function text_WIP_(ctx) {
  var ready = hc_(ctx, 'work_in_progress') || hc_(ctx, 'в_работе');
  if (ready) return ready;
  var rd = ctx.rawData || {};
  var total = toNumber_(rd.wip_total || rd.wipTotal);
  if (total === null) return null;
  var prep = toNumber_(rd.wip_preparing || rd.wipPreparing) || 0;
  var bid = toNumber_(rd.wip_bidding || rd.wipBidding) || 0;
  var t = 'На данный момент в работе у отдела муниципальных закупок находится ' +
    fmtInt_(total) + ' процедуры';
  if (prep > 0 || bid > 0) {
    t += ': ' + fmtInt_(prep) + ' на стадии подготовки извещения к размещению, ' +
      fmtInt_(bid) + ' на стадии подачи заявок';
  }
  return t + '.';
}

// Расчётная экономия по оставшимся процедурам
function text_EconomyForecast_(ctx, remCount) {
  try {
    var rd = ctx.rawData || {}, g = ctx.metrics.global;
    var projE = toNumber_(rd.projectedEconomy), projMB = toNumber_(rd.projectedEconomyMB);
    if (projE === null) {
      var fS = g.allCompYearFactSum || 0, ec = g.allCompYearEconomySum || 0;
      if (fS <= 0 || remCount <= 0) return null;
      var remPS = Math.max(0, (g.allCompYearPlanSum || 0) - fS);
      projE = remPS * (ec / fS);
      if (projE <= 0) return null;
      projMB = projE * (toNumber_(hc_(ctx, 'mb_share')) || 0.65);
    }
    if (!projE || projE <= 0) return null;
    var eb = gBudget_(ctx, 'projected_economy');
    var t = 'Расчетная экономия по оставшимся незаключенным ' + fmtInt_(remCount) +
      ' конкурентным процедурам составляет ' + fmtMoney_(projE) +
      ', из них – ' + fmtMoney_(projMB || 0) + ' – местный бюджет';
    if (eb.fb !== null || eb.kb !== null || eb.mb !== null) t += ' (' + budgetStr_(eb.fb, eb.kb, eb.mb) + ')';
    return t + '.';
  } catch (e) { return null; }
}

// ─── СЕКЦИЯ 2: Единственный поставщик (все ГРБС) ────────────────────────────

function sec_EpGlobal_(ctx, qNum, yearStr) {
  try {
    var g = ctx.metrics.global, rd = ctx.rawData || {}, L = [];
    L.push('ЕДИНСТВЕННЫЙ ПОСТАВЩИК:');

    // План на год
    var yb = gBudget_(ctx, 'ep_year_plan');
    L.push('  Всего на год запланировано ' + fmtInt_(g.allEpYearPlanCount) +
      ' процедур на сумму ' + fmtMoney_(g.allEpYearPlanSum) +
      budgetP_(yb.fb, yb.kb, yb.mb) + '.');

    // План на квартал
    var eQPC = toNumber_(rd.allEpQPlanCount) || getEpQ1PlanCount_(ctx);
    var eQPS = toNumber_(rd.allEpQPlanSum) || getEpQ1PlanSum_(ctx);
    var qb = { fb: toNumber_(rd.allEpQPlanFB), kb: toNumber_(rd.allEpQPlanKB), mb: toNumber_(rd.allEpQPlanMB) };
    if (qb.fb === null) qb = gBudget_(ctx, 'ep_q1_plan');
    L.push('  Всего на ' + qNum + ' квартал ' + yearStr +
      ' года запланировано заключить договоров/контрактов по ' +
      fmtInt_(eQPC) + ' наименованиям на общую сумму ' + fmtMoney_(eQPS) +
      budgetP_(qb.fb, qb.kb, qb.mb) + '.');

    // Факт
    var eQFC = toNumber_(rd.allEpQFactCount) || getEpQ1FactCount_(ctx);
    var eQFS = toNumber_(rd.allEpQFactSum) || getEpQ1FactSum_(ctx);
    var fb2 = { fb: toNumber_(rd.allEpQFactFB), kb: toNumber_(rd.allEpQFactKB), mb: toNumber_(rd.allEpQFactMB) };
    if (fb2.fb === null) fb2 = gBudget_(ctx, 'ep_q1_fact');
    L.push('  Заключено ' + pluralContract_(eQFC) + ' на сумму ' + fmtMoney_(eQFS) +
      budgetP_(fb2.fb, fb2.kb, fb2.mb) + '.');
    L.push('');

    // Распределение ЕП по ГРБС с пояснениями
    L.push(list_EpDistribution_(ctx));
    return L.join('\n');
  } catch (e) {
    return 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:\n[Ошибка: ' + e.message + ']';
  }
}

// Распределение ЕП по ГРБС — сортировка по убыванию доли ЕП
function list_EpDistribution_(ctx) {
  try {
    var dt = (ctx.rawData || {}).report_date || new Date();
    var L = ['По состоянию на ' + fmtDate_(dt) +
      ' фактическое распределение контрактации по ЕП составляет:'];
    var codes = GRBS_ORDER_.concat(['УО']), entries = [];

    for (var i = 0; i < codes.length; i++) {
      var c = codes[i], gm = ctx.metrics.byGrbs[c], row = findRow_(ctx, c);
      if (!gm && !row) continue;
      var share = gm ? gm.epShare : (row ? row.epShare : null);
      if (share === null || share === undefined) continue;
      entries.push({ code: c, share: share, expl: text_EpExplanation_(ctx, c, row) });
    }
    entries.sort(function(a, b) { return (b.share || 0) - (a.share || 0); });

    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      var line = '  ' + e.code + ' ' + fmtPct_(e.share) +
        ' от фактической общей суммы закупок приобрелось по ЕП';
      if (e.expl) line += ' (' + e.expl + ')';
      L.push(line);
    }
    return L.join('\n');
  } catch (e) {
    return '[Ошибка распределения ЕП: ' + e.message + ']';
  }
}

// Пояснение к ЕП: epBreakdown → grbsComments → humanContext
function text_EpExplanation_(ctx, code, row) {
  // Структурированная разбивка: {monopolists: 28, education: 6, equipment: 66}
  if (row && row.epBreakdown) {
    var bd = row.epBreakdown, parts = [];
    var labels = {
      monopolists: 'услуги монополистов', education: 'обучение', equipment: 'техника',
      utilities: 'коммунальные услуги', maintenance: 'содержание', other: 'прочее'
    };
    var keys = Object.keys(bd);
    var totalCount = 0;
    for (var k = 0; k < keys.length; k++) {
      var item = bd[keys[k]];
      if (item && typeof item === 'object' && item.count) totalCount += item.count;
      else if (typeof item === 'number') totalCount += item;
    }
    // Собираем категории с долями, сортируем по убыванию
    var catArr = [];
    for (var k = 0; k < keys.length; k++) {
      var item = bd[keys[k]];
      var cnt = (item && typeof item === 'object') ? (item.count || 0) : (typeof item === 'number' ? item : 0);
      if (cnt > 0 && totalCount > 0) {
        catArr.push({ key: keys[k], pct: (cnt / totalCount) * 100 });
      }
    }
    catArr.sort(function(a, b) { return b.pct - a.pct; });
    for (var k = 0; k < catArr.length; k++) {
      parts.push(fmtNum_(catArr[k].pct, 0) + '% \u2014 ' + (labels[catArr[k].key] || catArr[k].key));
    }
    if (parts.length > 0) return parts.join(', ');
  }
  // Текстовые комментарии
  if (row && row.grbsComments && row.grbsComments.length > 0) return row.grbsComments.join('; ');
  // humanContext
  return hc_(ctx, code + '_ep_explanation') || hc_(ctx, code + '_ep_пояснение') || null;
}

// ─── СЕКЦИЯ 3: Рекомендации и выводы по ЕП ──────────────────────────────────

function sec_Recommendations_(ctx) {
  var total = toNumber_(hc_(ctx, 'recs_total'));
  if (total === null) return null;
  var accepted = toNumber_(hc_(ctx, 'recs_accepted'));

  var L = [];

  // Пункт 1: Общая информация о рекомендациях
  L.push('1. В ходе ведения аналитики коллегам были даны ' + fmtInt_(total) +
    ' адресных рекомендаций по совмещению разрозненных процедур в единую закупку, ' +
    'по объединению схожих мероприятий в единый аукцион, замене типа процедуры с ЕП ' +
    'на конкурентную и иных, способствующих сбору экономии.');
  if (accepted !== null) {
    L.push('   Принято в работу: ' + fmtInt_(accepted) + ' из ' + fmtInt_(total) +
      ' (' + fmtPct_(accepted / total) + '). По остальным позиции разошлись либо обратная связь ещё не получена.');
  }

  // Пункт 2: Оценка конкурентной среды
  var g = ctx.metrics && ctx.metrics.global ? ctx.metrics.global : {};
  var epShareGlobal = g.allFactEpShare;
  if (epShareGlobal !== null && epShareGlobal !== undefined) {
    var epVerdict = epShareGlobal > 0.50 ? 'избыточная зависимость от ЕП; доля конкурентных процедур ниже целевого уровня' :
                   (epShareGlobal > 0.30 ? 'умеренная зависимость от ЕП, есть потенциал для расширения конкуренции' :
                   'конкурентная модель работает удовлетворительно');
    L.push('2. Доля единственного поставщика в совокупном объёме закупок составляет ' +
      fmtPct_(epShareGlobal) + ' — ' + epVerdict + '.');
  }

  // Пункт 3: Экономия бюджета
  if (g.allCompYearEconomySum > 0) {
    var econPct = g.allCompYearPlanSum > 0 ? (g.allCompYearEconomySum / g.allCompYearPlanSum) : 0;
    L.push('3. Совокупная экономия бюджетных средств по конкурентным процедурам: ' +
      fmtMoney_(g.allCompYearEconomySum) + ' (' + fmtPct_(econPct) + ' от плановых сумм). ' +
      (econPct > 0.10 ? 'Показатель выше среднего — конкурентные процедуры обеспечивают значимую экономию.' :
       (econPct > 0.03 ? 'Показатель в нормальном диапазоне.' :
       'Низкий уровень экономии может свидетельствовать о недостаточной конкуренции на торгах.')));
  }

  // Пункт 4: Ключевые риски (из complianceFlags)
  if (ctx.complianceFlags && ctx.complianceFlags.length > 0) {
    var highFlags = ctx.complianceFlags.filter(function(f) {
      return f.severity === 'ВЫСОКАЯ' || f.severity === 'КРИТИЧЕСКАЯ';
    });
    if (highFlags.length > 0) {
      L.push('4. Выявлено ' + highFlags.length + ' индикаторов повышенного/критического риска, ' +
        'требующих дополнительной проверки (дробление, превышение порогов ЕП, антидемпинг). ' +
        'Рекомендуется запросить у соответствующих ГРБС обоснования по каждому индикатору.');
    } else {
      L.push('4. Существенных нарушений требований 44-ФЗ не выявлено. Рекомендуется продолжать мониторинг в штатном режиме.');
    }
  }

  // Пункт 5: Перспективы и задачи на следующий период
  var remainY = 0;
  if (g.allCompYearPlanCount && g.allCompYearFactCount) {
    remainY = Math.max(0, g.allCompYearPlanCount - g.allCompYearFactCount);
  }
  if (remainY > 0) {
    L.push('5. На оставшийся период необходимо завершить ' + fmtInt_(remainY) +
      ' конкурентных процедур. Рекомендуется сосредоточить усилия на своевременном размещении ' +
      'извещений и обеспечении максимальной конкуренции на торгах для повышения экономии бюджетных средств.');
  } else {
    L.push('5. Рекомендуется продолжить работу по повышению квалификации контрактных управляющих ' +
      'и расширению практики конкурентных закупок для оптимизации бюджетных расходов.');
  }

  return L.join('\n');
}

function sec_EpFacts_(ctx) {
  var custom = hc_(ctx, 'ep_conclusions') || hc_(ctx, 'выводы_еп');
  var L = ['Исходя из проведенного анализа по ЕП фиксируем следующие факты:'];
  if (custom) {
    L.push(custom);
  } else {
    L.push('- низкий уровень заинтересованности контрактных управляющих производить закупку ' +
      'товаров, работ и услуг через конкурентные процедуры в связи со сложностью, большим ' +
      'объемом подготавливаемой документации, а также удобством осуществления закупок по ' +
      'единственному поставщику – по мнению специалистов, их трудозатраты кратно превышают ' +
      'уровень заработной платы и возможный эффект от закупки (выгоду для себя не видят)');
    L.push('- невысокая квалификация контрактных управляющих');
  }
  return L.join('\n');
}

// ─── СЕКЦИЯ 4/5: Блок одного ГРБС ──────────────────────────────────────────

function sec_GrbsFull_(ctx, code, qNum, yearStr) {
  try {
    var gm = ctx.metrics.byGrbs[code], row = findRow_(ctx, code);
    if (!gm && !row) return null;
    var bl = GRBS_BASELINES_[code] || {};
    var L = [];

    // Заголовок
    L.push(bl.fullName || (code + ' АЕМР'));
    if (code === 'УО') L.push('(образование — повышенные лимиты ЕП, п.5 ч.1 ст.93 44-ФЗ)');

    // Конкурентные
    L.push(blk_GrbsComp_(ctx, code, gm, row, qNum, yearStr));
    L.push('');
    // ЕП
    L.push(blk_GrbsEp_(ctx, code, gm, row, qNum, yearStr));
    return L.join('\n');
  } catch (e) {
    return code + '\n[Ошибка: ' + e.message + ']';
  }
}

// Конкурентные для одного ГРБС
function blk_GrbsComp_(ctx, code, gm, row, qNum, yearStr) {
  try {
    var L = ['КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:'];
    var pYC = (row ? row.compPlanCount : null) || (gm ? gm.compPlanCount : 0) || 0;
    var pQC = (row ? row.compPlanCountQ : null) || (gm ? gm.compPlanCountQ : 0) || 0;
    var pQS = (row ? (row.compPlanSumQ || row.compPlanSum) : null) || (gm ? gm.compPlanSum : 0) || 0;
    var fQC = (row ? row.compFactCountQ : null) || (gm ? gm.compFactCountQ : 0) || 0;
    var fS  = (row ? (row.compFactSumQ || row.compFactSum) : null) || (gm ? (gm.compFactSumQ || gm.compFactSum) : 0) || 0;
    if (fQC === 0) fS = 0;  // Если за квартал 0 процедур, сумма тоже 0
    var pbdg = rBudget_(ctx, row, 'compPlan'), fbdg = rBudget_(ctx, row, 'compFact');

    // План на год + квартал (одна строка, как в эталоне)
    L.push('  Всего на год: ' + fmtInt_(pYC) +
      '  Всего на ' + qNum + ' квартал ' + yearStr +
      ' года запланировано ' + fmtInt_(pQC) +
      ' конкурентных процедур на общую сумму ' + fmtMoney_(pQS) +
      budgetP_(pbdg.fb, pbdg.kb, pbdg.mb));

    // Факт
    L.push('  Проведено ' + fmtInt_(fQC) + ' аукционов на общую сумму ' + fmtMoney_(fS) +
      budgetP_(fbdg.fb, fbdg.kb, fbdg.mb));

    // Исполнение
    var exQ = pQC > 0 ? (fQC / pQC) : null;
    if (row && row.compExecPctQ !== null && row.compExecPctQ !== undefined) exQ = row.compExecPctQ;
    var fYC = (row ? row.compFactCount : null) || (gm ? gm.compFactCount : 0) || 0;
    var exY = pYC > 0 ? (fYC / pYC) : null;
    L.push('  Исполнение плана ' + qNum + ' квартала – ' + fmtPct_(exQ) +
      '  Исполнение годового плана – ' + fmtPct_(exY));

    // Экономия
    var eco = (row ? row.compEconomy : null) || (gm ? gm.compEconomy : 0) || 0;
    L.push('  Экономия местного бюджета ' + fmtMoney_(eco));

    // Остаток в квартале с детализацией
    var remQ = (row && row.remainingCompCount != null) ? row.remainingCompCount : Math.max(0, pQC - fQC);
    if (remQ > 0) {
      var remS = (row && row.remainingCompSum != null) ? row.remainingCompSum : Math.max(0, pQS - fS);

      // Подсчёт программных/текущих из lineItems
      var nProg = 0, nTek = 0;
      if (row && row.lineItems && row.lineItems.length > 0) {
        for (var li = 0; li < row.lineItems.length; li++) {
          var tp = row.lineItems[li].type || '';
          if (tp.indexOf('программн') === 0) nProg++; else nTek++;
        }
      }
      var remLine = '  В ' + qNum + ' квартале осталось отыграть ' + fmtInt_(remQ) +
        ' аукционов на общую сумму ' + fmtMoney_(remS);
      if (nProg > 0 || nTek > 0) {
        remLine += ' (' + fmtInt_(nProg) + ' программных мероприятия, ' +
          fmtInt_(nTek) + ' – по текущей деятельности)';
      }
      L.push(remLine);

      // Конкретные позиции из lineItems
      if (row && row.lineItems && row.lineItems.length > 0) {
        L.push('    в том числе:');
        for (var j = 0; j < row.lineItems.length; j++) {
          var it = row.lineItems[j];
          L.push('    - ' + (it.name || 'Позиция ' + (j+1)) +
            (it.amount ? ' (' + fmtMoney_(it.amount) + ')' : ''));
        }
      } else {
        // Запасной: humanContext
        var hcDet = hc_(ctx, code + '_remain_details') || hc_(ctx, code + '_остаток_детали');
        if (hcDet) L.push(hcDet);
      }
    }

    // Планируемые подачи заявок
    var apps = text_PlannedApps_(ctx, code, row, qNum);
    if (apps) L.push(apps);

    return L.join('\n');
  } catch (e) {
    return 'КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:\n[Ошибка: ' + e.message + ']';
  }
}

// Планируемые подачи заявок на ЭА
function text_PlannedApps_(ctx, code, row, qNum) {
  if (row && row.plannedApplications && row.plannedApplications.length > 0) {
    var L = ['  До конца ' + qNum + ' квартала ' + code +
      ' планирует подать ' + fmtInt_(row.plannedApplications.length) +
      ' заявки на проведение ЭА:'];
    for (var i = 0; i < row.plannedApplications.length; i++) {
      var a = row.plannedApplications[i];
      L.push('    - ' + (typeof a === 'string' ? a : (a.name || 'Заявка ' + (i+1))));
    }
    return L.join('\n');
  }
  var hcA = hc_(ctx, code + '_planned_apps') || hc_(ctx, code + '_планируемые_подачи');
  if (hcA) return '  До конца ' + qNum + ' квартала ' + code +
    ' планирует подать заявки на проведение ЭА:\n' + hcA;
  return null;
}

// ЕП для одного ГРБС
function blk_GrbsEp_(ctx, code, gm, row, qNum, yearStr) {
  try {
    var L = ['ЕДИНСТВЕННЫЙ ПОСТАВЩИК:'];
    var ePY = (row ? row.epPlanCount : null) || (gm ? gm.epPlanCount : 0) || 0;
    var ePQ = (row ? row.epPlanCountQ : null) || (gm ? gm.epPlanCountQ : 0) || 0;
    var eFQ = (row ? row.epFactCountQ : null) || (gm ? gm.epFactCountQ : 0) || 0;
    var ePS = (row ? row.epPlanSumQ : null) || (gm ? gm.epPlanSumQ : 0) || 0;
    var eFS = (row ? row.epFactSumQ : null) || (gm ? gm.epFactSumQ : 0) || 0;
    var epbdg = rBudget_(ctx, row, 'epPlan'), efbdg = rBudget_(ctx, row, 'epFact');

    L.push('  Всего на год: ' + fmtInt_(ePY));
    if (ePQ > 0) {
      L.push('  Всего на ' + qNum + ' квартал ' + yearStr +
        ' года запланировано заключить договоров/контрактов по ' +
        fmtInt_(ePQ) + ' наименованиям на общую сумму ' + fmtMoney_(ePS) +
        budgetP_(epbdg.fb, epbdg.kb, epbdg.mb) + '.');
    }
    L.push('  Заключено ' + pluralContract_(eFQ) + ' на сумму ' + fmtMoney_(eFS) +
      budgetP_(efbdg.fb, efbdg.kb, efbdg.mb) + '.');

    // Исполнение (если есть план)
    if (ePQ > 0 || ePY > 0) {
      var eExQ = ePQ > 0 ? (eFQ / ePQ) : null;
      var eExY = ePY > 0 ? (eFQ / ePY) : null;
      L.push('  Исполнение плана ' + qNum + ' квартала – ' + fmtPct_(eExQ) +
        '  Исполнение годового плана – ' + fmtPct_(eExY));
    }

    // Экономия ЕП
    var epEco = (row && row.epEconomy !== undefined) ? toNumber_(row.epEconomy) : null;
    if (epEco === null) epEco = toNumber_(hc_(ctx, code + '_ep_economy'));
    if (epEco !== null && epEco > 0) L.push('  Экономия местного бюджета ' + fmtMoney_(epEco));

    // Остаток
    var epRem = Math.max(0, ePQ - eFQ);
    if (epRem > 0) {
      var epRemS = Math.max(0, ePS - eFS);
      L.push('  Осталось заключить ' + pluralContract_(epRem) + ' на сумму ' + fmtMoney_(epRemS) + '.');
    }

    // Конкретные позиции ЕП
    if (row && row.epItems && row.epItems.length > 0) {
      L.push('    в том числе:');
      for (var i = 0; i < row.epItems.length; i++) {
        var it = row.epItems[i];
        var nm = (typeof it === 'string') ? it : (it.name || 'Позиция ' + (i+1));
        var am = (typeof it === 'object' && it.amount) ? ' (' + fmtMoney_(it.amount) + ')' : '';
        L.push('    - ' + nm + am);
      }
    } else {
      var hcEI = hc_(ctx, code + '_ep_items') || hc_(ctx, code + '_еп_позиции');
      if (hcEI) L.push(hcEI);
    }

    return L.join('\n');
  } catch (e) {
    return 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:\n[Ошибка: ' + e.message + ']';
  }
}

// ─── СЕКЦИЯ 6: Заключение ───────────────────────────────────────────────────

function sec_Conclusion_(ctx, qNum) {
  try {
    var g = ctx.metrics.global, L = [];
    L.push('ВЫВОДЫ И НАБЛЮДЕНИЯ:');
    L.push('');

    // Общее исполнение
    var ex = calcPct_(g.allCompQ1FactCount, g.allCompQ1PlanCount);
    L.push('Общее исполнение плана конкурентных закупок ' + qNum + ' квартала: ' +
      fmtPct_(ex) + ' (' + fmtInt_(g.allCompQ1FactCount) +
      ' из ' + fmtInt_(g.allCompQ1PlanCount) + ').');

    // Доля ЕП
    if (g.allFactEpShare !== null) {
      L.push('Доля закупок у единственного поставщика составляет ' +
        fmtPct_(g.allFactEpShare) + ' от общего объёма контрактации.');
    }

    // Экономия
    if (g.allCompYearEconomySum > 0) {
      L.push('Экономия по конкурентным процедурам: ' + fmtMoney_(g.allCompYearEconomySum) + '.');
    }

    // Лидер и аутсайдер
    var codes = GRBS_ORDER_.concat(['УО']), best = null, worst = null;
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i], r = findRow_(ctx, c), gm = ctx.metrics.byGrbs[c];
      var pQ = r ? (r.compPlanCountQ || 0) : (gm ? (gm.compPlanCountQ || 0) : 0);
      var fQ = r ? (r.compFactCountQ || 0) : (gm ? (gm.compFactCountQ || 0) : 0);
      if (pQ <= 0) continue;
      var pct = fQ / pQ;
      if (!best || pct > best.pct) best = { code: c, pct: pct };
      if (!worst || pct < worst.pct) worst = { code: c, pct: pct };
    }
    if (best) {
      var lt = 'Лидер по исполнению: ' + best.code + ' (' + fmtPct_(best.pct) + ').';
      if (worst) lt += ' Отстающий: ' + worst.code + ' (' + fmtPct_(worst.pct) + ').';
      L.push(lt);
    }

    // Дополнительные выводы оператора
    var custom = hc_(ctx, 'conclusion') || hc_(ctx, 'заключение');
    if (custom) { L.push(''); L.push(custom); }

    return L.join('\n');
  } catch (e) {
    return '[Ошибка выводов: ' + e.message + ']';
  }
}
// =============================================================================
// ХЕЛПЕРЫ ДЛЯ М12/М13 (восстановлены из v1 — контекстные, инсайты, фильтры)
// =============================================================================

function getBudgetBreakdown_(ctx, prefix) {
  try {
    var raw = ctx.rawData || {};
    var fb = toNumber_(raw[prefix + '_fb'] || raw['all_' + prefix + '_sum_fb']);
    var kb = toNumber_(raw[prefix + '_kb'] || raw['all_' + prefix + '_sum_kb']);
    var mb = toNumber_(raw[prefix + '_mb'] || raw['all_' + prefix + '_sum_mb']);
    if (fb === null && kb === null && mb === null && ctx.humanContext) {
      var hc = ctx.humanContext;
      fb = toNumber_(hc[prefix + '_fb']);
      kb = toNumber_(hc[prefix + '_kb']);
      mb = toNumber_(hc[prefix + '_mb']);
    }
    if (fb === null && kb === null && mb === null) return null;
    var parts = [];
    parts.push('ФБ – ' + fmtMoney_(fb || 0));
    parts.push('КБ – ' + fmtMoney_(kb || 0));
    parts.push('МБ – ' + fmtMoney_(mb || 0));
    return parts.join(', ');
  } catch (e) { return null; }
}

function getWorkInProgressText_(ctx) {
  try {
    if (!ctx.humanContext) return null;
    return ctx.humanContext['work_in_progress'] || ctx.humanContext['в_работе'] || null;
  } catch (e) { return null; }
}

function buildEconomyForecast_(ctx, remainCount) {
  try {
    var g = ctx.metrics.global;
    var factSum = g.allCompYearFactSum || 0;
    var economy = g.allCompYearEconomySum || 0;
    if (factSum <= 0 || remainCount <= 0) return null;
    var avgEconPct = economy / factSum;
    var remainPlanSum = Math.max(0, (g.allCompYearPlanSum || 0) - factSum);
    var forecastEconomy = remainPlanSum * avgEconPct;
    if (forecastEconomy <= 0) return null;
    var mbShare = 0.65;
    if (ctx.humanContext && ctx.humanContext['mb_share']) {
      mbShare = toNumber_(ctx.humanContext['mb_share']) || mbShare;
    }
    var mbEconomy = forecastEconomy * mbShare;
    return 'Расчетная экономия по оставшимся незаключенным ' + fmtInt_(remainCount) +
      ' конкурентным процедурам составляет ' + fmtMoney_(forecastEconomy) +
      ', из них – ' + fmtMoney_(mbEconomy) + ' – местный бюджет.';
  } catch (e) { return null; }
}

function buildEpDistribution_(ctx) {
  try {
    var entries = [];
    var allCodes = GRBS_ORDER_.concat(['УО']);
    for (var i = 0; i < allCodes.length; i++) {
      var code = allCodes[i];
      var gm = ctx.metrics.byGrbs[code];
      if (!gm) continue;
      var epShare = gm.epShare;
      if (epShare === null || epShare === undefined) continue;
      var explanation = null;
      if (ctx.humanContext) {
        explanation = ctx.humanContext[code + '_ep_explanation'] ||
                      ctx.humanContext[code + '_ep_пояснение'] || null;
      }
      entries.push({ code: code, epShare: epShare, explanation: explanation });
    }
    entries.sort(function(a, b) { return (b.epShare || 0) - (a.epShare || 0); });
    return entries;
  } catch (e) { return []; }
}

function getEpConclusions_(ctx) {
  try {
    if (!ctx.humanContext) return null;
    return ctx.humanContext['ep_conclusions'] || ctx.humanContext['выводы_еп'] || null;
  } catch (e) { return null; }
}

function getGrbsRemainDetails_(ctx, grbsCode) {
  try {
    if (!ctx.humanContext) return null;
    return ctx.humanContext[grbsCode + '_remain_details'] ||
           ctx.humanContext[grbsCode + '_остаток_детали'] || null;
  } catch (e) { return null; }
}

function getGrbsRecommendations_(ctx, grbsCode) {
  try {
    if (!ctx.humanContext) return null;
    return ctx.humanContext[grbsCode + '_recommendations'] ||
           ctx.humanContext[grbsCode + '_рекомендации'] || null;
  } catch (e) { return null; }
}

function getEpQ1PlanCount_(ctx) {
  try {
    var raw = ctx.rawData || {};
    var g = ctx.metrics && ctx.metrics.global ? ctx.metrics.global : {};
    return toNumber_(raw.all_ep_q1_plan_count || g.allEpQ1PlanCount || raw.allEpQPlanCount) || g.allEpYearPlanCount || 0;
  } catch (e) { return 0; }
}

function getEpQ1PlanSum_(ctx) {
  try {
    var raw = ctx.rawData || {};
    var g = ctx.metrics && ctx.metrics.global ? ctx.metrics.global : {};
    return toNumber_(raw.all_ep_q1_plan_sum || g.allEpQ1PlanSum || raw.allEpQPlanSum) || g.allEpYearPlanSum || 0;
  } catch (e) { return 0; }
}

function getEpQ1FactCount_(ctx) {
  try {
    var raw = ctx.rawData || {};
    var g = ctx.metrics && ctx.metrics.global ? ctx.metrics.global : {};
    return toNumber_(raw.all_ep_q1_fact_count || g.allEpQ1FactCount || raw.allEpQFactCount) || g.allEpYearFactCount || 0;
  } catch (e) { return 0; }
}

function getEpQ1FactSum_(ctx) {
  try {
    var raw = ctx.rawData || {};
    var g = ctx.metrics && ctx.metrics.global ? ctx.metrics.global : {};
    return toNumber_(raw.all_ep_q1_fact_sum || g.allEpQ1FactSum || raw.allEpQFactSum) || g.allEpYearFactSum || 0;
  } catch (e) { return 0; }
}

// --- InsightBuilder: конструктор, дедупликация, сборка, фильтрация ---

function createInsight_(grbs, factor, severity, fact, interpretation, action, source, law) {
  return {
    grbs: grbs || 'ВСЕ',
    factor: factor || '',
    severity: severity || 'ИНФОРМАЦИЯ',
    fact: normalizeString_(fact),
    interpretation: normalizeString_(interpretation),
    action: normalizeString_(action),
    source: source || 'СВОД',
    law: law || ''
  };
}

function deduplicateInsights_(insights) {
  if (!insights || insights.length === 0) return [];
  var seen = {};
  var result = [];
  for (var i = 0; i < insights.length; i++) {
    var ins = insights[i];
    var key = (ins.grbs || '') + '|' + (ins.factor || '');
    var weight = SEVERITY_WEIGHTS_[ins.severity] || 0;
    if (!seen[key] || (SEVERITY_WEIGHTS_[seen[key].severity] || 0) < weight) {
      seen[key] = ins;
    }
  }
  var keys = Object.keys(seen);
  for (var j = 0; j < keys.length; j++) {
    result.push(seen[keys[j]]);
  }
  return result;
}

function buildAllInsights_(ctx) {
  var insights = [];
  insights = insights.concat(buildAnomalyInsights_(ctx));
  insights = insights.concat(buildComplianceInsights_(ctx));
  insights = insights.concat(buildProfileInsights_(ctx));
  insights = insights.concat(buildDynamicsInsights_(ctx));
  return insights;
}

function buildAnomalyInsights_(ctx) {
  var result = [];
  if (!ctx.anomalies || ctx.anomalies.length === 0) return result;
  for (var i = 0; i < ctx.anomalies.length; i++) {
    var a = ctx.anomalies[i];
    var action = a.recommendation || '';
    // Обогащаем рекомендацию данными ГРБС
    if ((!action || action === 'Требуется проверка') && a.grbs && a.grbs !== 'ВСЕ') {
      var gm = ctx.metrics && ctx.metrics.byGrbs ? ctx.metrics.byGrbs[a.grbs] : null;
      if (gm) {
        var parts = [a.grbs + ':'];
        if (a.type && a.type.indexOf('ЕП') >= 0 && gm.epShare !== null) {
          parts.push('доля ЕП ' + fmtPct_(gm.epShare) + ',');
          parts.push((gm.epFactCount || 0) + ' закупок на ' + fmtMoney_(gm.epFactSum || 0) + '.');
          parts.push('Проверить обоснования по п. 4 ч. 1 ст. 93');
        } else if (a.type && a.type.indexOf('исполнен') >= 0 && gm.compExecPctCount !== undefined) {
          var remain = Math.max(0, (gm.compPlanCount || 0) - (gm.compFactCount || 0));
          parts.push('исполнение ' + fmtPct_(gm.compExecPctCount) + ',');
          parts.push('остаток ' + pluralProc_(remain) + '.');
          parts.push('Запросить план-график с контрольными точками');
        } else {
          parts.push('проверить данные');
          if (gm.compExecPctCount !== undefined) parts.push('(исполнение ' + fmtPct_(gm.compExecPctCount) + ')');
        }
        action = parts.join(' ');
      } else {
        action = 'Требуется проверка \u2014 ' + (a.grbs || '');
      }
    }
    if (!action) action = 'Требуется проверка';
    result.push(createInsight_(
      a.grbs || 'ВСЕ', a.type || 'аномалия', a.severity || 'СРЕДНЯЯ',
      a.description || 'Обнаружена аномалия', a.explanation || '',
      action, 'СВОД/ИСТОРИЯ', ''
    ));
  }
  return result;
}

function buildComplianceInsights_(ctx) {
  var result = [];
  if (!ctx.complianceFlags || ctx.complianceFlags.length === 0) return result;
  for (var i = 0; i < ctx.complianceFlags.length; i++) {
    var f = ctx.complianceFlags[i];
    result.push(createInsight_(
      f.grbs || 'ВСЕ',
      '44-ФЗ: ' + (f.type || f.rule || 'нарушение'),
      f.severity || 'ВЫСОКАЯ',
      f.text || f.description || 'Возможное нарушение 44-ФЗ',
      f.interpretation || f.explanation || '',
      f.action || f.recommendation || 'Провести проверку',
      'СВОД',
      f.article || f.lawReference || ''
    ));
  }
  return result;
}

function buildProfileInsights_(ctx) {
  var result = [];
  if (!ctx.profiles) return result;
  var codes = Object.keys(ctx.profiles);
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    var profile = ctx.profiles[code];
    if (!profile) continue;
    var gm = ctx.metrics.byGrbs[code];

    // Используем managementAction из профиля как основное действие
    var mAction = profile.managementAction || '';

    if (profile.overallStatus === 'ОТСТАЮЩИЙ' || profile.overallStatus === 'КРИТИЧЕСКИЙ') {
      var statusAction = mAction || 'Требуется совещание с руководством ' + code;
      // Обогащаем данными из метрик
      if (gm) {
        var remainComp = Math.max(0, (gm.compPlanCount || 0) - (gm.compFactCount || 0));
        if (remainComp > 0) {
          statusAction += '. Остаток: ' + remainComp + ' конкурентных процедур';
          var remainSum = Math.max(0, (gm.compPlanSum || 0) - (gm.compFactSum || 0));
          if (remainSum > 0) statusAction += ' на ' + fmtMoney_(remainSum);
        }
      }
      result.push(createInsight_(
        code, 'статус',
        profile.overallStatus === 'КРИТИЧЕСКИЙ' ? 'КРИТИЧЕСКАЯ' : 'ВЫСОКАЯ',
        code + ': общий статус \u2014 ' + profile.overallStatus +
          (gm ? ', исполнение ' + fmtPct_(gm.compExecPct) : ''),
        DOMINANT_FACTOR_LABELS_[profile.dominantFactor] || 'Системные проблемы с исполнением плана',
        statusAction, 'ПРОФИЛЬ', ''
      ));
    }

    if (gm && gm.epShare !== null && gm.epShare !== undefined) {
      var baseline = GRBS_BASELINES_[code];
      var normalEp = baseline ? baseline.normalEpShare : 0.40;
      if (gm.epShare > normalEp * 1.3) {
        // Конкретная рекомендация с цифрами
        var epCount = gm.epFactCount || 0;
        var epSum = gm.epFactSum || 0;
        var epAction = code + ': проанализировать ' + epCount + ' закупок у ЕП';
        if (epSum > 0) epAction += ' (' + fmtMoney_(epSum) + ')';
        epAction += ' \u2014 доля ЕП ' + fmtPct_(gm.epShare) + ' при допустимых ' + fmtPct_(normalEp);
        epAction += '. Рекомендуется перевести позиции свыше 600 тыс. руб. в конкурентные процедуры';
        result.push(createInsight_(
          code, 'доля_ЕП', gm.epShare > 0.80 ? 'ВЫСОКАЯ' : 'СРЕДНЯЯ',
          'Доля ЕП ' + code + ' составляет ' + fmtPct_(gm.epShare) +
            ' (норма для управления \u2014 до ' + fmtPct_(normalEp) + ')',
          'Превышение нормальной доли ЕП может указывать на системное предпочтение неконкурентных способов закупки',
          epAction,
          'СВОД', 'п. 4 ч. 1 ст. 93 44-ФЗ'
        ));
      }
    }
  }
  return result;
}

function buildDynamicsInsights_(ctx) {
  var result = [];
  if (!ctx.dynamics) return result;
  var codes = Object.keys(ctx.dynamics);
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    var dyn = ctx.dynamics[code];
    if (!dyn) continue;
    if (dyn.velocity !== undefined && dyn.velocity !== null && dyn.velocity < 0) {
      result.push(createInsight_(
        code, 'динамика', 'СРЕДНЯЯ',
        'Скорость исполнения ' + code + ' снижается (показатель: ' + fmtNum_(dyn.velocity, 3) + ')',
        'Замедление может привести к невыполнению плана к концу квартала',
        'Контроль еженедельной динамики, при сохранении тренда — корректирующие меры',
        'ИСТОРИЯ', ''
      ));
    }
    if (dyn.forecastExecQ !== undefined && dyn.forecastExecQ !== null &&
        dyn.forecastExecQ < CFG_.TARGET_EXEC_Q_END) {
      result.push(createInsight_(
        code, 'прогноз', 'ВЫСОКАЯ',
        'Прогнозное исполнение ' + code + ' к концу квартала: ' + fmtPct_(dyn.forecastExecQ) +
          ' (целевое — ' + fmtPct_(CFG_.TARGET_EXEC_Q_END) + ')',
        'При текущей динамике ' + code + ' не выйдет на целевой показатель',
        'Ускорить подготовку документации, рассмотреть упрощение процедур',
        'ИСТОРИЯ', ''
      ));
    }
  }
  return result;
}

function filterInsightsBySeverity_(ctx, severity) {
  var insights = ctx._insights || [];
  var result = [];
  for (var i = 0; i < insights.length; i++) {
    if (insights[i].severity === severity) result.push(insights[i]);
  }
  return result;
}

function filterInsightsByFactor_(ctx, factorPart) {
  var insights = ctx._insights || [];
  var result = [];
  var lowerPart = factorPart.toLowerCase();
  for (var i = 0; i < insights.length; i++) {
    if ((insights[i].factor || '').toLowerCase().indexOf(lowerPart) >= 0) {
      result.push(insights[i]);
    }
  }
  return result;
}

function filterInsightsByGrbs_(ctx, grbsCode) {
  var insights = ctx._insights || [];
  var result = [];
  for (var i = 0; i < insights.length; i++) {
    if (insights[i].grbs === grbsCode) result.push(insights[i]);
  }
  return result;
}


// =============================================================================
// М13: УМНЫЙ ОТЧЁТ — InsightBuilder v3.0 (ГУМАНИЗИРОВАННАЯ АНАЛИТИКА)
// =============================================================================
// Полная замена предыдущей версии М13. Генерирует аналитический отчёт,
// который читается как экспертное заключение, а не как робот-шаблон.
//
// Ключевые принципы:
// - Каждый ГРБС получает УНИКАЛЬНЫЙ текст (без повторов фраз)
// - Числа ВСЕГДА даются с контекстом (сравнение с нормой, фазой квартала)
// - Структура: факт -> интерпретация -> действие
// - Разнообразие синтаксиса: короткие фразы, длинные аналитические, тире, двоеточия
//
// Зависимости:
//   Утилиты: fmtNum_(), fmtInt_(), fmtPct_(), fmtMoney_(), fmtDate_(),
//            toNumber_(), safeAdd_(), calcPct_(), dateDiffDays_(),
//            quarterStart_(), quarterEnd_(), quarterNumber_(), normalizeString_()
//   Константы: CFG_, GRBS_BASELINES_, GRBS_ORDER_, SEVERITY_WEIGHTS_
//   Контекстные хелперы: getWorkInProgressText_(), getGrbsRemainDetails_(),
//            getGrbsRecommendations_(), buildEpDistribution_(), getEpConclusions_(),
//            buildEconomyForecast_(), getBudgetBreakdown_()
// =============================================================================


// ---------------------------------------------------------------------------
// БАНК ФРАЗ — синонимы и вариации для исключения повторов
// ---------------------------------------------------------------------------

/**
 * Банк шаблонов для описания уровней исполнения.
 * Каждый уровень содержит несколько вариантов — вызывающий код выбирает
 * по индексу ГРБС, гарантируя уникальность в рамках одного отчёта.
 */
var EXEC_PHRASES_ = {
  excellent: [
    'демонстрирует устойчиво высокий темп — {pct} при ожидаемых {exp}',
    'опережает график: {pct} против плановых {exp} для текущей фазы',
    'показывает образцовое исполнение ({pct}), значительно превышая ориентир {exp}',
    'уверенно лидирует с показателем {pct} — это выше нормы ({exp}) на {delta} п.п.',
    'работает с опережением: {pct} при базовом ожидании {exp} для этого этапа квартала',
    'вышел на отметку {pct}, что на {delta} п.п. выше прогнозной траектории ({exp})',
    'держит высокую планку — {pct} исполнения при среднем ожидании {exp}',
    'исполнение {pct} — это один из лучших результатов, ориентир составлял {exp}'
  ],
  good: [
    'исполнение на уровне {pct} — в рамках нормы ({exp}), отклонение минимальное',
    'идёт по графику: {pct} при ожидаемых {exp}, запас — {delta} п.п.',
    'показатель {pct} соответствует плановой траектории ({exp})',
    'устойчивое исполнение {pct} — близко к расчётному уровню {exp}',
    'вписывается в плановый коридор: {pct} при ориентире {exp}',
    'текущие {pct} — штатный результат для данной фазы квартала (ожидание: {exp})',
    'держится на стабильном уровне {pct}, норма — {exp}',
    'план выполняется равномерно: {pct} при целевых {exp}'
  ],
  medium: [
    'исполнение {pct} — ниже ожидаемых {exp} на {delta} п.п., требует внимания',
    'отстаёт от графика: {pct} против {exp}, разрыв — {delta} п.п.',
    'текущие {pct} не дотягивают до ориентира {exp} — разница {delta} п.п.',
    'показатель {pct} формально в среднем диапазоне, но ниже плановых {exp} на {delta} п.п.',
    'зафиксировано умеренное отставание: {pct} при норме {exp}',
    'темп замедлен — {pct} при расчётных {exp}, дефицит {delta} п.п.',
    'исполнение {pct} сигнализирует об отставании от графика (ожидание {exp})',
    'разрыв с планом ({exp}) составляет {delta} п.п. — текущий уровень {pct}'
  ],
  low: [
    'критическое отставание: {pct} при ожидаемых {exp} — разрыв {delta} п.п.',
    'исполнение на уровне {pct} — это значительно ниже нормы ({exp})',
    'провал темпов: {pct} против {exp}, дефицит {delta} п.п. — необходимо вмешательство',
    '{pct} исполнения — тревожный показатель, разрыв с ожидаемыми {exp} критичен ({delta} п.п.)',
    'глубокое отставание от графика: {pct} при целевых {exp}',
    'ситуация с исполнением ({pct}) вызывает серьёзную обеспокоенность: норма — {exp}, разрыв — {delta} п.п.',
    'показатель {pct} фактически означает срыв графика (ожидание: {exp})',
    'отставание на {delta} п.п. от плана ({exp}) — текущие {pct} требуют экстренных мер'
  ],
  zero: [
    'исполнение нулевое — ни одна конкурентная процедура не завершена',
    'конкурентные процедуры фактически не начаты — исполнение 0%',
    'ноль завершённых конкурентных процедур — полная стагнация',
    'конкурентный блок не сдвинулся: 0% исполнения при плане {plan}'
  ]
};

/**
 * Банк шаблонов для описания доли единственного поставщика.
 */
var EP_PHRASES_ = {
  low: [
    'доля ЕП минимальна ({pct}) — конкурентная модель работает',
    'ЕП занимает лишь {pct} объёма — здоровая конкурентная среда',
    'низкая зависимость от ЕП ({pct}) — структура закупок сбалансирована',
    'доля ЕП {pct} — значительно ниже порога внимания'
  ],
  normal: [
    'доля ЕП {pct} — в пределах нормы для управления (допустимо до {norm})',
    'ЕП составляет {pct}, что укладывается в нормативный коридор (до {norm})',
    'структура «конкурентные / ЕП» в рабочем диапазоне: ЕП — {pct} при лимите {norm}',
    'соотношение конкурентных и ЕП приемлемое: доля ЕП {pct} (норма — до {norm})'
  ],
  elevated: [
    'доля ЕП выросла до {pct} — превышает норму ({norm}) на {delta} п.п.',
    'ЕП на уровне {pct} — это выше допустимого ({norm}), необходим анализ обоснований',
    'структурный перекос в сторону ЕП: {pct} при нормативе {norm}',
    'зависимость от ЕП ({pct}) превышает разумный порог ({norm}) — причины требуют проверки'
  ],
  critical: [
    'доля ЕП составляет {pct} — это существенно выше нормы ({norm}), необходим аудит обоснований',
    'критическая зависимость от ЕП: {pct} при нормативном пределе {norm}',
    'ЕП доминирует — {pct} объёма, при допустимых {norm}; доля конкурентных процедур ниже целевого уровня',
    '{pct} закупок через ЕП — крайне высокий уровень, лимит {norm} превышен на {delta} п.п.'
  ]
};

/**
 * Банк фраз для рекомендаций по ГРБС (уникальные формулировки).
 */
var RECOMMENDATION_PHRASES_ = {
  onTrack: [
    'Штатный мониторинг; поддерживать текущий темп',
    'Продолжить в текущем режиме, контроль — раз в две недели',
    'Вмешательство не требуется; плановый контроль',
    'Текущая динамика удовлетворительна — обычный мониторинг',
    'Сохранять набранный темп; следующий контроль — плановый',
    'Ситуация штатная, оснований для вмешательства нет',
    'Стабильная работа; рекомендуется плановое наблюдение',
    'Показатели в норме — стандартный режим отслеживания'
  ],
  needsAttention: [
    'Усилить контроль за ходом процедур; еженедельный отчёт',
    'Провести совещание с контрактной службой, выяснить причины задержек',
    'Перевести в режим еженедельного мониторинга; определить блокирующие позиции',
    'Потребовать пояснительную записку о причинах отставания',
    'Запросить план-график ускорения с конкретными сроками',
    'Взять на еженедельный контроль; установить промежуточные контрольные точки',
    'Оценить кадровый ресурс контрактной службы — возможна перегрузка',
    'Провести инвентаризацию незавершённых процедур и причин задержки'
  ],
  urgent: [
    'Срочное совещание с руководством; план ускорения до конца недели',
    'Немедленное вмешательство: определить блокирующие процедуры и устранить причины',
    'Экстренный разбор ситуации; пересмотр графика размещений',
    'Поставить на особый контроль; ежедневные статусы до выхода на плановый темп',
    'Назначить ответственного за ликвидацию отставания; срок — 5 рабочих дней',
    'Критическая ситуация — рассмотреть привлечение дополнительных ресурсов',
    'Доложить руководству; подготовить антикризисный план закупок',
    'Экстренные меры: приоритизировать крупнейшие процедуры, упростить документацию'
  ],
  epReview: [
    'Провести ревизию обоснований ЕП; выявить позиции для перевода в ЭА',
    'Запросить реестр обоснований ЕП с разбивкой по основаниям (ст. 93)',
    'Аудит контрактов ЕП: проверить наличие альтернативных поставщиков',
    'Проверить правомерность применения п. 4/5 ч. 1 ст. 93 по каждой позиции',
    'Составить список ЕП-контрактов, потенциально переводимых на конкурентные процедуры',
    'Выборочная проверка обоснований единственного поставщика; акцент на крупных контрактах',
    'Проанализировать повторяющихся контрагентов в реестре ЕП',
    'Запросить экспертизу рынка по позициям ЕП свыше 500 тыс. руб.'
  ]
};

/**
 * Банк фраз для описания трендов.
 */
var TREND_LABELS_ = {
  'РОСТ':                  { icon: '\u2191', text: 'рост' },
  'УМЕРЕННЫЙ_РОСТ':        { icon: '\u2197', text: 'умеренный рост' },
  'СТАБИЛЬНОСТЬ':          { icon: '\u2192', text: 'стабильно' },
  'УМЕРЕННОЕ_СНИЖЕНИЕ':    { icon: '\u2198', text: 'умеренное снижение' },
  'СНИЖЕНИЕ':              { icon: '\u2193', text: 'снижение' },
  'НЕДОСТАТОЧНО_ДАННЫХ':   { icon: '\u2014', text: 'нет данных' }
};

/**
 * Банк причинно-следственных интерпретаций — используется при сочетании
 * факторов (высокая ЕП + низкая экономия, опережение графика и т.д.).
 */
var CAUSATION_PHRASES_ = [
  'Высокая доля ЕП при низкой экономии свидетельствует о недостаточном развитии конкурентной среды',
  'Опережение графика при сбалансированной структуре ЕП/конкурентных — признак эффективной контрактной службы',
  'Нулевое исполнение при наличии плановых процедур указывает на организационные барьеры в подготовке документации',
  'Аномально высокая экономия при малом числе участников может указывать на завышение НМЦ',
  'Сочетание высокого исполнения по количеству и низкого по объёму говорит о приоритизации мелких закупок',
  'Концентрация ЕП в одной категории требует отдельного анализа обоснованности',
  'Устойчивое отставание от графика с начала года может привести к кассовому разрыву',
  'Положительная динамика последних недель позволяет рассчитывать на выход в плановый коридор'
];

/**
 * Банк конкретных управленческих действий — используется в рекомендациях
 * и аудиторских выводах для повышения конкретности.
 */
var AUDIT_ACTIONS_ = [
  'Запросить форму-обоснование по п. 4 ч. 1 ст. 93 за отчётный период',
  'Направить предложение о включении позиций свыше 600 тыс. в план-график ЭА',
  'Провести выборочную проверку 3-5 крупнейших ЕП-контрактов на наличие альтернативных поставщиков',
  'Организовать совещание контрактной службы с протоколом и перечнем блокирующих позиций',
  'Запросить еженедельный отчёт: позиция / стадия / плановая дата / причина задержки',
  'Подготовить служебную записку о рисках невыполнения плана закупок с указанием суммы',
  'Инициировать пересмотр НМЦ по позициям с экономией более 25%',
  'Запросить заключение о соответствии закупок антимонопольному законодательству'
];

/**
 * Правовой контекст — ссылки на ключевые нормы 44-ФЗ.
 * Ключ = короткий идентификатор ситуации, значение = развёрнутый комментарий.
 */
var LAW_CONTEXT_ = {
  'ПОРОГ': 'Закон 44-ФЗ устанавливает предельную долю закупок у ЕП — не более 10% от СГОЗ (ст. 93 ч. 1). Превышение может указывать на недостаточное планирование конкурентных процедур',
  'ДРОБЛЕНИЕ': 'Искусственное разделение одной закупки на несколько мелких для обхода порога конкурентных процедур (ст. 93 ч. 1) является нарушением. Признак: серия однотипных ЕП-контрактов в короткий период',
  'ДЕМПИНГ': 'При снижении цены контракта более чем на 25% от НМЦ подрядчик обязан предоставить обеспечение исполнения в повышенном размере (ст. 37 44-ФЗ). Отсутствие такого обеспечения — нарушение',
  'СРОКИ': 'Контракт должен быть зарегистрирован в ЕИС в течение 5 рабочих дней после подписания (ст. 103 44-ФЗ). Систематическое нарушение сроков — признак проблем с документооборотом',
  'СОВМЕСТНЫЕ': 'При наличии однотипных потребностей у нескольких ГРБС рекомендуется рассмотреть совместные закупки (ст. 25 44-ФЗ) для увеличения конкуренции и снижения расходов',
  'ЦЕНТРАЛИЗАЦИЯ': 'Объединение закупок нескольких заказчиков снижает административные расходы и повышает конкуренцию (ст. 25 44-ФЗ)',
  'АНТИДЕМПИНГ': 'При снижении цены контракта более чем на 25% от НМЦ подрядчик обязан предоставить обеспечение исполнения в повышенном размере (ст. 37 44-ФЗ)'
};

/**
 * Словарь безопасных переформулировок — заменяет категоричные/обвинительные
 * формулировки на корректные аналитические.
 */
var SAFE_INTERPRETATIONS_ = {
  'признак сговора': 'рекомендуется проверить обоснованность НМЦ и условия конкуренции',
  'подозрительно низкая': 'минимальная экономия — цены контрактов близки к начальным максимальным',
  'возможно завышение НМЦ': 'высокая экономия может указывать на необходимость пересмотра методологии определения НМЦ (ст. 22 44-ФЗ)',
  'конкурентная среда подавлена': 'доля конкурентных процедур ниже целевого уровня — рекомендуется анализ причин'
};


// ---------------------------------------------------------------------------
// ГЛАВНАЯ ФУНКЦИЯ УМНОГО ОТЧЁТА
// ---------------------------------------------------------------------------

/**
 * Точка входа М13 — собирает все разделы аналитического отчёта.
 * Заменяет прежнюю renderSmartReport_().
 *
 * @param {Object} ctx — контекст конвейера (metrics, rawData, grbsRows,
 *                       trustScore, dynamics, anomalies, complianceFlags,
 *                       profiles, classifications, humanContext)
 * @returns {string} — полный текст аналитического отчёта
 */
function renderSmartReport_(ctx) {
  try {
    var parts = [];
    var reportDate = ctx.rawData ? ctx.rawData.report_date : new Date();
    var dateObj = (reportDate instanceof Date) ? reportDate : new Date(reportDate);

    // Предвычисляем общие параметры, чтобы не считать в каждой секции
    var qCtx = buildQuarterContext_(dateObj);
    ctx._qCtx = qCtx;

    // Собираем тезисы (insight-ы) — основа для аналитики
    var insights = buildAllInsights_(ctx);
    insights = deduplicateInsights_(insights);
    insights.sort(function(a, b) {
      return (SEVERITY_WEIGHTS_[b.severity] || 0) - (SEVERITY_WEIGHTS_[a.severity] || 0);
    });
    ctx._insights = insights;

    // Предвычисляем рейтинг ГРБС (нужен нескольким секциям)
    ctx._ranking = buildGrbsRanking_(ctx);

    // --- Заголовок ---
    parts.push('\u2550\u2550\u2550 АНАЛИТИЧЕСКИЙ ОТЧЁТ ПО ЗАКУПКАМ ' + fmtDate_(dateObj) + ' \u2550\u2550\u2550');
    parts.push('');

    // Раздел 0: Грейд качества данных
    parts.push(renderTrustGrade_(ctx));
    parts.push('');

    // Раздел 1: Управленческое резюме (30 секунд для руководителя)
    parts.push(renderExecSummary_(ctx));
    parts.push('');

    // Раздел 2: Общая картина — интерпретированные цифры
    parts.push(renderBigPicture_(ctx));
    parts.push('');

    // Раздел 3: Рейтинг ГРБС (таблица со светофором)
    parts.push(renderRankingTable_(ctx));
    parts.push('');

    // Раздел 4: Аналитика по каждому ГРБС (уникальные нарративы)
    parts.push(renderGrbsNarratives_(ctx));
    parts.push('');

    // Раздел 5: Управление образования (отдельно — особый режим ЕП)
    parts.push(renderUoNarrative_(ctx));
    parts.push('');

    // Раздел 6: Соответствие 44-ФЗ (только при наличии флагов)
    var compSection = renderComplianceNarrative_(ctx);
    if (compSection) {
      parts.push(compSection);
      parts.push('');
    }

    // Раздел 7: Аномалии и риски
    parts.push(renderAnomaliesNarrative_(ctx));
    parts.push('');

    // Раздел 8: Прогноз (три сценария)
    parts.push(renderForecastNarrative_(ctx));
    parts.push('');

    // Раздел 9: Рекомендации (по приоритетам)
    parts.push(renderPrioritizedRecs_(ctx));
    parts.push('');

    // Раздел 10: Антикоррупционный мониторинг (только при наличии индикаторов)
    var acSection = renderAntiCorruptionNarrative_(ctx);
    if (acSection) {
      parts.push(acSection);
    }

    // Раздел 11: Централизация закупок (ст. 25 44-ФЗ)
    var centrSection = renderCentralizationNarrative_(ctx);
    if (centrSection) {
      parts.push(centrSection);
    }

    return parts.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 АНАЛИТИЧЕСКИЙ ОТЧЁТ ПО ЗАКУПКАМ \u2550\u2550\u2550\n\n[Ошибка генерации умного отчёта: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// ВСПОМОГАТЕЛЬНЫЕ: контекст квартала и выбор фраз
// ---------------------------------------------------------------------------

/**
 * Формирует контекст текущей фазы квартала — используется повсеместно.
 * Зачем: «исполнение 40%» без контекста бессмысленно. С контекстом
 * «исполнение 40% на 35-й день квартала (38% пройдено)» — информативно.
 *
 * @param {Date} reportDate — дата отчёта
 * @returns {Object} — { qNum, qStart, qEnd, totalDays, elapsed, phase,
 *                        phaseLabel, expectedExecPct, yearStr }
 */
function buildQuarterContext_(reportDate) {
  var d = (reportDate instanceof Date) ? reportDate : new Date(reportDate);
  var qNum = quarterNumber_(d) || 1;
  var qStart = quarterStart_(d) || new Date(d.getFullYear(), (qNum - 1) * 3, 1);
  var qEnd = quarterEnd_(d) || new Date(d.getFullYear(), qNum * 3, 0);
  var totalDays = dateDiffDays_(qStart, qEnd) || 90;
  var elapsed = dateDiffDays_(qStart, d) || 0;
  var phase = Math.max(0, Math.min(1, elapsed / totalDays));

  // Текстовая метка фазы квартала
  var phaseLabel;
  if (phase < 0.15)      phaseLabel = 'начало ' + qNum + '-го квартала';
  else if (phase < 0.40) phaseLabel = 'первая треть ' + qNum + '-го квартала';
  else if (phase < 0.60) phaseLabel = 'середина ' + qNum + '-го квартала';
  else if (phase < 0.85) phaseLabel = 'вторая половина ' + qNum + '-го квартала';
  else                    phaseLabel = 'завершение ' + qNum + '-го квартала';

  // Ожидаемое среднее исполнение для данной фазы (линейная интерполяция 0 -> 100%)
  // На практике закупки идут неравномерно, но это разумный ориентир
  var expectedExecPct = phase;

  // Годовая фаза (доля года, прошедшая от 1 января)
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var dayOfYear = dateDiffDays_(yearStart, d) || 1;
  var yearPhase = dayOfYear / 365;

  return {
    qNum: qNum,
    qStart: qStart,
    qEnd: qEnd,
    totalDays: totalDays,
    elapsed: elapsed,
    phase: phase,
    phaseLabel: phaseLabel,
    expectedExecPct: expectedExecPct,
    yearStr: String(d.getFullYear()),
    daysLeft: Math.max(0, totalDays - elapsed),
    dayOfYear: dayOfYear,
    yearPhase: yearPhase
  };
}


/**
 * Выбирает фразу из банка по индексу, гарантируя отсутствие повторов
 * в рамках одного отчёта.
 *
 * @param {Array} bank — массив фраз-шаблонов
 * @param {number} idx — индекс (обычно номер ГРБС в списке)
 * @param {Object} vars — переменные для подстановки: {pct}, {exp}, {delta}, {norm}...
 * @returns {string} — готовая фраза
 */
function pickPhrase_(bank, idx, vars) {
  if (!bank || bank.length === 0) return '';
  var phrase = bank[idx % bank.length];
  if (!vars) return phrase;

  var keys = Object.keys(vars);
  for (var i = 0; i < keys.length; i++) {
    phrase = phrase.replace(new RegExp('\\{' + keys[i] + '\\}', 'g'), vars[keys[i]]);
  }
  return phrase;
}


/**
 * Определяет категорию исполнения для конкретного ГРБС
 * с учётом его baseline и фазы квартала.
 *
 * @param {number} execPct — текущее исполнение (доля 0..1)
 * @param {string} code — код ГРБС
 * @param {Object} qCtx — контекст квартала
 * @returns {string} — 'excellent', 'good', 'medium', 'low', 'zero'
 */
function categorizeExec_(execPct, code, qCtx) {
  if (execPct === null || execPct === undefined) return 'zero';
  if (execPct <= 0) return 'zero';

  var baseline = GRBS_BASELINES_[code] || {};
  // Годовое ожидание: интерполяция от 0 к expectedExecQ1 за Q1, далее к 1.0 к концу года
  var yearPhase = qCtx.yearPhase || 0.26;
  var baseQ1 = baseline.expectedExecQ1 || 0.50;
  var expected;
  if (yearPhase <= 0.25) {
    expected = (yearPhase / 0.25) * baseQ1;
  } else {
    var afterQ1 = (yearPhase - 0.25) / 0.75;
    expected = baseQ1 + afterQ1 * (1.0 - baseQ1);
  }

  var delta = execPct - expected;
  if (delta > 0.15) return 'excellent';
  if (delta > -0.05) return 'good';
  if (delta > -0.20) return 'medium';
  return 'low';
}


/**
 * Определяет категорию доли ЕП для ГРБС.
 *
 * @param {number} epShare — доля ЕП (0..1)
 * @param {string} code — код ГРБС
 * @returns {string} — 'low', 'normal', 'elevated', 'critical'
 */
function categorizeEp_(epShare, code) {
  if (epShare === null || epShare === undefined) return 'normal';

  var baseline = GRBS_BASELINES_[code] || {};
  var norm = baseline.normalEpShare || 0.40;

  if (epShare <= norm * 0.5) return 'low';
  if (epShare <= norm * 1.05) return 'normal';
  if (epShare <= norm * 1.40) return 'elevated';
  return 'critical';
}


/**
 * Безопасное вычисление разницы в процентных пунктах.
 * Результат — строка вида «12,3» (без знака) для подстановки в фразы.
 */
function ppDelta_(a, b) {
  var d = Math.abs(((a || 0) - (b || 0)) * 100);
  return fmtNum_(d, 1);
}


/**
 * Иконка светофора по проценту исполнения.
 */
function trafficLight_(value, threshold) {
  if (value === null || value === undefined) return '\u26AA';  // серый кружок
  if (value >= threshold * 1.1) return '\uD83D\uDFE2';  // зелёный
  if (value >= threshold * 0.8) return '\uD83D\uDFE1';  // жёлтый
  return '\uD83D\uDD34';  // красный
}


/**
 * Иконка светофора для доли ЕП (инвертированная: меньше — лучше).
 */
function epLight_(epShare, normalEp) {
  if (epShare === null || epShare === undefined) return '\u26AA';
  if (epShare <= normalEp) return '\uD83D\uDFE2';
  if (epShare <= normalEp * 1.3) return '\uD83D\uDFE1';
  return '\uD83D\uDD34';
}


/**
 * Иконка тренда.
 */
function trendIcon_(trendStr) {
  var entry = TREND_LABELS_[trendStr];
  return entry ? entry.icon : '\u2014';
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 0: ГРЕЙД КАЧЕСТВА ДАННЫХ
// ---------------------------------------------------------------------------

/**
 * Лаконичный блок о качестве данных. При высоком грейде — одна строка.
 * При низком — развёрнутое предупреждение с конкретными проблемами.
 */
function renderTrustGrade_(ctx) {
  try {
    var ts = ctx.trustScore || {};
    var grade = ts.grade || '?';
    var total = ts.total || 0;
    var lines = [];

    lines.push('\u2550\u2550\u2550 ОЦЕНКА КАЧЕСТВА ДАННЫХ \u2550\u2550\u2550');

    // Находим метку грейда
    var gradeLabel = '';
    var grades = CFG_.TRUST_GRADES;
    var gKeys = ['A', 'B', 'C', 'D', 'F'];
    for (var i = 0; i < gKeys.length; i++) {
      if (grade === gKeys[i] && grades[gKeys[i]]) {
        gradeLabel = grades[gKeys[i]].label;
        break;
      }
    }

    lines.push('Грейд: ' + grade + ' (' + total + '/100) \u2014 ' + (gradeLabel || 'не определено'));

    // Развёрнутые предупреждения только при грейде C и ниже
    if ((grade === 'C' || grade === 'D' || grade === 'F') && ts.issues && ts.issues.length > 0) {
      lines.push('');
      lines.push('ВНИМАНИЕ: качество данных ограничивает глубину аналитики. Проблемы:');
      var maxShow = Math.min(ts.issues.length, 5);
      for (var j = 0; j < maxShow; j++) {
        var msg = ts.issues[j].message || ts.issues[j].description || '';
        if (msg) lines.push('  \u2022 ' + msg);
      }
      if (ts.issues.length > 5) {
        lines.push('  \u2026 и ещё ' + (ts.issues.length - 5) + ' проблем');
      }
    }

    if (grade === 'D' || grade === 'F') {
      lines.push('');
      lines.push('*** Выводы ниже носят предварительный характер и требуют ручной верификации. ***');
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 ОЦЕНКА КАЧЕСТВА ДАННЫХ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 1: УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ
// ---------------------------------------------------------------------------

/**
 * 3-5 предложений, дающих руководителю полную картину за 30 секунд.
 * Структура: статус -> контекст -> главный риск -> главное достижение -> действие.
 */
function renderExecSummary_(ctx) {
  try {
    var g = ctx.metrics.global;
    var qCtx = ctx._qCtx;
    var lines = [];
    lines.push('\u2550\u2550\u2550 1. УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ \u2550\u2550\u2550');

    // ===== ПАРАГРАФ 1: Контекст с весом данных =====
    var planY = g.allCompYearPlanCount || 0;
    var factY = g.allCompYearFactCount || 0;
    var execYPct = planY > 0 ? (factY / planY) : null;
    var yearPhase = qCtx.yearPhase || 0.26;

    var reportDate = ctx.rawData ? ctx.rawData.report_date : new Date();
    var dateObj = (reportDate instanceof Date) ? reportDate : new Date(reportDate);

    if (execYPct !== null && planY > 0) {
      var diffPP = (execYPct - yearPhase) * 100;
      var diffDir = diffPP >= 0 ? 'выше' : 'ниже';
      var diffAbs = Math.abs(Math.round(diffPP * 10) / 10);
      lines.push('По состоянию на ' + fmtDate_(dateObj) + ' из ' + fmtInt_(planY) +
        ' запланированных процедур завершено ' + fmtInt_(factY) +
        ' (' + fmtPct_(execYPct) + '), что на ' + fmtNum_(diffAbs, 1) + ' п.п. ' +
        diffDir + ' годовой траектории (' + fmtPct_(yearPhase) + ').');
    } else {
      lines.push('По состоянию на ' + fmtDate_(dateObj) + ': запланировано ' + fmtInt_(planY) +
        ' конкурентных процедур; завершённых нет \u2014 ' +
        (qCtx.phase < 0.2
          ? 'это ожидаемо для начала квартала.'
          : 'требуется выяснение причин.'));
    }

    // Доля ЕП — весовой контекст
    if (g.allFactEpShare !== null && g.allFactEpShare !== undefined) {
      var epVerdict;
      if (g.allFactEpShare > 0.60) epVerdict = 'тревожный уровень \u2014 необходим аудит';
      else if (g.allFactEpShare > 0.40) epVerdict = 'выше комфортного порога';
      else epVerdict = 'в приемлемом диапазоне';
      lines.push('Доля ЕП по всем ГРБС: ' + fmtPct_(g.allFactEpShare) + ' \u2014 ' + epVerdict + '.');
    }

    // Лидер
    var ranking = ctx._ranking || [];
    if (ranking.length > 0 && ranking[0].execPct > 0) {
      var leader = ranking[0];
      var blName = (GRBS_BASELINES_[leader.code] || {}).fullName || leader.code;
      lines.push('\u2605 Лидер: ' + blName + ' \u2014 исполнение ' + fmtPct_(leader.execPct) +
        ', комплексный балл ' + fmtNum_(leader.score, 0) + '/100.');
    }

    // ===== ПАРАГРАФ 2: Топ-3 риска =====
    lines.push('');
    var criticals = filterInsightsBySeverity_(ctx, 'КРИТИЧЕСКАЯ');
    var highs = filterInsightsBySeverity_(ctx, 'ВЫСОКАЯ');
    var allRisks = criticals.concat(highs)
      .filter(function(ins) { return (ins.factor || '').indexOf('ЦЕНТРАЛИЗАЦИЯ') === -1; });
    // Диверсифицируем: не более 1 инсайта на один ГРБС в топ-3
    var topRisks = [];
    var seenGrbsTop = {};
    for (var tfi = 0; tfi < allRisks.length && topRisks.length < 3; tfi++) {
      var gKey = allRisks[tfi].grbs || '';
      if (!seenGrbsTop[gKey]) {
        seenGrbsTop[gKey] = true;
        topRisks.push(allRisks[tfi]);
      }
    }
    // Если менее 3 уникальных ГРБС — добрать из оставшихся
    if (topRisks.length < 3) {
      for (var tfi2 = 0; tfi2 < allRisks.length && topRisks.length < 3; tfi2++) {
        if (topRisks.indexOf(allRisks[tfi2]) === -1) topRisks.push(allRisks[tfi2]);
      }
    }
    if (topRisks.length > 0) {
      var showCount = Math.min(3, topRisks.length);
      lines.push('Три ключевых вопроса:');
      for (var ri = 0; ri < showCount; ri++) {
        lines.push('  (' + (ri + 1) + ') ' + topRisks[ri].fact +
          (topRisks[ri].grbs !== 'ВСЕ' ? ' [' + topRisks[ri].grbs + ']' : ''));
      }
    } else {
      lines.push('Критических рисков на текущий момент не выявлено.');
    }

    // ===== ПАРАГРАФ 3: Прогноз и рекомендации =====
    lines.push('');
    var gf = ctx.dynamics && ctx.dynamics.global ? ctx.dynamics.global.forecast : null;
    if (gf && gf.projectedExec !== undefined) {
      var qEndStr = fmtDate_(qCtx.qEnd);
      lines.push('При сохранении текущего темпа к концу квартала (' + qEndStr +
        ') прогнозируемое исполнение составит ' + fmtPct_(gf.projectedExec) +
        (gf.projectedExec >= 0.85
          ? ' \u2014 план достижим.'
          : ' \u2014 РИСК недовыполнения.'));
    } else if (execYPct !== null && planY > 0) {
      // Линейная экстраполяция при отсутствии модели динамики
      var projectedYear = yearPhase > 0 ? Math.min(1.0, execYPct / yearPhase) : 0;
      lines.push('При сохранении текущего темпа к концу года ожидаемое исполнение \u2014 ' +
        fmtPct_(projectedYear) +
        (projectedYear >= 0.85
          ? ' \u2014 план достижим.'
          : ' \u2014 РИСК недовыполнения.'));
    }

    // Конкретные рекомендации (нумерованные)
    var recCounter = 1;
    var recItems = [];
    for (var ci = 0; ci < criticals.length && recItems.length < 3; ci++) {
      if (criticals[ci].action) recItems.push(criticals[ci]);
    }
    for (var hi = 0; hi < highs.length && recItems.length < 3; hi++) {
      if (highs[hi].action) recItems.push(highs[hi]);
    }
    if (recItems.length > 0) {
      lines.push('');
      lines.push('Приоритетные действия:');
      for (var qi = 0; qi < recItems.length; qi++) {
        lines.push('  ' + recCounter + '. ' + recItems[qi].action +
          (recItems[qi].grbs !== 'ВСЕ' ? ' (' + recItems[qi].grbs + ')' : ''));
        recCounter++;
      }
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 1. УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 2: ОБЩАЯ КАРТИНА
// ---------------------------------------------------------------------------

/**
 * Числа с интерпретацией — не просто «план X, факт Y»,
 * а «план X, факт Y, что означает Z с учётом фазы квартала».
 */
function renderBigPicture_(ctx) {
  try {
    var g = ctx.metrics.global;
    var qCtx = ctx._qCtx;
    var lines = [];
    lines.push('\u2550\u2550\u2550 2. ОБЩАЯ КАРТИНА \u2550\u2550\u2550');

    // --- Компактная сводная таблица ---
    var planY = g.allCompYearPlanCount || 0;
    var factY = g.allCompYearFactCount || 0;
    var execYPct = planY > 0 ? (factY / planY) : null;
    var remainY = Math.max(0, planY - factY);
    var epShareVal = (g.allFactEpShare !== null && g.allFactEpShare !== undefined)
      ? g.allFactEpShare : null;
    var econVal = (g.allCompYearEconomySum > 0 && g.allCompYearPlanSum > 0)
      ? (g.allCompYearEconomySum / g.allCompYearPlanSum) : null;

    lines.push('');
    // Оценки
    var execMark = '';
    if (execYPct !== null) {
      if (execYPct > qCtx.phase + 0.10) execMark = '\u2605 опережение';
      else if (execYPct > qCtx.phase - 0.10) execMark = 'в рамках плана';
      else execMark = '\u26A0 отставание';
    }
    var epMark = '';
    if (epShareVal !== null) {
      if (epShareVal > 0.60) epMark = '\u26A0 выше 60%';
      else if (epShareVal > 0.40) epMark = 'повышенная';
      else if (epShareVal > 0.20) epMark = 'умеренная';
      else epMark = '\u2605 низкая';
    }
    var econMark = '';
    if (econVal !== null) {
      if (econVal > 0.25) econMark = '\u26A0 завышение НМЦ?';
      else if (econVal > 0.15) econMark = '\u2605 эффективные торги';
      else if (econVal > 0.05) econMark = 'норма';
      else econMark = 'ниже среднего';
    }
    // Таблица сводных показателей
    lines.push('{{TBL:H}}Показатель{{|}}Значение{{|}}Оценка');
    lines.push('{{TBL:R}}Исполнение (кол-во){{|}}' + fmtPct_(execYPct) + ' (' + fmtInt_(factY) + '/' + fmtInt_(planY) + '){{|}}' + execMark);
    lines.push('{{TBL:R}}Доля ЕП{{|}}' + (epShareVal !== null ? fmtPct_(epShareVal) : '\u2014') + '{{|}}' + epMark);
    lines.push('{{TBL:R}}Экономия{{|}}' + (econVal !== null ? fmtPct_(econVal) : '\u2014') + '{{|}}' + econMark);
    lines.push('{{TBL:R}}Остаток процедур{{|}}' + fmtInt_(remainY) + '{{|}}');
    lines.push('{{TBL:E}}');

    // --- Конкурентные процедуры (детальный блок) ---
    lines.push('');
    lines.push('Конкурентные процедуры:');

    lines.push('  На ' + qCtx.yearStr + ' год запланировано ' + fmtInt_(planY) +
      ' конкурентных процедур на ' + fmtMoney_(g.allCompYearPlanSum) + '.');
    // Бюджетная разбивка плановых сумм
    var planFB = g.allCompYearPlanFB, planKB = g.allCompYearPlanKB, planMB = g.allCompYearPlanMB;
    if (planFB || planKB || planMB) {
      lines.push('    (ФБ \u2014 ' + fmtMoney_(planFB || 0) + ', КБ \u2014 ' + fmtMoney_(planKB || 0) + ', МБ \u2014 ' + fmtMoney_(planMB || 0) + ')');
    }

    if (factY > 0) {
      var execVerdict = '';
      if (execYPct !== null) {
        if (execYPct > qCtx.phase + 0.10) execVerdict = ' \u2014 опережение графика';
        else if (execYPct > qCtx.phase - 0.10) execVerdict = ' \u2014 в рамках плана';
        else execVerdict = ' \u2014 отставание от графика';
      }
      lines.push('  Завершено: ' + fmtInt_(factY) + ' (' + fmtPct_(execYPct) + ')' +
        ' на ' + fmtMoney_(g.allCompYearFactSum) + execVerdict + '.');
      // Бюджетная разбивка фактических сумм
      var factFB = g.allCompYearFactFB, factKB = g.allCompYearFactKB, factMB = g.allCompYearFactMB;
      if (factFB || factKB || factMB) {
        lines.push('    (ФБ \u2014 ' + fmtMoney_(factFB || 0) + ', КБ \u2014 ' + fmtMoney_(factKB || 0) + ', МБ \u2014 ' + fmtMoney_(factMB || 0) + ')');
      }
      lines.push('  Остаток: ' + fmtInt_(remainY) + ' процедур.');
    } else {
      lines.push('  Завершённых процедур нет.');
    }

    // Динамика (если доступна)
    var globalDyn = ctx.dynamics && ctx.dynamics.global ? ctx.dynamics.global : null;
    if (globalDyn && globalDyn.trend && globalDyn.trend !== 'НЕДОСТАТОЧНО_ДАННЫХ') {
      var tLabel = TREND_LABELS_[globalDyn.trend];
      var trendText = tLabel ? tLabel.text : globalDyn.trend;
      lines.push('  Темп: ' + trendText +
        (globalDyn.weekOverWeek
          ? ' (' + (globalDyn.weekOverWeek > 0 ? '+' : '') + fmtNum_(globalDyn.weekOverWeek * 100, 1) + ' п.п. за неделю)'
          : '') + '.');
    }

    // Экономия с оценкой
    if (g.allCompYearEconomySum > 0 && g.allCompYearPlanSum > 0) {
      var econPct = g.allCompYearEconomySum / g.allCompYearPlanSum;
      var econVerdict;
      if (econPct > 0.25) econVerdict = 'аномально высокая \u2014 рекомендуется пересмотр методологии определения НМЦ (ст. 22, ст. 37 44-ФЗ)';
      else if (econPct > 0.15) econVerdict = 'повышенная \u2014 эффективные торги';
      else if (econPct > 0.05) econVerdict = 'в нормальном диапазоне';
      else if (econPct > 0.01) econVerdict = 'ниже среднего \u2014 возможна недостаточная конкуренция';
      else econVerdict = 'минимальная \u2014 цены близки к НМЦ, рекомендуется оценка обоснованности';
      lines.push('');
      lines.push('  Экономия: ' + fmtMoney_(g.allCompYearEconomySum) +
        ' (' + fmtPct_(econPct) + ' от плановых сумм) \u2014 ' + econVerdict + '.');

      // Рейтинг экономии по ГРБ��
      if (ctx.metrics && ctx.metrics.byGrbs) {
        var econRanking = [];
        var grbsKeys = Object.keys(ctx.metrics.byGrbs);
        for (var ek = 0; ek < grbsKeys.length; ek++) {
          var gm = ctx.metrics.byGrbs[grbsKeys[ek]];
          var gEconPct = 0;
          if (gm.compEconomy && gm.compPlanSum && gm.compPlanSum > 0) {
            gEconPct = gm.compEconomy / gm.compPlanSum;
          } else if (gm.economyPct) {
            gEconPct = toNumber_(gm.economyPct);
            if (gEconPct > 1) gEconPct = gEconPct / 100;
          }
          if (gEconPct > 0) econRanking.push({ code: grbsKeys[ek], pct: gEconPct, sum: gm.compEconomy || 0 });
        }
        if (econRanking.length > 1) {
          econRanking.sort(function(a, b) { return b.pct - a.pct; });
          var econTop = econRanking.slice(0, 3).map(function(r) { return r.code + ' ' + fmtPct_(r.pct); });
          lines.push('  Рейтинг экономии: ' + econTop.join(' > ') +
            (econRanking.length > 3 ? ' > ...' : '') + '.');
        }
      }

      // Прогноз экономии (если есть остаток)
      if (remainY > 0) {
        var forecast = buildEconomyForecast_(ctx, remainY);
        if (forecast) {
          lines.push('  ' + forecast);
        }
      }
    }

    // --- Единственный поставщик ---
    lines.push('');
    lines.push('Единственный поставщик:');
    if (g.allFactEpShare !== null && g.allFactEpShare !== undefined) {
      var epSharePct = g.allFactEpShare;
      var epInterpretation;
      if (epSharePct > 0.60)      epInterpretation = 'критически высокая доля; доля конкурентных процедур ниже целевого уровня';
      else if (epSharePct > 0.40) epInterpretation = 'повышенная зависимость от ЕП; рекомендуется анализ обоснований';
      else if (epSharePct > 0.20) epInterpretation = 'умеренный уровень, типичный для муниципальных заказчиков';
      else                        epInterpretation = 'низкая доля \u2014 конкурентная модель работает эффективно';
      lines.push('  Доля ЕП: ' + fmtPct_(epSharePct) + ' \u2014 ' + epInterpretation + '.');
      lines.push('  Объём: план ' + fmtInt_(g.allEpYearPlanCount) + ' процедур на ' +
        fmtMoney_(g.allEpYearPlanSum) + ', факт \u2014 ' + fmtInt_(g.allEpYearFactCount) +
        ' на ' + fmtMoney_(g.allEpYearFactSum) + '.');
    } else {
      lines.push('  Данные о ЕП недоступны.');
    }

    // --- Структура бюджета (если есть) ---
    var budgetStr = getBudgetBreakdown_(ctx, 'fact');
    if (budgetStr) {
      lines.push('');
      lines.push('Структура бюджета:');
      lines.push('  ' + budgetStr);
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 2. ОБЩАЯ КАРТИНА \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 3: РЕЙТИНГ ГРБС
// ---------------------------------------------------------------------------

/**
 * Строит сводную таблицу-рейтинг со светофорной индикацией.
 * Сортировка по комплексному баллу (убывание).
 */
function renderRankingTable_(ctx) {
  try {
    var lines = [];
    lines.push('\u2550\u2550\u2550 3. РЕЙТИНГ ГРБС \u2550\u2550\u2550');
    lines.push('');

    var ranking = ctx._ranking || [];
    if (ranking.length === 0) {
      lines.push('Данных для рейтинга недостаточно.');
      return lines.join('\n');
    }

    // Таблица рейтинга ГРБС
    lines.push('{{TBL:H}}ГРБС{{|}}Исполнение{{|}}Доля ЕП{{|}}Балл{{|}}Тренд{{|}}Рекомендация');

    for (var i = 0; i < ranking.length; i++) {
      var r = ranking[i];
      var baseline = GRBS_BASELINES_[r.code] || {};
      var execLight = trafficLight_(r.execPct, baseline.expectedExecQ1 || 0.50);
      var epLt = epLight_(r.epShare, baseline.normalEpShare || 0.40);
      var trend = trendIcon_(r.trend);

      var recCategory;
      if (r.score >= 70) recCategory = 'onTrack';
      else if (r.score >= 40) recCategory = 'needsAttention';
      else recCategory = 'urgent';
      var recText = pickPhrase_(RECOMMENDATION_PHRASES_[recCategory], i, {});

      lines.push('{{TBL:R}}' + r.code + '{{|}}' +
        fmtPct_(r.execPct) + ' ' + execLight + '{{|}}' +
        fmtPct_(r.epShare) + ' ' + epLt + '{{|}}' +
        fmtNum_(r.score, 0) + '/100{{|}}' +
        trend + '{{|}}' + recText);
    }
    lines.push('{{TBL:E}}');

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 3. РЕЙТИНГ ГРБС \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


/**
 * Построение рейтинга — используется в таблице и резюме.
 * Комплексный балл: 40% исполнение + 30% (1 - доля ЕП) + 30% дисциплина.
 *
 * @param {Object} ctx — контекст
 * @returns {Array} — массив отсортированный по баллу (убывание)
 */
function buildGrbsRanking_(ctx) {
  try {
    var entries = [];
    var allCodes = GRBS_ORDER_.concat(['УО']);

    for (var i = 0; i < allCodes.length; i++) {
      var code = allCodes[i];
      var gm = ctx.metrics.byGrbs[code];
      if (!gm) continue;

      // Годовое исполнение по КОЛИЧЕСТВУ (штуки) — основной показатель для рейтинга
      var execPct = gm.compPlanCount > 0 ? (gm.compFactCount / gm.compPlanCount) : 0;
      var epShare = gm.epShare || 0;

      // Дисциплинарный индекс из профиля (если есть), иначе — по исполнению
      var discipline = 50;
      if (ctx.profiles && ctx.profiles[code] && ctx.profiles[code].disciplineIndex !== undefined) {
        discipline = ctx.profiles[code].disciplineIndex;
      } else {
        discipline = Math.min(100, Math.max(0, execPct * 100));
      }

      // Комплексный балл (0-100)
      var score = (execPct * 40) + ((1 - epShare) * 30) + (discipline / 100 * 30);
      score = Math.round(Math.max(1, Math.min(100, score)));

      // Тренд из динамики
      var trend = 'НЕДОСТАТОЧНО_ДАННЫХ';
      if (ctx.dynamics && ctx.dynamics.byGrbs && ctx.dynamics.byGrbs[code]) {
        trend = ctx.dynamics.byGrbs[code].trend || trend;
      }

      entries.push({
        code: code,
        score: score,
        execPct: execPct,
        epShare: epShare,
        discipline: discipline,
        trend: trend
      });
    }

    entries.sort(function(a, b) { return b.score - a.score; });
    return entries;
  } catch (e) {
    return [];
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 4: АНАЛИТИКА ПО ГРБС (уникальные нарративы)
// ---------------------------------------------------------------------------

/**
 * Для каждого ГРБС (кроме УО) строит уникальный аналитический параграф.
 * Никаких шаблонных повторов — каждый ГРБС описывается своими словами,
 * с учётом его профиля, динамики, аномалий и контекста.
 */
function renderGrbsNarratives_(ctx) {
  try {
    var lines = [];
    lines.push('\u2550\u2550\u2550 4. АНАЛИТИКА ПО ГРБС \u2550\u2550\u2550');

    for (var i = 0; i < GRBS_ORDER_.length; i++) {
      var code = GRBS_ORDER_[i];
      var gm = ctx.metrics.byGrbs[code];
      if (!gm) continue;

      lines.push('');
      lines.push(renderOneGrbsNarrative_(ctx, code, i));
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 4. АНАЛИТИКА ПО ГРБС \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


/**
 * Генерирует уникальный аналитический параграф для одного ГРБС.
 * Использует индекс `idx` для выбора фраз из банка — гарантирует
 * что соседние ГРБС не получат одинаковые формулировки.
 *
 * @param {Object} ctx — контекст
 * @param {string} code — код ГРБС
 * @param {number} idx — порядковый номер ГРБС (для выбора фраз)
 * @returns {string} — аналитический текст
 */
function renderOneGrbsNarrative_(ctx, code, idx) {
  try {
    var gm = ctx.metrics.byGrbs[code];
    var baseline = GRBS_BASELINES_[code] || {};
    var qCtx = ctx._qCtx;
    var lines = [];

    var fullName = baseline.fullName || code;
    lines.push('\u258E ' + fullName);

    // --- Исполнение (ГОДОВОЕ как основной показатель) ---
    var execPctYear = gm.compExecPct || (gm.compPlanSum > 0 ? (gm.compFactSum / gm.compPlanSum) : null);
    var execPctCount = gm.compPlanCount > 0 ? (gm.compFactCount / gm.compPlanCount) : null;
    // Годовое ожидание: интерполяция от 0 к Q1-baseline за Q1, далее к 1.0 к концу года
    var yearPhase = qCtx.yearPhase || 0.26;
    var baseQ1 = baseline.expectedExecQ1 || 0.50;
    var expectedExec;
    if (yearPhase <= 0.25) {
      expectedExec = (yearPhase / 0.25) * baseQ1;
    } else {
      var afterQ1 = (yearPhase - 0.25) / 0.75;
      expectedExec = baseQ1 + afterQ1 * (1.0 - baseQ1);
    }

    var cat = categorizeExec_(execPctCount, code, qCtx);
    var phraseBank = EXEC_PHRASES_[cat] || EXEC_PHRASES_.medium;
    var delta = ppDelta_(execPctCount, expectedExec);

    var execPhrase = pickPhrase_(phraseBank, idx, {
      pct: fmtPct_(execPctCount),
      exp: fmtPct_(expectedExec),
      delta: delta,
      plan: fmtInt_(gm.compPlanCount)
    });

    lines.push('  Исполнение: ' + execPhrase + '.');

    // Позиция в рейтинге ГРБС
    var ranking = ctx._ranking || [];
    var rankTotal = ranking.length;
    for (var ri = 0; ri < ranking.length; ri++) {
      if (ranking[ri].code === code) {
        lines.push('  (' + (ri + 1) + '-е место из ' + rankTotal + ' ГРБС)');
        break;
      }
    }

    // Абсолютные цифры (конкурентные) + бюджетная разбивка
    if (gm.compPlanCount > 0) {
      lines.push('  Конкурентные: план ' + fmtInt_(gm.compPlanCount) + ' на ' +
        fmtMoney_(gm.compPlanSum) + ', факт ' + fmtInt_(gm.compFactCount) +
        ' на ' + fmtMoney_(gm.compFactSum) + '.');
      // ФБ/КБ/МБ разбивка (если данные есть)
      var hasBudget = (gm.compFactFBYear || 0) + (gm.compFactKBYear || 0) + (gm.compFactMBYear || 0);
      if (hasBudget > 0) {
        lines.push('    в т.ч. ФБ — ' + fmtMoney_(gm.compFactFBYear || 0) +
          ', КБ — ' + fmtMoney_(gm.compFactKBYear || 0) +
          ', МБ — ' + fmtMoney_(gm.compFactMBYear || 0));
      }
    }

    // --- Доля ЕП ---
    var epCat = categorizeEp_(gm.epShare, code);
    var epBank = EP_PHRASES_[epCat] || EP_PHRASES_.normal;
    var normalEp = baseline.normalEpShare || 0.40;
    var epDelta = ppDelta_(gm.epShare, normalEp);

    var epPhrase = pickPhrase_(epBank, idx, {
      pct: fmtPct_(gm.epShare),
      norm: fmtPct_(normalEp),
      delta: epDelta
    });
    lines.push('  ' + epPhrase.charAt(0).toUpperCase() + epPhrase.slice(1) + '.');

    // --- Экономия (5-уровневая интерпретация) ---
    var econPct = 0;
    if (gm.compEconomy > 0) {
      econPct = gm.compPlanSum > 0 ? (gm.compEconomy / gm.compPlanSum) : 0;
      var econComment;
      if (econPct > 0.25) econComment = 'аномально высокая — рекомендуется пересмотр методологии НМЦ (ст. 22, ст. 37 44-ФЗ). ТРЕБУЕТ ПРОВЕРКИ';
      else if (econPct > 0.15) econComment = 'повышенная — эффективные торги';
      else if (econPct > 0.05) econComment = 'в нормальном диапазоне';
      else if (econPct > 0.01) econComment = 'ниже среднего — возможна недостаточная конкуренция';
      else econComment = 'минимальная — цены контрактов близки к начальным. Требуется оценка обоснованности НМЦ';
      lines.push('  Экономия: ' + fmtMoney_(gm.compEconomy) + ' (' + fmtPct_(econPct) + ') — ' + econComment + '.');
    }

    // --- Причинно-следственная интерпретация (высокая ЕП + низкая экономия) ---
    var isHighEp = (epCat === 'critical' || epCat === 'elevated');
    var hasCompletions = (gm.compFactCount || 0) > 0;
    var isLowEcon = hasCompletions && (econPct < 0.05);
    if (isHighEp && isLowEcon) {
      lines.push('  \u2192 ' + pickPhrase_(CAUSATION_PHRASES_, idx, {}));
    } else if (isHighEp && !hasCompletions) {
      lines.push('  \u2192 Нулевое исполнение конкурентного блока при высокой доле ЕП указывает на организационные барьеры в подготовке документации');
    }

    // --- Динамика ---
    var dyn = ctx.dynamics && ctx.dynamics.byGrbs ? ctx.dynamics.byGrbs[code] : null;
    if (dyn && dyn.trend && dyn.trend !== 'НЕДОСТАТОЧНО_ДАННЫХ') {
      var tInfo = TREND_LABELS_[dyn.trend] || { icon: '\u2014', text: dyn.trend };
      lines.push('  Тренд: ' + tInfo.icon + ' ' + tInfo.text +
        (dyn.weekOverWeek
          ? ' (' + (dyn.weekOverWeek > 0 ? '+' : '') + fmtNum_(dyn.weekOverWeek * 100, 1) + ' п.п./нед.)'
          : '') + '.');
    }

    // --- Детали остатка из контекста оператора ---
    var remainDetails = getGrbsRemainDetails_(ctx, code);
    if (remainDetails) {
      lines.push('  Остаток: ' + remainDetails);
    } else {
      // Вычисляем оставшиеся процедуры из метрик
      var remainCount = Math.max(0, (gm.compPlanCount || 0) - (gm.compFactCount || 0));
      if (remainCount > 0) {
        var remainSum = Math.max(0, (gm.compPlanSum || 0) - (gm.compFactSum || 0));
        lines.push('  В работе: ' + pluralProc_(remainCount) + ' на ориентировочные ' +
          fmtMoney_(remainSum) + '.');
      }
    }

    // --- Пояснение по ЕП из контекста оператора ---
    if (ctx.humanContext) {
      var epExplanation = ctx.humanContext[code + '_ep_explanation'] ||
                          ctx.humanContext[code + '_ep_пояснение'] || null;
      if (epExplanation) {
        lines.push('  Структура ЕП: ' + epExplanation);
      }
    }

    // --- Тезисы-аномалии конкретно для этого ГРБС ---
    var grbsInsights = filterInsightsByGrbs_(ctx, code);
    var anomalyCount = 0;
    for (var j = 0; j < grbsInsights.length; j++) {
      var ins = grbsInsights[j];
      if (ins.severity === 'КРИТИЧЕСКАЯ' || ins.severity === 'ВЫСОКАЯ') {
        if (anomalyCount === 0) lines.push('  Сигналы:');
        lines.push('    [' + ins.severity + '] ' + ins.fact);
        if (ins.law) lines.push('    Основание: ' + ins.law);
        anomalyCount++;
      }
    }

    // --- Рекомендация ---
    var humanRec = getGrbsRecommendations_(ctx, code);
    if (humanRec) {
      lines.push('  \u2192 Рекомендация: ' + humanRec);
    } else {
      // Автоматическая рекомендация на основе категории
      var recCat;
      if (cat === 'excellent' || cat === 'good') {
        recCat = epCat === 'critical' || epCat === 'elevated' ? 'epReview' : 'onTrack';
      } else if (cat === 'medium') {
        recCat = 'needsAttention';
      } else {
        recCat = 'urgent';
      }
      var autoRec = pickPhrase_(RECOMMENDATION_PHRASES_[recCat], idx + 3, {});
      lines.push('  \u2192 Рекомендация: ' + autoRec);
    }

    // --- Визуальный разделитель ---
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    return lines.join('\n');
  } catch (e) {
    return '\u258E ' + code + '\n  [\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 5: УПРАВЛЕНИЕ ОБРАЗОВАНИЯ (отдельный блок)
// ---------------------------------------------------------------------------

/**
 * УО выделено отдельно из-за особого режима ЕП:
 * п. 5 ч. 1 ст. 93 44-ФЗ — повышенные лимиты для образовательных учреждений.
 * Это значит, что высокая доля ЕП для УО — не обязательно проблема.
 */
function renderUoNarrative_(ctx) {
  try {
    var lines = [];
    lines.push('\u2550\u2550\u2550 5. УПРАВЛЕНИЕ ОБРАЗОВАНИЯ \u2550\u2550\u2550');
    lines.push('(особый режим ЕП: п. 5 ч. 1 ст. 93 44-ФЗ \u2014 повышенные лимиты для образовательных учреждений)');
    lines.push('');

    var gm = ctx.metrics.byGrbs['УО'];
    var g = ctx.metrics.global;
    var baseline = GRBS_BASELINES_['УО'] || {};
    var qCtx = ctx._qCtx;

    // Берём метрики из byGrbs или из глобальных
    var compPlanCount = gm ? gm.compPlanCount : (g.uoCompYearPlanCount || 0);
    var compFactCount = gm ? gm.compFactCount : (g.uoCompYearFactCount || 0);
    var compFactSum = gm ? gm.compFactSum : (g.uoCompYearFactSum || 0);
    var compPlanSum = gm ? gm.compPlanSum : 0;
    var epShare = gm ? gm.epShare : g.uoFactEpShare;
    var economy = gm ? gm.compEconomy : (g.uoCompYearEconomySum || 0);

    // Исполнение
    var execPct = compPlanCount > 0 ? (compFactCount / compPlanCount) : null;
    var yearPhaseUO = qCtx.yearPhase || 0.26;
    var baseQ1UO = baseline.expectedExecQ1 || 0.30;
    var expectedExec;
    if (yearPhaseUO <= 0.25) {
      expectedExec = (yearPhaseUO / 0.25) * baseQ1UO;
    } else {
      var afterQ1UO = (yearPhaseUO - 0.25) / 0.75;
      expectedExec = baseQ1UO + afterQ1UO * (1.0 - baseQ1UO);
    }

    if (execPct !== null && execPct > 0) {
      var uoExecDiff = execPct - expectedExec;
      var uoExecComment;
      if (uoExecDiff > 0.10) uoExecComment = 'опережение';
      else if (uoExecDiff > -0.10) uoExecComment = 'в рамках нормы';
      else uoExecComment = 'отставание';
      lines.push('Исполнение: ' + fmtPct_(execPct) +
        ' (ожидание для УО на данном этапе: ' + fmtPct_(expectedExec) + ' \u2014 ' + uoExecComment + ').');
    } else {
      lines.push('Конкурентные процедуры не завершены.' +
        (qCtx.phase < 0.25 ? ' Для начала квартала это стандартная ситуация для образовательных закупок.' : ''));
    }

    // Объёмы
    lines.push('Конкурентные: план ' + fmtInt_(compPlanCount) + ' процедур' +
      (compPlanSum > 0 ? ' на ' + fmtMoney_(compPlanSum) : '') +
      ', факт \u2014 ' + fmtInt_(compFactCount) + ' на ' + fmtMoney_(compFactSum) + '.');

    // Доля ЕП — с оговоркой о повышенных лимитах для образования
    if (epShare !== null && epShare !== undefined) {
      var uoNormEp = baseline.normalEpShare || 0.55;
      var uoEpComment;
      if (epShare <= uoNormEp) {
        uoEpComment = 'в рамках повышенного лимита для образовательных учреждений';
      } else if (epShare <= uoNormEp * 1.2) {
        uoEpComment = 'на верхней границе допустимого диапазона';
      } else {
        uoEpComment = 'превышает даже повышенный лимит для образования \u2014 ТРЕБУЕТ ПРОВЕРКИ';
      }
      lines.push('Доля ЕП: ' + fmtPct_(epShare) + ' (норма для ПО/ДО: до ' + fmtPct_(uoNormEp) + ' по п. 5 ч. 1 ст. 93 44-ФЗ) \u2014 ' +
      uoEpComment + '.');
    }

    // Экономия
    if (economy > 0) {
      lines.push('Экономия: ' + fmtMoney_(economy) + '.');
    }

    // Тезисы по УО
    var uoInsights = filterInsightsByGrbs_(ctx, 'УО');
    if (uoInsights.length > 0) {
      lines.push('');
      for (var k = 0; k < uoInsights.length; k++) {
        if (uoInsights[k].severity === 'КРИТИЧЕСКАЯ' || uoInsights[k].severity === 'ВЫСОКАЯ') {
          lines.push('  [' + uoInsights[k].severity + '] ' + uoInsights[k].fact);
        }
      }
    }

    // Рекомендация
    var uoHumanRec = getGrbsRecommendations_(ctx, 'УО');
    if (uoHumanRec) {
      lines.push('\u2192 Рекомендация: ' + uoHumanRec);
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 5. УПРАВЛЕНИЕ ОБРАЗОВАНИЯ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 6: СООТВЕТСТВИЕ 44-ФЗ
// ---------------------------------------------------------------------------

/**
 * Выводится только при наличии флагов. Каждый флаг — со ссылкой на статью.
 * Возвращает null, если нарушений нет (раздел не включается в отчёт).
 */
function renderComplianceNarrative_(ctx) {
  try {
    var compInsights = filterInsightsByFactor_(ctx, '44-ФЗ')
      .filter(function(ins) { return (ins.factor || '').indexOf('ЦЕНТРАЛИЗАЦИЯ') === -1; });
    if (compInsights.length === 0) return null;

    var lines = [];
    lines.push('\u2550\u2550\u2550 6. СООТВЕТСТВИЕ 44-ФЗ \u2550\u2550\u2550');
    lines.push('Выявлено ' + compInsights.length + ' потенциальных отклонений от требований 44-ФЗ:');

    for (var i = 0; i < compInsights.length; i++) {
      var ins = compInsights[i];
      lines.push('');
      lines.push((i + 1) + '. [' + ins.severity + '] ' +
        (ins.grbs !== 'ВСЕ' ? ins.grbs + ': ' : '') + ins.fact);
      if (ins.interpretation) {
        lines.push('   Почему важно: ' + ins.interpretation);
      }
      if (ins.law) {
        lines.push('   Норма: ' + ins.law);
      }
      if (ins.action) {
        lines.push('   Действие: ' + ins.action);
      }
      // Правовой контекст из LAW_CONTEXT_ (если доступен)
      var lawKey = (ins.factor || '').replace('44-ФЗ: ', '');
      if (LAW_CONTEXT_[lawKey]) {
        lines.push('   Контекст: ' + LAW_CONTEXT_[lawKey]);
      }
    }

    return lines.join('\n');
  } catch (e) {
    return null;
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 7: АНОМАЛИИ И РИСКИ
// ---------------------------------------------------------------------------

/**
 * Группирует аномалии по серьёзности: критические -> высокие -> средние.
 * Каждая аномалия сопровождается пометкой «ТРЕБУЕТ ПРОВЕРКИ».
 */
function renderAnomaliesNarrative_(ctx) {
  try {
    var lines = [];
    lines.push('\u2550\u2550\u2550 7. АНОМАЛИИ И РИСКИ \u2550\u2550\u2550');

    var insights = ctx._insights || [];
    // Фильтруем аномалии и высокие/критические риски
    var anomalies = [];
    for (var i = 0; i < insights.length; i++) {
      var ins = insights[i];
      var factor = (ins.factor || '');
      // Централизация выводится в отдельной секции 10
      if (factor.indexOf('ЦЕНТРАЛИЗАЦИЯ') >= 0) continue;
      var factorLc = factor.toLowerCase();
      if (factorLc.indexOf('аномал') >= 0 ||
          ins.severity === 'КРИТИЧЕСКАЯ' ||
          ins.severity === 'ВЫСОКАЯ') {
        anomalies.push(ins);
      }
    }

    if (anomalies.length === 0) {
      lines.push('Значимых аномалий не зафиксировано. Процедуры идут в штатном режиме.');
      return lines.join('\n');
    }

    // Группировка по серьёзности
    var groups = { 'КРИТИЧЕСКАЯ': [], 'ВЫСОКАЯ': [], 'СРЕДНЯЯ': [] };
    for (var j = 0; j < anomalies.length; j++) {
      var sev = anomalies[j].severity;
      if (groups[sev]) groups[sev].push(anomalies[j]);
      else if (groups['СРЕДНЯЯ']) groups['СРЕДНЯЯ'].push(anomalies[j]);
    }

    var sevOrder = ['КРИТИЧЕСКАЯ', 'ВЫСОКАЯ', 'СРЕДНЯЯ'];
    var sevLabels = {
      'КРИТИЧЕСКАЯ': '\uD83D\uDD34 КРИТИЧЕСКИЕ',
      'ВЫСОКАЯ': '\uD83D\uDFE1 ВЫСОКИЕ',
      'СРЕДНЯЯ': '\u26AA СРЕДНИЕ'
    };
    var counter = 1;

    for (var k = 0; k < sevOrder.length; k++) {
      var group = groups[sevOrder[k]];
      if (!group || group.length === 0) continue;

      lines.push('');
      lines.push(sevLabels[sevOrder[k]] + ':');
      for (var m = 0; m < group.length; m++) {
        var a = group[m];
        var factText = a.fact || '';
        var needsCheck = factText.indexOf('ТРЕБУЕТ ПРОВЕРКИ') >= 0;
        lines.push(counter + '. ' + (a.grbs !== 'ВСЕ' ? a.grbs + ' \u2014 ' : '') + factText +
          (needsCheck ? '' : ' \u2014 ТРЕБУЕТ ПРОВЕРКИ'));
        if (a.interpretation) {
          lines.push('   ' + a.interpretation);
        }
        counter++;
      }
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 7. АНОМАЛИИ И РИСКИ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 8: ПРОГНОЗ
// ---------------------------------------------------------------------------

/**
 * Три сценария: базовый, оптимистичный, пессимистичный.
 * Прогнозирует исполнение к концу квартала по каждому ГРБС.
 */
function renderForecastNarrative_(ctx) {
  try {
    var lines = [];
    var qCtx = ctx._qCtx;
    lines.push('\u2550\u2550\u2550 8. ПРОГНОЗ \u2550\u2550\u2550');

    // Проверяем наличие данных динамики
    var hasDynamics = ctx.dynamics && (
      (ctx.dynamics.global && ctx.dynamics.global.trend !== 'НЕДОСТАТОЧНО_ДАННЫХ') ||
      (ctx.dynamics.byGrbs && Object.keys(ctx.dynamics.byGrbs).length > 0)
    );

    if (!hasDynamics) {
      lines.push('Недостаточно исторических данных для построения прогноза.');
      lines.push('Для прогнозирования необходимо минимум ' + CFG_.MIN_SNAPSHOTS_REGRESSION + ' пятничных среза. ' +
        'Сейчас доступных срезов недостаточно.');
      return lines.join('\n');
    }

    var qEndStr = fmtDate_(qCtx.qEnd);
    lines.push('Остаток квартала: ' + qCtx.daysLeft + ' дней (до ' + qEndStr + ').');
    lines.push('');

    // Глобальный прогноз
    var gf = ctx.dynamics.global ? ctx.dynamics.global.forecast : null;
    if (gf) {
      lines.push('Общий прогноз исполнения к ' + qEndStr + ':');
      lines.push('  Базовый:       ' + fmtPct_(gf.projectedExec) +
        (gf.projectedExec >= CFG_.TARGET_EXEC_Q_END ? ' \u2014 план достижим' : ' \u2014 РИСК недовыполнения'));
      lines.push('  Оптимистичный: ' + fmtPct_(gf.optimistic));
      lines.push('  Пессимистичный: ' + fmtPct_(gf.pessimistic));
    }

    // Прогноз по каждому ГРБС
    var allCodes = GRBS_ORDER_.concat(['УО']);
    var forecastRows = [];
    for (var i = 0; i < allCodes.length; i++) {
      var code = allCodes[i];
      var dyn = ctx.dynamics.byGrbs ? ctx.dynamics.byGrbs[code] : null;
      if (!dyn || !dyn.forecast) continue;

      var fc = dyn.forecast;
      var status;
      if (fc.projectedExec >= CFG_.TARGET_EXEC_Q_END) status = '\uD83D\uDFE2 норма';
      else if (fc.projectedExec >= CFG_.TARGET_EXEC_Q_END * 0.7) status = '\uD83D\uDFE1 риск';
      else status = '\uD83D\uDD34 срыв';

      forecastRows.push({
        code: code,
        projected: fc.projectedExec,
        optimistic: fc.optimistic,
        pessimistic: fc.pessimistic,
        status: status
      });
    }

    if (forecastRows.length > 0) {
      lines.push('');
      lines.push('Прогноз по ГРБС:');
      lines.push('{{TBL:H}}ГРБС{{|}}Базовый{{|}}Оптим.{{|}}Пессим.{{|}}Статус');
      for (var j = 0; j < forecastRows.length; j++) {
        var fr = forecastRows[j];
        lines.push('{{TBL:R}}' + fr.code + '{{|}}' +
          fmtPct_(fr.projected) + '{{|}}' +
          fmtPct_(fr.optimistic) + '{{|}}' +
          fmtPct_(fr.pessimistic) + '{{|}}' +
          fr.status);
      }
      lines.push('{{TBL:E}}');
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 8. ПРОГНОЗ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 9: РЕКОМЕНДАЦИИ (по приоритетам)
// ---------------------------------------------------------------------------

/**
 * Группирует рекомендации: СРОЧНЫЕ -> ОПЕРАТИВНЫЕ -> ПЛАНОВЫЕ.
 * Каждая рекомендация привязана к ГРБС и основанию.
 */
function renderPrioritizedRecs_(ctx) {
  try {
    var lines = [];
    lines.push('\u2550\u2550\u2550 9. РЕКОМЕНДАЦИИ \u2550\u2550\u2550');

    var insights = ctx._insights || [];
    var actionable = [];
    for (var i = 0; i < insights.length; i++) {
      if (insights[i].action && insights[i].action.length > 0) {
        // Централизация выводится в отдельной секции — не дублировать в рекомендациях
        if ((insights[i].factor || '').indexOf('ЦЕНТРАЛИЗАЦИЯ') >= 0) continue;
        actionable.push(insights[i]);
      }
    }

    // Добавляем рекомендации из профилей ГРБС, которых нет в insights
    var seenGrbs = {};
    for (var si = 0; si < actionable.length; si++) {
      seenGrbs[actionable[si].grbs + ':' + actionable[si].factor] = true;
    }
    if (ctx.profiles) {
      var profileCodes = Object.keys(ctx.profiles);
      for (var pi = 0; pi < profileCodes.length; pi++) {
        var pCode = profileCodes[pi];
        var prof = ctx.profiles[pCode];
        if (!prof || !prof.managementAction) continue;
        if (prof.managementAction === 'Мониторинг в штатном режиме') continue;
        if (seenGrbs[pCode + ':статус'] || seenGrbs[pCode + ':доля_ЕП']) continue;
        // Определяем severity по профилю
        var profSev = 'СРЕДНЯЯ';
        if (prof.riskLevel === 'КРИТИЧЕСКИЙ' || prof.overallStatus === 'КРИТИЧЕСКИЙ') profSev = 'КРИТИЧЕСКАЯ';
        else if (prof.riskLevel === 'ВЫСОКИЙ' || prof.overallStatus === 'ОТСТАЮЩИЙ') profSev = 'ВЫСОКАЯ';
        actionable.push(createInsight_(
          pCode, 'профиль', profSev,
          pCode + ': ' + (DOMINANT_FACTOR_LABELS_[prof.dominantFactor] || prof.dominantFactor || 'требует внимания'),
          '', prof.managementAction, 'ПРОФИЛЬ', ''
        ));
      }
    }

    // Дедупликация по ГРБС + первые 60 символов action
    var seenActions = {};
    var deduped = [];
    for (var di = 0; di < actionable.length; di++) {
      var aKey = (actionable[di].grbs || '') + ':' + (actionable[di].action || '').substring(0, 60);
      if (!seenActions[aKey]) {
        seenActions[aKey] = true;
        deduped.push(actionable[di]);
      }
    }
    actionable = deduped;

    if (actionable.length === 0) {
      lines.push('Адресных рекомендаций на текущий момент нет. Процессы идут в плановом режиме.');
      return lines.join('\n');
    }

    // Группируем по приоритету:
    // СРОЧНЫЕ = КРИТИЧЕСКАЯ, ОПЕРАТИВНЫЕ = ВЫСОКАЯ, ПЛАНОВЫЕ = СРЕДНЯЯ + ИНФОРМАЦИЯ
    var urgent = [];
    var operational = [];
    var planned = [];

    for (var j = 0; j < actionable.length; j++) {
      var sev = actionable[j].severity;
      if (sev === 'КРИТИЧЕСКАЯ') urgent.push(actionable[j]);
      else if (sev === 'ВЫСОКАЯ') operational.push(actionable[j]);
      else planned.push(actionable[j]);
    }

    var counter = 1;

    // Вспомогательная функция: вывод одной рекомендации с Факт/Обоснование/Основание
    var pushRec = function(item, num) {
      lines.push('  ' + num + '. ' + item.action +
        (item.grbs !== 'ВСЕ' ? ' \u2014 ' + item.grbs : ''));
      if (item.fact) {
        lines.push('     Факт: ' + item.fact);
      }
      if (item.interpretation) {
        lines.push('     Обоснование: ' + item.interpretation);
      }
      if (item.law) {
        lines.push('     Основание: ' + item.law);
      }
    };

    if (urgent.length > 0) {
      lines.push('');
      lines.push('СРОЧНЫЕ:');
      for (var u = 0; u < urgent.length; u++) {
        pushRec(urgent[u], counter);
        counter++;
      }
    }

    if (operational.length > 0) {
      lines.push('');
      lines.push('ОПЕРАТИВНЫЕ:');
      for (var o = 0; o < operational.length; o++) {
        pushRec(operational[o], counter);
        counter++;
      }
    }

    if (planned.length > 0) {
      lines.push('');
      lines.push('ПЛАНОВЫЕ:');
      for (var p = 0; p < planned.length; p++) {
        pushRec(planned[p], counter);
        counter++;
      }
    }

    return lines.join('\n');
  } catch (e) {
    return '\u2550\u2550\u2550 9. РЕКОМЕНДАЦИИ \u2550\u2550\u2550\n[Ошибка: ' + e.message + ']';
  }
}


// ---------------------------------------------------------------------------
// РАЗДЕЛ 10: АНТИКОРРУПЦИОННЫЙ МОНИТОРИНГ
// ---------------------------------------------------------------------------

/**
 * Выводится ТОЛЬКО при наличии индикаторов: дробление, сговор, конфликт интересов.
 * Каждый индикатор сопровождается «ТРЕБУЕТ ПРОВЕРКИ» — это не обвинение.
 * Возвращает null, если индикаторов нет.
 */
function renderAntiCorruptionNarrative_(ctx) {
  try {
    var acInsights = [];
    var insights = ctx._insights || [];

    // Собираем индикаторы из тезисов
    for (var i = 0; i < insights.length; i++) {
      var factor = (insights[i].factor || '').toLowerCase();
      if (factor.indexOf('дроблени') >= 0 ||
          factor.indexOf('сговор') >= 0 ||
          factor.indexOf('коррупци') >= 0 ||
          factor.indexOf('антикоррупци') >= 0) {
        acInsights.push(insights[i]);
      }
    }

    // Также проверяем complianceFlags на антикоррупционные индикаторы
    if (ctx.complianceFlags) {
      for (var j = 0; j < ctx.complianceFlags.length; j++) {
        var flag = ctx.complianceFlags[j];
        if (flag.type === 'splitting' || flag.type === 'collusion' || flag.type === 'дробление') {
          // Проверяем, не дублируется ли
          var isDup = false;
          for (var k = 0; k < acInsights.length; k++) {
            if (acInsights[k].grbs === flag.grbs &&
                (acInsights[k].fact || '').indexOf(flag.description || '???') >= 0) {
              isDup = true;
              break;
            }
          }
          if (!isDup) {
            acInsights.push(createInsight_(
              flag.grbs, 'антикоррупция', flag.severity || 'ВЫСОКАЯ',
              flag.description, flag.explanation, flag.recommendation,
              'СВОД', flag.lawReference
            ));
          }
        }
      }
    }

    if (acInsights.length === 0) return null;

    var lines = [];
    lines.push('\u2550\u2550\u2550 10. АНТИКОРРУПЦИОННЫЙ МОНИТОРИНГ \u2550\u2550\u2550');
    lines.push('Обнаружено ' + acInsights.length + ' индикаторов:');

    for (var m = 0; m < acInsights.length; m++) {
      var ac = acInsights[m];
      lines.push('');
      lines.push((m + 1) + '. ' + (ac.grbs !== 'ВСЕ' ? ac.grbs + ': ' : '') +
        ac.fact + ' \u2014 ТРЕБУЕТ ПРОВЕРКИ');
      if (ac.interpretation) lines.push('   ' + ac.interpretation);
      if (ac.law) lines.push('   Норма: ' + ac.law);
      if (ac.action) lines.push('   Действие: ' + ac.action);
    }

    // Перекрёстная таблица структурных рисков
    // Если: дробление_высокое И ЕП_критическая И экономия < 2% → структурный сигнал
    if (ctx.metrics && ctx.metrics.byGrbs && ctx.complianceFlags) {
      var structuralSignals = [];
      var grbsKeys = Object.keys(ctx.metrics.byGrbs);
      for (var si = 0; si < grbsKeys.length; si++) {
        var sCode = grbsKeys[si];
        var sm = ctx.metrics.byGrbs[sCode];
        var hasSplittingHigh = false, hasEpCritical = false, hasLowEconomy = false;

        // Проверяем дробление
        for (var fi = 0; fi < ctx.complianceFlags.length; fi++) {
          var fl = ctx.complianceFlags[fi];
          if (fl.grbs === sCode && fl.type === 'ДРОБЛЕНИЕ' && fl.severity === 'ВЫСОКАЯ') hasSplittingHigh = true;
          if (fl.grbs === sCode && fl.type === 'ПОРОГ' && fl.severity === 'ВЫСОКАЯ') hasEpCritical = true;
        }

        // Проверяем экономию < 2%
        var sEconPct = toNumber_(sm.economyPct || 0);
        if (sEconPct > 1) sEconPct = sEconPct / 100;
        if (sm.compEconomy && sm.compPlanSum && sm.compPlanSum > 0) {
          sEconPct = sm.compEconomy / sm.compPlanSum;
        }
        if (sEconPct < 0.02) hasLowEconomy = true;

        // Также проверяем долю ЕП как альтернативу hasEpCritical
        var sEpShare = toNumber_(sm.epShare || 0);
        if (sEpShare > 0.60) hasEpCritical = true;

        if (hasSplittingHigh && hasEpCritical && hasLowEconomy) {
          structuralSignals.push(sCode);
        }
      }

      if (structuralSignals.length > 0) {
        lines.push('');
        lines.push('  СТРУКТУРНЫЕ СИГНАЛЫ (перекрёстный анализ):');
        lines.push('  ' + repeatStr_('\u2500', 60));
        for (var ss = 0; ss < structuralSignals.length; ss++) {
          var ssCode = structuralSignals[ss];
          var ssm = ctx.metrics.byGrbs[ssCode];
          var ssEpShare = toNumber_(ssm.epShare || 0);
          var ssEconPct = toNumber_(ssm.economyPct || 0);
          if (ssEconPct > 1) ssEconPct = ssEconPct / 100;
          if (ssm.compEconomy && ssm.compPlanSum && ssm.compPlanSum > 0) {
            ssEconPct = ssm.compEconomy / ssm.compPlanSum;
          }
          lines.push('  ' + ssCode + ': высокий риск дробления + доля ЕП ' + fmtPct_(ssEpShare) +
            ' + экономия ' + fmtPct_(ssEconPct) + ' — СОВОКУПНОСТЬ ФАКТОРОВ ТРЕБУЕТ ПРОВЕРКИ');
          lines.push('    Рекомендация: комплексная проверка закупочной деятельности ' + ssCode +
            ' с привлечением контрольного органа (ст. 99 44-ФЗ)');
        }
      }
    }

    lines.push('');
    lines.push('Примечание: индикаторы носят информационный характер и не являются обвинением. ' +
      'Для подтверждения необходима дополнительная проверка.');

    return lines.join('\n');
  } catch (e) {
    return null;
  }
}


/**
 * Формирует нарративный раздел по централизации закупок и совместным процедурам.
 * Основание: ст. 25 44-ФЗ. Выводит сводку возможностей объединения закупок
 * между ГРБС и потенциальную экономию.
 * @param {Object} ctx — контекст конвейера
 * @return {string} — текстовый блок или пустая строка
 */
function renderCentralizationNarrative_(ctx) {
  try {
    var centrFlags = (ctx.complianceFlags || []).filter(function(f) { return f.type === 'ЦЕНТРАЛИЗАЦИЯ' || f.type === 'ЦЕНТРАЛИЗАЦИЯ_СВОДКА'; });
    if (centrFlags.length === 0) return '';

    var lines = [];
    lines.push('');
    lines.push('═══ 10. ЦЕНТРАЛИЗАЦИЯ ЗАКУПОК И СОВМЕСТНЫЕ ПРОЦЕДУРЫ ═══');
    lines.push('Основание: ст. 25 44-ФЗ');
    lines.push('');

    // Сводка
    var summary = centrFlags.filter(function(f) { return f.type === 'ЦЕНТРАЛИЗАЦИЯ_СВОДКА'; });
    if (summary.length > 0) {
      lines.push('  ' + summary[0].text);
      lines.push('');
    }

    // Детали по категориям
    var details = centrFlags.filter(function(f) { return f.type === 'ЦЕНТРАЛИЗАЦИЯ'; });
    if (details.length >= 3) {
      lines.push('  ВОЗМОЖНОСТИ ЦЕНТРАЛИЗАЦИИ:');
      lines.push('{{TBL:H}}№{{|}}Категория{{|}}ГРБС{{|}}Рекомендация');
      for (var i = 0; i < details.length; i++) {
        var d = details[i];
        lines.push('{{TBL:R}}' + (i + 1) + '{{|}}' +
          (d.text || '').substring(0, 80) + '{{|}}' +
          (d.grbs || '') + '{{|}}' +
          (d.action || ''));
      }
      lines.push('{{TBL:E}}');
    } else if (details.length > 0) {
      lines.push('  ВОЗМ��ЖНОСТИ ЦЕНТРАЛИЗАЦИИ:');
      for (var i = 0; i < details.length; i++) {
        var d = details[i];
        lines.push('  ' + (i + 1) + '. ' + d.text);
        if (d.interpretation) lines.push('     ' + d.interpretation);
        if (d.action) lines.push('     Рекомендация: ' + d.action);
        lines.push('');
      }
    }

    return lines.join('\n');
  } catch (e) {
    return '';
  }
}


// ---------------------------------------------------------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ФОРМАТИРОВАНИЯ
// ---------------------------------------------------------------------------

/**
 * Дополнение строки пробелами справа до заданной длины.
 * Нужно для выравнивания столбцов в текстовой таблице рейтинга.
 *
 * @param {string} str — исходная строка
 * @param {number} len — целевая длина
 * @returns {string}
 */
function padRight_(str, len) {
  str = String(str || '');
  while (str.length < len) str += ' ';
  return str;
}


/**
 * Повторение символа N раз — для горизонтальных линий.
 *
 * @param {string} ch — символ
 * @param {number} count — количество повторений
 * @returns {string}
 */
function repeatStr_(ch, count) {
  var result = '';
  for (var i = 0; i < count; i++) result += ch;
  return result;
}
// =============================================================================
// М14: СБОРКА И ВЫВОД (стадия 11 — финализация результатов)
// =============================================================================
// Создаёт Google Doc с текстом, записывает витрину в РАСЧЕТ,
// сохраняет пятничный срез в ИСТОРИЮ, обновляет КОНТЕКСТ.
// =============================================================================

/**
 * Стадия 11 конвейера: финальная сборка и фиксация результатов.
 * В зависимости от режима (БОЕВОЙ/ТЕСТОВЫЙ/ДЕМОНСТРАЦИЯ) выполняет разный набор действий.
 *
 * @param {Object} ctx — контекст конвейера (ss, reportType, mode, reportText, metrics и т.д.)
 */
function assembleOutput_(ctx) {
  try {
    var ss = ctx.ss;
    var mode = ctx.mode || 'ТЕСТОВЫЙ';

    // 1. ��апись витрины модели в РАСЧЕТ (всегда, для всех режимов)
    log_(ss, 'М14', 'РАСЧЕТ', 'Запись витрины модели...', null, 'ИНФО');
    writeRaschetSheet_(ss, ctx);

    // 2. Создание Google Doc (для БОЕВОЙ и ТЕСТОВЫЙ, но не ДЕМОНСТРАЦИЯ)
    if (mode === 'БОЕВОЙ' || mode === 'ТЕСТОВЫЙ') {
      log_(ss, 'М14', 'ДОКУМЕНТ', 'Создание Google Doc...', null, 'ИНФО');
      var reportDate = ctx.rawData ? ctx.rawData.report_date : new Date();
      var title = 'Отчёт по закупкам ' + fmtDate_(reportDate) +
        ' (' + ctx.reportType + ', ' + mode + ')';

      // Получаем ID папки из настроек (если задан)
      var folderId = null;
      if (ctx.humanContext && ctx.humanContext['output_folder_id']) {
        folderId = ctx.humanContext['output_folder_id'];
      }

      var docUrl = createRichGoogleDoc_(title, ctx.reportText || '', folderId);
      ctx.docUrl = docUrl;
      log_(ss, 'М14', 'ДОКУМЕНТ', 'Документ создан: ' + docUrl, null, 'ИНФО');
    }

    // 3. Сохранение пятничного среза в ИСТОРИЮ (только БОЕВОЙ + пятница)
    if (mode === 'БОЕВОЙ') {
      var today = new Date();
      if (isFriday_(today)) {
        log_(ss, 'М14', 'ИСТОРИЯ', 'Пятничный срез — сохранение...', null, 'ИНФО');
        saveWeeklySnapshot_(ss, ctx);
      } else {
        log_(ss, 'М14', 'ИСТОРИЯ', 'Не пятница — срез не сохраняется', null, 'ИНФО');
      }
    }

    // 4. Обновление автоматических столбцов КОНТЕКСТ (C-F)
    if (mode === 'БОЕВОЙ' || mode === 'ТЕСТОВЫЙ') {
      log_(ss, 'М14', 'КОНТЕКСТ', 'Обновление автостолбцов...', null, 'ИНФО');
      updateKontekstAutoColumns_(ss, ctx);
    }

  } catch (e) {
    log_(ss, 'М14', 'ОШИБКА', 'Ошибка при сборке: ' + e.message, { stack: e.stack }, 'ОШИБКА');
  }
}


/**
 * Создание Google Doc с богатым форматированием.
 * Парсит текст с маркерами {{TBL:*}}, заголовками ═══, ▎ и т.д.
 * Применяет дизайнерские шрифты, настоящие таблицы, цвета, отступы.
 *
 * @param {string} title — название документа
 * @param {string} text — текст отчёта с маркерами
 * @param {string} [folderId] — ID папки на Google Drive
 * @returns {string} — URL созданного документа
 */
function createRichGoogleDoc_(title, text, folderId) {
  try {
    var doc = DocumentApp.create(title);
    var body = doc.getBody();

    // Настройка полей документа (мм → пт)
    body.setMarginTop(36);
    body.setMarginBottom(36);
    body.setMarginLeft(50);
    body.setMarginRight(42);

    var lines = (text || '').split('\n');
    var i = 0;
    var emptyLineCount = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = (line || '').trim();

      // --- Табличный маркер: собираем блок ---
      if (trimmed.indexOf('{{TBL:H}}') === 0) {
        var headerCols = trimmed.replace('{{TBL:H}}', '').split('{{|}}');
        var dataRows = [];
        i++;
        while (i < lines.length) {
          var tl = (lines[i] || '').trim();
          if (tl.indexOf('{{TBL:E}}') === 0) { i++; break; }
          if (tl.indexOf('{{TBL:R}}') === 0) {
            dataRows.push(tl.replace('{{TBL:R}}', '').split('{{|}}'));
          }
          i++;
        }
        insertRichTable_(body, headerCols, dataRows);
        emptyLineCount = 0;
        continue;
      }

      // --- Пустая строка: не более 1 подряд ---
      if (!trimmed) {
        emptyLineCount++;
        if (emptyLineCount <= 1) {
          var spacer = body.appendParagraph('');
          spacer.setFontSize(4);
          spacer.setSpacingBefore(0);
          spacer.setSpacingAfter(0);
        }
        i++;
        continue;
      }
      emptyLineCount = 0;

      // --- Определяем тип строки ---
      var para;

      // ТИТУЛ: АНАЛИТИЧЕСКИЙ ОТЧЁТ / ОТЧЕТ ПО ЗАКУПКАМ
      if (/^(═══\s*АНАЛИТИЧЕСКИЙ|АНАЛИТИЧЕСКИЙ ОТЧЁТ|ОТЧЕТ ПО ЗАКУПКАМ)/.test(trimmed)) {
        var titleText = trimmed.replace(/^═+\s*/, '').replace(/\s*═+$/, '').trim();
        para = body.appendParagraph(titleText);
        para.setHeading(DocumentApp.ParagraphHeading.TITLE);
        para.setFontFamily(DOC_STYLE_.FONT_TITLE);
        para.setFontSize(DOC_STYLE_.SIZE_TITLE);
        para.setForegroundColor(DOC_STYLE_.COLOR_H1);
        para.setBold(true);
        para.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        para.setSpacingAfter(DOC_STYLE_.SPACING_SECTION);
        i++;
        continue;
      }

      // H1: ═══ N. СЕКЦИЯ ═══
      if (/^═══/.test(trimmed)) {
        var h1Text = trimmed.replace(/^═+\s*/, '').replace(/\s*═+$/, '').trim();
        para = body.appendParagraph(h1Text);
        para.setHeading(DocumentApp.ParagraphHeading.HEADING1);
        para.setFontFamily(DOC_STYLE_.FONT_HEADING);
        para.setFontSize(DOC_STYLE_.SIZE_H1);
        para.setForegroundColor(DOC_STYLE_.COLOR_H1);
        para.setBold(true);
        para.setSpacingBefore(DOC_STYLE_.SPACING_SECTION);
        para.setSpacingAfter(DOC_STYLE_.SPACING_AFTER_H1);
        i++;
        continue;
      }

      // H3: ▎ ГРБС Name (перед H2, т.к. ▎ более специфичен)
      if (/^▎/.test(trimmed)) {
        para = body.appendParagraph(trimmed);
        para.setHeading(DocumentApp.ParagraphHeading.HEADING3);
        para.setFontFamily(DOC_STYLE_.FONT_HEADING);
        para.setFontSize(DOC_STYLE_.SIZE_H3);
        para.setForegroundColor(DOC_STYLE_.COLOR_H3);
        para.setBold(true);
        para.setSpacingBefore(DOC_STYLE_.SPACING_AFTER_H1);
        para.setSpacingAfter(DOC_STYLE_.SPACING_AFTER_H2);
        i++;
        continue;
      }

      // H2: --- подзаголовок --- или ключевые слова
      if (/^---\s*.+\s*---$/.test(trimmed) || isReportSubHeading_(line)) {
        var h2Text = trimmed.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim();
        para = body.appendParagraph(h2Text);
        para.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        para.setFontFamily(DOC_STYLE_.FONT_HEADING);
        para.setFontSize(DOC_STYLE_.SIZE_H2);
        para.setForegroundColor(DOC_STYLE_.COLOR_H2);
        para.setBold(true);
        para.setSpacingBefore(DOC_STYLE_.SPACING_AFTER_H1);
        para.setSpacingAfter(DOC_STYLE_.SPACING_AFTER_H2);
        i++;
        continue;
      }

      // Горизонтальные линии (─── или ═══ оставшиеся) — тонкий разделитель
      if (/^[─━═]{5,}$/.test(trimmed)) {
        para = body.appendParagraph('');
        para.setFontSize(2);
        para.setSpacingBefore(4);
        para.setSpacingAfter(4);
        i++;
        continue;
      }

      // «ВСЕ ГРБС» — особый стиль
      if (trimmed === 'ВСЕ ГРБС') {
        para = body.appendParagraph(trimmed);
        para.setFontFamily(DOC_STYLE_.FONT_HEADING);
        para.setFontSize(DOC_STYLE_.SIZE_H2);
        para.setForegroundColor(DOC_STYLE_.COLOR_H2);
        para.setBold(true);
        para.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        para.setSpacingAfter(DOC_STYLE_.SPACING_AFTER_H2);
        i++;
        continue;
      }

      // --- Обычный текст ---
      para = body.appendParagraph(line);
      para.setFontFamily(DOC_STYLE_.FONT_BODY);
      para.setFontSize(DOC_STYLE_.SIZE_BODY);
      para.setSpacingAfter(DOC_STYLE_.SPACING_BODY);

      // Определяем уровень отступа по пробелам
      var leadingSpaces = (line.match(/^( +)/) || ['', ''])[1].length;
      if (leadingSpaces >= 6) {
        para.setIndentStart(36);
        para.setFontSize(DOC_STYLE_.SIZE_SMALL);
        para.setForegroundColor(DOC_STYLE_.COLOR_MUTED);
      } else if (leadingSpaces >= 4) {
        para.setIndentStart(24);
      } else if (leadingSpaces >= 2) {
        para.setIndentStart(12);
      }

      // Нумерованные списки «  N. » — bold номер
      if (/^\s+\d+\.\s/.test(line)) {
        var numMatch = line.match(/(\d+\.)/);
        if (numMatch) {
          var numStart = line.indexOf(numMatch[1]);
          para.editAsText().setBold(numStart, numStart + numMatch[1].length - 1, true);
        }
      }

      // Inline цвета: ★ → зелёный, ⚠ → оранжевый, 🔴 → красный и т.д.
      applyInlineColors_(para);

      i++;
    }

    // Удаляем первый пустой параграф (Google Docs создаёт его автоматически)
    var firstChild = body.getChild(0);
    if (firstChild && firstChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var firstText = firstChild.asParagraph().getText();
      if (!firstText || firstText.trim() === '') {
        body.removeChild(firstChild);
      }
    }

    doc.saveAndClose();

    // Перемещаем в целевую папку
    if (folderId) {
      try {
        var file = DriveApp.getFileById(doc.getId());
        var folder = DriveApp.getFolderById(folderId);
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (moveErr) {
        console.log('Не удалось переместить документ в папку: ' + moveErr.message);
      }
    }

    return doc.getUrl();
  } catch (e) {
    // Fallback на простой рендеринг
    console.log('Ошибка createRichGoogleDoc_: ' + e.message + ', fallback на plain');
    return createPlainGoogleDoc_(title, text, folderId);
  }
}

/**
 * Вставка настоящей таблицы Google Doc с заголовком и чередованием строк.
 */
function insertRichTable_(body, headerCols, dataRows) {
  // appendTable() создаёт таблицу с одной пустой строкой — удалим её после
  var cells = [headerCols];
  for (var r = 0; r < dataRows.length; r++) {
    // Дополняем строки до нужного количества столбцов
    var row = dataRows[r];
    while (row.length < headerCols.length) row.push('');
    cells.push(row);
  }
  var table = body.appendTable(cells);

  // Стилизация заголовка
  var hRow = table.getRow(0);
  for (var c = 0; c < hRow.getNumCells(); c++) {
    var hCell = hRow.getCell(c);
    hCell.setBackgroundColor(DOC_STYLE_.COLOR_TBL_HEADER_BG);
    var hPara = hCell.getChild(0).asParagraph();
    hPara.setBold(true);
    hPara.setFontFamily(DOC_STYLE_.FONT_TABLE);
    hPara.setFontSize(DOC_STYLE_.SIZE_TABLE);
    hPara.setForegroundColor(DOC_STYLE_.COLOR_H1);
    hPara.setSpacingBefore(2);
    hPara.setSpacingAfter(2);
  }

  // Стилизация данных с чередованием фона
  for (var r = 1; r < table.getNumRows(); r++) {
    var dRow = table.getRow(r);
    var bgColor = (r % 2 === 0) ? DOC_STYLE_.COLOR_TBL_ALT_BG : null;
    for (var c = 0; c < dRow.getNumCells(); c++) {
      var dCell = dRow.getCell(c);
      if (bgColor) dCell.setBackgroundColor(bgColor);
      var dPara = dCell.getChild(0).asParagraph();
      dPara.setFontFamily(DOC_STYLE_.FONT_TABLE);
      dPara.setFontSize(DOC_STYLE_.SIZE_TABLE);
      dPara.setSpacingBefore(1);
      dPara.setSpacingAfter(1);

      // Цвет для ячеек с маркерами
      var cellText = dPara.getText();
      if (cellText.indexOf('\u2605') >= 0 || cellText.indexOf('\uD83D\uDFE2') >= 0) {
        dPara.setForegroundColor(DOC_STYLE_.COLOR_OK);
      } else if (cellText.indexOf('\u26A0') >= 0 || cellText.indexOf('\uD83D\uDFE1') >= 0) {
        dPara.setForegroundColor(DOC_STYLE_.COLOR_WARN);
      } else if (cellText.indexOf('\uD83D\uDD34') >= 0 || cellText.indexOf('срыв') >= 0) {
        dPara.setForegroundColor(DOC_STYLE_.COLOR_CRIT);
      }
    }
  }

  // Отступ после таблицы
  var spacer = body.appendParagraph('');
  spacer.setFontSize(4);
  spacer.setSpacingBefore(0);
  spacer.setSpacingAfter(4);
}

/**
 * Применяет цвета к inline-маркерам (★, ⚠, ТРЕБУЕТ ПРОВЕРКИ и т.д.)
 */
function applyInlineColors_(para) {
  try {
    var text = para.editAsText();
    var content = para.getText();
    if (!content) return;

    var colorRules = [
      { pattern: '\u2605', color: DOC_STYLE_.COLOR_OK, len: 1 },
      { pattern: '\u26A0', color: DOC_STYLE_.COLOR_WARN, len: 1 },
      { pattern: '\uD83D\uDFE2', color: DOC_STYLE_.COLOR_OK, len: 2 },
      { pattern: '\uD83D\uDFE1', color: DOC_STYLE_.COLOR_WARN, len: 2 },
      { pattern: '\uD83D\uDD34', color: DOC_STYLE_.COLOR_CRIT, len: 2 }
    ];

    for (var r = 0; r < colorRules.length; r++) {
      var rule = colorRules[r];
      var idx = content.indexOf(rule.pattern);
      while (idx >= 0) {
        // Красим от маркера до конца фразы (max 30 символов)
        var end = Math.min(idx + rule.len + 30, content.length) - 1;
        // Ищем конец фразы (точка, запятая, перенос)
        for (var e = idx + rule.len; e < content.length && e <= idx + 40; e++) {
          var ch = content.charAt(e);
          if (ch === '.' || ch === ',' || ch === ';' || ch === '\n') { end = e - 1; break; }
        }
        text.setForegroundColor(idx, end, rule.color);
        idx = content.indexOf(rule.pattern, idx + rule.len);
      }
    }

    // «ТРЕБУЕТ ПРОВЕРКИ» — оранжевый
    var reqIdx = content.indexOf('ТРЕБУЕТ ПРОВЕРКИ');
    while (reqIdx >= 0) {
      text.setForegroundColor(reqIdx, reqIdx + 'ТРЕБУЕТ ПРОВЕРКИ'.length - 1, DOC_STYLE_.COLOR_WARN);
      text.setBold(reqIdx, reqIdx + 'ТРЕБУЕТ ПРОВЕРКИ'.length - 1, true);
      reqIdx = content.indexOf('ТРЕБУЕТ ПРОВЕРКИ', reqIdx + 16);
    }

    // «КРИТИЧ» — красный
    var critIdx = content.indexOf('КРИТИЧ');
    while (critIdx >= 0) {
      var critEnd = Math.min(critIdx + 20, content.length) - 1;
      text.setForegroundColor(critIdx, critEnd, DOC_STYLE_.COLOR_CRIT);
      critIdx = content.indexOf('КРИТИЧ', critIdx + 6);
    }
  } catch (e) {
    // Не критично — просто без цветов
  }
}

/**
 * Fallback: простой рендеринг (старый createGoogleDoc_).
 */
function createPlainGoogleDoc_(title, text, folderId) {
  try {
    var doc = DocumentApp.create(title);
    var body = doc.getBody();

    var paragraphs = (text || '').split('\n');
    for (var i = 0; i < paragraphs.length; i++) {
      var line = paragraphs[i];
      // Пропускаем табличные маркеры при plain-рендеринге
      if (/^\{\{TBL:[HRE]\}\}/.test((line || '').trim())) {
        line = (line || '').replace(/\{\{TBL:[HRE]\}\}/g, '').replace(/\{\{\|\}\}/g, ' | ');
      }
      var para = body.appendParagraph(line);

      if (isReportHeading_(line)) {
        para.setBold(true);
        para.setFontSize(12);
      } else if (isReportSubHeading_(line)) {
        para.setBold(true);
        para.setFontSize(11);
      } else {
        para.setFontSize(10);
      }
    }

    var firstChild = body.getChild(0);
    if (firstChild && firstChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var firstText = firstChild.asParagraph().getText();
      if (!firstText || firstText.trim() === '') {
        body.removeChild(firstChild);
      }
    }

    doc.saveAndClose();

    if (folderId) {
      try {
        var file = DriveApp.getFileById(doc.getId());
        var folder = DriveApp.getFolderById(folderId);
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch (moveErr) {
        console.log('Не удалось переместить документ в папку: ' + moveErr.message);
      }
    }

    return doc.getUrl();
  } catch (e) {
    return '[Ошибка создания документа: ' + e.message + ']';
  }
}


/**
 * Проверка: является ли строка заголовком отчёта (верхний уровень).
 */
function isReportHeading_(line) {
  if (!line) return false;
  var trimmed = line.trim();
  return /^═══/.test(trimmed) ||
    trimmed === 'ВСЕ ГРБС' ||
    /^ОТЧЕТ ПО ЗАКУПКАМ/.test(trimmed) ||
    /^АНАЛИТИЧЕСКИЙ ОТЧЁТ/.test(trimmed) ||
    /^=== \d+\./.test(trimmed);
}

/**
 * Проверка: является ли строка подзаголовком (уровень секции).
 */
function isReportSubHeading_(line) {
  if (!line) return false;
  var trimmed = line.trim();
  return /^▎/.test(trimmed) ||
    trimmed === 'ПО КОНКУРЕНТНЫМ ПРОЦЕДУРАМ:' ||
    trimmed === 'ЕДИНСТВЕННЫЙ ПОСТАВЩИК:' ||
    trimmed === 'КОНКУРЕНТНЫЕ ПРОЦЕДУРЫ:' ||
    /^--- .+ ---$/.test(trimmed) ||
    /^=== .+ ===$/.test(trimmed) ||
    /АЕМР/.test(trimmed);
}


/**
 * Запись витрины модели в лист РАСЧЕТ.
 * Содержит: ключевые метрики, грейд доверия, классификации, аномалии.
 * Этот лист — «приборная панель» для оператора.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {Object} ctx — контекст конвейера
 */
function writeRaschetSheet_(ss, ctx) {
  try {
    var sheet = ss.getSheetByName(CFG_.SHEETS.RASCHET);
    if (!sheet) {
      sheet = ss.insertSheet(CFG_.SHEETS.RASCHET);
    }

    // Очищаем предыдущие данные
    sheet.clearContents();

    var g = ctx.metrics.global;
    var ts = ctx.trustScore || {};
    var rows = [];

    // Заголовок
    rows.push(['ВИТРИНА МОДЕЛИ', '', 'Дата формирования:', fmtDate_(new Date())]);
    rows.push(['']);

    // Блок 1: Доверие
    rows.push(['ДОВЕРИЕ К ДАННЫМ']);
    rows.push(['Грейд', ts.grade || '?', 'Балл', ts.total || 0]);
    rows.push(['']);

    // Блок 2: Глобальные метрики
    rows.push(['ГЛОБАЛЬНЫЕ МЕТРИКИ']);
    rows.push(['Показатель', 'План', 'Факт', 'Исполнение']);
    rows.push(['Конкурентные (год, кол-во)', g.allCompYearPlanCount, g.allCompYearFactCount,
      fmtPct_(calcPct_(g.allCompYearFactCount, g.allCompYearPlanCount))]);
    rows.push(['Конкурентные (год, сумма)', fmtMoney_(g.allCompYearPlanSum),
      fmtMoney_(g.allCompYearFactSum), fmtPct_(g.allCompYearExecPct)]);
    rows.push(['ЕП (год, кол-во)', g.allEpYearPlanCount, g.allEpYearFactCount, '']);
    rows.push(['ЕП (год, сумма)', fmtMoney_(g.allEpYearPlanSum), fmtMoney_(g.allEpYearFactSum), '']);
    rows.push(['Экономия (год)', '', fmtMoney_(g.allCompYearEconomySum), '']);
    rows.push(['Доля ЕП', '', fmtPct_(g.allFactEpShare), '']);
    rows.push(['']);

    // Блок 3: Метрики по ГРБС
    rows.push(['МЕТРИКИ ПО ГРБС']);
    rows.push(['ГРБС', 'Испол. кв.%', 'Доля ЕП%', 'Экономия', 'Статус']);
    var allCodes = GRBS_ORDER_.concat(['УО']);
    for (var i = 0; i < allCodes.length; i++) {
      var code = allCodes[i];
      var gm = ctx.metrics.byGrbs[code];
      if (!gm) continue;

      var execPctQ = gm.compPlanCountQ > 0 ? (gm.compFactCountQ / gm.compPlanCountQ) : null;
      var status = '';
      if (ctx.profiles && ctx.profiles[code]) {
        status = ctx.profiles[code].overallStatus || '';
      }
      rows.push([code, fmtPct_(execPctQ), fmtPct_(gm.epShare),
        fmtMoney_(gm.compEconomy), status]);
    }
    rows.push(['']);

    // Блок 4: Аномалии
    if (ctx.anomalies && ctx.anomalies.length > 0) {
      rows.push(['АНОМАЛИИ (' + ctx.anomalies.length + ')']);
      rows.push(['ГРБС', 'Тип', 'Серьёзность', 'Описание']);
      var maxAnoms = Math.min(ctx.anomalies.length, 20);
      for (var j = 0; j < maxAnoms; j++) {
        var a = ctx.anomalies[j];
        rows.push([a.grbs || '', a.type || '', a.severity || '', a.description || '']);
      }
    }

    // Записываем всё одним вызовом (оптимизация: меньше обращений к API)
    if (rows.length > 0) {
      // Определяем максимальную ширину строки
      var maxCols = 1;
      for (var r = 0; r < rows.length; r++) {
        if (Array.isArray(rows[r]) && rows[r].length > maxCols) {
          maxCols = rows[r].length;
        }
      }
      // Нормализуем ширину всех строк
      for (var rr = 0; rr < rows.length; rr++) {
        if (!Array.isArray(rows[rr])) rows[rr] = [rows[rr]];
        while (rows[rr].length < maxCols) rows[rr].push('');
      }

      sheet.getRange(1, 1, rows.length, maxCols).setValues(rows);
    }

    // Форматирование заголовков
    try {
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
      sheet.setColumnWidth(1, 250);
      sheet.setColumnWidth(2, 150);
      sheet.setColumnWidth(3, 150);
      sheet.setColumnWidth(4, 150);
    } catch (fmtErr) {
      // Форматирование необязательно — не блокируем работу
    }

  } catch (e) {
    log_(ss, 'М14', 'РАСЧЕТ', 'Ошибка записи: ' + e.message, null, 'ОШИБКА');
  }
}


/**
 * Сохранение пятничного среза в лист ИСТОРИЯ.
 * Каждая строка — один срез: дата + глобальные метрики + метрики по ГРБС.
 * Используется для анализа динамики (М7) и прогнозирования.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {Object} ctx — контекст конвейера
 */
function saveWeeklySnapshot_(ss, ctx) {
  try {
    var sheet = ss.getSheetByName(CFG_.SHEETS.HISTORY);
    if (!sheet) {
      sheet = ss.insertSheet(CFG_.SHEETS.HISTORY);
      // Заголовки для нового листа
      var headers = ['Дата', 'Конкур.план', 'Конкур.факт', 'Конкур.испол%',
        'ЕП.план', 'ЕП.факт', 'Экономия', 'Доля ЕП'];
      // Добавляем столбцы для каждого ГРБС
      var allCodes = GRBS_ORDER_.concat(['УО']);
      for (var i = 0; i < allCodes.length; i++) {
        headers.push(allCodes[i] + ' испол%');
        headers.push(allCodes[i] + ' ЕП%');
      }
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    var g = ctx.metrics.global;
    var row = [
      new Date(),
      g.allCompYearPlanCount,
      g.allCompYearFactCount,
      g.allCompYearExecPct,
      g.allEpYearPlanCount,
      g.allEpYearFactCount,
      g.allCompYearEconomySum,
      g.allFactEpShare
    ];

    // Метрики по каждому ГРБС
    var allCodes2 = GRBS_ORDER_.concat(['УО']);
    for (var j = 0; j < allCodes2.length; j++) {
      var code = allCodes2[j];
      var gm = ctx.metrics.byGrbs[code];
      if (gm) {
        var execPctQ = gm.compPlanCountQ > 0 ? (gm.compFactCountQ / gm.compPlanCountQ) : null;
        row.push(execPctQ);
        row.push(gm.epShare);
      } else {
        row.push(null);
        row.push(null);
      }
    }

    sheet.appendRow(row);
    log_(ss, 'М14', 'ИСТОРИЯ', 'Срез сохранён (' + row.length + ' столбцов)', null, 'ИНФО');
  } catch (e) {
    log_(ss, 'М14', 'ИСТОРИЯ', 'Ошибка сохранения среза: ' + e.message, null, 'ОШИБКА');
  }
}


/**
 * Обновление автоматических столбцов в листе КОНТЕКСТ (C-F).
 * Эти столбцы заполняются системой: текущие значения метрик,
 * отклонения от нормы, статус ГРБС.
 *
 * @param {Spreadsheet} ss — объект таблицы
 * @param {Object} ctx — контекст конвейера
 */
function updateKontekstAutoColumns_(ss, ctx) {
  try {
    var sheet = ss.getSheetByName(CFG_.SHEETS.KONTEKST);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;

    // Ищем строки ГРБС по первому столбцу (код ГРБС)
    for (var r = 1; r < data.length; r++) {
      var code = normalizeString_(data[r][0]);
      if (!code) continue;

      var gm = ctx.metrics.byGrbs[code];
      if (!gm) continue;

      var execPctQ = gm.compPlanCountQ > 0 ? (gm.compFactCountQ / gm.compPlanCountQ) : null;

      // Столбец C (3): текущее исполнение квартала
      sheet.getRange(r + 1, 3).setValue(execPctQ !== null ? fmtPct_(execPctQ) : '—');

      // Столбец D (4): доля ЕП
      sheet.getRange(r + 1, 4).setValue(gm.epShare !== null ? fmtPct_(gm.epShare) : '—');

      // Столбец E (5): экономия
      sheet.getRange(r + 1, 5).setValue(gm.compEconomy > 0 ? fmtMoney_(gm.compEconomy) : '—');

      // Столбец F (6): статус из профиля
      var status = '';
      if (ctx.profiles && ctx.profiles[code]) {
        status = ctx.profiles[code].overallStatus || '';
      }
      sheet.getRange(r + 1, 6).setValue(status);
    }
  } catch (e) {
    log_(ss, 'М14', 'КОНТЕКСТ', 'Ошибка обновления автостолбцов: ' + e.message, null, 'ОШИБКА');
  }
}


/**
 * Настройка всех служебных листов — создаёт отсутствующие, форматирует.
 * Вызывается из меню «Настроить листы» или при первом запуске.
 *
 * @param {Spreadsheet} ss — объект таблицы
 */
function setupAllSheets_(ss) {
  try {
    setupKontekstSheet_(ss);
    setupSpravkaSheet_(ss);
    setupRaschetSheet_(ss);
    setupHistorySheet_(ss);
    setupOtladkaSheet_(ss);
  } catch (e) {
    console.log('Ошибка настройки листов: ' + e.message);
  }
}


/**
 * Настройка листа КОНТЕКСТ — основной интерфейс оператора.
 * Столбцы A-B заполняются вручную, C-F обновляются автоматически.
 * Защита автостолбцов от случайного редактирования.
 */
function setupKontekstSheet_(ss) {
  try {
    var sheetName = CFG_.SHEETS.KONTEKST;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // Проверяем, есть ли уже заголовки (не перезаписываем данные оператора)
    var firstCell = sheet.getRange('A1').getValue();
    if (firstCell && normalizeString_(firstCell).length > 0) return;

    // Заголовки
    var headers = ['Код ГРБС', 'Контекст (ручной ввод)', 'Испол. кв.%',
      'Доля ЕП%', 'Экономия', 'Статус'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

    // Заполняем коды ГРБС
    var allCodes = GRBS_ORDER_.concat(['УО']);
    for (var i = 0; i < allCodes.length; i++) {
      sheet.getRange(i + 2, 1).setValue(allCodes[i]);
    }

    // Цвета: автостолбцы (C-F) серым фоном
    try {
      sheet.getRange(1, 3, allCodes.length + 1, 4).setBackground('#f0f0f0');
      sheet.setColumnWidth(1, 100);
      sheet.setColumnWidth(2, 400);
      sheet.setColumnWidth(3, 120);
      sheet.setColumnWidth(4, 100);
      sheet.setColumnWidth(5, 150);
      sheet.setColumnWidth(6, 120);
    } catch (styleErr) {
      // Стили необязательны
    }
  } catch (e) {
    console.log('Ошибка настройки КОНТЕКСТ: ' + e.message);
  }
}


/**
 * Настройка листа СПРАВКА — встроенная инструкция для пользователя.
 * Содержит описание системы, листов, полей, FAQ.
 */
function setupSpravkaSheet_(ss) {
  try {
    var sheetName = CFG_.SHEETS.SPRAVKA;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    var firstCell = sheet.getRange('A1').getValue();
    if (firstCell && normalizeString_(firstCell).length > 0) return;

    var help = [
      ['СПРАВКА ПО СИСТЕМЕ ГЕНЕРАЦИИ ОТЧЁТОВ'],
      [''],
      ['Версия: ' + CFG_.VERSION],
      [''],
      ['=== ЛИСТЫ ==='],
      ['СВОД ТД-ПМ — исходные данные (план-факт по всем ГРБС). Заполняется из внешнего источника.'],
      ['КОНТЕКСТ — ручной ввод оператора. Столбец B: комментарии, контекст, пояснения по каждому ГРБС.'],
      ['РАСЧЕТ — витрина расчётной модели. Заполняется автоматически при каждом запуске.'],
      ['ИСТОРИЯ — пятничные срезы метрик. Используется для анализа динамики.'],
      ['ОТЛАДКА — лог событий. Очищается при каждом запуске.'],
      ['СПРАВКА — этот лист.'],
      [''],
      ['=== МЕНЮ «ЗАКУПКИ» ==='],
      ['Типовой отчёт (ТЕСТОВЫЙ) — формирует отчёт без записи в ИСТОРИЮ. Для проверки.'],
      ['Типовой отчёт (БОЕВОЙ) — формирует отчёт + сохраняет срез (по пятницам).'],
      ['Умный отчёт (ТЕСТОВЫЙ) — аналитический отчёт без записи в ИСТОРИЮ.'],
      ['Умный отчёт (БОЕВОЙ) — аналитический отчёт + срез + Google Doc.'],
      ['Демонстрация — запуск конвейера без создания документов (только РАСЧЕТ).'],
      [''],
      ['=== РЕЖИМЫ РАБОТЫ ==='],
      ['ТЕСТОВЫЙ — создаёт Google Doc, НЕ записывает в ИСТОРИЮ. Для проверки перед пятницей.'],
      ['БОЕВОЙ — создаёт Google Doc, записывает пятничный срез, обновляет КОНТЕКСТ.'],
      ['ДЕМОНСТРАЦИЯ — только расчёт, без создания документов и записи истории.'],
      [''],
      ['=== FAQ ==='],
      ['В: Что делать, если грейд доверия — D или F?'],
      ['О: Проверьте лист СВОД ТД-ПМ на наличие пропущенных или аномальных значений.'],
      [''],
      ['В: Почему срез не сохраняется?'],
      ['О: Срез сохраняется только в режиме БОЕВОЙ и только по пятницам.'],
      ['   Используйте «Принудительно сохранить срез» для ручного сохранения.']
    ];

    sheet.getRange(1, 1, help.length, 1).setValues(help);
    sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
    sheet.setColumnWidth(1, 800);
  } catch (e) {
    console.log('Ошибка настройки СПРАВКА: ' + e.message);
  }
}


/**
 * Настройка листа РАСЧЕТ — создание с заголовком (данные заполняются при запуске).
 */
function setupRaschetSheet_(ss) {
  try {
    var sheetName = CFG_.SHEETS.RASCHET;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange('A1').setValue('ВИТРИНА МОДЕЛИ').setFontWeight('bold');
      sheet.getRange('A2').setValue('Данные появятся после первого запуска конвейера.');
    }
  } catch (e) {
    console.log('Ошибка настройки РАСЧЕТ: ' + e.message);
  }
}


/**
 * Настройка листа ИСТОРИЯ — создание с заголовками.
 */
function setupHistorySheet_(ss) {
  try {
    var sheetName = CFG_.SHEETS.HISTORY;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      var headers = ['Дата', 'Конкур.план', 'Конкур.факт', 'Конкур.испол%',
        'ЕП.план', 'ЕП.факт', 'Экономия', 'Доля ЕП'];
      var allCodes = GRBS_ORDER_.concat(['УО']);
      for (var i = 0; i < allCodes.length; i++) {
        headers.push(allCodes[i] + ' испол%');
        headers.push(allCodes[i] + ' ЕП%');
      }
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  } catch (e) {
    console.log('Ошибка настройки ИСТОРИЯ: ' + e.message);
  }
}


/**
 * Настройка листа ОТЛАДКА — создание с заголовками.
 */
function setupOtladkaSheet_(ss) {
  try {
    var sheetName = CFG_.SHEETS.OTLADKA;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(['Время', 'Модуль', 'Стадия', 'Сообщение', 'Данные', 'Серьёзность']);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
  } catch (e) {
    console.log('Ошибка настройки ОТЛАДКА: ' + e.message);
  }
}


// =============================================================================
// М1: ТОЧКИ ВХОДА И МЕНЮ
// =============================================================================
// Публичные функции, вызываемые из меню Google Sheets.
// Имена без подчёркивания — требование Google Apps Script для пунктов меню.
// =============================================================================

/**
 * Создание меню «Закупки» при открытии таблицы.
 * Вызывается автоматически триггером onOpen.
 * Порядок пунктов: типовой → умный → утилиты.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('Закупки')
      .addItem('Типовой отчёт (ТЕСТОВЫЙ)', 'runTemplateTest')
      .addItem('Типовой отчёт (БОЕВОЙ)', 'runTemplateOfficial')
      .addSeparator()
      .addItem('Умный отчёт (ТЕСТОВЫЙ)', 'runSmartTest')
      .addItem('Умный отчёт (БОЕВОЙ)', 'runSmartOfficial')
      .addSeparator()
      .addItem('Демонстрация', 'runDemo')
      .addSeparator()
      .addItem('Принудительно сохранить срез', 'forceSaveSnapshot')
      .addItem('Настроить листы', 'setupSheets')
      .addItem('Открыть справку', 'openHelp')
      .addToUi();
  } catch (e) {
    // onOpen не должен падать — это блокирует открытие таблицы
    console.log('Ошибка создания меню: ' + e.message);
  }
}


// === Публичные точки входа (без подчёркивания, чтобы GAS видел их в меню) ===

/** Типовой отчёт в тестовом режиме — для проверки перед боевым запуском */
function runTemplateTest() { runPipeline_('ТИПОВОЙ', 'ТЕСТОВЫЙ'); }

/** Типовой отчёт в боевом режиме — с записью истории и созданием документа */
function runTemplateOfficial() { runPipeline_('ТИПОВОЙ', 'БОЕВОЙ'); }

/** Умный отчёт в тестовом режиме */
function runSmartTest() { runPipeline_('УМНЫЙ', 'ТЕСТОВЫЙ'); }

/** Умный отчёт в боевом режиме */
function runSmartOfficial() { runPipeline_('УМНЫЙ', 'БОЕВОЙ'); }

/** Демонстрация — только расчёт, без документов */
function runDemo() { runPipeline_('УМНЫЙ', 'ДЕМОНСТРАЦИЯ'); }

/**
 * Принудительное сохранение среза — для ситуаций, когда нужен срез не в пятницу.
 * Запускает извлечение + метрики + запись в ИСТОРИЮ без генерации отчёта.
 */
function forceSaveSnapshot() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ui = SpreadsheetApp.getUi();

    log_(ss, 'М1', 'СТАРТ', 'Принудительное сохранение среза', null, 'ИНФО');

    // Извлечение данных
    var extracted = extractData_(ss);

    // Метрики
    var metrics = buildMetrics_(extracted.rawData, extracted.grbsRows);

    // Формируем минимальный контекст для saveWeeklySnapshot_
    var ctx = {
      ss: ss,
      rawData: extracted.rawData,
      grbsRows: extracted.grbsRows,
      metrics: metrics,
      mode: 'БОЕВОЙ'
    };

    // Сохраняем срез
    saveWeeklySnapshot_(ss, ctx);

    log_(ss, 'М1', 'ГОТОВО', 'Срез сохранён принудительно', null, 'ИНФО');
    ui.alert('Срез сохранён в лист ИСТОРИЯ.');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Ошибка сохранения среза: ' + e.message);
  }
}

/**
 * Настройка всех служебных листов — создаёт недостающие, форматирует.
 */
function setupSheets() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    setupAllSheets_(ss);
    SpreadsheetApp.getUi().alert('Листы настроены: КОНТЕКСТ, РАСЧЕТ, ИСТОРИЯ, ОТЛАДКА, СПРАВКА');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Ошибка настройки листов: ' + e.message);
  }
}

/**
 * Открытие справки — переключает активный лист на СПРАВКА.
 */
function openHelp() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CFG_.SHEETS.SPRAVKA);
    if (sheet) {
      SpreadsheetApp.setActiveSheet(sheet);
    } else {
      // Если справки нет — создаём и открываем
      setupSpravkaSheet_(ss);
      var newSheet = ss.getSheetByName(CFG_.SHEETS.SPRAVKA);
      if (newSheet) SpreadsheetApp.setActiveSheet(newSheet);
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('Ошибка открытия справки: ' + e.message);
  }
}


/**
 * Главный конвейер — 11 стадий обработки данных.
 * Последовательно вызывает все модули: извлечение → доверие → метрики →
 * контекст → динамика → аномалии → 44-ФЗ → классификация → профили → текст → сборка.
 *
 * @param {string} reportType — 'ТИПОВОЙ' или 'УМНЫЙ'
 * @param {string} mode — 'БОЕВОЙ', 'ТЕСТОВЫЙ' или 'ДЕМОНСТРАЦИЯ'
 */
function runPipeline_(reportType, mode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  try {
    // Очистка листа ОТЛАДКА перед каждым запуском — чтобы видеть только текущий прогон
    var otladkaSheet = ss.getSheetByName(CFG_.SHEETS.OTLADKA);
    if (otladkaSheet) otladkaSheet.clearContents();

    log_(ss, 'М1', 'СТАРТ', 'Запуск конвейера: ' + reportType + ' / ' + mode, null, 'ИНФО');

    var ctx = {
      ss: ss,
      reportType: reportType,  // 'ТИПОВОЙ' или 'УМНЫЙ'
      mode: mode,              // 'БОЕВОЙ', 'ТЕСТОВЫЙ', 'ДЕМОНСТРАЦИЯ'
      startTime: new Date()
    };

    // Стадия 1: Извлечение данных из СВОД ТД-ПМ
    log_(ss, 'М3', 'ИЗВЛЕЧЕНИЕ', 'Чтение данных из СВОД...', null, 'ИНФО');
    var extracted = extractData_(ss);
    ctx.rawData = extracted.rawData;
    ctx.grbsRows = extracted.grbsRows;
    if (extracted.issues.length > 0) {
      log_(ss, 'М3', 'ИЗВЛЕЧЕНИЕ', 'Проблемы при извлечении',
        { issues: extracted.issues }, 'ВНИМАНИЕ');
    }

    // Стадия 2: Скоринг доверия к данным — определяем, можно ли делать выводы
    log_(ss, 'М4', 'ДОВЕРИЕ', 'Оценка качества данных...', null, 'ИНФО');
    var prevSnap = null;
    try {
      prevSnap = readPreviousSnapshot_(ss);
    } catch (snapErr) {
      log_(ss, 'М4', 'ДОВЕРИЕ', 'Нет предыдущего среза — первый запуск?', null, 'ИНФО');
    }
    ctx.trustScore = scoreTrust_(ctx.rawData, ctx.grbsRows, prevSnap);
    log_(ss, 'М4', 'ДОВЕРИЕ', 'Грейд: ' + ctx.trustScore.grade +
      ' (' + ctx.trustScore.total + '/100)', null, 'ИНФО');

    // Если данные непригодны (грейд F) и режим БОЕВОЙ — запрашиваем подтверждение
    if (ctx.trustScore.grade === 'F' && mode === 'БОЕВОЙ') {
      var proceed = ui.alert(
        'Качество данных непригодное (грейд F). Продолжить?',
        ui.ButtonSet.YES_NO
      );
      if (proceed !== ui.Button.YES) {
        log_(ss, 'М1', 'ОТМЕНА', 'Пользователь отменил из-за грейда F', null, 'ИНФО');
        return;
      }
    }

    // Стадия 3: Метрики — вычисление всех показателей из сырых данных
    log_(ss, 'М5', 'МЕТРИКИ', 'Вычисление показателей...', null, 'ИНФО');
    ctx.metrics = buildMetrics_(ctx.rawData, ctx.grbsRows);

    // Стадия 4: Контекст — загрузка ручного ввода оператора и исторических данных
    log_(ss, 'М6', 'КОНТЕКСТ', 'Загрузка контекста и истории...', null, 'ИНФО');
    try {
      var contextData = loadContext_(ss, Object.keys(ctx.metrics.byGrbs));
      ctx.humanContext = contextData.humanContext;
      ctx.previousSnapshot = contextData.previousSnapshot;
    } catch (ctxErr) {
      log_(ss, 'М6', 'КОНТЕКСТ', 'Контекст недоступен: ' + ctxErr.message, null, 'ВНИМАНИЕ');
      ctx.humanContext = {};
      ctx.previousSnapshot = null;
    }

    // Стадия 5: Динамика — анализ трендов по историческим срезам
    log_(ss, 'М7', 'ДИНАМИКА', 'Анализ траекторий...', null, 'ИНФО');
    try {
      var snapshots = readHistoricalSnapshots_(ss, 10);
      ctx.dynamics = analyzeDynamics_(ctx.metrics, snapshots);
    } catch (dynErr) {
      log_(ss, 'М7', 'ДИНАМИКА', 'Динамика недоступна: ' + dynErr.message, null, 'ВНИМАНИЕ');
      ctx.dynamics = {};
    }

    // Стадия 6: Аномалии — поиск статистических выбросов и подозрительных паттернов
    log_(ss, 'М8', 'АНОМАЛИИ', 'Поиск аномалий...', null, 'ИНФО');
    try {
      ctx.anomalies = detectAnomalies_(ctx.metrics, ctx.dynamics, ctx.previousSnapshot);
    } catch (anomErr) {
      log_(ss, 'М8', 'АНОМАЛИИ', 'Ошибка: ' + anomErr.message, null, 'ВНИМАНИЕ');
      ctx.anomalies = [];
    }
    log_(ss, 'М8', 'АНОМАЛИИ', 'Обнаружено: ' + ctx.anomalies.length,
      null, ctx.anomalies.length > 0 ? 'ВНИМАНИЕ' : 'ИНФО');

    // Стадия 7: Проверка 44-ФЗ — поиск нарушений закона о контрактной системе
    log_(ss, 'М9', '44-ФЗ', 'Проверка соответствия...', null, 'ИНФО');
    try {
      ctx.complianceFlags = checkCompliance44FZ_(ctx.metrics, ctx.grbsRows);
    } catch (compErr) {
      log_(ss, 'М9', '44-ФЗ', 'Ошибка: ' + compErr.message, null, 'ВНИМАНИЕ');
      ctx.complianceFlags = [];
    }

    // Стадия 8: Классификация — определение категорий ГРБС по адаптивным порогам
    log_(ss, 'М10', 'КЛАССИФИКАЦИЯ', 'Адаптивные пороги...', null, 'ИНФО');
    try {
      var reportDate = ctx.rawData.report_date ? new Date(ctx.rawData.report_date) : new Date();
      ctx.classifications = classify_(ctx.metrics, reportDate);
    } catch (classErr) {
      log_(ss, 'М10', 'КЛАССИФИКАЦИЯ', 'Ошибка: ' + classErr.message, null, 'ВНИМАНИЕ');
      ctx.classifications = {};
    }

    // Стадия 9: Профилирование — построение комплексных профилей ГРБС
    log_(ss, 'М11', 'ПРОФИЛИ', 'Построение профилей ГРБС...', null, 'ИНФО');
    try {
      ctx.profiles = buildProfiles_(
        ctx.metrics, ctx.classifications, ctx.dynamics,
        ctx.anomalies, ctx.complianceFlags, ctx.humanContext
      );
    } catch (profErr) {
      log_(ss, 'М11', 'ПРОФИЛИ', 'Ошибка: ' + profErr.message, null, 'ВНИМАНИЕ');
      ctx.profiles = {};
    }

    // Стадия 10: Генерация текста отчёта — типовой или умный
    log_(ss, 'М12/М13', 'ТЕКСТ', 'Генерация ' + reportType + ' отчёта...', null, 'ИНФО');
    if (reportType === 'ТИПОВОЙ') {
      ctx.reportText = renderTemplateReport_(ctx);
    } else {
      ctx.reportText = renderSmartReport_(ctx);
    }

    // Стадия 11: Сборка и фиксация результатов
    log_(ss, 'М14', 'СБОРКА', 'Запись результатов...', null, 'ИНФО');
    assembleOutput_(ctx);

    // Финализация: замеряем время и уведомляем пользователя
    var elapsed = ((new Date() - ctx.startTime) / 1000).toFixed(1);
    log_(ss, 'М1', 'ГОТОВО', 'Конвейер завершён за ' + elapsed + ' сек.', null, 'ИНФО');

    if (mode !== 'ДЕМОНСТРАЦИЯ') {
      ui.alert('Отчёт сформирован! Тип: ' + reportType + ', режим: ' + mode +
        '. Время: ' + elapsed + ' сек.' +
        (ctx.docUrl ? '\n\nДокумент: ' + ctx.docUrl : ''));
    } else {
      ui.alert('Демонстрация завершена. Результаты — в листе РАСЧЕТ.');
    }

  } catch (e) {
    // Критическая ошибка конвейера — логируем и показываем пользователю
    log_(ss, 'М1', 'ОШИБКА', 'Критическая ошибка конвейера: ' + e.message,
      { stack: e.stack }, 'КРИТИЧЕСКАЯ');
    ui.alert('Ошибка при формировании отчёта:\n' + e.message +
      '\n\nПодробности — в листе ОТЛАДКА.');
  }
}
