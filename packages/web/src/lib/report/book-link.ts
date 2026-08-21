/**
 * Адрес строки в живой книге управления — дверь от числа отчёта к первичке.
 *
 * Дословный закон продукта: «от каждого пункта — путь к таблице». Отчёт этот
 * путь до 21.08 только НАЗЫВАЛ: под незаключённой позицией стояло «строка 128»
 * серым моноширинным текстом, и читателю оставалось открыть книгу управления
 * руками и долистать до неё. Работа P1-2 карты вкладки делает адрес
 * кликабельным.
 *
 * Что честно, а что нет. Идентификатор книги известен точно
 * (`DEPARTMENT_SPREADSHEET_IDS` — тот же реестр, по которому сервер эти книги
 * читает). Идентификатор ЛИСТА внутри книги (gid) продукту не известен:
 * `buildSheetUrl` подставляет gid=0 и диапазон, поэтому ссылка открывает книгу
 * и наводит выделение на строку активного листа. Обещать больше нельзя, и
 * подсказка ссылки говорит ровно это — «откроется книга управления, строка N».
 * Выдуманный gid увёл бы читателя на чужой лист и был бы хуже отсутствия
 * ссылки.
 */
import { DEPARTMENT_SPREADSHEET_IDS, buildSheetUrl } from '@aemr/shared';
import { toCanonicalDeptId } from '../dept-key';

/** Идентификатор книги управления; null — управление вне реестра книг. */
export function deptBookId(dept: string): string | null {
  const canonical = toCanonicalDeptId(dept) as keyof typeof DEPARTMENT_SPREADSHEET_IDS;
  return DEPARTMENT_SPREADSHEET_IDS[canonical] ?? null;
}

/**
 * Ссылка на строку книги управления. null — книги нет в реестре либо номер
 * строки не похож на строку листа: ссылка в никуда хуже обычного текста.
 */
export function bookRowUrl(dept: string, row: number): string | null {
  const id = deptBookId(dept);
  if (id === null) return null;
  if (!Number.isInteger(row) || row < 1) return null;
  return buildSheetUrl(id, `A${row}`);
}

/**
 * Ссылка на конкретную ячейку книги управления (адрес сигнала: лист · ячейка).
 * Ячейка проверяется на форму A1 — сигналы приходят из разных проверок, и
 * непонятную строку лучше показать текстом, чем завернуть в битую ссылку.
 */
export function bookCellUrl(dept: string, cell: string): string | null {
  const id = deptBookId(dept);
  if (id === null) return null;
  if (!/^[A-Z]{1,2}\d+$/.test(cell.trim())) return null;
  return buildSheetUrl(id, cell.trim());
}

/** Подсказка ссылки — обещает ровно то, что ссылка делает. */
export function bookLinkHint(dept: string, where: string): string {
  return `Откроется книга управления ${dept} в Google Sheets, ${where}. ` +
    'Продукт не знает, какой лист книги открыт у вас, поэтому выделение наводится на активном листе.';
}
