/**
 * Сверка КАЖДОЙ СТРОКИ реестра со строкой книги управления — указатель
 * «код процедуры → встречная сторона» (канон п.101а дословно: «маппинг с
 * книгами ГРБС по каждой строке»).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ДОМ, А НЕ ВТОРАЯ ЧИТАЛКА ОТВЕТА. До этого модуля у роута
 * `/api/monitoring/match` было ДВА читателя с разными представлениями о его
 * форме: панель аналитики читала живую (`normalizeMatchView` — `matched`,
 * `bookOnly`, `monitoringOnly`, `ambiguous`, `listCells`), а карточка строки
 * — выдуманную (`normalizeMatch` — `rows`, `outcomes`, `internalDiff`).
 * Второй читатель молча возвращал `null` на каждом ответе, и полоса «Сверка
 * со строкой книги управления» в карточке КАЖДОЙ процедуры писала «сверка не
 * подключена» при живом и работающем роуте. Один сигнал — один дом (канон
 * п.132): указатель строится из ТОГО ЖЕ разобранного ответа, которым живёт
 * панель, и разойтись им теперь нечем.
 *
 * ОТВЕТ, А НЕ ОТМЕТКА (требование владельца «по каждому сигналу виден ответ:
 * какая строка, что в ней, почему»). Пары нет — карточка обязана сказать, ЧТО
 * это значит, и вариантов здесь четыре разных, а не один:
 *   • пара нашлась — назван адрес книги, обе суммы и вердикт по каждой;
 *   • код есть в мониторинге, а строки с ним в книгах управлений нет;
 *   • код нашёлся у нескольких строк — в разных книгах это штатная форма
 *     совместной закупки, в одной книге это уже аномалия заполнения;
 *   • код лежит в ячейке-списке книги — парная сверка сумм по такой ячейке
 *     невозможна в принципе, и молчать об этом значит обещать сверку, которой
 *     не будет.
 * Пятое состояние — «книги управлений не прочитаны» — про источник, а не про
 * строку, и живёт в `booksRead`: пустой список означает, что сверять было не с
 * чем, и это НЕ «пары не нашлось» (канон п.36, три рода пустоты).
 *
 * ДЕНЬГИ ОБЕИХ СТОРОН — РУБЛИ. Книги управлений ведутся в тысячах, и сервер
 * умножает их план и факт на тысячу ДО сравнения (routes/monitoring.ts,
 * оговорка в `notes` ответа). Здесь числа уже приведены — второго умножения
 * быть не должно.
 */
import type {
  InternalDiffRow, MatchViewPayload, MoneyComparison,
} from './analytics-contract';
import { fmtPct, fmtRubExact } from './format';

/** Чем кончилась сверка этой строки. Пятого исхода у одной строки не бывает. */
export type RowMatchKind =
  | 'matched'
  | 'monitoring-only'
  | 'ambiguous'
  | 'list-cell';

export interface RowMatch {
  readonly code: string;
  readonly kind: RowMatchKind;
  /** Короткое имя книги управления («УО»); неизвестно — null. */
  readonly bookLabel: string | null;
  /** Адрес встречной строки «УО:214» — провенанс числа книги. */
  readonly bookRowKey: string | null;
  /** Адрес строки мониторинга «УКСиМП:38», как его назвал сервер. */
  readonly sheetRowKey: string | null;
  /** Начальная цена: книга против мониторинга. Нет пары — null. */
  readonly nmck: MoneyComparison | null;
  /** Факт книги против цены победителя. Нет пары — null. */
  readonly fact: MoneyComparison | null;
  /** Адреса другой стороны при неоднозначности либо ячейке-списке. */
  readonly addresses: readonly string[];
  /** Что произошло — одной фразой, тоном механизма (п.104). */
  readonly summary: string;
  /** Вердикт по каждому сравнению словами и с размером расхождения. */
  readonly verdicts: readonly string[];
}

export interface MatchIndex {
  /** Код процедуры → её встречная сторона. */
  readonly byCode: ReadonlyMap<string, RowMatch>;
  /** Расхождение «лист управления ↔ 25-26» по тому же коду. */
  readonly internalByCode: ReadonlyMap<string, InternalDiffRow>;
  /**
   * Какие книги управлений прочитаны. Пусто — сверять было не с чем, и
   * отсутствие пары у строки НИЧЕГО не значит: это пустота источника.
   */
  readonly booksRead: readonly string[];
  /** Сколько строк книг управлений несут код процедуры — знаменатель сверки. */
  readonly bookRowsWithCode: number;
  /** Момент чтения книг сверки — своя ось периметра, не момент реестра. */
  readonly readAt: string;
}

/** Вердикт по одной паре сумм. Размер расхождения называется, а не «не сходится». */
function moneyVerdict(label: string, m: MoneyComparison): string {
  if (m.agrees === true) {
    return `${label}: сходится с книгой управления — ${fmtRubExact(m.bookRub)} руб.`;
  }
  if (m.agrees === false) {
    const rel = m.relDiff === null ? '' : ` (${fmtPct(m.relDiff * 100)})`;
    return `${label}: расходится — книга ${fmtRubExact(m.bookRub)} руб.,`
      + ` мониторинг ${fmtRubExact(m.monitoringRub)} руб.,`
      + ` разница ${fmtRubExact(m.deltaRub)} руб.${rel}`;
  }
  // Сравнивать нечего — но «нечего» бывает с двух разных сторон, и назвать
  // сторону обязательно: иначе читатель пойдёт искать пропажу не в той книге.
  if (m.bookRub === null && m.monitoringRub === null) {
    return `${label}: сравнивать нечего — суммы нет ни в книге управления, ни в мониторинге.`;
  }
  if (m.bookRub === null) {
    return `${label}: сравнивать не с чем — в строке книги управления суммы нет`
      + ` (в мониторинге ${fmtRubExact(m.monitoringRub)} руб.).`;
  }
  return `${label}: сравнивать не с чем — в строке мониторинга суммы нет`
    + ` (в книге управления ${fmtRubExact(m.bookRub)} руб.).`;
}

/**
 * Указатель по разобранному ответу сверки. `null` на входе — ответа нет вовсе
 * (роут не поднят либо отказал), и указателя тоже нет: выдуманной сверки не
 * бывает.
 */
export function buildMatchIndex(view: MatchViewPayload | null): MatchIndex | null {
  if (view === null) return null;

  const byCode = new Map<string, RowMatch>();

  for (const m of view.matched) {
    byCode.set(m.code, {
      code: m.code,
      kind: 'matched',
      bookLabel: m.book === '' ? null : m.book,
      bookRowKey: m.bookRowKey === '' ? null : m.bookRowKey,
      sheetRowKey: m.procKey === '' ? null : m.procKey,
      nmck: m.nmck,
      fact: m.fact,
      addresses: [],
      summary: m.bookRowKey === ''
        ? 'Пара в книге управления найдена.'
        : `Пара найдена: книга ${m.book}, строка ${m.bookRowKey}.`,
      verdicts: [
        moneyVerdict('Начальная цена', m.nmck),
        moneyVerdict('Факт книги против цены победителя', m.fact),
      ],
    });
  }

  for (const u of view.monitoringOnly) {
    if (byCode.has(u.code)) continue;
    byCode.set(u.code, {
      code: u.code,
      kind: 'monitoring-only',
      bookLabel: null,
      bookRowKey: null,
      sheetRowKey: u.addresses[0] ?? null,
      nmck: null,
      fact: null,
      addresses: u.addresses,
      summary: 'Строки с этим кодом в прочитанных книгах управлений нет.',
      verdicts: [
        'Сверять не с чем: код процедуры есть в книге мониторинга, а в колонке AG книг'
        + ' управлений строки с ним не нашлось. Это состояние источника, а не расхождение сумм.',
      ],
    });
  }

  for (const a of view.ambiguous) {
    byCode.set(a.code, {
      code: a.code,
      kind: 'ambiguous',
      bookLabel: null,
      bookRowKey: null,
      sheetRowKey: a.procedureAddresses[0] ?? null,
      nmck: null,
      fact: null,
      addresses: a.bookAddresses,
      summary: a.sameBook
        ? 'Код нашёлся у нескольких строк ОДНОЙ книги управления.'
        : 'Код нашёлся в нескольких книгах управлений.',
      verdicts: [
        a.sameBook
          ? 'Парная сверка сумм не строится: в одной книге у кода больше одной строки —'
            + ' совместной закупкой это не объясняется.'
          : 'Парная сверка сумм не строится: каждое управление ведёт свою долю совместной'
            + ' закупки, и «правильной» одной строки у кода нет.',
        `Строки книг: ${a.bookAddresses.join(', ')}`,
      ].filter((v) => !v.endsWith(': ')),
    });
  }

  for (const cell of view.listCells) {
    for (const code of cell.codes) {
      if (byCode.has(code)) continue;
      byCode.set(code, {
        code,
        kind: 'list-cell',
        bookLabel: null,
        bookRowKey: cell.address === '' ? null : cell.address,
        sheetRowKey: null,
        nmck: null,
        fact: null,
        addresses: [cell.address].filter((s) => s !== ''),
        summary: `Код записан в ячейке-списке книги управления (${cell.address}).`,
        verdicts: [
          'Парная сверка сумм по такой ячейке невозможна: одна строка книги отвечает сразу'
          + ` за ${cell.codes.length} кодов, и разделить её план и факт между ними нечем.`,
        ],
      });
    }
  }

  const internalByCode = new Map<string, InternalDiffRow>();
  for (const row of view.internal.rows) {
    if (!internalByCode.has(row.code)) internalByCode.set(row.code, row);
  }

  return {
    byCode,
    internalByCode,
    booksRead: view.books.read,
    bookRowsWithCode: view.books.rowsWithCode,
    readAt: view.source.readAt,
  };
}
