import { saveSourceRowObservations } from './source-row-observations.js';
/**
 * source-refresh.ts — ОДИН цикл чтения всех источников.
 *
 * Зачем отдельный модуль: раньше книги ГРБС читались только при старте и по
 * ручному обновлению, а официальные ячейки — при каждой пересборке снимка.
 * Стороны сверки оказывались из разных моментов времени, и продукт показывал
 * расхождения там, где данные согласованы (14.08.2026: УКСиМП −181,9 и УО
 * −313,6 — обе стороны были правы). Канон п.66: обе стороны читаются одним
 * циклом, а сервер обновляет источники сам.
 */

import { config, DEPARTMENT_SPREADSHEETS } from '../config.js';
import { db } from '../db/index.js';
import { fetchDepartmentSpreadsheets, getSheetData } from './google-sheets.js';
import type { DeptSheetResult } from './google-sheets.js';
import {
  setDeptSheetCache,
  setDeptLoadMeta,
  setSvodGridCache,
  setSvodLoadFailure,
  invalidateCache,
  getDeptSheetCache,
  getSvodLoadFailure,
} from './snapshot.js';
import { sheetFingerprint } from './sheet-fingerprint.js';
import type { BookFormulaVerdict } from './formula-sink.js';
import { loadFormulaAudits, saveFormulaAudit } from './source-integrity-state.js';
import { checkFileChanged, forgetRevision, lastKnownRevision, readRevision, seedRevision } from './file-revision.js';
import {
  SVOD_WATERMARK_KEY,
  loadWatermarks,
  loadAcceptedReadings,
  noteHonestGap,
  saveWatermark,
} from './book-watermark.js';
import { DEPT_HEADER_ROWS, findDept, SVOD_SHEET_NAME, validateMasterSourceHeader } from '@aemr/shared';
import { publishLiveEvent, type RefreshOrigin } from './event-bus.js';
import { diffBook, isSilent } from './live-diff.js';
import { classifySourceFailure, isTransientSourceFailure } from './source-failure.js';
import { logSnapshotChange, logSourceFailure } from './source-log.js';

export interface SourceRefreshResult {
  loaded: string[];
  failed: string[];
  retryableFailures?: string[];
  svodRetryable?: boolean;
  svodOk: boolean;
  at: string;
  /**
   * Книги, содержимое которых ОТЛИЧАЕТСЯ от прошлого чтения. Пустой список при
   * непустом `loaded` — законный и частый исход: книгу перечитали, а в ней всё
   * то же самое. Ради него и заведено поле: снимок в этом случае не
   * пересобирается вовсе (см. ниже).
   */
  changedBooks: string[];
  /** Изменился ли лист СВОД в этом цикле. */
  svodChanged: boolean;
  /** Сколько книг ГРБС цикл прочитал (адресная перечитка читает не все). */
  booksRead: number;
  /**
   * Книги, которые цикл НЕ читал, потому что Drive сказал: файл не менялся с
   * прошлого чтения. Не ошибка и не пропуск — сэкономленное чтение.
   */
  skipped: string[];
  /**
   * Книги, у которых в этом цикле прочитаны ФОРМУЛЬНЫЕ КОЛОНКИ. Пустой список
   * — это «формулы не читали», а НЕ «дефектов формул нет»: быстрый плановый
   * цикл за формулы не платит (решение владельца §22 п.7), и выдавать его
   * молчание за чистую книгу запрещено.
   */
  formulaBooks: string[];
}

/** Идёт ли перечитка прямо сейчас — параллельные вызовы ждут общий промис. */
let inFlight: Promise<SourceRefreshResult> | null = null;
/** Обещанный НОВЫЙ цикл, назначенный на конец текущего (см. `fresh`). */
let queuedFresh: Promise<SourceRefreshResult> | null = null;
/**
 * Цель обещанного цикла — накопленная по всем, кто в него встал. Две правки в
 * разных книгах во время идущего цикла обязаны попасть в ОДИН следующий цикл
 * обеими книгами; взять цель только у первого вставшего значит потерять вторую
 * правку до планового опроса.
 */
let queuedScope: { books: Set<string> | null; svod: boolean; withFormulas: boolean; askDrive: boolean } | null = null;

/** Отпечатки прошлого чтения — по ним видно, изменилось ли что-нибудь. */
const bookPrints = new Map<string, string>();
let svodPrint: string | null = null;

/**
 * Посеян ли водяной знак из базы (§2.4 проекта службы). Раньше отпечатки жили
 * только в памяти процесса, и после рестарта первое чтение сравнивалось с
 * пустотой: правка, случившаяся, пока сервер лежал, выглядела как «первое
 * чтение, изменений нет». Теперь база сравнения переживает перезапуск.
 */
let watermarksSeeded = false;
const restoredReadings = new Map<string, { values: unknown[][] }>();

function seedFromWatermarks(): void {
  if (watermarksSeeded) return;
  const marks = loadWatermarks();
  const currentCache = getDeptSheetCache();
  for (const [book, reading] of loadAcceptedReadings()) {
    const mark = marks.get(book)!;
    if (!Number.isFinite(Date.parse(mark.parsedAt))) throw new Error('SOURCE_STATE_READ_FAILED');
    if (book === SVOD_WATERMARK_KEY && reading.fileId === config.google.spreadsheetId) {
      setSvodGridCache(reading.values, mark.parsedAt);
    } else if (DEPARTMENT_SPREADSHEETS[book] === reading.fileId) {
      // The stored checksum proves bytes were preserved, not that a previous
      // reader admitted today's mandatory meanings. Do not seed an incompatible
      // master into active KPI/rows/Word caches; keep its historical bytes and
      // force the existing refresh path to reacquire the current source.
      try {
        validateMasterSourceHeader(reading.values[DEPT_HEADER_ROWS - 1] ?? []);
      } catch {
        logSourceFailure(`восстановление схемы источника «${book}»`, {
          ms: 0, reason: 'MASTER_SOURCE_STORED_PROFILE_INCOMPATIBLE',
        });
        continue;
      }
      restoredReadings.set(book, { values: reading.values });
      if (!currentCache[book]) {
        const sheetName = findDept(book)?.source.sheet ?? book;
        setDeptSheetCache({ [book]: { values: reading.values, formulas: [], formulasRead: false,
          sheetName, providerId: reading.fileId, sourceVersion: mark.driveVersion ?? mark.driveModifiedTime ?? undefined,
          readAt: mark.parsedAt } }, [], mark.parsedAt);
        setDeptLoadMeta({ [book]: { loadedAt: mark.parsedAt, rowCount: reading.values.length, sheetName } });
      }
    }
  }
  for (const [book, mark] of marks) {
    if (book === SVOD_WATERMARK_KEY) {
      svodPrint ??= mark.fingerprint;
      continue;
    }
    if (!bookPrints.has(book)) bookPrints.set(book, mark.fingerprint);
    // Отметка версии файла тоже переживает рестарт: без неё первый вопрос
    // «а менялся ли файл» после подъёма отвечал бы «менялся» про каждую книгу.
    const fileId = DEPARTMENT_SPREADSHEETS[book];
    if (fileId && (mark.driveVersion !== null || mark.driveModifiedTime !== null)) {
      seedRevision(fileId, { version: mark.driveVersion, modifiedTime: mark.driveModifiedTime });
    }
  }
  watermarksSeeded = true;
}

/** Только для стражей: забыть посев и отпечатки. */
export function resetSourcePrints(): void {
  watermarksSeeded = false;
  bookPrints.clear();
  restoredReadings.clear();
  svodPrint = null;
}

// ---------------------------------------------------------------------------
// Доставка формул в разбор целостности
// ---------------------------------------------------------------------------

/**
 * ДОГОВОР СО СЛОЕМ РАЗБОРА (`packages/core/src/pipeline/formula-integrity.ts`).
 *
 * Сервер формулы ЧИТАЕТ и ПЕРЕДАЁТ, но не разбирает: эталон колонки, мутанты и
 * дыры — это правило предметной области, и жить ему в ядре, а не в модуле,
 * который ходит в сеть. Здесь стоит розетка: слой разбора подключается одним
 * вызовом `setFormulaSink`, и с этой минуты каждое чтение формул приезжает к
 * нему само.
 *
 * Форма посылки согласована с ядром по именам полей: `{ values, formulas,
 * startRow, book }`. `values` и `formulas` выровнены по ОДНИМ И ТЕМ ЖЕ
 * индексам колонок листа (0 = A), `startRow` — номер строки листа для индекса
 * 0 (всегда 1). Адрес ячейки в замечании считается как
 * `буква(колонка) + (startRow + индексСтроки)`.
 *
 * Пока розетка пуста, чтение не пропадает молча: оно оседает в перечне
 * `formulaDeliveryState()` со словами «разбор не подключён». Это ровно то
 * различие, которое запрещено стирать: «формулы прочитаны, разбирать некому»
 * — не то же самое, что «дефектов нет».
 */
export interface FormulaDelivery {
  book: string;
  /** Timestamp shared by source delivery and verdict, for exact-run attribution. */
  at?: string;
  values: unknown[][];
  formulas: unknown[][];
  startRow: number;
  /**
   * Всегда `true`: розетка получает только состоявшиеся чтения. Поле есть
   * ради ЯВНОСТИ договора — `FormulaIntegrityInput` в ядре принимает его же,
   * и посылка обязана читаться без домысливания.
   */
  formulasRead: true;
}

/** След одной доставки — для маршрута состояния и журнала. */
export interface FormulaDeliveryNote {
  book: string;
  at: string;
  /** Сколько формульных ячеек привезено. */
  cells: number;
  /** Принял ли разбор эту посылку (розетка занята и не отказала). */
  handled: boolean;
  /** "false" means Google did not provide formulas at all. */
  formulasRead?: boolean;
  /** Never advertise a verification whose diagnostic state was not committed. */
  persisted?: boolean;
  /** Почему не принял, если не принял. */
  failedBecause?: string;
}

let formulaSink: ((delivery: FormulaDelivery) => BookFormulaVerdict | undefined) | null = null;
const formulaNotes = new Map<string, FormulaDeliveryNote>();

/** Подключить слой разбора формул. `null` — отключить (стражи, выключение). */
export function setFormulaSink(sink: ((delivery: FormulaDelivery) => BookFormulaVerdict | undefined) | null): void {
  formulaSink = sink;
}

/**
 * Что известно о формулах книг: когда читали, сколько привезли, взял ли разбор.
 * Книги здесь НЕТ вовсе — значит формулы этой книги не читались ни разу за
 * жизнь процесса, и молчание про её формулы означает «не смотрели».
 */
export function formulaDeliveryState(): {
  sinkConnected: boolean;
  books: FormulaDeliveryNote[];
} {
  return {
    sinkConnected: formulaSink !== null,
    books: [...formulaNotes.values()].sort((a, b) => a.book.localeCompare(b.book, 'ru')),
  };
}

/** Restore attempted deliveries, including failures, before webhook handlers start. */
export function restoreFormulaDeliveries(): void {
  formulaNotes.clear();
  for (const entry of loadFormulaAudits()) formulaNotes.set(entry.delivery.book, entry.delivery);
}

/** Только для стражей: забыть следы доставок. */
export function resetFormulaDeliveries(): void {
  formulaNotes.clear();
}

function countFormulaCells(formulas: unknown[][]): number {
  let cells = 0;
  for (const row of formulas) {
    if (!row) continue;
    for (const value of row) if (value !== undefined && value !== null && value !== '') cells++;
  }
  return cells;
}

/**
 * Отдать прочитанные формулы разбору. Отказ разбора не валит цикл чтения:
 * источники прочитаны, и это правда независимо от того, справился ли разбор.
 */
function deliverFormulas(
  data: Record<string, DeptSheetResult>,
  errors: Record<string, string>,
  requested: boolean,
  at: string,
  log?: { warn: (msg: string) => void },
): string[] {
  const delivered: string[] = [];
  const remember = (note: FormulaDeliveryNote, verdict: BookFormulaVerdict | null): void => {
    try {
      // Last attempt and last confirmed verdict share one atomic SQLite row.
      saveFormulaAudit(note, verdict);
      note.persisted = true;
    } catch (err) {
      note.persisted = false;
      note.failedBecause = [note.failedBecause, `результат не сохранён: ${(err as Error).message}`]
        .filter(Boolean).join('; ');
      log?.warn(`Проверка формул книги «${note.book}» не сохранена: ${(err as Error).message}`);
    }
    formulaNotes.set(note.book, note);
  };
  for (const [book, result] of Object.entries(data)) {
    if (!result.formulasRead) {
      // Values-only poll must not replace a valid earlier formula observation.
      if (requested) remember({
        book, at, cells: 0, handled: false, formulasRead: false,
        failedBecause: 'формулы не получены в этом чтении',
      }, null);
      continue;
    }
    delivered.push(book);
    const note: FormulaDeliveryNote = {
      book, at, cells: countFormulaCells(result.formulas),
      handled: false, formulasRead: true,
    };
    let verdict: BookFormulaVerdict | null = null;
    if (formulaSink) {
      try {
        verdict = formulaSink({
          book, at, values: result.values, formulas: result.formulas,
          startRow: result.startRow ?? 1, formulasRead: true,
        }) ?? null;
        note.handled = true;
      } catch (err) {
        note.failedBecause = (err as Error).message;
        log?.warn(`Разбор формул книги «${book}» не удался: ${(err as Error).message}`);
      }
    } else {
      note.failedBecause = 'разбор формул не подключён';
    }
    remember(note, verdict);
  }
  if (requested) {
    for (const [book, error] of Object.entries(errors)) {
      remember({
        book, at, cells: 0, handled: false, formulasRead: false,
        failedBecause: `книга не прочитана: ${classifySourceFailure(error)}`,
      }, null);
    }
  }
  return delivered.sort();
}

export interface RefreshOptions {
  /**
   * Требуется чтение ПОСЛЕ этого мгновения, а не любое идущее.
   *
   * Обычный вызов присоединяется к текущему циклу — это бережёт квоту. Но для
   * уведомления Drive присоединиться значит потерять правку: цикл мог прочитать
   * книгу за секунду до того, как в ней что-то поменяли, и его результат честно
   * не содержит правки, о которой нас только что известили. С `fresh` вызов
   * ждёт окончания текущего цикла и запускает следующий.
   */
  fresh?: boolean;
  /**
   * Адресная перечитка: только названные книги ГРБС. Не задано или пусто —
   * все книги, как раньше.
   *
   * Смысл — в точности уведомления Drive. Оно называет ФАЙЛ (заголовок
   * X-Goog-Resource-URI), и дальше файла Google не идёт: ни листа, ни строки,
   * ни ячейки в сообщении нет, а метода «что поменялось с прошлого чтения» у
   * Google Sheets не существует вовсе. Значит, единственная разница, которую
   * можно взять у Google даром, — это «какая книга»; её и берём.
   */
  books?: readonly string[];
  /** Читать ли лист СВОД. По умолчанию да — прежнее поведение цикла. */
  svod?: boolean;
  /**
   * Спрашивать ли у Drive отметку версии файла перед чтением книги.
   * По умолчанию да. `false` — читать безусловно (нужно тестам и ручному
   * «обновить», где человек ждёт чтения, а не рассуждений о его надобности).
   */
  askDrive?: boolean;
  /**
   * Читать ли ФОРМУЛЬНЫЕ КОЛОНКИ книг (K, O:P, R:T, Y:AC) вторым обращением к
   * Google. По умолчанию НЕТ — и это решение владельца §22 п.7, а не экономия
   * на всякий случай: быстрый плановый цикл идёт каждые несколько минут, а
   * формулы меняются правкой человека, о которой нас извещает вебхук.
   *
   * Включают ровно двое: приёмник уведомлений (routes/webhook.ts — книгу
   * разбудили, значит в ней могли перебить формулу) и ночной полный обход
   * (services/metadata-watch.ts — сеть безопасности для книг, которые днём
   * молчали).
   */
  withFormulas?: boolean;
}

/**
 * Объявить в прямом эфире, что изменилось в книгах за этот цикл.
 *
 * Молчание — законный итог: книги перечитаны, всё совпало — событий нет.
 * Раньше эфир не отличался от тишины вовсе (числа менялись только после того,
 * как читатель сам обновит страницу), и это ровно то, что здесь чинится.
 */
function publishBookChanges(
  before: Record<string, { values: unknown[][] }>,
  after: Record<string, { values: unknown[][] }>,
  origin: RefreshOrigin,
  changedBooks?: readonly string[],
): void {
  // Построчное сравнение идёт только по книгам, чьи отпечатки разошлись:
  // прогонять его по восьми книгам ради одной изменившейся — это восемь
  // проходов по трёхтысячным листам вместо одного.
  const only = changedBooks ? new Set(changedBooks) : null;
  for (const [book, reading] of Object.entries(after)) {
    if (only && !only.has(book)) continue;
    const diff = diffBook(book, before[book], reading);
    if (isSilent(diff)) continue;
    publishLiveEvent({
      kind: 'book-updated',
      book,
      changedRows: diff.changedRows,
      addedRows: diff.addedRows,
      removedRows: diff.removedRows,
      rowsTotal: diff.rowsTotal,
      origin,
    });
    for (const row of diff.rows) publishLiveEvent(row);
  }
}

/**
 * Расширить цель обещанного цикла новым запросом.
 *
 * `books: null` означает «все книги» и поглощает любой адресный список:
 * встретив полную перечитку, серия обязана остаться полной, иначе адресный
 * хвост тихо отменил бы уже обещанное чтение остальных книг.
 */
function widenScope(
  scope: { books: Set<string> | null; svod: boolean; withFormulas: boolean; askDrive: boolean } | null,
  options: RefreshOptions,
): { books: Set<string> | null; svod: boolean; withFormulas: boolean; askDrive: boolean } {
  const wantsAll = !options.books || options.books.length === 0;
  const svod = (scope?.svod ?? false) || (options.svod ?? true);
  // Просьба прочитать формулы тоже СКЛАДЫВАЕТСЯ: уведомление вебхука, попавшее
  // в серию вместе с обычным вызовом, не имеет права потерять чтение формул —
  // иначе перебитая формула дождалась бы только ночного обхода.
  const withFormulas = (scope?.withFormulas ?? false) || (options.withFormulas ?? false);
  // Принудительное чтение не должно теряться в обещанном хвосте: false побеждает.
  const askDrive = (scope?.askDrive ?? true) && (options.askDrive ?? true);
  if (!scope) return { books: wantsAll ? null : new Set(options.books), svod, withFormulas, askDrive };
  if (scope.books === null || wantsAll) return { books: null, svod, withFormulas, askDrive };
  for (const book of options.books ?? []) scope.books.add(book);
  return { books: scope.books, svod, withFormulas, askDrive };
}

/**
 * Только для стражей: сложение целей обещанного цикла напрямую. Складывание —
 * то место, где просьба о формулах может потеряться молча, и проверять его
 * через таймеры и промисы значит проверять не то.
 */
export const widenScopeForTests = widenScope;

/**
 * Ступень отсева У GOOGLE: какие книги вообще стоит читать.
 *
 * ЧЕГО НЕТ В API. «Дай мне то, что изменилось с прошлого раза» — такого метода
 * у Google Sheets не существует: values.get/batchGet читают диапазоны, и
 * только их (документация Sheets, guides/values). Push-уведомление Drive тоже
 * не несёт ни листа, ни строки, ни ячейки — точность сообщения кончается на
 * файле (guides/push, «Receive notification»). Значит, настоящего диффа с
 * сервера получить нельзя ни за какие деньги.
 *
 * ЧТО ЕСТЬ ВМЕСТО НЕГО. Ресурс файла Drive хранит `version` и `modifiedTime`;
 * запрос за ними — двести байт против мегабайтов грида (services/
 * file-revision.ts). Совпали с отметкой прошлого чтения — файл не менялся, и
 * книгу читать НЕ НАДО вовсе. Разошлись или Drive промолчал — читаем, как
 * читали: пропустить правку хуже, чем прочитать лишнее.
 *
 * Книга, ни разу не прочитанная за жизнь процесса, не спрашивается: сравнивать
 * не с чем, читать надо в любом случае, и холодный старт не платит за вопросы
 * с заранее известным ответом.
 *
 * ЛИСТ СВОД ЭТОЙ СТУПЕНИ НЕ ПОДЛЕЖИТ — и это не забывчивость. Он ПРОИЗВОДНЫЙ:
 * его строки приходят из книг ГРБС через IMPORTRANGE, и когда правят книгу,
 * формулы СВОДа пересчитываются сами, БЕЗ правки файла сводной книги. Отметка
 * `modifiedTime` считает правки, а не пересчёты, — значит «файл не менялся»
 * про сводную книгу означало бы «числа те же» неверно, и продукт показывал бы
 * официальные ячейки вчерашними. Ступень работает только там, где содержимое
 * меняется РУКОЙ человека, то есть в книгах управлений.
 */
async function gateByRevision(
  candidates: readonly string[],
  wantSvod: boolean,
  ask: boolean,
  withFormulas: boolean,
  sourceBooks: Readonly<Record<string, string>>,
): Promise<{ books: string[]; svod: boolean; skipped: string[]; attested: string[] }> {
  if (!ask) return { books: [...candidates], svod: wantSvod, skipped: [], attested: [] };

  const books: string[] = [];
  const skipped: string[] = [];
  // Книги, про которые Drive СКАЗАЛ «файл менялся» (была прежняя отметка и
  // новая с ней разошлась). Не то же самое, что «читаем»: читаем и по
  // «не знаю», и впервые. Засвидетельствованное изменение при молчащем
  // содержимом — это честный пропуск журнала (правило полноты §2.2).
  const attested: string[] = [];

  const cached = getDeptSheetCache();
  const questions: Array<Promise<void>> = candidates.map(async (book) => {
    const fileId = sourceBooks[book];
    if (!fileId || !bookPrints.has(book) || !cached[book]?.values.length) {
      books.push(book);
      return;
    }
    const hadRevision = lastKnownRevision(fileId) !== null;
    const verdict = await checkFileChanged(fileId);
    if (verdict === 'same' && (!withFormulas || cached[book]?.formulasRead)) {
      skipped.push(book);
      return;
    }
    books.push(book);
    if (verdict === 'changed' && hadRevision) attested.push(book);
  });

  await Promise.all(questions);
  return { books: books.sort(), svod: wantSvod, skipped: skipped.sort(), attested: attested.sort() };
}

/**
 * Прочитать книги ГРБС и лист СВОД одним циклом и обновить кэши.
 * Ошибка отдельной книги не валит цикл: упавшая книга УДАЛЯЕТСЯ из кэша, а не
 * остаётся под видом свежих данных.
 */
type MasterAcquisition = (books: Readonly<Record<string, string>>) =>
  Promise<{ data: Record<string, DeptSheetResult>; errors: Record<string, string> }>;

/** Report and live consumers accept the same complete acquisition, under the
 * existing refresh lock and persistence boundary. Never join an older live read. */
export async function refreshReportSources(
  acquire: MasterAcquisition,
  log?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<SourceRefreshResult> {
  while (queuedFresh || inFlight) {
    await (queuedFresh ?? inFlight)!.catch(() => undefined);
  }
  return refreshAllSources(log, 'cycle',
    { askDrive: false, svod: false, withFormulas: true }, acquire);
}

export function refreshAllSources(log?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}, origin: RefreshOrigin = 'cycle', options: RefreshOptions = {},
acquire?: MasterAcquisition): Promise<SourceRefreshResult> {
  if (inFlight) {
    if (!options.fresh) return inFlight;
    // Один хвост на всю серию: пять уведомлений, пришедших во время цикла,
    // назначают ОДИН следующий цикл, а не пять подряд. Цель при этом
    // СКЛАДЫВАЕТСЯ: правки в разных книгах едут одним циклом обеими книгами.
    queuedScope = widenScope(queuedScope, options);
    queuedFresh ??= inFlight
      .catch(() => undefined)
      .then(() => {
        const scope = queuedScope;
        queuedFresh = null;
        queuedScope = null;
        return refreshAllSources(log, origin, {
          books: scope?.books ? [...scope.books] : undefined,
          svod: scope?.svod ?? true,
          withFormulas: scope?.withFormulas ?? false,
          askDrive: scope?.askDrive ?? true,
        });
      });
    return queuedFresh;
  }

  inFlight = (async () => {
    const sourceBooks = { ...DEPARTMENT_SPREADSHEETS };
    const svodSourceId = config.google.spreadsheetId;
    // Водяной знак из базы — ДО любого сравнения: после рестарта отпечатки
    // обязаны быть довалочными, а не пустыми (§2.4 проекта службы).
    seedFromWatermarks();

    // Прежнее чтение книг — материал для ответа «что именно поменялось»
    // (шина живых событий). Ссылка снимается ДО записи нового кэша: запись
    // подставляет новый объект, прежний остаётся целым.
    const cachedBefore = getDeptSheetCache();
    const before = { ...Object.fromEntries(restoredReadings), ...cachedBefore };

    // Книги управлений и лист СВОД читаются ОДНОВРЕМЕННО, а не одно за другим.
    // Дело не только в скорости цикла (лист СВОД перестал ждать окончания
    // восьми книг): читать их подряд значит разносить стороны сверки во
    // времени ровно на длительность чтения книг. Параллельность сокращает
    // этот разрыв, но не доказывает единую версию Google. Отказ одной стороны не должен
    // уносить другую, поэтому лист СВОД ловит свой отказ внутри себя.
    const startedAt = Date.now();
    const targetBooks = options.books && options.books.length > 0 ? options.books : undefined;
    const wantSvod = options.svod ?? true;

    // Ступень отсева у Google — ДО чтения: книга, которую никто не трогал с
    // прошлого раза, не стоит ни байта грида (см. gateByRevision).
    // Формат чтения не означает принуждение: повторный вебхук может пропустить
    // уже прочитанную версию с формулами. Ручной/контрольный обход задаёт askDrive:false.
    const askDrive = options.askDrive ?? true;
    const previousRevisions = new Map(Object.values(sourceBooks)
      .map(fileId => [fileId, lastKnownRevision(fileId)] as const));
    const gate = await gateByRevision(
      targetBooks ?? Object.keys(sourceBooks),
      wantSvod,
      askDrive,
      options.withFormulas ?? false,
      sourceBooks,
    );
    const booksToRead = gate.books;
    const readSvod = gate.svod;
    // Pin the pre-read revision. Forced reads bypass the skip gate, but must
    // still detect edits made while Sheets values/formulas are being acquired.
    const acquisitionRevisions = new Map(await Promise.all((acquire ? [] : booksToRead).map(async name => {
      const fileId = sourceBooks[name];
      return [name, await readRevision(fileId)] as const;
    })));

    const [{ data, errors }, svodRead] = await Promise.all([
      // Пустая цель — это НЕ «читай всё»: у fetchDepartmentSpreadsheets пустой
      // `only` означает «все книги», и передать его сюда значило бы отменить
      // весь отсев ровно в тот момент, когда он сработал полностью.
      acquire ? acquire(sourceBooks) : booksToRead.length > 0
        ? fetchDepartmentSpreadsheets(sourceBooks, {
            only: booksToRead,
            // Формулы — только когда их попросили (вебхук, ночной обход).
            // Плановый цикл сюда приходит без флага и платит за одно чтение.
            withFormulas: options.withFormulas ?? false,
          })
        : Promise.resolve({
            data: {} as Record<string, DeptSheetResult>,
            errors: {} as Record<string, string>,
          }),
      readSvod
        ? getSheetData(SVOD_SHEET_NAME)
            .then((values) => ({ values }))
            .catch((error: unknown) => ({ error }))
        : Promise.resolve(null),
    ]);
    // The report worker may have its own adapter, but its accepted matrices
    // enter the SAME live cache and later feed API/metrics/Word. Recheck their
    // mandatory meanings with the one shared profile before committing any
    // report source, instead of treating a matching Drive revision as schema proof.
    if (acquire) {
      for (const [name, reading] of Object.entries(data)) {
        if (!(name in sourceBooks)) {
          Reflect.deleteProperty(data, name);
          errors[name] = 'REPORT_SOURCE_NOT_REGISTERED';
          continue;
        }
        try {
          validateMasterSourceHeader(reading.values?.[DEPT_HEADER_ROWS - 1] ?? []);
        } catch (error) {
          Reflect.deleteProperty(data, name);
          errors[name] = error instanceof Error && error.message.startsWith('MASTER_SOURCE_REQUIRED_MEANING_CHANGED:')
            ? error.message : 'MASTER_SOURCE_PROFILE_INVALID';
        }
      }
    }

    await Promise.all(Object.keys(data).map(async name => {
      if (acquire) {
        // The full connector may have retried a changing source. Recheck its
        // accepted token, not a probe from before that complete acquisition.
        const revision = await readRevision(sourceBooks[name]);
        if (!data[name].sourceVersion || !revision
            || data[name].sourceVersion !== (revision.version ?? revision.modifiedTime)) {
          Reflect.deleteProperty(data, name);
          errors[name] = 'SOURCE_CHANGED_DURING_READ';
        } else {
          acquisitionRevisions.set(name, revision);
        }
        return;
      }
      const beforeRevision = acquisitionRevisions.get(name);
      // Unavailable metadata retains the existing unverified live-read mode;
      // it must never be advertised as a sealed report source revision.
      if (!beforeRevision || (beforeRevision.version === null && beforeRevision.modifiedTime === null)) return;
      const afterRevision = await readRevision(sourceBooks[name]);
      if (!afterRevision || beforeRevision.version !== afterRevision.version
          || beforeRevision.modifiedTime !== afterRevision.modifiedTime) {
        Reflect.deleteProperty(data, name);
        errors[name] = afterRevision ? 'SOURCE_CHANGED_DURING_READ' : 'SOURCE_REVISION_RECHECK_UNAVAILABLE';
      }
    }));
    // Check after ALL asynchronous reads/rechecks; another source can finish
    // later while settings change. Never label old-book values as the new book.
    for (const name of Object.keys(data)) {
      if (sourceBooks[name] !== DEPARTMENT_SPREADSHEETS[name]) {
        Reflect.deleteProperty(data, name);
        errors[name] = 'SOURCE_BINDING_CHANGED_DURING_READ';
      }
    }
    if (acquire && (Object.keys(errors).length > 0
        || Object.keys(data).length !== Object.keys(sourceBooks).length
        || Object.keys(sourceBooks).some(name => !data[name]?.formulasRead))) {
      throw new Error('REPORT_SOURCE_INPUT_NOT_ACCEPTED');
    }
    // Publish both sides only after acquisition has finished, without yielding
    // between cache updates. Parallel reads do not prove atomic Google revisions.
    const svodResult = (() => {
      if (svodRead !== null && svodSourceId !== config.google.spreadsheetId) {
        setSvodLoadFailure('SOURCE_BINDING_CHANGED_DURING_READ');
        return { ok: false, changed: false, first: false, retryable: true };
      }
      if (svodRead === null) {
        return { ok: getSvodLoadFailure() === null, changed: false, first: false };
      }
      try {
        if ('error' in svodRead) throw svodRead.error;
        const print = sheetFingerprint(svodRead.values);
        const first = svodPrint === null;
        const changed = !first && svodPrint !== print;
        return { ok: true, changed, first, print };
      } catch (err: unknown) {
        const reason = classifySourceFailure((err as Error)?.message ?? String(err));
        setSvodLoadFailure(reason);
        log?.warn(`Лист СВОД не прочитан в этом цикле: ${reason}`);
        return { ok: false, changed: false, first: false, retryable: isTransientSourceFailure(err) };
      }
    })();
    const svodOk = svodResult.ok;

    // Отпечатки — дешёвая ступень разбора: они отвечают «изменилось ли», и
    // только для изменившихся книг работает дорогое построчное сравнение.
    // Книга, прочитанная впервые за жизнь процесса, изменившейся НЕ считается.
    const changedBooks: string[] = [];
    // Книга, прочитанная ВПЕРВЫЕ, не «изменилась» — но снимок, собранный до
    // неё, собран без её строк, и оставлять его в кэше нельзя. Событий в эфир
    // первое чтение не даёт, а сброс кэша — даёт.
    let firstReads = 0;
    const nextPrints = new Map<string, string>();
    for (const [name, result] of Object.entries(data)) {
      const print = sheetFingerprint(result.values);
      const previous = bookPrints.get(name);
      nextPrints.set(name, print);
      if (previous === undefined || !before[name]?.values.length) firstReads++;
      if (previous !== undefined && previous !== print) changedBooks.push(name);
    }

    const at = new Date().toISOString();
    // Persist the acceptance boundary before changing any successful cache.
    // SQLite rolls back the whole cycle if a watermark or gap cannot be saved.
    const gaps: Array<{ name: string; modifiedTime: string | null }> = [];
    try {
      db.transaction(() => {
        if ('print' in svodResult && svodResult.print !== undefined) {
          saveWatermark(SVOD_WATERMARK_KEY, svodResult.print, at, lastKnownRevision(svodSourceId) ?? undefined,
            { fileId: svodSourceId, values: svodRead && 'values' in svodRead ? svodRead.values : [] });
        }
        for (const [name, print] of nextPrints) {
          const revision = acquisitionRevisions.get(name) ?? null;
          saveSourceRowObservations(name, before[name], data[name], bookPrints.get(name), print, at);
          saveWatermark(name, print, at, revision ?? undefined, { fileId: sourceBooks[name], values: data[name].values });
        }
        for (const name of gate.attested) {
          if (changedBooks.includes(name) || !(name in data)) continue;
          const fileId = sourceBooks[name];
          const modifiedTime = fileId ? lastKnownRevision(fileId)?.modifiedTime ?? null : null;
          if (noteHonestGap(name, modifiedTime)) gaps.push({ name, modifiedTime });
        }
      });
    } catch (error) {
      // The Drive probe advanced its in-memory revision before acquisition.
      // Restore it so retry cannot skip this unaccepted input or lose attestation.
      for (const name of booksToRead) {
        const fileId = sourceBooks[name];
        if (!fileId) continue;
        forgetRevision(fileId);
        const previous = previousRevisions.get(fileId);
        if (previous) seedRevision(fileId, previous);
      }
      throw error;
    }
    if (svodRead !== null && 'values' in svodRead && 'print' in svodResult && svodResult.print !== undefined) {
      setSvodGridCache(svodRead.values);
      svodPrint = svodResult.print;
    }
    for (const [name, reading] of Object.entries(data)) {
      reading.providerId = sourceBooks[name];
      const revision = acquisitionRevisions.get(name);
      if (revision) reading.sourceVersion = revision.version ?? revision.modifiedTime ?? undefined;
    }
    if (gate.skipped.length > 0) {
      setDeptSheetCache(data, Object.keys(errors), undefined, gate.skipped);
    } else {
      setDeptSheetCache(data, Object.keys(errors));
    }
    for (const [name, print] of nextPrints) {
      bookPrints.set(name, print);
      restoredReadings.delete(name);
      const fileId = sourceBooks[name];
      forgetRevision(fileId);
      const revision = acquisitionRevisions.get(name);
      if (revision) seedRevision(fileId, revision);
    }
    for (const { name, modifiedTime } of gaps) {
      log?.warn(`Журнал: по книге «${name}» изменение было, содержание не установлено`
        + (modifiedTime ? ` (отметка файла ${modifiedTime})` : ''));
    }
    // Упавшая книга ушла из кэша — её отпечаток больше ничего не описывает.
    // Заодно забывается отметка версии файла: она снята перед чтением, которого
    // не было, и без этого книга выпала бы из перечиток до следующей правки.
    for (const name of Object.keys(errors)) {
      bookPrints.delete(name);
      const fileId = sourceBooks[name];
      if (fileId) forgetRevision(fileId);
    }

    publishBookChanges(before, data, origin, changedBooks);

    // Формулы — в разбор целостности. Доставка идёт ПОСЛЕ записи кэша и до
    // журнала: разбор не имеет права задержать обновление экрана, а его исход
    // обязан попасть в ту же строку журнала, что и остальной итог цикла.
    const formulaBooks = deliverFormulas(data, errors, options.withFormulas ?? false, at, log);

    const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string; sourceRevision?: string }> = {};
    for (const [name, result] of Object.entries(data)) {
      loadMeta[name] = { loadedAt: result.readAt ?? at, rowCount: result.values.length, sheetName: result.sheetName,
        ...(result.sourceRevision ? { sourceRevision: result.sourceRevision } : {}) };
    }
    for (const [name, errMsg] of Object.entries(errors)) {
      loadMeta[name] = { loadedAt: at, rowCount: 0, sheetName: name, error: errMsg };
    }
    setDeptLoadMeta(loadMeta);

    // Итог цикла в журнал сервера — с числами, а не «источники обновлены».
    // Вопрос «почему в отчёте столько закупок» решается сложением строк по
    // книгам, а вопрос «почему меньше, чем вчера» — списком не ответивших.
    const rowsTotal = Object.values(data).reduce((sum, r) => sum + r.values.length, 0);
    // «Ничего не сдвинулось» — это ОДНОВРЕМЕННО: ни одна книга не изменилась,
    // ни одна не прочитана впервые, лист СВОД тот же и никто не отказал.
    // Достаточно любому условию не выполниться — снимок обязан пересобраться.
    const formulaInputsChanged = Object.entries(data).some(([book, reading]) => reading.formulasRead
      && (!cachedBefore[book]?.formulasRead || sheetFingerprint(reading.formulas) !== sheetFingerprint(cachedBefore[book].formulas)));
    const nothingChanged =
      changedBooks.length === 0
      && firstReads === 0
      && !formulaInputsChanged
      && !svodResult.changed
      && !svodResult.first
      && Object.keys(errors).length === 0;
    logSnapshotChange(
      `Цикл чтения источников за ${Date.now() - startedAt} мс: книг прочитано ${Object.keys(data).length}`
      + ` (строк ${rowsTotal})`
      + (targetBooks ? ` — адресно: ${targetBooks.join(', ')}` : '')
      + (gate.skipped.length > 0 ? `, не читали (Drive: файл не менялся): ${gate.skipped.join(', ')}` : '')
      + (Object.keys(errors).length > 0 ? `, не прочитано: ${Object.keys(errors).join(', ')}` : '')
      + (readSvod ? (svodOk ? ', лист СВОД прочитан' : ', лист СВОД не прочитан') : ', лист СВОД не входил в цель')
      // «Формулы не читали» пишется словами, а не пропускается: строка журнала
      // без упоминания формул читалась бы как «формулы в порядке».
      + (formulaBooks.length > 0
          ? `, формулы прочитаны: ${formulaBooks.join(', ')}`
          : ', формулы не читались')
      + (nothingChanged ? ', изменений нет — снимок не пересобирался'
        : changedBooks.length || svodResult.changed ? `, изменилось: ${[...changedBooks, ...(svodResult.changed ? ['лист СВОД'] : [])].join(', ')}`
          : formulaInputsChanged ? ', получены новые сведения о формулах'
            : Object.keys(errors).length ? ', чтение источников неполно' : ', принято первое чтение источников'),
      {
        ms: Date.now() - startedAt,
        books: Object.keys(data).length,
        rows: rowsTotal,
        failed: Object.keys(errors).length,
        svodOk,
        origin,
        targeted: targetBooks ? targetBooks.length : 0,
        skipped: gate.skipped.length,
        changed: changedBooks.length + (svodResult.changed ? 1 : 0),
        formulaBooks: formulaBooks.length,
      },
    );

    // П.98б («внесла данные, из красного не ушло»): свежие книги обязаны сразу
    // попасть в снимок — без сброса кэш снимка (TTL 300 с) держал старые
    // замечания до 5 минут после вебхука. Пересборка дедуплицирована
    // inFlightLoads, шторма пересчётов сброс не создаёт.
    //
    // Но сброс не бесплатен: следом идёт полная пересборка снимка со всеми
    // проверками. Правка в книге, не изменившая ни одной ячейки (открыли,
    // закрыли, переставили ширину колонки — Drive шлёт уведомление и на это),
    // раньше стоила ровно столько же, сколько настоящая. Совпали отпечатки —
    // сбрасывать нечего: на экране те же числа, что и в кэше.
    if (!nothingChanged) invalidateCache();

    return {
      loaded: Object.keys(data),
      failed: Object.keys(errors),
      retryableFailures: Object.entries(errors).filter(([, error]) => isTransientSourceFailure(error)).map(([name]) => name),
      svodRetryable: 'retryable' in svodResult && svodResult.retryable === true,
      svodOk,
      at,
      changedBooks,
      svodChanged: svodResult.changed,
      booksRead: Object.keys(data).length + Object.keys(errors).length,
      skipped: gate.skipped,
      formulaBooks,
    };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Рабочее окно опроса — решение владельца 14.08 (канон п.87/20): книги правят
 * в рабочее время, ночью и в выходные опрос жжёт квоту впустую. Окно задано
 * по Камчатке (продуктовый пояс, config.weeklySnapshot.utcOffsetHours);
 * вебхук-каналы работают всегда — они бесплатны и точны.
 */
const WORK_START_MIN = 8 * 60 + 45;
const WORK_END_MIN = 18 * 60 + 20;

export function isWithinWorkHours(now: Date, utcOffsetHours: number): boolean {
  const localMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + utcOffsetHours * 60 + 24 * 60) % (24 * 60);
  return localMin >= WORK_START_MIN && localMin <= WORK_END_MIN;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Запустить самообновление источников. Период — `cache.autoRefreshMinutes`
 * (0 выключает). Тик не наслаивается сам на себя: пока идёт предыдущая
 * перечитка, следующая ждёт её промис.
 */
export function startSourceAutoRefresh(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): void {
  const minutes = config.cache.autoRefreshMinutes;
  if (minutes <= 0 || timer) return;

  timer = setInterval(() => {
    if (!isWithinWorkHours(new Date(), config.weeklySnapshot.utcOffsetHours)) return;
    void refreshAllSources(log)
      .then((r) => {
        const state = r.failed.length || !r.svodOk ? 'Проверка источников неполна'
          : r.changedBooks.length || r.svodChanged ? 'Источники изменились' : 'Источники проверены, изменений не обнаружено';
        log.info(
          `${state}: книг прочитано ${r.loaded.length}` +
          `${r.failed.length > 0 ? `, не прочитано: ${r.failed.join(', ')}` : ''}` +
          `${r.svodOk ? '' : ', лист СВОД недоступен'}`,
        );
      })
      .catch((err: unknown) => {
        log.warn(`Автообновление источников не удалось: ${(err as Error).message}`);
      });
  }, minutes * 60_000);

  // Таймер не держит процесс: сервер должен уметь завершаться штатно.
  timer.unref?.();
  log.info(`Автообновление источников включено: каждые ${minutes} мин`);
}

export function stopSourceAutoRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
