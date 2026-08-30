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
import { checkFileChanged, forgetRevision, lastKnownRevision, seedRevision } from './file-revision.js';
import {
  SVOD_WATERMARK_KEY,
  loadWatermarks,
  noteHonestGap,
  saveWatermark,
} from './book-watermark.js';
import { SVOD_SHEET_NAME } from '@aemr/shared';
import { publishLiveEvent, type RefreshOrigin } from './event-bus.js';
import { diffBook, isSilent } from './live-diff.js';
import { classifySourceFailure } from './source-failure.js';
import { logSnapshotChange } from './source-log.js';

export interface SourceRefreshResult {
  loaded: string[];
  failed: string[];
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
let queuedScope: { books: Set<string> | null; svod: boolean; withFormulas: boolean } | null = null;

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

function seedFromWatermarks(): void {
  if (watermarksSeeded) return;
  watermarksSeeded = true;
  for (const [book, mark] of loadWatermarks()) {
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
}

/** Только для стражей: забыть посев и отпечатки. */
export function resetSourcePrints(): void {
  watermarksSeeded = false;
  bookPrints.clear();
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
  /** Почему не принял, если не принял. */
  failedBecause?: string;
}

let formulaSink: ((delivery: FormulaDelivery) => void) | null = null;
const formulaNotes = new Map<string, FormulaDeliveryNote>();

/** Подключить слой разбора формул. `null` — отключить (стражи, выключение). */
export function setFormulaSink(sink: ((delivery: FormulaDelivery) => void) | null): void {
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
  at: string,
  log?: { warn: (msg: string) => void },
): string[] {
  const delivered: string[] = [];
  for (const [book, result] of Object.entries(data)) {
    if (!result.formulasRead) continue;
    delivered.push(book);
    const note: FormulaDeliveryNote = {
      book,
      at,
      cells: countFormulaCells(result.formulas),
      handled: false,
    };
    if (formulaSink) {
      try {
        formulaSink({
          book,
          values: result.values,
          formulas: result.formulas,
          startRow: result.startRow ?? 1,
          formulasRead: true,
        });
        note.handled = true;
      } catch (err) {
        note.failedBecause = (err as Error).message;
        log?.warn(`Разбор формул книги «${book}» не удался: ${(err as Error).message}`);
      }
    } else {
      note.failedBecause = 'разбор формул не подключён';
    }
    formulaNotes.set(book, note);
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
  scope: { books: Set<string> | null; svod: boolean; withFormulas: boolean } | null,
  options: RefreshOptions,
): { books: Set<string> | null; svod: boolean; withFormulas: boolean } {
  const wantsAll = !options.books || options.books.length === 0;
  const svod = (scope?.svod ?? false) || (options.svod ?? true);
  // Просьба прочитать формулы тоже СКЛАДЫВАЕТСЯ: уведомление вебхука, попавшее
  // в серию вместе с обычным вызовом, не имеет права потерять чтение формул —
  // иначе перебитая формула дождалась бы только ночного обхода.
  const withFormulas = (scope?.withFormulas ?? false) || (options.withFormulas ?? false);
  if (!scope) return { books: wantsAll ? null : new Set(options.books), svod, withFormulas };
  if (scope.books === null || wantsAll) return { books: null, svod, withFormulas };
  for (const book of options.books ?? []) scope.books.add(book);
  return { books: scope.books, svod, withFormulas };
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
): Promise<{ books: string[]; svod: boolean; skipped: string[]; attested: string[] }> {
  if (!ask) return { books: [...candidates], svod: wantSvod, skipped: [], attested: [] };

  const books: string[] = [];
  const skipped: string[] = [];
  // Книги, про которые Drive СКАЗАЛ «файл менялся» (была прежняя отметка и
  // новая с ней разошлась). Не то же самое, что «читаем»: читаем и по
  // «не знаю», и впервые. Засвидетельствованное изменение при молчащем
  // содержимом — это честный пропуск журнала (правило полноты §2.2).
  const attested: string[] = [];

  const questions: Array<Promise<void>> = candidates.map(async (book) => {
    const fileId = DEPARTMENT_SPREADSHEETS[book];
    if (!fileId || !bookPrints.has(book)) {
      books.push(book);
      return;
    }
    const hadRevision = lastKnownRevision(fileId) !== null;
    const verdict = await checkFileChanged(fileId);
    if (verdict === 'same') {
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
export function refreshAllSources(log?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}, origin: RefreshOrigin = 'cycle', options: RefreshOptions = {}): Promise<SourceRefreshResult> {
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
        });
      });
    return queuedFresh;
  }

  inFlight = (async () => {
    // Водяной знак из базы — ДО любого сравнения: после рестарта отпечатки
    // обязаны быть довалочными, а не пустыми (§2.4 проекта службы).
    seedFromWatermarks();

    // Прежнее чтение книг — материал для ответа «что именно поменялось»
    // (шина живых событий). Ссылка снимается ДО записи нового кэша: запись
    // подставляет новый объект, прежний остаётся целым.
    const before = getDeptSheetCache();

    // Книги управлений и лист СВОД читаются ОДНОВРЕМЕННО, а не одно за другим.
    // Дело не только в скорости цикла (лист СВОД перестал ждать окончания
    // восьми книг): читать их подряд значит разносить стороны сверки во
    // времени ровно на длительность чтения книг, а канон п.66 требует
    // обратного — обе стороны из одного момента. Отказ одной стороны не должен
    // уносить другую, поэтому лист СВОД ловит свой отказ внутри себя.
    const startedAt = Date.now();
    const targetBooks = options.books && options.books.length > 0 ? options.books : undefined;
    const wantSvod = options.svod ?? true;

    // Ступень отсева у Google — ДО чтения: книга, которую никто не трогал с
    // прошлого раза, не стоит ни байта грида (см. gateByRevision).
    // Ручная просьба прочитать ФОРМУЛЫ отменяет отсев по отметке Drive.
    // Иначе жест владельца «перечитать сейчас» бесполезен ровно в том случае,
    // ради которого он существует: формулу починили руками, содержимое ячейки
    // изменилось, а Drive о правке уже отчитался прошлым циклом — книга
    // считается неизменной, формулы не читаются, дефект остаётся на экране.
    // Плата названа вслух: полный проход по восьми книгам со вторым
    // обращением за формулами. Автоматические циклы отсев сохраняют.
    const askDrive = options.withFormulas ? false : (options.askDrive ?? true);
    const gate = await gateByRevision(
      targetBooks ?? Object.keys(DEPARTMENT_SPREADSHEETS),
      wantSvod,
      askDrive,
    );
    const booksToRead = gate.books;
    const readSvod = gate.svod;

    const [{ data, errors }, svodResult] = await Promise.all([
      // Пустая цель — это НЕ «читай всё»: у fetchDepartmentSpreadsheets пустой
      // `only` означает «все книги», и передать его сюда значило бы отменить
      // весь отсев ровно в тот момент, когда он сработал полностью.
      booksToRead.length > 0
        ? fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS, {
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
            .then((values) => {
              setSvodGridCache(values);
              const print = sheetFingerprint(values);
              const first = svodPrint === null;
              const changed = !first && svodPrint !== print;
              svodPrint = print;
              // Водяной знак листа СВОД — тем же правилом, что и у книг:
              // успешный разбор оставляет след в базе, а не в памяти.
              saveWatermark(SVOD_WATERMARK_KEY, print, new Date().toISOString());
              return { ok: true, changed, first };
            })
            .catch((err: unknown) => {
              const reason = classifySourceFailure((err as Error)?.message ?? String(err));
              // След отказа переживает цикл: без него маршрут здоровья не отличал
              // «читали и не смогли» от «ещё не читали».
              setSvodLoadFailure(reason);
              log?.warn(`Лист СВОД не прочитан в этом цикле: ${reason}`);
              return { ok: false, changed: false, first: false };
            })
        : // Лист СВОД не входил в цель — про него в этом цикле сказать нечего.
          // «Не читали» честнее выдаётся прошлым состоянием, а не ложным «ок».
          Promise.resolve({ ok: getSvodLoadFailure() === null, changed: false, first: false }),
    ]);
    const svodOk = svodResult.ok;
    setDeptSheetCache(data, Object.keys(errors));

    // Отпечатки — дешёвая ступень разбора: они отвечают «изменилось ли», и
    // только для изменившихся книг работает дорогое построчное сравнение.
    // Книга, прочитанная впервые за жизнь процесса, изменившейся НЕ считается.
    const changedBooks: string[] = [];
    // Книга, прочитанная ВПЕРВЫЕ, не «изменилась» — но снимок, собранный до
    // неё, собран без её строк, и оставлять его в кэше нельзя. Событий в эфир
    // первое чтение не даёт, а сброс кэша — даёт.
    let firstReads = 0;
    for (const [name, result] of Object.entries(data)) {
      const print = sheetFingerprint(result.values);
      const previous = bookPrints.get(name);
      bookPrints.set(name, print);
      if (previous === undefined) firstReads++;
      else if (previous !== print) changedBooks.push(name);
      // Водяной знак: момент успешного разбора, отпечаток и отметка версии
      // файла — в базу, чтобы рестарт не обнулял базу сравнения (§2.4).
      const fileId = DEPARTMENT_SPREADSHEETS[name];
      const revision = fileId ? lastKnownRevision(fileId) : null;
      saveWatermark(name, print, new Date().toISOString(), revision ?? undefined);
    }

    // Правило полноты (§2.2): Drive засвидетельствовал «файл менялся», книга
    // прочитана, а содержательные свидетели молчат — отпечаток листа тот же.
    // В журнал уходит честный пропуск «изменение было, содержание не
    // установлено», а не тишина. Один и тот же пропуск не пишется дважды.
    for (const name of gate.attested) {
      if (changedBooks.includes(name)) continue;
      if (!(name in data)) continue; // чтение упало — это отказ, а не пропуск
      const fileId = DEPARTMENT_SPREADSHEETS[name];
      const modifiedTime = fileId ? lastKnownRevision(fileId)?.modifiedTime ?? null : null;
      if (noteHonestGap(name, modifiedTime)) {
        log?.warn(
          `Журнал: по книге «${name}» изменение было, содержание не установлено`
          + (modifiedTime ? ` (отметка файла ${modifiedTime})` : ''),
        );
      }
    }
    // Упавшая книга ушла из кэша — её отпечаток больше ничего не описывает.
    // Заодно забывается отметка версии файла: она снята перед чтением, которого
    // не было, и без этого книга выпала бы из перечиток до следующей правки.
    for (const name of Object.keys(errors)) {
      bookPrints.delete(name);
      const fileId = DEPARTMENT_SPREADSHEETS[name];
      if (fileId) forgetRevision(fileId);
    }

    publishBookChanges(before, data, origin, changedBooks);

    const at = new Date().toISOString();

    // Формулы — в разбор целостности. Доставка идёт ПОСЛЕ записи кэша и до
    // журнала: разбор не имеет права задержать обновление экрана, а его исход
    // обязан попасть в ту же строку журнала, что и остальной итог цикла.
    const formulaBooks = deliverFormulas(data, at, log);

    const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
    for (const [name, result] of Object.entries(data)) {
      loadMeta[name] = { loadedAt: at, rowCount: result.values.length, sheetName: result.sheetName };
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
    const nothingChanged =
      changedBooks.length === 0
      && firstReads === 0
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
      + (nothingChanged ? ', изменений нет — снимок не пересобирался' : `, изменилось: ${[...changedBooks, ...(svodResult.changed ? ['лист СВОД'] : [])].join(', ')}`),
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
        log.info(
          `Источники обновлены: книг ${r.loaded.length}` +
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
