/**
 * Форматирование чисел, дат и адресов вкладки «Мониторинг».
 *
 * Один дом на всю вкладку — чтобы подпись единицы нельзя было забыть в одном
 * месте из десяти. Деньги книги мониторинга — РУБЛИ, книги ГРБС — тысячи;
 * `fmtRub` возвращает число без слова «руб.», а слово ставится в шапке
 * колонки либо рядом с числом — так подпись остаётся, а таблица не пестрит.
 *
 * Прочерк здесь означает ровно одно: значения НЕТ. Ноль прочерком не рисуется
 * никогда — ноль в цене аукциона содержателен («торги без результата»).
 */

/** Рубли с разрядами, без копеек: копейки в реестре — шум, точность — в title. */
export function fmtRub(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

/** Рубли с копейками — для карточки процедуры и сверки: там копейка решает. */
export function fmtRubExact(v: number | null): string {
  return v === null
    ? '—'
    : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Проценты с одним знаком: 9,7 %. */
export function fmtPct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v.toLocaleString('ru-RU', { maximumFractionDigits: digits })} %`;
}

/** Целое с русскими разрядами. */
export function fmtCount(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('ru-RU');
}

/** Момент чтения книги: «18.08.2026, 14:05» по часам читателя (п.58). */
export function fmtReadAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Дата книги как есть: «дд.мм.гггг» уже пришла строкой, чинить её нельзя. */
export function fmtDate(v: string | null): string {
  return v ?? '—';
}

/**
 * Двойной адрес строки — «строка 34 · № 32» (принято на других вкладках после
 * бага 18.08 с номерами). Одного номера п/п мало: в листе УО нумерация 1…27
 * идёт дважды, и ссылка по номеру неоднозначна.
 */
export function rowAddress(sheet: string, row: number, ppNum: string | null): string {
  const tail = ppNum !== null ? ` · № ${ppNum}` : '';
  return `Лист «${sheet}», строка ${row}${tail}`;
}

/** Короткий адрес для списков сигналов: «8. УО!J100». */
export function cellAddress(sheet: string, cell: string): string {
  return `${sheet}!${cell}`;
}

/**
 * Дата книги «дд.мм.гггг» → сортируемый ключ «ггггммдд». Дата, записанная
 * текстом с опечаткой (`23.062026`), ключа не даёт: такая строка уезжает в
 * конец сортировки и в сигнал, а не притворяется валидной датой.
 */
export function dateSortKey(v: string | null): number | null {
  if (v === null) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
  if (!m) return null;
  return Number(m[3]) * 10_000 + Number(m[2]) * 100 + Number(m[1]);
}

/** Месяц даты книги (1–12) либо null — для разреза по кварталу и месяцу. */
export function dateMonth(v: string | null): number | null {
  const key = dateSortKey(v);
  return key === null ? null : Math.floor(key / 100) % 100;
}

/** Год даты книги либо null. */
export function dateYear(v: string | null): number | null {
  const key = dateSortKey(v);
  return key === null ? null : Math.floor(key / 10_000);
}

/** Квартал даты книги (1–4) либо null. */
export function dateQuarter(v: string | null): number | null {
  const m = dateMonth(v);
  return m === null ? null : Math.ceil(m / 3);
}

/**
 * Дата книги «дд.мм.гггг» → Date либо null. Дата, записанная текстом с
 * опечаткой, null и остаётся: чинить набор человека продукт не вправе, он
 * называет адрес и просит перезаписать.
 */
export function parseBookDate(v: string | null): Date | null {
  const m = v === null ? null : /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  // Проверка на «31.02.2026»: JS молча перекатывает такую дату на март.
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/**
 * Календарных дней между двумя датами книги. Отрицательное значение — не
 * ошибка расчёта, а находка: торги раньше публикации в книге встречаются
 * двенадцать раз, и прятать такой минус нельзя.
 */
export function daysBetween(from: string | null, to: string | null): number | null {
  const a = parseBookDate(from);
  const b = parseBookDate(to);
  if (a === null || b === null) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** «4 дня» / «−12 дней» — длительность этапа словами. */
export function fmtDays(v: number | null): string {
  if (v === null) return '—';
  return `${v.toLocaleString('ru-RU')} ${plural(Math.abs(v), 'день', 'дня', 'дней')}`;
}

/** Русское склонение по числу: 1 процедура, 2 процедуры, 5 процедур. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «374 процедуры» — число со склонённым словом. */
export function pluralCount(n: number, one: string, few: string, many: string): string {
  return `${fmtCount(n)} ${plural(n, one, few, many)}`;
}
