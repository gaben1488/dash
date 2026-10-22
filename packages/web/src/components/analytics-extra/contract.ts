import { PRODUCT_COPY } from '@aemr/shared';
/**
 * Договор с сервером по двум разделам, которые до 21.08.2026 не выводились
 * никуда: адресные признаки странностей (GET /api/anomalies) и целостность
 * книг (GET /api/integrity).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЕ ТИПЫ, А НЕ ОБЩИЙ api.ts. Оба ответа читает ровно по одному
 * блоку экрана, и их форма меняется вместе с этими блоками. Общий словарь
 * типов здесь не экономит ничего, зато превращает правку одной секции в
 * правку файла, который читают все.
 *
 * ЧТО ЗАДАЮТ ЭТИ ТИПЫ. Различие пустоты и нуля: `sequence: null` означает
 * «строки книги не прочитаны», а не «нумерация в порядке»; `sheetRow: null`
 * означает «признак не про одну строку», а не «строка нулевая». Экран обязан
 * рисовать null словами, а не прочерком без объяснения.
 */

// ────────────────────────────────────────────────────────────
// GET /api/anomalies
// ────────────────────────────────────────────────────────────

/** Две шкалы детектора: они не складываются в один балл. */
export type AnomalyScale = 'typo' | 'fitted';

/** Один признак с адресом строки и деньгами под риском. */
export interface AnomalySignDto {
  /** Кириллический канон книги («УО») — ось изоляции по управлению, п.127. */
  dept: string;
  deptName: string;
  scale: AnomalyScale;
  sign: string;
  title: string;
  explanation: string;
  amountAtRisk: number;
  sheet: string;
  /** 0 — признак про группу строк, а не про одну. */
  sheetRow: number;
  rowSeq: string;
  cell: string;
  subordinate: string;
  subject: string;
  rows: number;
  smallSample: boolean;
  note?: string;
  /** Адреса остальных строк группы, уже словами: «строка 155 (№ 39)». */
  members: string[];
}

/** Аномалия датасета, доведённая до адреса строки книги. */
export interface DatasetFindingDto {
  dept: string;
  deptName: string;
  sheet: string;
  /** row — про строку, behaviour — видно сравнением снимков, book — про книгу. */
  level: 'row' | 'behaviour' | 'book';
  type: string;
  title: string;
  urgency: string;
  urgencyRank: number;
  why: string;
  /** null — признак уровня книги, одной строки у него нет. */
  sheetRow: number | null;
  rowSeq: string;
  subject: string;
  subordinate: string;
  members: string[];
  rows: number;
}

/** Свёртка находок по типам — сколько строк за родом и какие именно. */
export interface NoiseGroupDto {
  dept: string;
  deptName: string;
  key: string;
  label: string;
  count: number;
  urgency: string;
  urgencyRank: number;
  summary: string;
  members: string[];
}

export interface AnomaliesResponse {
  asOf: string;
  booksRead: string[];
  booksSilent: string[];
  journalsSilent: string[];
  rowsScanned: number;
  typo: AnomalySignDto[];
  fitted: AnomalySignDto[];
  counts: Record<string, number>;
  amountAtRisk: { typo: number; fitted: number };
  dataset: DatasetFindingDto[];
  noise: NoiseGroupDto[];
  datasetAvailable: boolean;
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// GET /api/integrity
// ────────────────────────────────────────────────────────────

export interface SequenceGapDto { from: number; to: number; count: number }
export interface SequenceDuplicateDto { rowSeq: string; sheetRows: number[]; subjects: string[] }

export interface SequenceReportDto {
  rows: number;
  countable: number;
  numbered: number;
  countableWithoutSeq: number;
  /** null — считать охват не от чего (счётных строк нет). */
  coveragePct: number | null;
  range: { min: number; max: number } | null;
  gaps: SequenceGapDto[];
  gapCount: number;
  duplicates: SequenceDuplicateDto[];
  unnumbered: Array<{ sheetRow: number; subject: string | undefined; planSum: number | null }>;
  note: string;
}

export interface DateFormatRowDto {
  sheetRow: number;
  rowSeq: string;
  subject: string;
  subordinate: string;
  column: 'N' | 'Q';
  columnLabel: string;
  shown: string;
  meansDate: string;
  mechanism: string;
  action: string;
}

export interface IntegrityBookDto {
  dept: string;
  deptName: string;
  sheet: string;
  /** false — строки книги не прочитаны: это не «нарушений нет». */
  rowsAvailable: boolean;
  sequence: SequenceReportDto | null;
  dateFormat: DateFormatRowDto[];
  note: string;
}


/**
 * The integrity card may show only a selected GRBS. Server totals cover all
 * books, so derive the visible counters from exactly the displayed books.
 * Unknown/unread books do not contribute a claimed zero result.
 */
export function scopedIntegrityTotals(
  books: readonly Pick<IntegrityBookDto, 'sequence'>[],
): Pick<IntegrityResponse['totals'], 'gapCount' | 'duplicates' | 'countableWithoutSeq'> & {
  checkedBooks: number;
  unreadBooks: number;
} {
  return books.reduce((total, book) => {
    const sequence = book.sequence;
    if (sequence === null) {
      total.unreadBooks++;
      return total;
    }
    total.checkedBooks++;
    total.gapCount += sequence.gapCount;
    total.duplicates += sequence.duplicates.length;
    total.countableWithoutSeq += sequence.countableWithoutSeq;
    return total;
  }, { gapCount: 0, duplicates: 0, countableWithoutSeq: 0, checkedBooks: 0, unreadBooks: 0 });
}

export interface VanishedBookDto {
  dept: string;
  deptName: string;
  currentAt: string;
  vanished: Array<{
    rowSeq: string;
    wasAtSheetRow: number;
    subject: string;
    subordinate: string;
    planSum: number | null;
    factSum: number | null;
  }>;
  moved: Array<{ rowSeq: string; fromSheetRow: number; toSheetRow: number; subject: string }>;
  appeared: number;
  vanishedPlanSum: number;
  vanishedFactSum: number;
  unkeyed: { before: number; after: number };
  identityCandidates: Array<{
    beforeRowSeq: string; afterRowSeq: string;
    beforeSheetRow: number; afterSheetRow: number;
    subject: string; subordinate: string; planSum: number;
    evidence: 'subject+subordinate+plan+method'; status: 'needs-review';
  }>;
  ambiguousKeys: { before: string[]; after: string[] };
  contextChanged: Array<{
    rowSeq: string; beforeSheetRow: number; afterSheetRow: number;
    beforeSubject: string; afterSubject: string;
    beforeSubordinate: string; afterSubordinate: string;
    status: 'needs-review';
  }>;
  note: string;
}

/** Only the absence of an earlier number, not a verified procurement deletion. */
export interface OperationalAbsenceDto {
  dept: string;
  rowSeq: string;
  wasAtSheetRow: number | null;
  subject: string;
  observedAt: string;
}
export interface OperationalAbsenceReport {
  since: string;
  entries: OperationalAbsenceDto[];
  unavailableBooks: Array<{ dept: string; reason: string }>;
  error: string | null;
}

/** Avoid counting a single literal number twice in live and weekly evidence. */
export function uniqueOperationalAbsences(
  observations: readonly OperationalAbsenceDto[],
  comparisons: readonly { dept: string; vanished: readonly { rowSeq: string }[] }[],
): { only: OperationalAbsenceDto[]; corroboratedCount: number } {
  const weekly = new Set(comparisons.flatMap(book =>
    book.vanished.map(row => JSON.stringify([book.dept, row.rowSeq]))));
  const unique = new Map<string, OperationalAbsenceDto>();
  let corroboratedCount = 0;
  for (const event of observations) {
    const key = JSON.stringify([event.dept, event.rowSeq]);
    if (weekly.has(key)) { corroboratedCount++; continue; }
    const previous = unique.get(key);
    if (!previous || event.observedAt > previous.observedAt) unique.set(key, event);
  }
  return { only: [...unique.values()], corroboratedCount };
}

export interface IntegrityResponse {
  asOf: string;
  books: IntegrityBookDto[];
  totals: { gapCount: number; duplicates: number; countableWithoutSeq: number; dateFormat: number };
  /** null — сравнивать не с чем; причина названа в comparisonNote. */
  comparison: {
    baselineId: string;
    beforeAt: string;
    afterAt: string;
    oldestCurrentAt: string;
    unavailableBooks: Array<{ dept: string; reason: string }>;
    books: VanishedBookDto[];
    vanishedTotal: number;
    vanishedPlanSum: number;
  } | null;
  comparisonNote: string;
  /** Независимая сверка двух последних СМЕЖНЫХ завершённых четвергов. */
  weeklyComparison: {
    beforeId: string;
    afterId: string;
    beforeAt: string;
    afterAt: string;
    books: VanishedBookDto[];
    vanishedTotal: number;
    vanishedPlanSum: number;
  } | null;
  weeklyComparisonNote: string;
  /** Optional so old installed servers continue to render honestly. */
  operational?: OperationalAbsenceReport;
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// Подписи и форматирование
// ────────────────────────────────────────────────────────────

/** Заголовки шкал: вопрос, на который отвечает каждая. */
export const SCALE_TITLE: Record<AnomalyScale, string> = PRODUCT_COPY["components/analytics-extra/contract:SCALE_TITLE"];

export const SCALE_LEAD: Record<AnomalyScale, string> = {
  typo: 'Рука дрогнула: лишний ноль, рубли вместо тысяч, соседний год, сумма скопирована '
    + 'сверху. Лечится правкой ячейки.',
  fitted: 'Числа подобраны: суммы липнут к порогу снизу, одна закупка разложена на несколько, '
    + 'факт равен плану до копейки. Лечится проверкой документов.',
};

/** Уровень аномалии датасета словом — внутренние коды на экран не выходят. */
export const LEVEL_LABEL: Record<DatasetFindingDto['level'], string> = PRODUCT_COPY["components/analytics-extra/contract:LEVEL_LABEL"];

/** Тысячи рублей с русской группировкой разрядов. */
export function fmtTys(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} тыс. ₽`;
}

/** Адрес строки словами: «строка 155 (№ 39)» либо «строка 155». */
export function addressText(sheetRow: number | null, rowSeq: string): string {
  if (sheetRow === null || sheetRow <= 0) return '';
  const seq = rowSeq.trim();
  return seq === '' ? `строка ${sheetRow}` : `строка ${sheetRow} (№ ${seq})`;
}

/** Карточка базы знаний раздела признаков. */
export const ANOMALY_SIGNS_KB = {
  whatIs:
    'Признак — наблюдение над строкой книги, которое стоит проверить: сумма выбивается из '
    + 'ряда соседей, дата на год в стороне, цена липнет к порогу снизу. Признак не '
    + 'утверждает нарушения и не заменяет проверку документов.',
  howCalc:
    'Две независимые шкалы. «Похоже на опечатку» сравнивает строку с её соседями по '
    + 'учреждению: во сколько раз сумма больше медианы группы, ровная ли она среди дробных, '
    + 'не соседний ли год в дате. «Похоже на подгон» смотрит на распределение: плотность '
    + 'сумм в последних 10 % порога против соседней полосы, однотипные закупки в окне '
    + '30 дней, доля «факт равен плану» среди конкурентных.',
  dataSource:
    'Строки книг управлений и скрытый лист «_ChangeLog» той же книги. Два признака из '
    + 'двенадцати — правка в кратное десяти число раз и правка плана после факта — без '
    + 'журнала не выводятся вовсе.',
  pitfalls:
    'Шкалы отвечают на разные вопросы и в один балл не складываются. Малая выборка '
    + 'помечается словами: такой признак показывать можно, опираться на него как на вывод — '
    + 'нельзя. Отсутствие признаков не означает, что данные верны.',
  actions:
    'Открыть названную строку в книге и сверить её с документом. Если признак ложный — '
    + 'ничего делать не нужно: он не создаёт замечания и не влияет на оценку управления.',
} as const;

/** Карточка базы знаний раздела целостности. */
export const INTEGRITY_KB = {
  whatIs:
    'Целостность книги — про адресуемость её строк, а не про суммы. Три вопроса: можно ли '
    + 'сослаться на строку («№ п/п» заполнен и не повторяется), видит ли человек в графе '
    + 'срока дату, и не пропала ли закупка между чтениями.',
  howCalc:
    'Нумерация: пропуски внутри диапазона использованных номеров сворачиваются в отрезки; '
    + 'охват — доля счётных строк (есть способ закупки и плановые деньги) с заполненным '
    + 'номером. Поиск отсутствующих прежних номеров: текущее чтение действующих книг '
    + 'сравнивается с последним завершённым недельным контролем. Возможная перенумерация '
    + 'ищется по уникальному совпадению предмета, учреждения, суммы и способа; '
    + 'это гипотеза, а не подтверждённая идентичность.',
  dataSource:
    'Нумерация и вид ячеек — текущие прочитанные книги управлений. Контрольная база — '
    + 'строки-атомы последнего подтверждённого четвергового снимка. Повторное чтение Google '
    + 'запускается только по явной кнопке; пробелы источника показываются.',
  pitfalls:
    'Пропуск номера не доказывает удаление: возможны перенумерация и переоформление. '
    + 'Дубли № и устаревшие книги исключаются из доказанной сверки. '
    + 'Вид ячейки проверяется только там, где код даты лежит текстом: книги '
    + 'читаются в необработанном виде, и дату с верным форматом от даты с числовым '
    + 'отличить нечем.',
  actions:
    'Восстановить номера у счётных строк без «№ п/п» — иначе на закупку нечем сослаться. '
    + 'По отсутствующему прежнему номеру проверить журнал правок, контекст закупки и '
    + 'основание изменения. Восстановление допустимо только после подтверждения '
    + 'неправомерного удаления, не по одному номеру.',
} as const;
