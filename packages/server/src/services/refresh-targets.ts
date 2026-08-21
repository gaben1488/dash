/**
 * refresh-targets.ts — что именно перечитывать по уведомлению Drive.
 *
 * ЧТО ДАЁТ GOOGLE. Push-уведомление Drive приходит без тела; вся правда — в
 * заголовках X-Goog-* (документация Drive, guides/push, «Receive
 * notification»): идентификатор канала, номер сообщения, идентификатор и адрес
 * ресурса, состояние ресурса и — по желанию — грани правки (X-Goog-Changed:
 * content, properties, parents, children, permissions). Ни листа, ни строки,
 * ни ячейки в сообщении НЕТ, и получить их неоткуда: changes.list у Drive
 * перечисляет изменившиеся ФАЙЛЫ, а Google Sheets вообще не имеет метода «что
 * поменялось с прошлого чтения» — только чтение диапазонов
 * (spreadsheets.values.get / batchGet).
 *
 * ЧТО ИЗ ЭТОГО СЛЕДУЕТ. Точность уведомления — файл. Значит, и перечитка
 * обязана быть до файла: правка в книге УО не имеет права стоить чтения ещё
 * семи книг, листа СВОД и одиннадцати листов мониторинга. Дальше файла разницу
 * считает продукт сам — отпечатками листов (sheet-fingerprint.ts) и построчным
 * сравнением (live-diff.ts).
 *
 * Этот модуль — только перевод «идентификатор файла → что перечитать». Он
 * ничего не читает и ни на что не подписывается: решение о цели должно быть
 * проверяемо тестом без сети.
 */
import { config, DEPARTMENT_SPREADSHEETS, SHDYU_SPREADSHEET_ID } from '../config.js';
import { MONITORING_SPREADSHEET_ID } from './monitoring.js';

/**
 * Цель перечитки.
 *
 * `unknown` — файл под наблюдением, но в списке источников его нет (книгу
 * переназначили, канал остался от прежней настройки). Такая правка стоит
 * ПОЛНОЙ перечитки: лучше прочитать лишнее, чем молча пропустить изменение.
 */
export interface RefreshPlan {
  /** Книги ГРБС, которые надо перечитать; пусто — ни одной. */
  books: string[];
  /** Нужно ли перечитывать лист СВОД основной книги. */
  svod: boolean;
  /** Нужно ли сбрасывать кэш книги мониторинга. */
  monitoring: boolean;
  /** Ни одна цель не опознана — читать всё (страховка). */
  full: boolean;
}

export const EMPTY_PLAN: RefreshPlan = { books: [], svod: false, monitoring: false, full: false };

/** План «прочитать всё» — прежнее поведение, оставленное как страховка. */
export const FULL_PLAN: RefreshPlan = { books: [], svod: true, monitoring: true, full: true };

/**
 * Цель одного файла. Идентификаторы книг ГРБС читаются из живого
 * DEPARTMENT_SPREADSHEETS, а не из снятой копии: книгу управления можно
 * переназначить на ходу (updateSpreadsheetId), и план обязан следовать за
 * настройкой, а не за состоянием на момент старта процесса.
 */
export function planForFile(fileId: string | null | undefined): RefreshPlan {
  if (!fileId) return FULL_PLAN;

  for (const [book, id] of Object.entries(DEPARTMENT_SPREADSHEETS)) {
    if (id === fileId) return { books: [book], svod: false, monitoring: false, full: false };
  }
  if (fileId === MONITORING_SPREADSHEET_ID) {
    return { books: [], svod: false, monitoring: true, full: false };
  }
  // Основная книга и книга ШДЮ — один и тот же файл в текущей настройке;
  // обе стороны сверки живут в нём, поэтому цель одна: лист СВОД.
  if (fileId === config.google.spreadsheetId || fileId === SHDYU_SPREADSHEET_ID) {
    return { books: [], svod: true, monitoring: false, full: false };
  }
  return FULL_PLAN;
}

/**
 * Свести планы серии уведомлений в один.
 *
 * Пять правок в трёх книгах за время склейки — это три книги в одном цикле, а
 * не пять циклов и не восемь книг. Достаточно одному файлу оказаться
 * неопознанным, чтобы вся серия читалась полностью: половинчатая перечитка
 * после неизвестного изменения хуже честной полной.
 */
export function mergePlans(plans: readonly RefreshPlan[]): RefreshPlan {
  if (plans.length === 0) return EMPTY_PLAN;
  const books = new Set<string>();
  let svod = false;
  let monitoring = false;
  let full = false;
  for (const plan of plans) {
    for (const book of plan.books) books.add(book);
    svod ||= plan.svod;
    monitoring ||= plan.monitoring;
    full ||= plan.full;
  }
  if (full) return FULL_PLAN;
  return { books: [...books].sort(), svod, monitoring, full: false };
}

/** Есть ли в плане хоть какая-то работа. */
export function isEmptyPlan(plan: RefreshPlan): boolean {
  return !plan.full && !plan.svod && !plan.monitoring && plan.books.length === 0;
}

/** Человеческое описание плана — для журнала сервера. */
export function describePlan(plan: RefreshPlan): string {
  if (plan.full) return 'все источники';
  const parts: string[] = [];
  if (plan.books.length > 0) parts.push(`книги: ${plan.books.join(', ')}`);
  if (plan.svod) parts.push('лист СВОД');
  if (plan.monitoring) parts.push('книга мониторинга');
  return parts.length > 0 ? parts.join('; ') : 'ничего';
}
