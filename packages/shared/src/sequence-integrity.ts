/**
 * Целостность нумерации рабочего листа книги (колонка A, «№ п/п»).
 *
 * Номер по порядку — единственный адрес строки, переживающий её перемещение:
 * номер строки листа меняется от вставок и сортировок (канон п.98б, живой
 * случай — «Опрессовка» была строкой 534, стала 155), а номер закупки остаётся
 * при ней. На нём стоят замечания, сверки и ссылки в переписке.
 *
 * Замер 19.08.2026 по рабочим листам всех восьми книг показал, что болит не то,
 * что казалось. Дубль номера во всём районе один: у управления дорожного
 * хозяйства номер 39 стоит в строках 47 и 67. Зато:
 *
 * · ПРОПУСКИ — у образования 337 пропущенных номеров в диапазоне 1…3012, у
 *   аппарата 25, у дорожного хозяйства и финансов по 18. Пропуск — след
 *   удалённой строки: закупка была, номер остался в воздухе. Журнал книги
 *   удаление строки не записывает (канон п.105), поэтому пропуск в нумерации —
 *   единственный видимый след пропажи.
 * · НЕЗАПОЛНЕННОСТЬ — в шести книгах из восьми номер есть меньше чем у сотни
 *   строк: у экономики 86 из 993, у имущества 70 из 989, у финансов 46 из 978.
 *   Там нумерация как адрес просто не работает: сослаться на строку нечем.
 *
 * Проверка смотрит ОДИН рабочий лист — тот, с которым работают. Листы
 * учреждений (зеркала) сюда не входят: ими не пользуются, и их расхождения
 * ничего не говорят о качестве работы (решение владельца 19.08).
 */

/** Строка рабочего листа глазами проверки нумерации. */
export interface SequenceRow {
  /** Номер строки листа на момент чтения. */
  sheetRow: number;
  /** Значение колонки A как есть. */
  rowSeq: string;
  /** Строка счётная: есть способ закупки и плановые деньги. */
  countable: boolean;
  /** Предмет закупки — чтобы человек узнал строку. */
  subject?: string;
  /** Плановая сумма, тыс. руб. — разбор идёт от крупного. */
  planSum?: number | null;
}

export interface SequenceGap {
  /** Первый и последний номер непрерывного пропуска. */
  from: number;
  to: number;
  /** Сколько номеров пропущено подряд. */
  count: number;
}

export interface SequenceDuplicate {
  rowSeq: string;
  /** Строки листа, где встретился один и тот же номер. */
  sheetRows: number[];
  subjects: string[];
}

export interface SequenceReport {
  /** Всего строк на листе и сколько из них счётных. */
  rows: number;
  countable: number;
  /** Строк с заполненным номером. */
  numbered: number;
  /** Счётных строк без номера — они лишены адреса. */
  countableWithoutSeq: number;
  /** Доля счётных строк, у которых адрес есть. От 0 до 100; null — считать не от чего. */
  coveragePct: number | null;
  /** Диапазон использованных номеров. */
  range: { min: number; max: number } | null;
  /** Пропуски внутри диапазона, свёрнутые в отрезки. */
  gaps: SequenceGap[];
  /** Сколько номеров пропущено всего. */
  gapCount: number;
  /** Повторяющиеся номера. */
  duplicates: SequenceDuplicate[];
  /** Счётные строки без номера — адреса и предметы, от крупных денег. */
  unnumbered: Array<{ sheetRow: number; subject: string | undefined; planSum: number | null }>;
  /** Человеческое объяснение состояния нумерации. */
  note: string;
}

/** Отрезки-пропуски: подряд идущие пропущенные номера сворачиваются в один. */
function foldGaps(missing: readonly number[]): SequenceGap[] {
  const out: SequenceGap[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const n of missing) {
    if (start === null) {
      start = n;
      prev = n;
      continue;
    }
    if (prev !== null && n === prev + 1) {
      prev = n;
      continue;
    }
    out.push({ from: start, to: prev as number, count: (prev as number) - start + 1 });
    start = n;
    prev = n;
  }
  if (start !== null && prev !== null) out.push({ from: start, to: prev, count: prev - start + 1 });
  return out;
}

/** Показывать в карточке столько отрезков и строк — остальное свернуто числом. */
const SHOWN_GAPS = 12;
const SHOWN_ROWS = 20;

/** Ниже этой доли адресуемых счётных строк нумерация считается неработающей. */
const COVERAGE_BROKEN_PCT = 50;

export function checkSequenceIntegrity(rows: readonly SequenceRow[]): SequenceReport {
  const numberedRows = rows.filter((r) => String(r.rowSeq ?? '').trim() !== '');
  const countableRows = rows.filter((r) => r.countable);
  const countableNoSeq = countableRows.filter((r) => String(r.rowSeq ?? '').trim() === '');

  // Повторы считаем по нормализованному номеру: «531» и 531 — один адрес.
  const bySeq = new Map<string, SequenceRow[]>();
  for (const r of numberedRows) {
    const key = String(r.rowSeq).trim();
    const bucket = bySeq.get(key);
    if (bucket) bucket.push(r);
    else bySeq.set(key, [r]);
  }
  const duplicates: SequenceDuplicate[] = [];
  for (const [seq, list] of bySeq) {
    if (list.length < 2) continue;
    duplicates.push({
      rowSeq: seq,
      sheetRows: list.map((r) => r.sheetRow),
      subjects: list.map((r) => r.subject ?? '').filter(Boolean),
    });
  }

  const numeric = [...new Set(
    numberedRows
      .map((r) => Number(String(r.rowSeq).trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  )].sort((a, b) => a - b);

  const range = numeric.length > 0 ? { min: numeric[0], max: numeric[numeric.length - 1] } : null;
  const present = new Set(numeric);
  const missing: number[] = [];
  if (range) {
    for (let n = range.min; n <= range.max; n += 1) if (!present.has(n)) missing.push(n);
  }
  const gaps = foldGaps(missing);

  const coveragePct = countableRows.length > 0
    ? Math.round(((countableRows.length - countableNoSeq.length) / countableRows.length) * 1000) / 10
    : null;

  const notes: string[] = [];
  if (duplicates.length > 0) {
    notes.push(
      `Один номер на нескольких строках: ${duplicates.length}. Ссылка «строка № такой-то» ` +
      `перестаёт быть однозначной.`,
    );
  }
  if (missing.length > 0) {
    notes.push(
      `Пропущено номеров: ${missing.length} (отрезков ${gaps.length}). Пропуск — след ` +
      `удалённой строки: журнал книги удаление не записывает, и нумерация остаётся ` +
      `единственным следом пропажи.`,
    );
  }
  if (countableNoSeq.length > 0) {
    notes.push(
      `Счётных строк без номера: ${countableNoSeq.length}. У них нет адреса, который ` +
      `переживёт перемещение строки, — сослаться на такую закупку нечем.`,
    );
  }
  if (coveragePct !== null && coveragePct < COVERAGE_BROKEN_PCT) {
    notes.push(
      `Номер есть лишь у ${coveragePct}% счётных строк — как адрес нумерация на этом ` +
      `листе не работает.`,
    );
  }
  if (notes.length === 0) notes.push('Нумерация сквозная: адрес есть у каждой счётной строки, повторов и пропусков нет.');

  return {
    rows: rows.length,
    countable: countableRows.length,
    numbered: numberedRows.length,
    countableWithoutSeq: countableNoSeq.length,
    coveragePct,
    range,
    gaps: gaps.slice(0, SHOWN_GAPS),
    gapCount: missing.length,
    duplicates,
    unnumbered: [...countableNoSeq]
      .sort((a, b) => (b.planSum ?? 0) - (a.planSum ?? 0))
      .slice(0, SHOWN_ROWS)
      .map((r) => ({ sheetRow: r.sheetRow, subject: r.subject, planSum: r.planSum ?? null })),
    note: notes.join(' '),
  };
}
