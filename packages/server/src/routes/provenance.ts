/**
 * /api/provenance — провенанс плановых сумм наружу (канон п.102).
 *
 * ЗАЧЕМ. Владелец 18.08: «провенанс плановых сумм будет очень полезной опцией».
 * Замер по полным дампам восьми книг показал ТРИ семантики плановой суммы K:
 * НМЦК неизменная (УАГЗО/УКСиМП/УД, в основном УО/УЭР); НМЦК минус изъятое
 * перераспределением (культура правит K вниз задним числом); распределяемый
 * лимит (УДТХ — дословно: «при экономии снимаю лимиты с закупки и
 * перераспределяю на следующую»). Общий знаменатель двух последних: экономия
 * уходит ПРАВКОЙ ПЛАНА ЗАДНИМ ЧИСЛОМ, исчезает из разницы план−факт и перестаёт
 * быть видимой. Единственный след — журнал правок книги. Эти роуты доставляют
 * след читателю: по строке (что было с планом) и по всем книгам (насколько
 * вообще можно судить).
 *
 * ДВА РОУТА, РАЗНЫЕ ОБЕЩАНИЯ:
 *   GET /api/provenance/:deptId/:rowSeq — история плановых ячеек H/I/J/K одной
 *     закупки: события, сводка, честная наблюдаемость;
 *   GET /api/provenance/health — сводка наблюдаемости по всем восьми книгам:
 *     сколько записей в журнале, какую долю строк он покрывает, сколько
 *     ретро-снижений видно. Это не «здоровье сервера», а здоровье СЛЕДА.
 *
 * ЧТО ТАКОЕ rowSeq. Это «№ п/п» — колонка A листа, тот самый ключ, которым
 * журнал ключует правки («№ 38 · Услуги почтовой связи» либо голое «177»). Это
 * НЕ номер строки листа: живой пример УД — ячейка J177 при № п/п 195. Роут
 * ничего не подменяет молча; если по номеру ничего не нашлось, ответ 404
 * называет, что именно искали, и подсказывает № п/п строки, которая стоит на
 * листе под этим номером (канон п.98б: операторы жалуются, что «номера строк не
 * везде бьются» — путаницу надо снимать текстом, а не догадкой).
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ — ЧЕСТНОСТЬ НАБЛЮДАЕМОСТИ. Журнал ведётся крайне
 * неравномерно: УО 33 724 записи, УКСиМП 4 904, УД 568, УФБП 124, УАГЗО 70,
 * УДТХ 34, УЭР 31, УИО 13. Отсутствие следов у управления НЕ означает
 * отсутствия практики — это дыра наблюдаемости. Поэтому у каждого ответа есть
 * блок observability, и роут отдельно отличает ТРИ состояния, которые легко
 * слить в одно «правок не было»: журнал прочитан и пуст; журнал прочитан и
 * правок этой строки в нём нет; журнал ПРОЧИТАТЬ НЕ УДАЛОСЬ. Третье состояние
 * ядру неизвестно (оно получает пустой массив), поэтому подпись подменяется
 * здесь — иначе молчащая сеть выдала бы себя за чистые данные.
 *
 * ПРО ФИЛЬТР ПО ЛИСТУ. Ядро умеет фильтровать записи по имени листа, и здесь он
 * НАМЕРЕННО не задаётся: имена в живых журналах разные (УФБП пишет «УФБП», УО
 * пишет «ВСЕ»), а читается ровно одна книга одного управления, так что
 * фильтровать не от чего. Пустой фильтр честнее фильтра, который молча съест всю
 * историю.
 *
 * ПРО СВОБОДНЫЙ ТЕКСТ (канон п.27). Колонка «Столбец» журнала и любые пояснения
 * операторов машинно не интерпретируются: вид правки ядро выводит структурно —
 * из адреса ячейки и пары чисел было/стало.
 */
import type { FastifyInstance } from 'fastify';
import {
  DEPT_COLUMNS,
  collectRowsByDept,
  findDept,
  type DepartmentEntry,
} from '@aemr/shared';
import {
  buildPlanProvenance,
  summarizeBookProvenance,
  type BookProvenanceSummary,
  type PlanProvenance,
  type PlanRowInput,
} from '@aemr/core';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { buildRowDto, isDataRow, sheetDateToIso } from '../services/rows-dto.js';
import {
  readAllBookJournals,
  readBookJournal,
  type BookJournal,
} from '../services/provenance-journal.js';

/**
 * Число из плановой ячейки листа. Отличать пустоту от нуля обязательно: у ядра
 * planNow=null значит «плана нет», а planNow=0 — «план равен нулю», и путать их
 * нельзя (нулевой план это заполненная ячейка, а не отсутствующая).
 * Операторский формат «1 234,56» с пробелами-разрядами — живой.
 */
function readMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim();
  if (s === '') return null;
  const cleaned = s.replace(/\s/g, '').replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Строка листа с её номером — то, из чего собирается вход ядра. */
interface SheetRow {
  /** Номер строки ЛИСТА (1-based): шапка 3 строки, данные с 4-й. */
  sheetRow: number;
  cells: unknown[];
  /** № п/п из колонки A; null — номер не проставлен либо не число. */
  ordinal: number | null;
  subject: string;
}

/** № п/п из колонки A. Google отдаёт номера и как «25», и как «25.0». */
function readOrdinal(value: unknown): number | null {
  const s = String(value ?? '').trim().replace(/ /g, '');
  if (s === '') return null;
  const m = s.match(/^(\d+)(?:[.,]0+)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 ? n : null;
}

/**
 * Строки ВСЕХ книг разом, разложенные ПО ИДЕНТИФИКАТОРУ УПРАВЛЕНИЯ.
 *
 * Источник — живой кэш книг (канонический периметр /api/report), при пустом
 * кэше — rowsByDept последнего сохранённого снимка. Тот же порядок, что у
 * /api/timeline: сначала свежее, потом сохранённое, и только потом отказ.
 *
 * КЛЮЧ ПЕРЕКЛАДЫВАЕТСЯ НАМЕРЕННО. И кэш, и снимок ключуются ИМЕНЕМ КНИГИ
 * («УЭР», «УКСиМП»), а поле sheetName реестра — это имя ВКЛАДКИ внутри книги, и
 * у пяти управлений из восьми оно одинаковое: «ВСЕ» (там, где есть подведы).
 * Брать строки по sheetName значит либо не найти ничего, либо выдать книгу
 * одного управления за книгу другого. Разрешаем имя через findDept — ровно так
 * же, как это делает /api/timeline.
 *
 * Читается один раз на запрос: сводка наблюдаемости обходит восемь книг, и
 * восемь отдельных обращений к снимку означали бы восемь полных сборок подряд
 * ради одних и тех же данных.
 */
async function readRowsByDeptId(): Promise<Record<string, unknown[][]>> {
  const byDeptId = (source: Record<string, unknown[][]>): Record<string, unknown[][]> => {
    const out: Record<string, unknown[][]> = {};
    for (const [name, rows] of Object.entries(source)) {
      const dept = findDept(name);
      if (dept) out[dept.id] = rows;
    }
    return out;
  };

  const live = byDeptId(collectRowsByDept(getDeptSheetValues()));
  if (Object.keys(live).length > 0) return live;
  try {
    const snapshot = await getSnapshot();
    // Строки снимка шапку УЖЕ не содержат (их так кладёт сборка снимка), поэтому
    // здесь только перекладывается ключ — второй срез шапки съел бы три закупки.
    if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
      const saved = byDeptId(snapshot.rowsByDept);
      if (Object.keys(saved).length > 0) return saved;
    }
  } catch {
    // источники молчат — честный пустой результат, роут ответит 503
  }
  return {};
}

/**
 * Строки-закупки одной книги. null — книги нет в прочитанном (не «книга пуста»,
 * а «нечего смотреть»): роут строки отвечает на это 503, сводка — честным null.
 */
function deptSheetRows(
  dept: DepartmentEntry,
  rowsByDeptId: Record<string, unknown[][]>,
): SheetRow[] | null {
  const rows = rowsByDeptId[dept.id];
  if (!rows || rows.length === 0) return null;

  const out: SheetRow[] = [];
  rows.forEach((row, idx) => {
    if (!Array.isArray(row)) return;
    const dto = buildRowDto(row, idx, { deptId: dept.id });
    if (!isDataRow(dto)) return; // шапки, итоги и прочие служебные строки — не закупки
    out.push({
      sheetRow: dto.rowIndex,
      cells: row,
      ordinal: readOrdinal(row[DEPT_COLUMNS.ID]),
      subject: String(row[DEPT_COLUMNS.SUBJECT] ?? '').trim(),
    });
  });
  return out;
}

/** Вход ядра из строки листа. */
function toPlanRowInput(row: SheetRow, ordinal: number): PlanRowInput {
  return {
    ordinal,
    planNow: readMoney(row.cells[DEPT_COLUMNS.TOTAL_PLAN]),
    factDate: row.cells[DEPT_COLUMNS.FACT_DATE],
    sheetRow: row.sheetRow,
    subject: row.subject,
  };
}

/**
 * Подпись наблюдаемости, когда книгу ПРОЧИТАТЬ НЕ УДАЛОСЬ. Ядро в этом случае
 * получает пустой журнал и честно говорит «журнал книги пуст, включить журнал» —
 * для непрочитанной книги это неправда и вдобавок вредный совет. Подменяем.
 */
function unreadableJournalNote(dept: string, error: string | undefined): string {
  return (
    `Книга ${dept} сейчас не читается${error ? ` (${error})` : ''}, поэтому журнал правок ` +
    'не просмотрен. Это не «правок не было» и не «журнал не ведётся» — это отсутствие ' +
    'ответа источника. Повторить обращение позже; если книга молчит и дальше — ' +
    'проверить доступ сервисного аккаунта к ней.'
  );
}

/**
 * Ключевая рекомендация по книге: что именно делать с её наблюдаемостью.
 * Тон диагноста (канон п.53): механизм, адрес, действие — без упрёка.
 */
function bookAdvice(journal: BookJournal, rowsTotal: number, coveredRows: number): string {
  if (!journal.available) {
    return unreadableJournalNote(journal.dept, journal.error);
  }
  if (journal.records.length === 0) {
    return (
      `${journal.dept}: журнал правок («_ChangeLog») пуст. Провенанс плановых сумм по книге ` +
      'слепой: ретро-снижения плана в ней не видны, и молчание проверки «экономия растворена ' +
      'в плане» означает отсутствие следов, а не отсутствие практики. Действие — включить ' +
      'ведение журнала в книге; до тех пор сверять план с НМЦК процедуры по реестру ' +
      'определения поставщика.'
    );
  }
  if (journal.rowKeyless === journal.records.length) {
    return (
      `${journal.dept}: все ${journal.records.length} записей журнала — шестиколоночной схемы ` +
      '(Ячейка │ Было │ Стало │ Время │ Автор │ Статус), в ней нет поля «Строка». Правку не с ' +
      'чем сопоставить: адрес ячейки несёт номер строки листа, а закупка ключуется № п/п, и ' +
      'при вставке строк эти числа расходятся. Действие — перевести журнал книги на ' +
      'восьмиколоночную схему с полем «Строка».'
    );
  }
  const coverage = rowsTotal > 0 ? Math.round((coveredRows / rowsTotal) * 100) : 0;
  if (coverage < 50) {
    return (
      `${journal.dept}: журнал покрывает ${coveredRows} строк(и) из ${rowsTotal} (${coverage} %). ` +
      'По непокрытым строкам судить о правках плана нельзя ни в одну сторону — там нет следа, ' +
      'а не подтверждённое отсутствие правок.'
    );
  }
  return (
    `${journal.dept}: журнал покрывает ${coveredRows} строк(и) из ${rowsTotal} (${coverage} %) — ` +
    'провенанс плановых сумм по книге читается.'
  );
}

/** Сводка по одной книге для /health. */
interface BookHealth {
  dept: string;
  sheetName: string;
  spreadsheetId: string;
  journalAvailable: boolean;
  journalError?: string;
  /** Записей журнала, разобранных в правки (шапка и мусор не в счёт). */
  journalEntries: number;
  /** Строк на листе журнала всего — мера, насколько лист велик. */
  journalRawRows: number;
  /** Записей без поля «Строка» (шестиколоночная схема) — сопоставить нельзя. */
  rowKeyless: number;
  /** Строк-закупок в книге; null — книга не прочитана. */
  rows: number | null;
  /** Строк, по которым журнал хоть что-то знает; null — книга не прочитана. */
  rowsCovered: number | null;
  /** Доля покрытия, %; null — считать не из чего. */
  coveragePercent: number | null;
  /** Провенанс по книге целиком; null — строк книги нет. */
  provenance: BookProvenanceSummary | null;
  note: string;
}

export async function provenanceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/provenance/health — наблюдаемость провенанса по всем книгам.
   *
   * Отвечает 200 ДАЖЕ КОГДА ВСЁ МОЛЧИТ, и это осознанно: сводка наблюдаемости
   * существует ровно затем, чтобы показать, где следа нет. Роут, который в
   * ответ на молчание источников отдаёт 503, не сообщает, КАКАЯ книга молчит —
   * то есть теряет единственное, ради чего его открывают.
   *
   * Путь из трёх сегментов, а карточка строки — из четырёх, поэтому «health»
   * не может быть прочитан как идентификатор управления.
   */
  app.get('/api/provenance/health', async (_request, reply) => {
    const journals = await readAllBookJournals();
    const byDept = new Map(journals.map((j) => [j.dept, j]));
    const rowsByDeptId = await readRowsByDeptId();

    const books: BookHealth[] = [];
    for (const [deptId, spreadsheetId] of Object.entries(DEPARTMENT_SPREADSHEETS)) {
      const dept = findDept(deptId);
      const journal: BookJournal = byDept.get(deptId) ?? {
        dept: deptId,
        available: false,
        records: [],
        rowKeyless: 0,
        rawRows: 0,
        readAt: Date.now(),
        error: 'книга отсутствует в реестре источников',
      };

      const sheetRows = dept ? deptSheetRows(dept, rowsByDeptId) : null;
      const planRows: PlanRowInput[] = (sheetRows ?? [])
        .filter((r): r is SheetRow & { ordinal: number } => r.ordinal !== null)
        .map((r) => toPlanRowInput(r, r.ordinal));

      const list: PlanProvenance[] = planRows.length > 0
        ? buildPlanProvenance(journal.records, planRows, { bookLabel: deptId })
        : [];
      const provenance = list.length > 0 ? summarizeBookProvenance(list, deptId) : null;

      const rows = sheetRows === null ? null : planRows.length;
      const rowsCovered = provenance ? provenance.rowsCovered : sheetRows === null ? null : 0;
      const coveragePercent =
        rows !== null && rows > 0 && rowsCovered !== null
          ? Math.round((rowsCovered / rows) * 100)
          : null;

      books.push({
        dept: deptId,
        sheetName: dept?.sheetName ?? deptId,
        spreadsheetId,
        journalAvailable: journal.available,
        ...(journal.error ? { journalError: journal.error } : {}),
        journalEntries: journal.records.length,
        journalRawRows: journal.rawRows,
        rowKeyless: journal.rowKeyless,
        rows,
        rowsCovered,
        coveragePercent,
        provenance,
        note: bookAdvice(journal, rows ?? 0, rowsCovered ?? 0),
      });
    }

    const readable = books.filter((b) => b.journalAvailable);
    const silent = books.filter((b) => !b.journalAvailable).map((b) => b.dept);
    const journalEntriesTotal = books.reduce((a, b) => a + b.journalEntries, 0);
    const retroCutCount = books.reduce((a, b) => a + (b.provenance?.retroCutCount ?? 0), 0);
    const retroCutTotal = books.reduce((a, b) => a + (b.provenance?.retroCutTotal ?? 0), 0);
    const unitFixCount = books.reduce((a, b) => a + (b.provenance?.unitFixCount ?? 0), 0);
    const emptyJournals = readable.filter((b) => b.journalEntries === 0).map((b) => b.dept);

    // Разброс объёма журналов — сам по себе диагноз: это разброс НАБЛЮДАЕМОСТИ,
    // а не разброс дисциплины управлений, и подписывать его надо именно так.
    const ranked = [...readable].sort((a, b) => b.journalEntries - a.journalEntries);
    const spread =
      ranked.length >= 2
        ? `${ranked[0].dept} — ${ranked[0].journalEntries}, ` +
          `${ranked[ranked.length - 1].dept} — ${ranked[ranked.length - 1].journalEntries}`
        : null;

    const notes: string[] = [];
    notes.push(
      `Прочитано книг: ${readable.length} из ${books.length}; записей журнала суммарно — ` +
      `${journalEntriesTotal}.`,
    );
    if (silent.length > 0) {
      notes.push(
        `Не ответили: ${silent.join(', ')}. По этим книгам провенанс не «пуст», а не просмотрен.`,
      );
    }
    if (emptyJournals.length > 0) {
      notes.push(
        `Журнал ведётся, но пуст: ${emptyJournals.join(', ')} — здесь ретро-правки плана ` +
        'невидимы в принципе.',
      );
    }
    if (spread) {
      notes.push(
        `Объём журналов различается на порядки (${spread}). Это разброс наблюдаемости, а не ` +
        'разброс практики: молчание журнала ничего не доказывает о том, правился ли план.',
      );
    }
    notes.push(
      `Видно ретро-снижений плана: ${retroCutCount}; исправлений единиц (рубли вместо тысяч) — ` +
      `${unitFixCount}, в «ушедший план» они не входят.`,
    );

    return reply.send({
      booksTotal: books.length,
      booksRead: readable.length,
      booksSilent: silent,
      journalEntriesTotal,
      retroCutCount,
      retroCutTotal,
      unitFixCount,
      books,
      note: notes.join(' '),
    });
  });

  /**
   * GET /api/provenance/:deptId/:rowSeq — провенанс плановых сумм одной строки.
   * deptId — кириллический или латинский идентификатор управления;
   * rowSeq — «№ п/п» колонки A (ключ журнала), НЕ номер строки листа.
   */
  app.get<{ Params: { deptId: string; rowSeq: string } }>(
    '/api/provenance/:deptId/:rowSeq',
    async (request, reply) => {
      const dept = findDept(request.params.deptId);
      if (!dept) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Управление «${request.params.deptId}» не найдено в реестре ГРБС.`,
          statusCode: 404,
        });
      }

      const rowSeq = readOrdinal(request.params.rowSeq);
      if (rowSeq === null) {
        return reply.status(400).send({
          error: 'BadRequest',
          message:
            `Номер «${request.params.rowSeq}» не подходит: нужен «№ п/п» закупки — целое число ` +
            'от 1 (колонка A книги, тот же номер, которым журнал правок помечает строку).',
          statusCode: 400,
        });
      }

      const sheetRows = deptSheetRows(dept, await readRowsByDeptId());
      if (sheetRows === null) {
        return reply.status(503).send({
          error: 'ServiceUnavailable',
          message:
            `Строки книги ${dept.id} не прочитаны — их нет ни в живом кэше книг, ни в снимке, ` +
            'который сервер смог поднять. Провенанс плановых сумм собрать не из чего: ' +
            'обновите данные и повторите.',
          statusCode: 503,
        });
      }

      const matches = sheetRows.filter((r) => r.ordinal === rowSeq);
      if (matches.length === 0) {
        // Подсказка против путаницы «№ п/п против номера строки листа» (п.98б):
        // если под этим числом на листе СТОИТ строка, называем её настоящий № п/п.
        const atSheetRow = sheetRows.find((r) => r.sheetRow === rowSeq);
        const hint = atSheetRow
          ? ` На строке листа ${rowSeq} стоит закупка с № п/п ${atSheetRow.ordinal ?? '—'}` +
            `${atSheetRow.subject ? ` («${atSheetRow.subject}»)` : ''}: возможно, нужен именно он.`
          : '';
        return reply.status(404).send({
          error: 'NotFound',
          message:
            `В книге ${dept.id} нет закупки с № п/п ${rowSeq} (искали по колонке A среди ` +
            `${sheetRows.length} строк-закупок).${hint}`,
          statusCode: 404,
        });
      }

      const spreadsheetId = DEPARTMENT_SPREADSHEETS[dept.id];
      const journal: BookJournal = spreadsheetId
        ? await readBookJournal(dept.id, spreadsheetId)
        : {
            dept: dept.id,
            available: false,
            records: [],
            rowKeyless: 0,
            rawRows: 0,
            readAt: Date.now(),
            error: 'источник книги не настроен',
          };

      const row = matches[0];
      const [provenance] = buildPlanProvenance(
        journal.records,
        [toPlanRowInput(row, rowSeq)],
        { bookLabel: dept.id },
      );

      // Непрочитанная книга не имеет права выглядеть как книга без правок.
      const observability = journal.available
        ? provenance.observability
        : { ...provenance.observability, note: unreadableJournalNote(dept.id, journal.error) };
      const summary = journal.available
        ? provenance.summary
        : {
            ...provenance.summary,
            note:
              `${dept.id}, строка № ${rowSeq}: судить о правках плана нельзя — журнал книги ` +
              'сейчас не прочитан.',
          };

      return reply.send({
        dept: dept.id,
        deptLatin: dept.latinId,
        deptName: dept.fullName,
        sheetName: dept.sheetName,
        rowSeq,
        sheetRow: row.sheetRow,
        subject: row.subject,
        planNow: provenance.planNow,
        factDate: sheetDateToIso(row.cells[DEPT_COLUMNS.FACT_DATE]),
        method: String(row.cells[DEPT_COLUMNS.METHOD] ?? '').trim(),
        journalAvailable: journal.available,
        ...(journal.error ? { journalError: journal.error } : {}),
        /**
         * Записей журнала без поля «Строка»: их нельзя привязать ни к одной
         * закупке, и о них надо говорить вслух — иначе пустой провенанс книги
         * УАГЗО прочитается как «план не правили».
         */
        journalRowKeyless: journal.rowKeyless,
        events: provenance.events,
        summary,
        observability,
        /**
         * Дубли № п/п (канон п.98з: «отсутствующие и повторяющиеся порядковые
         * номера»). Журнал ключует правки номером, поэтому при дублях он
         * физически не различает эти строки — история у них общая, и молчать об
         * этом нельзя.
         */
        ambiguity:
          matches.length > 1
            ? {
                sheetRows: matches.map((m) => m.sheetRow),
                note:
                  `№ п/п ${rowSeq} стоит у ${matches.length} строк книги ${dept.id} ` +
                  `(строки листа ${matches.map((m) => m.sheetRow).join(', ')}). Журнал правок ` +
                  'ключует записи именно этим номером, поэтому разделить их историю ' +
                  'невозможно: показанная история относится ко всем сразу. Действие — ' +
                  'развести номера в книге.',
              }
            : null,
      });
    },
  );
}
