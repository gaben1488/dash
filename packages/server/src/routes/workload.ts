/**
 * /api/workload — нагрузка управлений и три рода событий над строками
 * (канон п.103 и п.105, прямые идеи владельца 18.08.2026).
 *
 * ЗАЧЕМ. Замер журналов правок показал разброс в сотни раз: у УО 33 724
 * записи, у УИО — 13. Само по себе это число не значит ничего: у управления
 * образования 44 учреждения и две с половиной тысячи строк, у управления
 * имущества — одна организация и семь десятков строк. Сравнимой нагрузка
 * становится только отношениями — правок на строку, строк на учреждение,
 * правок на учреждение. Ядро их считает (analytics/workload.ts), но до сих
 * пор наружу они не выходили вовсе: расчёт был, роута не было (маяк, Г-02).
 *
 * ВТОРАЯ ПОЛОВИНА ОТВЕТА — РОД СОБЫТИЯ. Журнал книги пишет ЯЧЕЙКИ, а не
 * строки: одно добавление закупки выглядит как десяток записей «было пусто —
 * стало значение» в одну минуту. Ядро (analytics/journal-events.ts)
 * восстанавливает из этого три рода: добавили закупку, поправили ячейки,
 * очистили строку. Четвёртого рода — удаления строки — журнал не видит в
 * принципе: строка, убранная через меню таблицы, не порождает ни одной правки
 * ячейки. Поэтому ответ несёт признак deletionsUnobservable, и ноль удалений
 * здесь означает «не наблюдаемо», а не «не случалось» (пропажи ищет
 * сравнение снимков по № п/п — analytics/vanished-rows.ts).
 *
 * ЧЕСТНОСТЬ ПРЕЖДЕ ПОЛНОТЫ. Меры считаются ТОЛЬКО по книге, у которой
 * прочитано и то, и другое — и строки, и журнал. Книга без строк с
 * прочитанным журналом дала бы editsPerRow=null → признак «слепой журнал»,
 * то есть подпись «журнал почти не ведётся» там, где на самом деле нечем
 * поделить. Книга без журнала при живых строках дала бы ноль правок, то есть
 * «работы нет» вместо «мы не смотрели». Обе подмены запрещены: такие книги
 * идут в ответе отдельными строками с пустыми мерами и названной причиной.
 *
 * ТОН — ИЗМЕРЕНИЕ ТРУДОЁМКОСТИ, НЕ РЕЙТИНГ ВИНЫ (канон п.103). Много правок
 * — признак живой работы; мало правок при живых закупках — чаще признак того,
 * что журнал не ведётся, а не того, что работы нет. Роут нигде не расставляет
 * управления по «качеству» и не выводит из чисел оценки.
 *
 * ЦЕНА ЗАПРОСА. Открываются журналы ВСЕХ восьми книг (около 40 тыс. записей
 * суммарно) — столько же, сколько стоит /api/changes и /api/provenance/health,
 * поэтому и правило частоты то же. Сверх журналов ответ кэшируется на пять
 * минут: разбор 40 тыс. записей на события повторять на каждое открытие
 * вкладки незачем, а момент чтения (asOf) в ответе всегда назван — канон п.58.
 */
import type { FastifyInstance } from 'fastify';
import {
  DEPT_COLUMNS,
  collectRowsByDept,
  findDept,
  subordinateKey,
  type DepartmentEntry,
} from '@aemr/shared';
import {
  classifyJournalEvents,
  parseJournalInstant,
  workloadReport,
  type DeptWorkload,
  type DeptWorkloadInput,
  type JournalEntry,
  type JournalObservability,
} from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';
import { readAllBookJournals, type BookJournal } from '../services/provenance-journal.js';

/** Что удалось прочитать по строкам одной книги. */
interface BookRows {
  /** Строк-закупок (шапки, итоги и разделы не в счёт). */
  rows: number;
  /**
   * Различных значений колонки C, включая само управление: аппарат ГРБС —
   * такой же заказчик, как подвед, и выкидывать его из знаменателя значит
   * завышать нагрузку на учреждение у книг без подведов.
   */
  subordinates: number;
}

/** Одна строка ответа: книга с мерами либо с честно пустыми мерами. */
export interface WorkloadBook {
  /** Кириллический канон-идентификатор книги («УО»). */
  dept: string;
  deptLatin: string;
  deptName: string;
  sheetName: string;
  /** false — строк книги нет ни в живом кэше, ни в снимке. */
  rowsAvailable: boolean;
  /** false — лист «_ChangeLog» книги не прочитан (не «правок не было»). */
  journalAvailable: boolean;
  journalError?: string;
  /** null — читать было нечего; 0 означало бы «строк нет», а это неправда. */
  rows: number | null;
  subordinates: number | null;
  journalEntries: number | null;
  editsPerRow: number | null;
  rowsPerSubordinate: number | null;
  editsPerSubordinate: number | null;
  /** null — судить о наблюдаемости не по чему (см. шапку модуля). */
  observability: JournalObservability | null;
  /** Три рода событий по этой книге; null — журнал не прочитан. */
  events: { added: number; cleared: number; edits: number } | null;
  /** Человеческое пояснение строки: механизм, а не оценка. */
  note: string;
}

export interface WorkloadResponse {
  /** Момент чтения (ISO) — плашка периода данных, канон п.58. */
  asOf: string;
  /** Откуда взяты строки книг: живой кэш, сохранённый снимок или ниоткуда. */
  rowsSource: 'live' | 'snapshot' | 'none';
  booksTotal: number;
  /** Книг, по которым меры посчитаны (прочитаны и строки, и журнал). */
  booksMeasured: number;
  /** Книги, чей журнал не прочитан. */
  booksSilent: string[];
  books: WorkloadBook[];
  totals: { rows: number; subordinates: number; journalEntries: number };
  /** Книги со слепым журналом — по ним истории нет. */
  blindDepts: string[];
  /** Во сколько раз самая нагруженная книга тяжелее самой лёгкой. */
  rowsPerSubordinateSpread: number | null;
  events: {
    added: number;
    cleared: number;
    edits: number;
    /** Всегда true: свойство источника, а не результат подсчёта. */
    deletionsUnobservable: true;
    /** Книги, чьи события вошли в сумму. */
    countedBooks: string[];
    note: string;
  };
  notes: string[];
}

/**
 * Строки всех книг, разложенные по идентификатору управления.
 *
 * Порядок источников тот же, что у /api/provenance и /api/timeline: живой кэш
 * книг, затем сохранённый снимок, и только потом честная пустота. Ключ
 * перекладывается на id управления: и кэш, и снимок ключуются ИМЕНЕМ КНИГИ, а
 * «ВСЕ» — это имя вкладки внутри книги, одинаковое у пяти управлений.
 */
async function readRowsByDeptId(): Promise<{
  rows: Record<string, unknown[][]>;
  source: 'live' | 'snapshot' | 'none';
}> {
  const byDeptId = (source: Record<string, unknown[][]>): Record<string, unknown[][]> => {
    const out: Record<string, unknown[][]> = {};
    for (const [name, values] of Object.entries(source)) {
      const dept = findDept(name);
      if (dept) out[dept.id] = values;
    }
    return out;
  };

  const live = byDeptId(collectRowsByDept(getDeptSheetValues()));
  if (Object.keys(live).length > 0) return { rows: live, source: 'live' };

  try {
    const snapshot = await getSnapshot();
    if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
      // Строки снимка шапку уже не содержат — второй срез съел бы три закупки.
      const saved = byDeptId(snapshot.rowsByDept);
      if (Object.keys(saved).length > 0) return { rows: saved, source: 'snapshot' };
    }
  } catch {
    // источники молчат — ответ скажет об этом словами, а не пустым экраном
  }
  return { rows: {}, source: 'none' };
}

/**
 * Строки-закупки и число учреждений одной книги. null — книги в прочитанном
 * нет (это «нечего смотреть», а не «книга пуста»).
 */
export function countBookRows(
  dept: DepartmentEntry,
  rowsByDeptId: Record<string, unknown[][]>,
): BookRows | null {
  const values = rowsByDeptId[dept.id];
  if (!values || values.length === 0) return null;

  const orgs = new Set<string>();
  let rows = 0;
  values.forEach((row, idx) => {
    if (!Array.isArray(row)) return;
    const dto = buildRowDto(row, idx, { deptId: dept.id });
    if (!isDataRow(dto)) return; // шапки, итоги и разделы закупками не являются
    rows += 1;
    orgs.add(subordinateKey(row[DEPT_COLUMNS.SUBORDINATE]));
  });

  return { rows, subordinates: orgs.size };
}

/**
 * Записи журнала книги → вход разбора событий ядра.
 *
 * Время приводится к канону ядра provenance: живые формы разные
 * (Google-serial «46248.6623103», «дд.мм.гггг чч:мм:сс»), а группировка
 * событий идёт по минуте, и без общего разбора одно действие оператора
 * рассыпалось бы на десяток «правок». Записи шестиколоночной схемы (УАГЗО, без
 * поля «Строка») разбору событий не мешают: род события восстанавливается из
 * адреса ячейки и пары было/стало, а ключ закупки здесь не нужен.
 */
export function toJournalEntries(journal: BookJournal): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const record of journal.records) {
    const cell = String(record.cell ?? '').trim();
    if (cell === '') continue;
    const instant = parseJournalInstant(record.at);
    out.push({
      cell,
      was: String(record.was ?? ''),
      became: String(record.became ?? ''),
      // Время не разобралось — запись остаётся, но своей группой: терять
      // правку из-за нечитаемой метки времени нельзя.
      at: instant ? instant.at : String(record.at ?? ''),
      ...(record.author ? { author: String(record.author) } : {}),
    });
  }
  return out;
}

/** Причина, по которой меры книги пусты. Тон диагноста: механизм и действие. */
function unmeasuredNote(dept: string, rowsRead: boolean, journal: BookJournal): string {
  if (!rowsRead && !journal.available) {
    return (
      `${dept}: не прочитаны ни строки книги, ни её журнал правок. Нагрузку измерить не из ` +
      'чего — это отсутствие ответа источника, а не отсутствие работы. Действие: обновить ' +
      'данные и открыть раздел снова.'
    );
  }
  if (!rowsRead) {
    return (
      `${dept}: журнал правок прочитан (${journal.records.length} записей), а строки книги — ` +
      'нет. Отношения «правок на строку» и «строк на учреждение» считать не на что: без ' +
      'знаменателя число правок ничего не говорит о нагрузке. Действие: обновить данные.'
    );
  }
  return (
    `${dept}: строки книги прочитаны, а журнал правок — нет` +
    `${journal.error ? ` (${journal.error})` : ''}. Это не «правок не было»: истории по книге ` +
    'сейчас нет вовсе. Действие: повторить позже; если книга молчит и дальше — проверить ' +
    'доступ служебной учётной записи к ней.'
  );
}

/** Кэш ответа: пять минут — как у журналов, которые он и читает. */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; response: WorkloadResponse } | null = null;

/** Сбрасывает окно кэша — нужен тестам и ручной перечитке. */
export function resetWorkloadCache(): void {
  cached = null;
}

export async function buildWorkloadResponse(now: number = Date.now()): Promise<WorkloadResponse> {
  const journals = await readAllBookJournals(now);
  const journalByDept = new Map(journals.map((j) => [j.dept, j]));
  const { rows: rowsByDeptId, source: rowsSource } = await readRowsByDeptId();

  /** Сырьё книг, у которых прочитано и то, и другое: только их меряет ядро. */
  const measurable: DeptWorkloadInput[] = [];
  /** Книги с пустыми мерами — с названной причиной, а не молча. */
  const unmeasured: WorkloadBook[] = [];
  const eventsByDept = new Map<string, { added: number; cleared: number; edits: number }>();
  const booksSilent: string[] = [];

  const labelsByDept = new Map<string, Pick<WorkloadBook, 'deptLatin' | 'deptName' | 'sheetName'>>();

  for (const deptId of Object.keys(DEPARTMENT_SPREADSHEETS)) {
    const dept = findDept(deptId);
    const journal: BookJournal = journalByDept.get(deptId) ?? {
      dept: deptId,
      available: false,
      records: [],
      rowKeyless: 0,
      rawRows: 0,
      readAt: now,
      error: 'книга отсутствует в реестре источников',
    };
    if (!journal.available) booksSilent.push(deptId);

    labelsByDept.set(deptId, {
      deptLatin: dept?.latinId ?? deptId,
      deptName: dept?.fullName ?? deptId,
      sheetName: dept?.sheetName ?? deptId,
    });

    const counted = dept ? countBookRows(dept, rowsByDeptId) : null;

    // Род событий считается по каждому прочитанному журналу — даже если строк
    // книги нет: события над строками существуют независимо от того, удалось
    // ли сегодня открыть сам лист закупок.
    if (journal.available) {
      const summary = classifyJournalEvents(toJournalEntries(journal));
      eventsByDept.set(deptId, {
        added: summary.added,
        cleared: summary.cleared,
        edits: summary.edits,
      });
    }

    if (counted && journal.available) {
      measurable.push({
        deptId,
        rows: counted.rows,
        subordinates: counted.subordinates,
        journalEntries: journal.records.length,
      });
      continue;
    }

    unmeasured.push({
      dept: deptId,
      ...labelsByDept.get(deptId)!,
      rowsAvailable: counted !== null,
      journalAvailable: journal.available,
      ...(journal.error ? { journalError: journal.error } : {}),
      rows: counted?.rows ?? null,
      subordinates: counted?.subordinates ?? null,
      journalEntries: journal.available ? journal.records.length : null,
      editsPerRow: null,
      rowsPerSubordinate: null,
      editsPerSubordinate: null,
      observability: null,
      events: eventsByDept.get(deptId) ?? null,
      note: unmeasuredNote(deptId, counted !== null, journal),
    });
  }

  const report = workloadReport(measurable);
  const measured: WorkloadBook[] = report.depts.map((d: DeptWorkload) => ({
    dept: d.deptId,
    ...labelsByDept.get(d.deptId)!,
    rowsAvailable: true,
    journalAvailable: true,
    rows: d.rows,
    subordinates: d.subordinates,
    journalEntries: d.journalEntries,
    editsPerRow: d.editsPerRow,
    rowsPerSubordinate: d.rowsPerSubordinate,
    editsPerSubordinate: d.editsPerSubordinate,
    observability: d.observability,
    events: eventsByDept.get(d.deptId) ?? null,
    note: d.note,
  }));

  // Порядок: сперва измеренные (ядро уже расставило их по строкам на
  // учреждение убыванием), затем неизмеримые — ранжировать их не по чему.
  const books = [...measured, ...unmeasured];

  const countedBooks = [...eventsByDept.keys()];
  const eventTotals = countedBooks.reduce(
    (acc, dept) => {
      const e = eventsByDept.get(dept)!;
      return { added: acc.added + e.added, cleared: acc.cleared + e.cleared, edits: acc.edits + e.edits };
    },
    { added: 0, cleared: 0, edits: 0 },
  );

  // Подпись рода событий — из ядра: там же, где живёт правило их различения.
  const eventsNote = classifyJournalEvents([]).note;

  const notes: string[] = [];
  notes.push(
    'Нагрузка — измерение трудоёмкости, а не рейтинг вины: много правок означает живую ' +
    'работу с книгой, мало правок при живых закупках — чаще то, что журнал не ведётся.',
  );
  if (report.rowsPerSubordinateSpread !== null) {
    notes.push(
      `Разброс нагрузки на одно учреждение — в ${report.rowsPerSubordinateSpread} раза между ` +
      'самой тяжёлой и самой лёгкой книгой.',
    );
  }
  if (report.blindDepts.length > 0) {
    notes.push(
      `Журнал почти не ведётся: ${report.blindDepts.join(', ')}. Отсутствие записей здесь ` +
      'ничего не говорит о работе — восстанавливать историю по этим книгам нечем.',
    );
  }
  if (booksSilent.length > 0) {
    notes.push(
      `Журнал не прочитан: ${booksSilent.join(', ')}. По этим книгам события не посчитаны — ` +
      'это не ноль событий.',
    );
  }
  if (rowsSource === 'snapshot') {
    notes.push('Строки книг взяты из сохранённого снимка: живой кэш книг сейчас пуст.');
  }
  if (rowsSource === 'none') {
    notes.push(
      'Строки книг не прочитаны ни из живого кэша, ни из снимка — отношения нагрузки ' +
      'посчитать не из чего.',
    );
  }

  return {
    asOf: new Date(now).toISOString(),
    rowsSource,
    booksTotal: books.length,
    booksMeasured: measured.length,
    booksSilent,
    books,
    totals: report.totals,
    blindDepts: report.blindDepts,
    rowsPerSubordinateSpread: report.rowsPerSubordinateSpread,
    events: {
      ...eventTotals,
      deletionsUnobservable: true,
      countedBooks,
      note: eventsNote,
    },
    notes,
  };
}

export async function workloadRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/workload — нагрузка управлений и три рода событий.
   *
   * Отвечает 200 даже когда всё молчит: сводка существует ровно затем, чтобы
   * показать, где следа нет. Роут, который в ответ на молчание источников
   * отдаёт 503, скрывает КАКАЯ книга молчит — то есть теряет главное.
   */
  app.get('/api/workload', async (request, reply) => {
    const fresh = (request.query as { refresh?: string } | undefined)?.refresh === 'true';
    const now = Date.now();
    if (!fresh && cached && now - cached.at < CACHE_TTL_MS) {
      return reply.send(cached.response);
    }
    const response = await buildWorkloadResponse(now);
    cached = { at: now, response };
    return reply.send(response);
  });
}
