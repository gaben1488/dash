/**
 * monitoring-match.ts — построчный маппинг книг ГРБС ↔ «Ежедневный мониторинг»
 * (реестр процедур определения поставщика) по номеру процедуры.
 *
 * КАНОН п.101а (решения 18.08.2026): маппинг с книгами ГРБС — ПО КАЖДОЙ
 * СТРОКЕ; проблемы маппинга — отдельный класс сигналов. Этот модуль — сама
 * связка и классификация исходов; сигнальный/UI-слой строится поверх.
 *
 * КАНОН п.102 (семантический сдвиг плановых сумм): исполнители начали писать
 * в H/I/J/K книг НМЦК из заявок вместо лимитов бюджетных обязательств.
 * Проверка данными — по построчному маппингу сверить K книги (тыс. руб.)
 * с НМЦК процедуры мониторинга (руб.): где |K×1000 − НМЦК| в пределах 1 %,
 * там практика «пишут НМЦК» подтверждена; где нет — либо лимиты (старая
 * семантика, УДТХ), либо третья семантика УКСиМП «НМЦК минус изъятая
 * экономия». Модуль считает сравнение, вывод о семантике — за отчётом.
 *
 * Ключ связки — канонический код процедуры («ЭА152-26»): обе стороны
 * нормализуются одним парсером @aemr/shared (extractProcedureRefs — и для
 * ячейки AG книги, и для колонки C мониторинга, где код и предмет живут
 * одной строкой). Искажённые коды не чинятся молча (канон п.74); чистоту
 * ячейки AG (код без приписки) отличает parseProcedureRef у сигнального слоя.
 *
 * ЕДИНИЦЫ: книги ГРБС — ТЫСЯЧИ рублей, мониторинг — РУБЛИ. Перевод один и
 * живёт здесь (THOUSANDS_TO_RUB), чтобы отчёты и сигналы не плодили копий.
 */

import { extractProcedureRefs } from '@aemr/shared';

/** Книги хранят тысячи, мониторинг — рубли (шапки: «тыс. руб.» ↔ «руб.»). */
export const THOUSANDS_TO_RUB = 1000;

/**
 * Порог согласия сумм — 1 % (доля, не проценты). Выбран по п.102: K книги
 * хранится в тысячах с точностью до 0,01 тыс. (10 руб.), поэтому честное
 * «то же число» после перевода единиц расходится максимум на копейки-рубли,
 * а лимит против НМЦК расходится на проценты и десятки процентов.
 */
export const NMCK_AGREEMENT_TOLERANCE = 0.01;

/** Строка книги ГРБС на входе матчера (лист «ВСЕ», без шапки и служебных строк). */
export interface MonitoringBookRow {
  /** Адрес строки у вызывающего: «УЭР:5» (книга + номер строки листа). */
  readonly rowKey: string;
  /** Короткое имя книги ГРБС («УЭР», «УО», …) — для разреза отчёта по управлениям. */
  readonly book: string;
  /** Сырая ячейка AG (номер процедуры, канон п.74). */
  readonly ag: unknown;
  /** K книги — «ИТОГО 1» (план), тыс. руб.; null = пусто/нечисло. */
  readonly planTotalThousands: number | null;
  /** Y книги — «ИТОГО 2» (факт), тыс. руб.; null = пусто/нечисло. */
  readonly factTotalThousands: number | null;
}

/** Строка-процедура «Ежедневного мониторинга» (листы управлений и журнал «25-26»). */
export interface MonitoringProcedureRow {
  /** Адрес процедуры: «1. УЭР:7» (лист + номер строки). */
  readonly procKey: string;
  /** Имя листа мониторинга — журнал «25-26» дублирует листы управлений. */
  readonly sheet: string;
  /** Колонка C — «код + предмет» одной строкой («ЭА152-26 Ремонт …»). */
  readonly nameCell: unknown;
  /** Колонка D — НМЦК, руб.; null = пусто/нечисло. */
  readonly nmckRub: number | null;
  /** Колонка I — цена аукциона (цена победителя), руб.; null = пусто/нечисло. */
  readonly winnerPriceRub: number | null;
}

/**
 * Классы исходов построчного маппинга (п.101а: проблемы маппинга — отдельный
 * класс сигналов, поэтому исходы — закрытый словарь, а не свободный текст).
 */
export type MonitoringMatchOutcome =
  | 'matched'
  | 'code-in-book-not-in-monitoring'
  | 'monitoring-without-book-row'
  | 'ambiguous';

/**
 * Сравнение денег книга↔мониторинг в рублях.
 * agrees === null — сравнивать нечего (одна из сторон пуста), это НЕ провал
 * сверки: отсутствие числа сигналится отдельно от расхождения чисел.
 */
export interface MoneyComparison {
  /** Сторона книги, руб. (тыс. × 1000); null = в книге пусто. */
  readonly bookRub: number | null;
  /** Сторона мониторинга, руб.; null = в мониторинге пусто. */
  readonly monitoringRub: number | null;
  /** book − monitoring, руб.; null, если любая сторона пуста. */
  readonly deltaRub: number | null;
  /** |delta| / max(|book|, |monitoring|); 0 при равенстве, null — нет сравнения. */
  readonly relDiff: number | null;
  /** relDiff ≤ порога; null — нет сравнения. */
  readonly agrees: boolean | null;
}

/** Строка книги ↔ процедура мониторинга: код совпал, суммы сверены. */
export interface MonitoringMatch {
  readonly outcome: 'matched';
  readonly code: string;
  readonly bookRow: MonitoringBookRow;
  /**
   * Все строки мониторинга с этим кодом: журнал «25-26» штатно дублирует
   * листы управлений, поэтому >1 записи — норма, а не дубль-ошибка.
   */
  readonly procedures: readonly MonitoringProcedureRow[];
  /** Процедура, по которой считались сравнения (минимальный |Δ НМЦК|). */
  readonly primary: MonitoringProcedureRow;
  /** Проверка п.102: K книги ↔ НМЦК мониторинга. */
  readonly nmck: MoneyComparison;
  /** Сверка факта: Y книги ↔ цена победителя. */
  readonly fact: MoneyComparison;
}

/** Код есть в AG книги, но мониторинг такой процедуры не знает. */
export interface BookOnlyCode {
  readonly outcome: 'code-in-book-not-in-monitoring';
  readonly code: string;
  readonly bookRow: MonitoringBookRow;
}

/** Процедура мониторинга, на которую не ссылается ни одна строка книг. */
export interface MonitoringOnlyCode {
  readonly outcome: 'monitoring-without-book-row';
  readonly code: string;
  readonly procedures: readonly MonitoringProcedureRow[];
}

/**
 * Дубль кода на стороне книг: >1 строки претендуют на одну процедуру —
 * связка строка↔процедура не 1:1, суммы не сверяются (какую K сверять?).
 *
 * Два разных механизма под одним классом (различает sameBook):
 *  - дубль В РАЗНЫХ книгах — штатная форма совместного аукциона (ЭАС):
 *    каждый ГРБС ведёт свою долю одной процедуры (живой пример дампа
 *    18.08: ЭАС258-26 в УЭР, УКСиМП, УАГЗО и УДТХ одновременно);
 *  - дубль ВНУТРИ одной книги — реальная аномалия заполнения (живой
 *    пример: ЭА138-26 дважды в УДТХ), сигналить как проблему маппинга.
 */
export interface AmbiguousCode {
  readonly outcome: 'ambiguous';
  readonly code: string;
  readonly bookRows: readonly MonitoringBookRow[];
  readonly procedures: readonly MonitoringProcedureRow[];
  /** true — есть ≥2 строки одной и той же книги (аномалия, не ЭАС-доли). */
  readonly sameBook: boolean;
}

/**
 * Ячейка AG со СПИСКОМ кодов («ЭЕП103-26, ЭЕП104-26, …»): одна строка плана
 * дробится на несколько процедур (школьные списки УО, канон п.74). K строки —
 * сумма по списку, поэтому в парную сверку НМЦК такие строки не идут; их коды
 * при этом закрывают процедуры мониторинга от класса «без строки книги».
 */
export interface ListCellRow {
  readonly bookRow: MonitoringBookRow;
  readonly codes: readonly string[];
  /** Коды списка, которых мониторинг не знает. */
  readonly missingInMonitoring: readonly string[];
}

/** Полный результат построчного маппинга. */
export interface MonitoringMatchResult {
  readonly matched: readonly MonitoringMatch[];
  readonly bookOnly: readonly BookOnlyCode[];
  readonly monitoringOnly: readonly MonitoringOnlyCode[];
  readonly ambiguous: readonly AmbiguousCode[];
  readonly listCells: readonly ListCellRow[];
}

/**
 * Сравнение сумм книга (тыс.) ↔ мониторинг (руб.) с порогом согласия.
 * Обе стороны нули — согласие (0 ≡ 0); одна сторона пуста — сравнения нет.
 */
export function compareMoney(
  bookThousands: number | null,
  monitoringRub: number | null,
  tolerance: number = NMCK_AGREEMENT_TOLERANCE,
): MoneyComparison {
  const bookRub = bookThousands === null ? null : bookThousands * THOUSANDS_TO_RUB;
  if (bookRub === null || monitoringRub === null) {
    return { bookRub, monitoringRub, deltaRub: null, relDiff: null, agrees: null };
  }
  const deltaRub = bookRub - monitoringRub;
  const scale = Math.max(Math.abs(bookRub), Math.abs(monitoringRub));
  const relDiff = scale === 0 ? 0 : Math.abs(deltaRub) / scale;
  return { bookRub, monitoringRub, deltaRub, relDiff, agrees: relDiff <= tolerance };
}

/**
 * Индекс процедур мониторинга: канонический код → все строки с этим кодом.
 * Ячейка C с несколькими кодами регистрирует строку под каждым (совместные
 * аукционы в журнале описываются перечислением). Ячейки без единого валидного
 * кода в индекс не попадают — их адресует сигнал «нераспознанный код
 * в мониторинге», не эта функция.
 */
export function indexMonitoringProcedures(
  procedures: Iterable<MonitoringProcedureRow>,
): Map<string, MonitoringProcedureRow[]> {
  const byCode = new Map<string, MonitoringProcedureRow[]>();
  for (const proc of procedures) {
    for (const ref of extractProcedureRefs(proc.nameCell)) {
      const bucket = byCode.get(ref.code);
      if (bucket === undefined) byCode.set(ref.code, [proc]);
      else bucket.push(proc);
    }
  }
  return byCode;
}

/**
 * Построчный маппинг: каждая строка книги с кодом в AG получает исход из
 * закрытого словаря, каждая процедура мониторинга — либо строку книги, либо
 * класс «без строки книги». Строки книги без кода (пусто, плейсхолдер,
 * посторонний текст) — вне связки: их разбирает detectForeignText (п.74б).
 */
export function matchMonitoring(
  bookRows: readonly MonitoringBookRow[],
  procedureRows: readonly MonitoringProcedureRow[],
): MonitoringMatchResult {
  const procIndex = indexMonitoringProcedures(procedureRows);

  // Первый проход: раскладываем строки книг по каноническим кодам.
  // Ровно один код в ячейке — заявка строки на процедуру, даже если рядом
  // приписка («код + текст», школьные ячейки УО): маппинг держится (п.101а),
  // посторонний текст — отдельный сигнал detectForeignText (п.74б), не отказ
  // от связки. Ноль валидных кодов (пусто, плейсхолдер, искажение) — вне
  // связки: искажённое не чинится молча (канон п.74).
  const singleByCode = new Map<string, MonitoringBookRow[]>();
  const listCells: ListCellRow[] = [];
  const codesCoveredByLists = new Set<string>();
  for (const row of bookRows) {
    const refs = extractProcedureRefs(row.ag);
    if (refs.length === 1) {
      const code = refs[0].code;
      const bucket = singleByCode.get(code);
      if (bucket === undefined) singleByCode.set(code, [row]);
      else bucket.push(row);
    } else if (refs.length > 1) {
      const codes = refs.map((r) => r.code);
      for (const code of codes) codesCoveredByLists.add(code);
      listCells.push({
        bookRow: row,
        codes,
        missingInMonitoring: codes.filter((code) => !procIndex.has(code)),
      });
    }
  }

  // Второй проход: классификация исходов по кодам.
  const matched: MonitoringMatch[] = [];
  const bookOnly: BookOnlyCode[] = [];
  const ambiguous: AmbiguousCode[] = [];
  for (const [code, rows] of singleByCode) {
    const procedures = procIndex.get(code) ?? [];
    if (rows.length > 1) {
      const books = new Set(rows.map((r) => r.book));
      ambiguous.push({
        outcome: 'ambiguous',
        code,
        bookRows: rows,
        procedures,
        sameBook: books.size < rows.length,
      });
      continue;
    }
    const bookRow = rows[0];
    if (procedures.length === 0) {
      bookOnly.push({ outcome: 'code-in-book-not-in-monitoring', code, bookRow });
      continue;
    }
    // Опорная процедура — с минимальным |Δ НМЦК| к K книги: журнал «25-26»
    // и лист управления могут нести чуть разные копейки, сверяем ближайшую.
    let primary = procedures[0];
    let primaryNmck = compareMoney(bookRow.planTotalThousands, primary.nmckRub);
    for (const candidate of procedures.slice(1)) {
      const cmp = compareMoney(bookRow.planTotalThousands, candidate.nmckRub);
      const better =
        (primaryNmck.relDiff === null && cmp.relDiff !== null) ||
        (cmp.relDiff !== null && primaryNmck.relDiff !== null && cmp.relDiff < primaryNmck.relDiff);
      if (better) {
        primary = candidate;
        primaryNmck = cmp;
      }
    }
    matched.push({
      outcome: 'matched',
      code,
      bookRow,
      procedures,
      primary,
      nmck: primaryNmck,
      fact: compareMoney(bookRow.factTotalThousands, primary.winnerPriceRub),
    });
  }

  // Третий проход: процедуры мониторинга, на которые книги не ссылаются
  // ни строгой ячейкой, ни списком кодов.
  const monitoringOnly: MonitoringOnlyCode[] = [];
  for (const [code, procedures] of procIndex) {
    if (singleByCode.has(code) || codesCoveredByLists.has(code)) continue;
    monitoringOnly.push({ outcome: 'monitoring-without-book-row', code, procedures });
  }

  return { matched, bookOnly, monitoringOnly, ambiguous, listCells };
}
