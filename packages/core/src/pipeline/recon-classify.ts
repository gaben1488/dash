/**
 * Классификаторы первопричин расхождений сверки (блок 1 плана к запуску,
 * шаги 4–5). Контракт типов — @aemr/shared/recon-root-cause.
 *
 * Классификатор получает строки-атомы книги ГРБС и меру расхождения, а
 * возвращает первопричину с адресами строк-виновниц и их вкладом. Правило:
 * причина без адресов не предъявима, поэтому классификатор, не нашедший
 * строк, возвращает null — остаток честно достанется классу 'unknown'.
 */

import {
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  toNumber,
  type ReconRootCause,
  type ReconRootCauseRow,
} from '@aemr/shared';
import { isUnknownMethod, standardRowFilter, type RawRow } from './calc-engine.js';

const COL = DEPT_COLUMNS;

/**
 * Допуск сравнения денег — копейка. Тот же порог, что у DELTA_EPSILON в
 * контракте сверки: классификатор и валидатор обязаны считать «сошлось»
 * по одному правилу, иначе причина, найденная здесь, там же и упадёт.
 */
const MONEY_EPSILON = 0.01;

/** Мера, в которой считается расхождение: деньги или количество процедур. */
export type ReconMeasure = 'planMoney' | 'planCount' | 'factMoney' | 'factCount';

/**
 * Буква колонки листа по индексу (0 → A, 25 → Z, 26 → AA). Книги ГРБС
 * доходят до AH, поэтому одной буквы, в отличие от листа СВОД, мало.
 */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Номер строки листа для атома по его индексу (шапка + 1, как видит человек). */
export function sheetRowOf(rowIndex: number): number {
  return rowIndex + DEPT_HEADER_ROWS + 1;
}

const cellNum = (v: unknown): number => toNumber(v) ?? 0;

/** Плановая сумма строки: ИТОГО либо тройка бюджетов (канон build-report). */
function rowPlanTotal(row: RawRow): number {
  return (
    cellNum(row[COL.TOTAL_PLAN]) ||
    cellNum(row[COL.FB_PLAN]) + cellNum(row[COL.KB_PLAN]) + cellNum(row[COL.MB_PLAN])
  );
}

/** Фактическая сумма строки: ИТОГО либо тройка бюджетов. */
function rowFactTotal(row: RawRow): number {
  return (
    cellNum(row[COL.TOTAL_FACT]) ||
    cellNum(row[COL.FB_FACT]) + cellNum(row[COL.KB_FACT]) + cellNum(row[COL.MB_FACT])
  );
}

/** Дата факта заполнена (не пусто и не заглушка «Х»/«-»). */
function hasFactDate(row: RawRow): boolean {
  const s = String(row[COL.FACT_DATE] ?? '').trim().toLowerCase();
  return s !== '' && s !== 'х' && s !== 'x' && s !== '-';
}

/** Год плана пуст или заглушка — строка «без подтверждённого финансирования». */
function planYearEmpty(row: RawRow): boolean {
  const s = String(row[COL.PLAN_YEAR] ?? '').trim().toLowerCase();
  return s === '' || s === 'х' || s === 'x' || s === '-';
}

/** Плановый квартал валиден (1..4). */
function planQuarterValid(row: RawRow): boolean {
  const q = Number(String(row[COL.PLAN_QUARTER] ?? '').trim().replace(',', '.'));
  return q >= 1 && q <= 4;
}

/**
 * Строка относится к отчётному году. Пустой год — не отсекаем: такая строка
 * и есть класс `unfunded`, и молчаливый выброс по году спрятал бы её от всех
 * остальных классификаторов.
 */
function matchesYear(row: RawRow, year: number | undefined): boolean {
  if (year === undefined) return true;
  const y = cellNum(row[COL.PLAN_YEAR]);
  return y <= 0 || y === year;
}

/** Плановая тройка бюджетов — второй путь чтения плановой суммы строки. */
function planTriple(row: RawRow): number {
  return cellNum(row[COL.FB_PLAN]) + cellNum(row[COL.KB_PLAN]) + cellNum(row[COL.MB_PLAN]);
}

/** Фактическая тройка бюджетов — второй путь чтения фактической суммы строки. */
function factTriple(row: RawRow): number {
  return cellNum(row[COL.FB_FACT]) + cellNum(row[COL.KB_FACT]) + cellNum(row[COL.MB_FACT]);
}

/**
 * Канонические заглушки «значения нет»: в книгах ГРБС так помечают пустоту
 * осознанно. Их нельзя считать битым числом, иначе класс `parsing` соберёт
 * половину книги вместо настоящих дефектов чтения.
 */
const NO_VALUE_PLACEHOLDERS = new Set(['х', 'x', '-', '—', '–']);

/** Ячейка непуста, не заглушка, но числом не читается («н/д», «уточняется»). */
function unreadableNumber(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (s === '') return false;
  if (NO_VALUE_PLACEHOLDERS.has(s.toLowerCase())) return false;
  return toNumber(v) === null;
}

/** Вклад строки в меру расхождения: сколько именно она добавляет расчёту. */
function contributionOf(row: RawRow, measure: ReconMeasure): number {
  switch (measure) {
    case 'planMoney':
      return rowPlanTotal(row);
    case 'factMoney':
      return rowFactTotal(row);
    case 'planCount':
      return 1;
    case 'factCount':
      return hasFactDate(row) ? 1 : 0;
  }
}

/** Колонка-адрес для меры: куда смотреть человеку в книге. */
function cellColumnFor(measure: ReconMeasure): number {
  return measure === 'factMoney' || measure === 'factCount' ? COL.TOTAL_FACT : COL.TOTAL_PLAN;
}

function toCauseRow(sheet: string, rowIndex: number, measure: ReconMeasure, delta: number): ReconRootCauseRow {
  return {
    sheet,
    row: sheetRowOf(rowIndex),
    cell: `${columnLetter(cellColumnFor(measure))}${sheetRowOf(rowIndex)}`,
    delta,
  };
}

/** Строки-виновницы дороже — выше: внимание читателя ведут деньги. */
function sortRows(rows: ReconRootCauseRow[]): ReconRootCauseRow[] {
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function money(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export interface ClassifyInput {
  /** Строки-атомы книги ГРБС (без шапки, как в snapshot.rowsByDept). */
  rows: RawRow[];
  /** Имя листа книги — первая часть пути до виновницы. */
  sheet: string;
  /** Мера расхождения. */
  measure: ReconMeasure;
  /**
   * Отчётный год. Строки других лет к расхождению отношения не имеют.
   * Не задан — год не проверяется (сверка «за всё время»).
   */
  year?: number;
  /** Номер суток среза: для класса afterSlice. */
  asOfDay?: number;
  /**
   * Общее расхождение строки сверки в единицах меры, со знаком «расчёт минус
   * официал». Нужно классу `sign`: у направления нет смысла, пока неизвестно,
   * относительно чего строка идёт против течения.
   */
  delta?: number;
}

/**
 * Класс `unfunded` — строки без года плана (P пуст).
 *
 * Формулы листа СВОД считают год строго и таких строк не видят; наш расчёт
 * до консолидации 07.08 их учитывал. Ровно их сумма и была расхождением
 * лимита. Классификатор находит их адреса, чтобы исполнитель проставил
 * сроки, а не искал вручную по книге на три тысячи строк.
 */
export function classifyUnfunded(input: ClassifyInput): ReconRootCause | null {
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!planYearEmpty(row)) return;
    if (rowPlanTotal(row) <= 0) return;
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'unfunded',
    rows: sortRows(rows),
    explanation:
      `Строк без года плана: ${rows.length}, их вклад ${money(total)}. ` +
      'Формулы листа СВОД считают год строго и эти строки не видят, поэтому официальное число меньше расчётного.',
  };
}

/**
 * Класс `factQuarterMissing` — факт есть, планового квартала (O) нет.
 *
 * Печатный год считается строго по плановым кварталам, поэтому такая
 * строка выпадает из годовой свёртки отчёта, оставаясь в «живом» итоге.
 * Замер 07.08: одна строка УДТХ на 67 666,68 тыс. давала всё расхождение
 * годовых чисел района.
 */
export function classifyFactQuarterMissing(input: ClassifyInput): ReconRootCause | null {
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!hasFactDate(row)) return;
    if (planQuarterValid(row)) return;
    if (!matchesYear(row, input.year)) return;
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'factQuarterMissing',
    rows: sortRows(rows),
    explanation:
      `Строк с фактом без планового квартала: ${rows.length}, их вклад ${money(total)}. ` +
      'Годовой итог отчёта складывается из четырёх плановых кварталов, поэтому такие строки в него не входят.',
  };
}

/**
 * Класс `afterSlice` — заключено ПОСЛЕ даты среза.
 *
 * Лист СВОД дату факта ни с чем не сравнивает и всегда считает «на сейчас»,
 * а отчёт режет факт по четвергу снимка. Это не дефект данных: причина
 * несёт рекомендацию «действий не требуется», но расхождение объясняет.
 */
export function classifyAfterSlice(input: ClassifyInput): ReconRootCause | null {
  if (input.asOfDay === undefined) return null;
  if (input.measure === 'planMoney' || input.measure === 'planCount') return null;
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!hasFactDate(row)) return;
    const factDay = dayNumberOfCell(row[COL.FACT_DATE]);
    if (factDay === null || factDay <= input.asOfDay!) return;
    const delta = contributionOf(row, input.measure);
    if (delta === 0) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'afterSlice',
    rows: sortRows(rows),
    // Знак: эти строки есть у листа и нет у отчёта, поэтому расчёт МЕНЬШЕ
    // официала — вклад отрицательный относительно «расчёт − официал».
    explanation:
      `Заключено после даты среза: ${rows.length} строк на ${money(total)}. ` +
      'Лист СВОД всегда считает на текущий момент, отчёт — на дату среза; в отчётные числа эти строки войдут следующей неделей.',
  };
}

/**
 * Класс `sign` — расхождение по направлению отклонения.
 *
 * Канон листа СВОД: отклонение считается как факт минус план, поэтому
 * перерасход у листа положителен, а экономия отрицательна. Продукт местами
 * берёт обратную величину (экономия = план минус факт) и обнуляет
 * отрицательную (approvedEconomy) — решение Д14 о том, чей канон главный,
 * владельцем ещё не принято. Пока оно не принято, строки, чьё отклонение
 * направлено против общего расхождения, обязаны быть названы поимённо:
 * именно на них два пути расходятся знаком, а не величиной.
 *
 * Счёт процедур направления не имеет, поэтому к количественным мерам класс
 * не применяется — как afterSlice не применяется к плановым.
 */
export function classifySign(input: ClassifyInput): ReconRootCause | null {
  if (input.measure === 'planCount' || input.measure === 'factCount') return null;
  if (input.delta === undefined || Math.abs(input.delta) <= MONEY_EPSILON) return null;
  const overall = Math.sign(input.delta);
  const rows: ReconRootCauseRow[] = [];
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!matchesYear(row, input.year)) return;
    // Отклонение существует только у заключённого контракта. Без этого условия
    // «факт минус план» дал бы минус на всю плановую сумму каждой незаключённой
    // строки, и класс собрал бы всю книгу вместо знакового разнобоя.
    if (!hasFactDate(row)) return;
    const deviation = rowFactTotal(row) - rowPlanTotal(row);
    if (Math.abs(deviation) <= MONEY_EPSILON) return;
    if (Math.sign(deviation) === overall) return;
    rows.push(toCauseRow(input.sheet, i, input.measure, deviation));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  const overallWord = input.delta > 0 ? 'расчёт выше официального числа' : 'расчёт ниже официального числа';
  const rowsWord = total > 0 ? 'факт выше плана (перерасход)' : 'факт ниже плана (экономия)';
  return {
    class: 'sign',
    // Наблюдение, не вкладчик: разнонаправленные отклонения описывают
    // подозрительные строки, но арифметического права на разницу чисел у них
    // нет — складывая их в общий счёт, карточка объявляла остаток больше
    // самой разницы (прецедент 14.08.2026).
    kind: 'observation',
    rows: sortRows(rows),
    explanation:
      `Строк с обратным направлением отклонения: ${rows.length}, их сумма ${money(total)}. ` +
      `Общее расхождение — ${overallWord}, отклонение этих строк идёт против него: ${rowsWord}. ` +
      'Лист СВОД считает отклонение как факт минус план; путь, берущий обратную величину или обнуляющий отрицательную, даёт другой знак.',
  };
}

/**
 * Класс `method` — риск трактовки способа закупки.
 *
 * Формула листа СВОД делит строки отрицанием: конкурентной считается любая,
 * где способ не «ЕП». С волны 0 (реестр расхождений 08.08 §2) то же правило
 * стало ТОТАЛЬНЫМ и у нас: и пустая ячейка, и непустой нераспознанный код
 * идут в конкурентные — сумма частей снова равна плану, а доля ЕП перестала
 * расти от загрязнения столбца L. Поэтому вклад в расхождение здесь нулевой
 * у ОБЕИХ разновидностей: стороны читают такие строки одинаково.
 *
 * Класс не удалён, потому что риск остался и он крупнее арифметики: если
 * оператор имел в виду «ЕП», а написал непонятный код, ошибаются оба числа
 * сразу и молча. Строки перечисляются как адресуемая проблема данных, а не
 * как источник дельты, и арифметика сверки от их появления не поедет.
 */
export function classifyMethod(input: ClassifyInput): ReconRootCause | null {
  const rows: ReconRootCauseRow[] = [];
  let unknownCount = 0;
  let emptyCount = 0;
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!matchesYear(row, input.year)) return;
    if (rowPlanTotal(row) <= 0) return;
    const raw = String(row[COL.METHOD] ?? '').trim();
    // Единственная дверь для «мусор в столбце L» — предикат движка.
    // Прежнее `classifyMethodGroup(...) === null` держалось на том, что
    // классификатор возвращал ничью группу; после его тотализации такое
    // сравнение стало вечно ложным и молча выключило бы весь класс.
    const unknown = isUnknownMethod(row[COL.METHOD]);
    if (!unknown && raw !== '') return;
    const own = contributionOf(row, input.measure);
    // К этой мере строка отношения не имеет (например, факта нет, а мера
    // фактическая) — молчим, чтобы не показывать пустой адрес.
    if (own === 0) return;
    if (unknown) unknownCount += 1;
    else emptyCount += 1;
    // Вклад нулевой у обеих разновидностей: обе стороны считают такую строку
    // конкурентной, значит расхождения она не двигает — только риск данных.
    rows.push(toCauseRow(input.sheet, i, input.measure, 0));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  return {
    class: 'method',
    // Наблюдение: обе стороны читают такие строки одинаково (лист делит
    // отрицанием, у нас с волны 0 то же правило) — вклад в разницу нулевой.
    kind: 'observation',
    rows: sortRows(rows),
    explanation:
      `Строк с нераспознанным способом: ${unknownCount}, с пустым способом: ${emptyCount}; ` +
      `вклад в расхождение ${money(total)}. ` +
      'Лист СВОД считает конкурентной любую строку, где способ не «ЕП»; расчёт читает столбец так же, ' +
      'поэтому на числа такие строки не влияют. Риск в другом: если в ячейке имелась в виду закупка ' +
      'у единственного поставщика, обе стороны ошибаются одинаково и молча.',
  };
}

/**
 * Класс `cancelled` СНЯТ 14.08.2026 по канону п.27 (интервью): свободный текст
 * комментариев исполнителей машинно не интерпретируется НИГДЕ. Классификатор
 * искал слова «отмен», «аннулир», «не состоял» в причине отклонения и трёх
 * колонках комментариев — то же чтение слов, из-за которого продукт объявлял
 * состоявшуюся закупку отменённой (жалоба п.41).
 *
 * Отдельной структурной колонки статуса в книгах ГРБС нет, поэтому заменить
 * чтение текста нечем: признак отмены должен появиться у источника (просьба
 * владельцам книг — завести колонку статуса со списком значений). До тех пор
 * такие строки объясняются общими классами: план без исполнения, отсутствие
 * финансирования, факт вне периметра.
 *
 * Функция сохранена как заглушка, потому что на неё ссылаются старые тесты и
 * снимки; она НИЧЕГО не находит и в очередь классификаторов не включена.
 */
export function classifyCancelled(_input: ClassifyInput): ReconRootCause | null {
  return null;
}

/**
 * Класс `parsing` — строка прочитана по-разному.
 *
 * Итоговая сумма строки и сумма трёх бюджетов обязаны совпадать (правило
 * книги: ИТОГО = ФБ + КБ + МБ). Когда они расходятся, подсчёт по столбцу
 * ИТОГО и подсчёт по источникам дают разные числа — и это не спор о методике,
 * а дефект заполнения или чтения. Сюда же попадает непустая ячейка, которая
 * числом не читается: один путь видит там ноль, другой откатывается на тройку.
 *
 * Вклад считается как «сумма по столбцу ИТОГО минус сумма по источникам»:
 * ровно на столько расходятся два прочтения одной строки.
 */
export function classifyParsing(input: ClassifyInput): ReconRootCause | null {
  const factSide = input.measure === 'factMoney' || input.measure === 'factCount';
  const totalColumn = factSide ? COL.TOTAL_FACT : COL.TOTAL_PLAN;
  const isMoney = input.measure === 'planMoney' || input.measure === 'factMoney';
  const rows: ReconRootCauseRow[] = [];
  let unreadable = 0;
  input.rows.forEach((row, i) => {
    if (!standardRowFilter(row)) return;
    if (!matchesYear(row, input.year)) return;
    const raw = row[totalColumn];
    const triple = factSide ? factTriple(row) : planTriple(row);
    const gap = cellNum(raw) - triple;
    const broken = unreadableNumber(raw);
    if (!broken && Math.abs(gap) <= MONEY_EPSILON) return;
    const delta = isMoney ? gap : contributionOf(row, input.measure);
    if (delta === 0) return;
    if (broken) unreadable += 1;
    rows.push(toCauseRow(input.sheet, i, input.measure, delta));
  });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.delta, 0);
  const brokenPart = unreadable > 0 ? `, из них с нечитаемым числом ${unreadable}` : '';
  return {
    class: 'parsing',
    rows: sortRows(rows),
    explanation:
      `Строк, прочитанных по-разному: ${rows.length}${brokenPart}; расхождение прочтений ${money(total)}. ` +
      'Итоговая сумма строки не сходится с суммой трёх бюджетов, поэтому подсчёт по итоговому столбцу ' +
      'и подсчёт по источникам финансирования дают разные числа.',
  };
}

/** Дата ячейки в номер суток — локальная копия канона parse-sheet-date. */
function dayNumberOfCell(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m) {
    const d = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Math.floor(d / 86_400_000);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Math.floor(d / 86_400_000);
  }
  const serial = Number(s);
  // Google Sheets serial: 1899-12-30 = 0.
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    return Math.floor(serial - 25_569);
  }
  return null;
}
