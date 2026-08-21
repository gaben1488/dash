/**
 * sheet-fingerprint.ts — отпечаток содержимого листа.
 *
 * ЗАЧЕМ. Уведомление Google Drive говорит только «файл изменился» и, в лучшем
 * случае, грань правки («content», «properties») — ни строки, ни ячейки в
 * сообщении нет (документация Drive, guides/push, раздел «Receive
 * notification»: заголовки Channel-ID, Message-Number, Resource-ID,
 * Resource-State, Resource-URI, Changed — и всё). Google Sheets тоже не умеет
 * отдавать «что поменялось с прошлого чтения»: в API есть только чтение
 * диапазонов. Значит, разницу приходится считать у себя.
 *
 * Отпечаток — первая ступень такого счёта, самая дешёвая. Прочитанный лист
 * сворачивается в короткую строку; совпала со строкой прошлого чтения — лист
 * не изменился, и всё, что за ним стоит (разбор, пересборка снимка, живые
 * события), можно не делать вовсе. Не совпала — работает построчное сравнение
 * (live-diff.ts), которое дороже и говорит уже «какая строка и какая колонка».
 *
 * ПОЧЕМУ НЕ SHA. Криптографическая стойкость здесь не нужна и стоит денег:
 * лист на три тысячи строк пришлось бы сначала склеить в одну строку на
 * несколько мегабайт. FNV-1a идёт по ячейкам без промежуточной склейки. Два
 * независимых состояния (разные начальные значения) дают 64 бита — при таких
 * объёмах случайное совпадение отпечатков разных листов практически исключено,
 * а последствие совпадения — пропущенное обновление, а не порча данных.
 */

/** Начальное значение FNV-1a (32 бита) и второе, независимое от него. */
const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x01000193;

/**
 * Свернуть строки листа в отпечаток. Пустой лист и лист, которого не было,
 * дают РАЗНЫЕ отпечатки: «книга опустела» — это событие, а не тишина.
 */
export function sheetFingerprint(values: readonly (readonly unknown[])[] | null | undefined): string {
  if (values === null || values === undefined) return 'нет';

  let a = OFFSET_A;
  let b = OFFSET_B;
  let cells = 0;

  const mix = (code: number): void => {
    a ^= code;
    a = Math.imul(a, 0x01000193);
    b ^= code + 0x9e3779b9 + ((b << 6) | 0) + (b >>> 2);
    b = Math.imul(b, 0x85ebca6b);
  };

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    // Ширина строки — часть отпечатка: дописанная в конец пустая ячейка меняет
    // форму листа, и притворяться, что ничего не произошло, нельзя.
    mix(row?.length ?? 0);
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell === null || cell === undefined) {
        mix(0);
        continue;
      }
      const text = typeof cell === 'string' ? cell : String(cell);
      mix(text.length + 1);
      for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
      cells++;
    }
    // Граница строки: «а|б» и «аб|» не должны совпасть.
    mix(0xff);
  }

  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  // Число строк и заполненных ячеек идёт в отпечаток открытым текстом — так
  // след в журнале читается человеком, а не только машиной.
  return `${values.length}:${cells}:${hex(a)}${hex(b)}`;
}

/**
 * Отпечатки всех листов книги. Ключ — имя листа, значение — отпечаток.
 * Отдельная функция, а не цикл на месте вызова: одинаковая свёртка нужна и
 * книгам ГРБС, и книге мониторинга, и расхождение в способе счёта означало бы
 * ложные «изменилось» на ровном месте.
 */
export function bookFingerprints(
  sheets: Readonly<Record<string, readonly (readonly unknown[])[]>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, values] of Object.entries(sheets)) out[name] = sheetFingerprint(values);
  return out;
}

/**
 * Какие листы изменились между двумя наборами отпечатков.
 *
 * Исчезнувший лист попадает в список наравне с появившимся: «лист пропал» —
 * это изменение книги, и молчать о нём значит показывать вчерашние строки как
 * сегодняшние. Первое чтение за жизнь процесса (прежних отпечатков нет вовсе)
 * изменением НЕ считается — иначе каждый старт объявлял бы всю книгу новой.
 */
export function changedSheets(
  before: Readonly<Record<string, string>> | null | undefined,
  after: Readonly<Record<string, string>>,
): string[] {
  if (!before || Object.keys(before).length === 0) return [];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const name of names) {
    if (before[name] !== after[name]) changed.push(name);
  }
  return changed.sort();
}
