/**
 * file-revision.ts — «а книга вообще менялась?» одним дешёвым вопросом.
 *
 * ЗАЧЕМ. Уведомление Drive приходит и на такие правки, которых в данных нет:
 * открыли книгу и закрыли, переставили ширину колонки, поменяли цвет вкладки,
 * добавили примечание. Продукт до сих пор отвечал на каждое такое сообщение
 * полным чтением книги — сеть, квота Google, разбор, пересборка снимка. Плата
 * взималась за событие, а не за изменение.
 *
 * ЧТО ДАЁТ GOOGLE. Ресурс файла Drive v3 хранит два поля, по которым видно
 * факт правки, не читая ни одной ячейки: `version` (монотонный счётчик всех
 * изменений файла на сервере) и `modifiedTime`. Запрос за ними — это
 * files.get с маской полей (`fields`, документация Drive, guides/
 * manage-revisions: «use the fields system parameter to specify which data to
 * return»): ответ около двухсот байт против мегабайтов грида.
 *
 * ОДНОСТОРОННЯЯ ГАРАНТИЯ. Совпали оба поля — файл НЕ менялся, читать нечего,
 * и это утверждение точное. Разошлись — файл менялся хоть чем-нибудь, но чем
 * именно, Drive не говорит: ни листа, ни строки, ни ячейки в ответе нет.
 * Поэтому «разошлись» означает только «читай», а разницу дальше считает
 * продукт сам — отпечатками листов (sheet-fingerprint.ts).
 *
 * ЧЕГО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ. Он не решает, читать ли: он отвечает на вопрос
 * и честно говорит «не знаю», когда Drive недоступен или доступа нет.
 * «Не знаю» обязано трактоваться как «читай» — пропустить правку хуже, чем
 * прочитать лишнее.
 */
import { google } from 'googleapis';
import { config } from '../config.js';

/** Ответ на вопрос «менялся ли файл с прошлого чтения». */
export type RevisionVerdict = 'changed' | 'same' | 'unknown';

/** Отметка версии файла: то, что вернул Drive, без домыслов. */
export interface FileRevision {
  /** Монотонный счётчик изменений файла; пусто — Drive не вернул поле. */
  version: string | null;
  /** Момент последней правки (ISO); пусто — Drive не вернул поле. */
  modifiedTime: string | null;
}

/** Что видели в прошлый раз — по файлам. */
const seen = new Map<string, FileRevision>();

/**
 * Клиент Drive только для чтения метаданных. Отдельный от drive-watch: там
 * клиент создаётся под регистрацию каналов и живёт вызовом, здесь он нужен
 * часто и живёт процессом.
 */
let driveApi: ReturnType<typeof google.drive> | null = null;

function driveClient(): ReturnType<typeof google.drive> | null {
  if (driveApi) return driveApi;
  const { serviceAccountEmail, privateKey } = config.google;
  // Без служебной учётной записи Drive недоступен (ключ API к files.get на
  // приватный файл не подходит). Это не поломка — это «спросить не у кого».
  if (!serviceAccountEmail || !privateKey) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: serviceAccountEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  driveApi = google.drive({ version: 'v3', auth });
  return driveApi;
}

/** Сколько ждём ответа. Дешёвый вопрос не имеет права держать перечитку. */
const REVISION_TIMEOUT_MS = 4_000;

/**
 * Спросить у Drive отметку версии файла. Ошибка любого рода — `null`:
 * вызывающий обязан прочитать книгу, а не гадать.
 */
export async function readRevision(fileId: string): Promise<FileRevision | null> {
  const drive = driveClient();
  if (!drive) return null;
  try {
    const response = await drive.files.get(
      // supportsAllDrives — книги могут лежать на общем диске; без него
      // files.get на такой файл отвечает 404, и продукт решил бы, что книги нет.
      { fileId, fields: 'version,modifiedTime', supportsAllDrives: true },
      { timeout: REVISION_TIMEOUT_MS },
    );
    const data = response.data as { version?: string | null; modifiedTime?: string | null };
    return {
      version: data.version ?? null,
      modifiedTime: data.modifiedTime ?? null,
    };
  } catch {
    return null;
  }
}

/** Совпадают ли две отметки. Пустая отметка ни с чем не совпадает. */
function sameRevision(a: FileRevision | null | undefined, b: FileRevision | null): boolean {
  if (!a || !b) return false;
  // Пустые поля с обеих сторон — это «Drive промолчал», а не «всё совпало».
  if (a.version === null && a.modifiedTime === null) return false;
  return a.version === b.version && a.modifiedTime === b.modifiedTime;
}

/**
 * Менялся ли файл с прошлой проверки.
 *
 * Отметка запоминается ТОЛЬКО когда Drive ответил: молчание не имеет права
 * стать базой сравнения, иначе следующая проверка сказала бы «не менялся» про
 * файл, о котором мы ничего не знаем.
 *
 * Первый вопрос за жизнь процесса всегда даёт `changed`: сравнивать не с чем,
 * а книгу читать надо.
 */
export async function checkFileChanged(fileId: string): Promise<RevisionVerdict> {
  const now = await readRevision(fileId);
  if (!now) return 'unknown';
  const before = seen.get(fileId);
  seen.set(fileId, now);
  if (!before) return 'changed';
  return sameRevision(before, now) ? 'same' : 'changed';
}

/**
 * Запомнить отметку файла, не вынося вердикта, — после самостоятельного
 * чтения книги. Без этого первая же проверка после старта объявляла бы
 * изменением то, что мы только что прочитали.
 */
export async function noteRevisionRead(fileId: string): Promise<void> {
  const now = await readRevision(fileId);
  if (now) seen.set(fileId, now);
}

/**
 * Посеять отметку файла из водяного знака в базе — при подъёме процесса.
 *
 * После рестарта память пуста, и первый вопрос «менялся ли файл» отвечал бы
 * «менялся» про каждую книгу, даже нетронутую. Знак из базы (§2.4 проекта
 * службы) возвращает довалочную базу сравнения. Живая отметка, уже снятая в
 * этой жизни процесса, посевом не перетирается.
 */
export function seedRevision(fileId: string, revision: FileRevision): void {
  if (revision.version === null && revision.modifiedTime === null) return;
  if (!seen.has(fileId)) seen.set(fileId, revision);
}

/**
 * Забыть отметку файла — после НЕУДАВШЕГОСЯ чтения книги.
 *
 * Иначе выходит ловушка: отметку запомнили перед чтением, чтение упало, и
 * следующая проверка честно говорит «файл не менялся» — про книгу, которую мы
 * так и не прочитали. Продукт молчал бы до тех пор, пока файл не поправят ещё
 * раз. Забытая отметка означает «спроси заново и читай».
 */
export function forgetRevision(fileId: string): void {
  seen.delete(fileId);
}

/** Что запомнено про файл — для журнала и тестов. */
export function lastKnownRevision(fileId: string): FileRevision | null {
  return seen.get(fileId) ?? null;
}

/** Только для тестов: забыть всё, что видели. */
export function resetRevisionMemory(): void {
  seen.clear();
  driveApi = null;
}
