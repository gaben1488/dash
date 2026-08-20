/**
 * Целостность зеркал книги — проверки УРОВНЯ КНИГИ, а не листа.
 *
 * В книге управления есть общий лист «ВСЕ» и листы отдельных учреждений.
 * Листы учреждений — зеркала: строки приходят туда формулами из общего листа.
 * Пока зеркало исправно, обе стороны показывают одно и то же; когда оно
 * рвётся, учреждение перестаёт видеть свои закупки, а руководитель этого не
 * замечает — оба листа выглядят заполненными.
 *
 * Существующие проверки этого не ловят по устройству: правило сквозной
 * нумерации смотрит внутрь одного листа, гигиена текста — внутрь одной ячейки.
 * Разрыв зеркала виден только при сопоставлении листов между собой.
 *
 * Живой замер книги управления образования (19.08.2026, полный снимок):
 * · 2 604 строки листов учреждений нашлись в общем листе — зеркала работают;
 * · 66 строк школы № 7 (номера 212–302) в общий лист попали, а на лист школы
 *   нет: диапазон формул протянут не до конца. Среди потерянных —
 *   теплоснабжение на 15 678,53 тыс. и электроэнергия на 3 964,20 тыс.;
 * · 5 строк детского сада № 3 записаны с именем «ДС №3» без пробела, тогда
 *   как у остальных 43 строк того же сада — «ДС № 3»: зеркало ищет точное имя
 *   и эти строки не подхватывает;
 * · 33 номера по порядку стоят сразу на двух листах («Ромашка» и «Радуга») —
 *   адрес строки перестаёт быть однозначным;
 * · 2 строки совпали номером, но плановая сумма разошлась на копейку — там
 *   формула зеркала заменена ручным значением.
 *
 * Сопоставление идёт по номеру по порядку (колонка A): единственный адрес,
 * переживающий перемещения строк (канон п.98б, п.105).
 */

/** Строка листа в том виде, в каком её видит проверка. */
export interface MirrorRow {
  /** Номер по порядку (колонка A). Пустой — строка неадресуема. */
  rowSeq: string;
  /** Номер строки листа на момент чтения. */
  sheetRow: number;
  /** Учреждение (колонка C) — как записано в этой строке. */
  subordinate?: string;
  /** Предмет закупки (колонка G). */
  subject?: string;
  /** Плановая сумма, тыс. руб. */
  planSum?: number | null;
}

/** Книга: общий лист и листы учреждений. */
export interface MirrorBook {
  /** Строки листа «ВСЕ». */
  all: readonly MirrorRow[];
  /** Листы учреждений: имя листа → строки. */
  sheets: Readonly<Record<string, readonly MirrorRow[]>>;
}

export type MirrorFindingKind =
  /** Строка есть в общем листе, но ни на одном листе учреждения. */
  | 'missing-in-sheet'
  /** Строка есть на листе учреждения, но не в общем листе. */
  | 'missing-in-all'
  /** Номер совпал, плановая сумма разошлась. */
  | 'plan-mismatch'
  /** Один номер по порядку на двух листах учреждений. */
  | 'duplicate-across-sheets';

export interface MirrorFinding {
  kind: MirrorFindingKind;
  rowSeq: string;
  /** Механизм: что именно произошло с данными. */
  mechanism: string;
  /** Что делать и кому (канон п.53). */
  action: string;
  /** Адреса обеих сторон, насколько они известны. */
  addresses: string[];
  /** Деньги под вопросом — чтобы разбор шёл от крупного. */
  planSum?: number | null;
  // Предмет и учреждение берутся из строки книги и там бывают пустыми. Для
  // находки «поля нет» и «поле есть, но неизвестно» — один и тот же случай,
  // поэтому undefined разрешён явно: это не недосмотр, а описание жизни.
  subject?: string | undefined;
  subordinate?: string | undefined;
}

export interface MirrorReport {
  findings: MirrorFinding[];
  /** Сколько строк листов учреждений нашлось в общем листе. */
  matched: number;
  /** Строк в общем листе и на листах учреждений. */
  totals: { all: number; sheets: number; sheetCount: number };
  /** Строк без номера по порядку — их судьбу проследить нечем. */
  unkeyed: { all: number; sheets: number };
  note: string;
}

/** Допуск сравнения сумм: копейка. Всё, что крупнее, — расхождение. */
const MONEY_TOLERANCE = 0.01;

function indexBySeq(rows: readonly MirrorRow[]): {
  map: Map<string, MirrorRow>;
  unkeyed: number;
} {
  const map = new Map<string, MirrorRow>();
  let unkeyed = 0;
  for (const r of rows) {
    const key = String(r.rowSeq ?? '').trim();
    if (!key) {
      unkeyed += 1;
      continue;
    }
    if (!map.has(key)) map.set(key, r);
  }
  return { map, unkeyed };
}

/** Сверка зеркал книги: общий лист против листов учреждений. */
export function checkMirrorIntegrity(book: MirrorBook): MirrorReport {
  const all = indexBySeq(book.all);
  const findings: MirrorFinding[] = [];

  // Сводим все листы учреждений в один указатель, попутно ловя номера,
  // которые встречаются на двух листах сразу.
  const bySeq = new Map<string, { sheet: string; row: MirrorRow }>();
  let sheetRowCount = 0;
  let sheetUnkeyed = 0;
  for (const [sheet, rows] of Object.entries(book.sheets)) {
    const idx = indexBySeq(rows);
    sheetRowCount += rows.length;
    sheetUnkeyed += idx.unkeyed;
    for (const [seq, row] of idx.map) {
      const seen = bySeq.get(seq);
      if (seen) {
        findings.push({
          kind: 'duplicate-across-sheets',
          rowSeq: seq,
          mechanism:
            `Номер по порядку ${seq} стоит сразу на двух листах учреждений: ` +
            `«${seen.sheet}» и «${sheet}». Номер — адрес строки; когда один ` +
            `адрес указывает на две закупки, ссылка на строку перестаёт быть ` +
            `однозначной, а сверки начинают путать строки местами.`,
          action:
            `Владельцу книги: развести номера — оставить номер за одной строкой, ` +
            `второй присвоить свободный, и протянуть нумерацию заново.`,
          addresses: [`${seen.sheet}!A${seen.row.sheetRow}`, `${sheet}!A${row.sheetRow}`],
          subject: row.subject ?? seen.row.subject,
        });
        continue;
      }
      bySeq.set(seq, { sheet, row });
    }
  }

  let matched = 0;
  for (const [seq, { sheet, row }] of bySeq) {
    const inAll = all.map.get(seq);
    if (!inAll) {
      findings.push({
        kind: 'missing-in-all',
        rowSeq: seq,
        mechanism:
          `Строка есть на листе учреждения «${sheet}», но её нет в общем листе ` +
          `книги. Свод района считает по общему листу — плановые и фактические ` +
          `суммы этой закупки в него не попадают.`,
        action:
          `Владельцу книги: проверить, почему строка не отражена в общем листе — ` +
          `внести её либо восстановить формулу переноса.`,
        addresses: [`${sheet}!A${row.sheetRow}`],
        planSum: row.planSum ?? null,
        subject: row.subject,
      });
      continue;
    }
    matched += 1;
    const a = row.planSum;
    const b = inAll.planSum;
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > MONEY_TOLERANCE) {
      findings.push({
        kind: 'plan-mismatch',
        rowSeq: seq,
        mechanism:
          `Номер по порядку совпал, а плановая сумма разошлась: на листе ` +
          `«${sheet}» ${a} тыс., в общем листе ${b} тыс. Зеркало показывает ` +
          `одно значение, свод считает другое — значит формула переноса в этой ` +
          `строке заменена значением, введённым вручную.`,
        action:
          `Владельцу книги: решить, какая сумма верна, и восстановить формулу ` +
          `переноса — иначе при следующей правке расхождение вырастет.`,
        addresses: [`${sheet}!A${row.sheetRow}`, `ВСЕ!A${inAll.sheetRow}`],
        planSum: b,
        subject: inAll.subject ?? row.subject,
      });
    }
  }

  for (const [seq, row] of all.map) {
    if (bySeq.has(seq)) continue;
    findings.push({
      kind: 'missing-in-sheet',
      rowSeq: seq,
      mechanism:
        `Строка есть в общем листе книги, но не отражена ни на одном листе ` +
        `учреждения. Учреждение своей закупки не видит: либо диапазон формул ` +
        `на его листе протянут не до конца, либо имя учреждения в этой строке ` +
        `записано иначе, чем ищет зеркало.`,
      action:
        `Владельцу книги: сверить имя учреждения в строке со справочником и ` +
        `протянуть формулы зеркала до конца данных.`,
      addresses: [`ВСЕ!A${row.sheetRow}`],
      planSum: row.planSum ?? null,
      subject: row.subject,
      subordinate: row.subordinate,
    });
  }

  // Крупные деньги — первыми: разбор начинают с того, что двигает итог.
  findings.sort((x, y) => (y.planSum ?? 0) - (x.planSum ?? 0));

  const parts: string[] = [];
  if (findings.length === 0) {
    parts.push('Зеркала листов учреждений исправны: общий лист и листы учреждений сходятся строка в строку.');
  } else {
    parts.push(`Расхождений зеркал: ${findings.length}.`);
  }
  if (all.unkeyed > 0 || sheetUnkeyed > 0) {
    parts.push(
      `Строк без номера по порядку: в общем листе ${all.unkeyed}, на листах ` +
      `учреждений ${sheetUnkeyed} — их судьбу сверка проследить не может, ` +
      `нумерацию нужно восстановить.`,
    );
  }

  return {
    findings,
    matched,
    totals: { all: book.all.length, sheets: sheetRowCount, sheetCount: Object.keys(book.sheets).length },
    unkeyed: { all: all.unkeyed, sheets: sheetUnkeyed },
    note: parts.join(' '),
  };
}
