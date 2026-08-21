/**
 * signal-answer.ts — единый дом «ответа сигнала» (долг Д10, канон п.119).
 *
 * Требование владельца, повторённое трижды: «я хотел бы увидеть ответ по
 * каждому из сработавших сигналов — в чём проблема». До этой правки такой
 * разбор был ровно у одного класса из карты сигналов — «строки листа не попали
 * в расчёт» (@aemr/core orchestrator.ts): его карточка называла адреса
 * отвергнутых строк и действие. Остальные классы показывали читателю имя,
 * счётчик и рекомендацию — и ни одной строки, по которой можно проверить.
 *
 * Ответ состоит из четырёх частей, и все четыре обязательны:
 *   1. КАКИЕ СТРОКИ — адрес книга!лист!строка плюс «№ п/п» (колонка A).
 *      Два адреса, а не один: позиционный номер устаревает, как только лист
 *      живёт (п.98б — «Опрессовка» была строкой 534, стала 155), «№ п/п»
 *      переживает перемещения.
 *   2. ЧТО В НИХ НЕ ТАК — значения спорных ячеек, названные по-человечески
 *      («Плановая дата: пусто», «Итого план: 1 250,00»), а не буквой колонки.
 *   3. ПОЧЕМУ ЭТО НАХОДКА — условие правила одной фразой без жаргона.
 *   4. ЧТО ДЕЛАТЬ — действие из паспорта проверки (CHECK_REGISTRY).
 *
 * Дом один. Тексты 3 и 4 берутся из словаря продукта и реестра проверок,
 * набор спорных ячеек — из таблицы ниже, сборка — функцией buildSignalAnswers.
 * Копия любого из четырёх кусков на стороне экрана запрещена: ровно так
 * разъехались шестнадцать имён классов (инвентаризация сигналов 20.08.2026).
 */

import { CHECK_REGISTRY } from './check-registry.js';
import { COL_LETTER_INDEX } from './column-map.js';
import { SVOD_SHEET_FIELDS } from './svod-sheet-names.js';
import { signalCardTitle } from './product-dictionary.js';
import type { Issue } from './types.js';

// ────────────────────────────────────────────────────────────
// 1. Геометрия листа и человеческие имена колонок
// ────────────────────────────────────────────────────────────

/**
 * Какого листа колонки называет проверка: рабочего листа управления или
 * официального листа «СВОД ТД-ПМ». Раскладки колонок у них разные, и одна
 * буква значит в них разное: K на листе управления — «Итого план» строки
 * закупки, на СВОДе — «Итого план» блока управления.
 */
export type SheetGeometry = 'dept' | 'svod';

/**
 * Человеческое имя колонки рабочего листа управления.
 *
 * Почему не DEPT_HEADER_LABELS (@aemr/shared column-map): там ДОСЛОВНАЯ
 * подпись шапки книги — «ФБ 1», «ИТОГО 2», «Планируемый». Она нужна стражу
 * геометрии, который ловит сдвиг колонки, и совершенно непригодна читателю:
 * начальница управления не обязана знать, что «ИТОГО 2» — это факт.
 */
export const DEPT_COLUMN_HUMAN_LABELS: Readonly<Record<string, string>> = {
  A: '№ п/п',
  B: 'Управление',
  C: 'Подведомственное учреждение',
  D: 'Программа',
  E: 'Подпрограмма',
  F: 'Вид деятельности',
  G: 'Предмет закупки',
  H: 'Федеральный бюджет, план',
  I: 'Краевой бюджет, план',
  J: 'Муниципальный бюджет, план',
  K: 'Итого план',
  L: 'Способ закупки',
  M: 'Обоснование единственного поставщика',
  N: 'Плановая дата',
  O: 'Квартал плана',
  P: 'Год плана',
  Q: 'Дата заключения',
  R: 'Квартал факта',
  S: 'Год факта',
  T: 'Отклонение, дни',
  U: 'Причина отклонения',
  V: 'Федеральный бюджет, факт',
  W: 'Краевой бюджет, факт',
  X: 'Муниципальный бюджет, факт',
  Y: 'Итого факт',
  Z: 'Экономия по федеральному бюджету',
  AA: 'Экономия по краевому бюджету',
  AB: 'Экономия по муниципальному бюджету',
  AC: 'Итого экономия',
  AD: 'Отметка «учитывать в расчёте экономии»',
  AE: 'Обоснование необходимости',
  AF: 'Примечание ГРБС',
  AG: 'Комментарий экономического управления',
  AH: 'Комментарий финансового управления',
};

/**
 * Человеческое имя колонки листа «СВОД ТД-ПМ» — выведено из имён самого листа
 * (SVOD_SHEET_FIELDS), а не написано заново. Подпись листа повторяется («ФБ»
 * стоит и в плане, и в факте, и в экономии), поэтому к ней добавляется группа
 * шапки — иначе три разные колонки назывались бы одинаково.
 */
export const SVOD_COLUMN_HUMAN_LABELS: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  const seen = new Map<string, number>();
  for (const field of Object.values(SVOD_SHEET_FIELDS)) {
    seen.set(field.sheetName, (seen.get(field.sheetName) ?? 0) + 1);
  }
  for (const field of Object.values(SVOD_SHEET_FIELDS)) {
    const ambiguous = (seen.get(field.sheetName) ?? 0) > 1;
    out[field.column] = ambiguous ? `${field.group}: ${field.sheetName}` : field.sheetName;
  }
  return out;
})();

/** Человеческое имя колонки по геометрии листа; неизвестная — сама буква. */
export function columnHumanLabel(column: string, geometry: SheetGeometry): string {
  const table = geometry === 'svod' ? SVOD_COLUMN_HUMAN_LABELS : DEPT_COLUMN_HUMAN_LABELS;
  return table[column] ?? column;
}

// ────────────────────────────────────────────────────────────
// 2. Правило ответа: условие человеческим языком + спорные ячейки
// ────────────────────────────────────────────────────────────

/** Правило ответа для одного класса находок. */
export interface SignalAnswerRule {
  /**
   * Почему правило считает это находкой — одной фразой, без буквенных
   * адресов и жаргона. Полное описание механизма живёт в паспорте проверки;
   * здесь — та фраза, которую читатель успевает прочесть у карточки.
   */
  condition: string;
  /** Буквы колонок, значения которых и есть предмет спора. */
  evidence: readonly string[];
  /** Чей это лист: управления или СВОД. */
  geometry: SheetGeometry;
}

/**
 * checkId → правило ответа. Один класс — одна запись; спорные колонки
 * перечислены в том порядке, в каком их читает человек, открывший книгу.
 *
 * Класса нет в таблице — ответ всё равно строится: показываются адрес строки
 * и та ячейка, на которую указала сама находка. Молчания не будет ни при
 * каком классе (канон п.119).
 */
export const SIGNAL_ANSWER_RULES: Readonly<Record<string, SignalAnswerRule>> = {
  // ── Сроки и даты ──
  plan_year_missing: {
    condition: 'способ и плановые деньги указаны, а рукописной плановой даты нет — и год плана пуст вслед за ней',
    evidence: ['L', 'K', 'N', 'P'],
    geometry: 'dept',
  },
  fact_quarter_missing: {
    condition: 'дата заключения проставлена, а планового квартала у строки нет',
    evidence: ['Q', 'N', 'O'],
    geometry: 'dept',
  },
  foreign_year_execution: {
    condition: 'договор заключён не в том году, на который планировалась закупка',
    evidence: ['N', 'P', 'Q', 'S'],
    geometry: 'dept',
  },
  overdue: {
    condition: 'плановая дата прошла, а договора всё нет',
    evidence: ['N', 'Q', 'L', 'K'],
    geometry: 'dept',
  },
  early_closure: {
    condition: 'договор заключён заметно раньше плановой даты',
    evidence: ['N', 'Q'],
    geometry: 'dept',
  },
  fact_date_before_plan: {
    condition: 'дата заключения раньше плановой даты закупки',
    evidence: ['N', 'Q'],
    geometry: 'dept',
  },
  future_fact_date: {
    condition: 'дата заключения стоит в будущем',
    evidence: ['Q'],
    geometry: 'dept',
  },
  fact_without_date: {
    condition: 'деньги по факту есть, а даты заключения нет — статья исполняется серией в течение года',
    evidence: ['L', 'Q', 'Y'],
    geometry: 'dept',
  },
  date_without_fact: {
    condition: 'дата заключения есть, а фактических денег по строке нет',
    evidence: ['Q', 'Y'],
    geometry: 'dept',
  },
  plan_without_execution: {
    condition: 'план назначен, а исполнения по строке не видно',
    evidence: ['K', 'N', 'Q', 'Y'],
    geometry: 'dept',
  },
  finance_delay: {
    condition: 'деньги доведены позже, чем планировалась закупка',
    evidence: ['N', 'Q', 'K'],
    geometry: 'dept',
  },

  // ── Деньги и экономия ──
  fact_vs_plan: {
    condition: 'фактическая сумма превышает плановую',
    evidence: ['K', 'Y'],
    geometry: 'dept',
  },
  ep_fact_deviation: {
    condition: 'закупка у единственного поставщика, а факт разошёлся с планом',
    evidence: ['L', 'K', 'Y'],
    geometry: 'dept',
  },
  economy_conflict: {
    condition: 'отметка об экономии и посчитанная экономия противоречат друг другу',
    evidence: ['K', 'Y', 'AC', 'AD'],
    geometry: 'dept',
  },
  economy_sign_check: {
    condition: 'экономия отрицательная: факт больше плана, а строка помечена экономией',
    evidence: ['K', 'Y', 'AC'],
    geometry: 'dept',
  },
  budget_sum_plan: {
    condition: 'итог плановой суммы не сходится с суммой по бюджетам',
    evidence: ['H', 'I', 'J', 'K'],
    geometry: 'dept',
  },
  dept_fact_sum: {
    condition: 'итог фактической суммы не сходится с суммой по бюджетам',
    evidence: ['V', 'W', 'X', 'Y'],
    geometry: 'dept',
  },
  dept_economy_sum: {
    condition: 'итог экономии не сходится с суммой по бюджетам',
    evidence: ['Z', 'AA', 'AB', 'AC'],
    geometry: 'dept',
  },
  budget_source_missing: {
    condition: 'деньги есть, а источник финансирования не назван',
    evidence: ['H', 'I', 'J', 'K'],
    geometry: 'dept',
  },
  budget_underallocation: {
    condition: 'доведено меньше, чем запланировано по строке',
    evidence: ['K', 'Y'],
    geometry: 'dept',
  },

  // ── Способ закупки и основания ──
  ep_risk: {
    condition: 'закупка у единственного поставщика дороже шестисот тысяч рублей',
    evidence: ['L', 'K', 'M'],
    geometry: 'dept',
  },
  ep_justification_missing: {
    condition: 'закупка у единственного поставщика без обоснования выбора',
    evidence: ['L', 'M'],
    geometry: 'dept',
  },
  method_reason_mismatch: {
    condition: 'названный способ закупки не сходится с написанным основанием',
    evidence: ['L', 'M'],
    geometry: 'dept',
  },
  unmapped_reason_ep: {
    condition: 'основание выбора поставщика не удалось отнести ни к одному известному виду',
    evidence: ['L', 'M'],
    geometry: 'dept',
  },
  method_validation: {
    condition: 'способ закупки записан вне перечня допустимых',
    evidence: ['L'],
    geometry: 'dept',
  },
  type_validation: {
    condition: 'вид деятельности записан вне перечня допустимых',
    evidence: ['F'],
    geometry: 'dept',
  },
  single_participant: {
    condition: 'на конкурентную процедуру пришёл один участник',
    evidence: ['L', 'K', 'Y'],
    geometry: 'dept',
  },
  low_competition: {
    condition: 'снижение цены на торгах близко к нулю',
    evidence: ['K', 'Y', 'L'],
    geometry: 'dept',
  },
  anti_dumping: {
    condition: 'цена упала настолько, что вступают антидемпинговые меры',
    evidence: ['K', 'Y'],
    geometry: 'dept',
  },
  initiative_request: {
    condition: 'строка помечена инициативной заявкой — заявленная потребность, а не утверждённый план',
    evidence: ['AF', 'K'],
    geometry: 'dept',
  },

  // ── Формулы и целостность листа ──
  formula_broken: {
    condition: 'формула в ячейке возвращает ошибку',
    evidence: ['K', 'O', 'P'],
    geometry: 'dept',
  },
  derived_formula_broken: {
    condition: 'рукописная дата на месте, а производная формула стёрта',
    evidence: ['N', 'O', 'P'],
    geometry: 'dept',
  },
  row_numbering: {
    condition: 'сквозная нумерация строк нарушена: номер повторяется либо ячейка пуста',
    evidence: ['A', 'G'],
    geometry: 'dept',
  },
  status_on_data_rows: {
    condition: 'служебная отметка стоит в строке с настоящими данными',
    evidence: ['A', 'G', 'K'],
    geometry: 'dept',
  },
  text_hygiene: {
    condition: 'в тексте ячейки невидимые символы, лишние пробелы или разнобой написания',
    evidence: ['C', 'G'],
    geometry: 'dept',
  },
  data_quality: {
    condition: 'значение ячейки не соответствует своему виду',
    evidence: ['G', 'K', 'L'],
    geometry: 'dept',
  },

  // ── Официальный лист ──
  budget_sum_fact: {
    condition: 'на официальном листе итог факта не сходится с суммой по бюджетам',
    evidence: ['L', 'M', 'N', 'O'],
    geometry: 'svod',
  },
  execution_percentage: {
    condition: 'на официальном листе процент исполнения не сходится с числами строки',
    evidence: ['D', 'E', 'G'],
    geometry: 'svod',
  },
  deviation_calc: {
    condition: 'на официальном листе отклонение посчитано не по своим слагаемым',
    evidence: ['D', 'E', 'F'],
    geometry: 'svod',
  },
  q1_leq_year: {
    condition: 'квартальное значение больше годового — на официальном листе так быть не может',
    evidence: ['D', 'E', 'K'],
    geometry: 'svod',
  },
};

// ────────────────────────────────────────────────────────────
// 3. Сборка ответа
// ────────────────────────────────────────────────────────────

/** Одна спорная ячейка строки в ответе. */
export interface SignalEvidenceCell {
  /** Буква колонки листа — второй адрес для того, кто открывает книгу. */
  column: string;
  /** Человеческое имя колонки. */
  label: string;
  /** Значение, как оно стоит в книге; пустая ячейка названа словом. */
  value: string;
}

/** Одна строка-основание ответа. */
export interface SignalAnswerRow {
  /** Книга (лист ГРБС). */
  sheet: string;
  /** Номер строки листа на момент чтения. */
  row: number | null;
  /** «№ п/п» из колонки A — адрес, переживающий перемещения строк. */
  rowSeq: string | null;
  /** Полный адрес одной строкой: «Лист!строка 128 (№ п/п 57)». */
  address: string;
  /** Значения спорных ячеек. */
  cells: SignalEvidenceCell[];
}

/** Ответ по одному сработавшему классу. */
export interface SignalAnswer {
  checkId: string;
  /** Имя класса — карточная форма из словаря продукта. */
  title: string;
  condition: string;
  whatToDo: string;
  /** Показанные строки-основания. */
  rows: SignalAnswerRow[];
  /** Сколько строк класса всего — показанные плюс скрытые. */
  totalRows: number;
  /** Почему ответ пуст, если он пуст. */
  emptyReason: string | null;
}

/** Сколько строк-оснований показывает карточка по умолчанию. */
export const SIGNAL_ANSWER_ROW_LIMIT = 10;

/** Строка книги для сборки ответа: значения ячеек по буквам колонок. */
export interface SignalAnswerSource {
  /** Замечания одного класса, уже отобранные вызывающей стороной. */
  issues: readonly Pick<Issue, 'checkId' | 'sheet' | 'row' | 'rowSeq' | 'cell'>[];
  /**
   * Чтение ячейки книги: лист, номер строки, буква колонки → значение как
   * оно стоит в книге. Возвращает `null`, когда строка не прочитана — это
   * отличается от пустой ячейки, и ответ скажет об этом словом.
   */
  readCell?: (sheet: string, row: number, column: string) => string | null;
}

/** Пустая ячейка называется словом: пробел в таблице читается как потеря. */
const EMPTY_CELL_WORD = 'пусто';
/** Строка не прочитана — это не то же, что пустая ячейка. */
const UNREAD_CELL_WORD = 'строка не прочитана';

/**
 * Собрать ответ по одному классу находок: какая строка, что в ней и почему.
 *
 * Требование владельца 21.08 дословно: «я хотел бы увидеть ответ по каждому из
 * сработавших сигналов в чём проблема». До этого карточка называла класс и
 * число строк, а человек шёл искать строки руками по трёхтысячной книге.
 *
 * Ответ строится ВСЕГДА, даже для класса, которого нет в таблице правил: тогда
 * условие берётся из паспорта проверки, а спорной считается та ячейка, на
 * которую указала сама находка. Молчания не бывает.
 */
export function buildSignalAnswer(
  checkId: string,
  source: SignalAnswerSource,
  limit: number = SIGNAL_ANSWER_ROW_LIMIT,
): SignalAnswer {
  const registryEntry = CHECK_REGISTRY.find((c) => c.id === checkId);
  const rule = SIGNAL_ANSWER_RULES[checkId];
  const geometry: SheetGeometry = rule?.geometry ?? 'dept';

  const own = source.issues.filter((i) => String(i.checkId ?? '') === checkId);
  const shown = own.slice(0, limit);

  const rows: SignalAnswerRow[] = shown.map((iss) => {
    const sheet = iss.sheet ?? '—';
    const row = typeof iss.row === 'number' ? iss.row : null;
    const rowSeq = iss.rowSeq ?? null;

    // Колонки спора: из правила, а если правила нет — та, что назвала находка.
    const columns = rule
      ? [...rule.evidence]
      : [String(iss.cell ?? '').replace(/\d+/gu, '')].filter((c) => c.length > 0);

    const cells: SignalEvidenceCell[] = columns.map((column) => {
      const raw = row !== null && source.readCell ? source.readCell(sheet, row, column) : null;
      const value = row === null || !source.readCell
        ? UNREAD_CELL_WORD
        : raw === null
          ? UNREAD_CELL_WORD
          : raw.trim() === ''
            ? EMPTY_CELL_WORD
            : raw.trim();
      return { column, label: columnHumanLabel(column, geometry), value };
    });

    // Адрес двойной: номер строки листа для «открыть и посмотреть» и «№ п/п»
    // для «найти через месяц» — позиционный номер устаревает при вставках.
    const address = row === null
      ? `${sheet}${rowSeq ? ` (№ п/п ${rowSeq})` : ''}`
      : `${sheet}!строка ${row}${rowSeq ? ` (№ п/п ${rowSeq})` : ''}`;

    return { sheet, row, rowSeq, address, cells };
  });

  const emptyReason = own.length === 0
    ? 'Проверка отработала и ничего не нашла — строк этого класса в книгах нет.'
    : null;

  return {
    checkId,
    title: signalCardTitle(checkId),
    condition: rule?.condition
      ?? registryEntry?.description
      ?? 'Условие проверки не описано — паспорт класса не заполнен.',
    whatToDo: registryEntry?.recommendation
      ?? 'Действие по классу не описано — паспорт проверки требует дополнения.',
    rows,
    totalRows: own.length,
    emptyReason,
  };
}

/**
 * Ответы по всем классам, которые сработали в переданном наборе замечаний.
 * Порядок — по числу строк, от самого частого: читатель начинает с того, что
 * встречается чаще всего, а не с алфавита.
 */
export function buildSignalAnswers(
  source: SignalAnswerSource,
  limit: number = SIGNAL_ANSWER_ROW_LIMIT,
): SignalAnswer[] {
  const counts = new Map<string, number>();
  for (const iss of source.issues) {
    const key = String(iss.checkId ?? '');
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .map((checkId) => buildSignalAnswer(checkId, source, limit));
}

// COL_LETTER_INDEX используется таблицей человеческих имён колонок выше;
// реэкспорт нужен потребителям, которые строят адрес ячейки из буквы.
export { COL_LETTER_INDEX };
