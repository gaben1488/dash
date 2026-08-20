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

export interface VanishedBookDto {
  dept: string;
  deptName: string;
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
  note: string;
}

export interface IntegrityResponse {
  asOf: string;
  books: IntegrityBookDto[];
  totals: { gapCount: number; duplicates: number; countableWithoutSeq: number; dateFormat: number };
  /** null — сравнивать не с чем; причина названа в comparisonNote. */
  comparison: {
    beforeAt: string;
    afterAt: string;
    books: VanishedBookDto[];
    vanishedTotal: number;
    vanishedPlanSum: number;
  } | null;
  comparisonNote: string;
  notes: string[];
}

// ────────────────────────────────────────────────────────────
// Подписи и форматирование
// ────────────────────────────────────────────────────────────

/** Заголовки шкал: вопрос, на который отвечает каждая. */
export const SCALE_TITLE: Record<AnomalyScale, string> = {
  typo: 'Похоже на опечатку',
  fitted: 'Похоже на подгон',
};

export const SCALE_LEAD: Record<AnomalyScale, string> = {
  typo: 'Рука дрогнула: лишний ноль, рубли вместо тысяч, соседний год, сумма скопирована '
    + 'сверху. Лечится правкой ячейки.',
  fitted: 'Числа подобраны: суммы липнут к порогу снизу, одна закупка разложена на несколько, '
    + 'факт равен плану до копейки. Лечится проверкой документов.',
};

/** Уровень аномалии датасета словом — внутренние коды на экран не выходят. */
export const LEVEL_LABEL: Record<DatasetFindingDto['level'], string> = {
  row: 'строка книги',
  behaviour: 'видно сравнением с прошлым чтением',
  book: 'признак всей книги',
};

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
    + 'номером. Пропажи: строки двух последних снимков сравниваются по «№ п/п», а не по '
    + 'номеру строки листа — строки двигаются от вставок и сортировок.',
  dataSource:
    'Нумерация и вид ячеек — прочитанные книги управлений; пропажи — строки-атомы двух '
    + 'последних сохранённых снимков в местной базе. К Google при открытии раздела '
    + 'обращений нет.',
  pitfalls:
    'Пропуск номера — след удалённой строки, а не ошибка нумерации: журнал книги удаление '
    + 'не записывает. Вид ячейки проверяется только там, где код даты лежит текстом: книги '
    + 'читаются в необработанном виде, и дату с верным форматом от даты с числовым '
    + 'отличить нечем.',
  actions:
    'Восстановить номера у счётных строк без «№ п/п» — иначе на закупку нечем сослаться. '
    + 'Пропавшую строку сверить с книгой: если удалена по решению — это норма, если нет — '
    + 'восстановить из снимка.',
} as const;
