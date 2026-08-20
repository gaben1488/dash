/**
 * ДЕНЬГИ С ПОМЕЧЕННОЙ ЕДИНИЦЕЙ: тысячи рублей и рубли — разные типы.
 *
 * ЗАЧЕМ. Книги ГРБС ведутся в ТЫСЯЧАХ рублей (колонки H/I/J/K, V/W/X/Y —
 * канон report-map.ts), а закон, мониторинг и сообщения читателю говорят в
 * РУБЛЯХ. Пока обе величины — просто `number`, компилятор их не различает, и
 * перепутать их можно молча.
 *
 * ЭТО УЖЕ СЛУЧАЛОСЬ. БАГ #1 охоты 2026-08-08: пороги 44-ФЗ были записаны в
 * рублях (600_000), а сравнивались с плановой суммой строки в тысячах.
 * Чтобы проверка сработала, понадобился бы контракт на 600 МЛН — то есть она
 * молчала всегда, на всех живых данных. Ошибку нашли не типы и не тесты, а
 * ручная охота за багами через полгода. Нынешняя защита — суффикс
 * `...ThousandRub` в имени: это подпись, а не запрет, и подпись компилятор не
 * читает.
 *
 * ЧТО ДАЁТ ПОМЕТКА. Тип `ThousandRub` нельзя передать туда, где ждут `Rub`, и
 * наоборот; голое число тоже не пройдёт — его нужно объявить единицей явно.
 * Перевод возможен ровно один, через `toRub`/`toThousandRub`, и множитель
 * записан в одном месте, а не рассыпан делениями на 1000 по файлам.
 *
 * ЧЕГО ПОМЕТКА НЕ ДАЁТ — честная граница. В TypeScript обе величины остаются
 * числами, поэтому операторы сравнения (`>`, `<`) и арифметика примут любую
 * пару и брак пропустят. Поэтому сравнение и сложение денег ведутся ФУНКЦИЯМИ
 * этого модуля (`exceedsThousandRub`, `sumThousandRub` и прочие): у функции
 * есть типы параметров, и вот они смешение уже не пропускают. Правило простое:
 * денег не касаемся голыми операторами — берём функцию отсюда.
 *
 * ВО ВРЕМЯ ВЫПОЛНЕНИЯ пометки нет: это по-прежнему обычное число. Оно так же
 * складывается, так же попадает в JSON и так же весит. Пометка живёт только
 * при проверке типов и исчезает при сборке.
 */

/**
 * Носитель пометки. Объявлен, но не создан: значения у него не бывает,
 * существует только имя типа. Поэтому в собранном коде от него не остаётся
 * ничего.
 */
declare const MONEY_UNIT: unique symbol;

/** Тысячи рублей — единица книг ГРБС и листа СВОД. */
export type ThousandRub = number & { readonly [MONEY_UNIT]: 'тыс. руб.' };

/** Рубли — единица закона, мониторинга и сообщений читателю. */
export type Rub = number & { readonly [MONEY_UNIT]: 'руб.' };

/** Сколько рублей в одной тысяче. Множитель перевода живёт здесь и только здесь. */
export const RUB_PER_THOUSAND = 1000;

/**
 * Объявить голое число тысячами рублей.
 *
 * Место вызова — ГРАНИЦА: разбор ячейки книги, разбор ответа таблиц, запись
 * порога закона. Внутри расчёта вызывать не нужно: там величины уже помечены,
 * и лишний вызов как раз и стирает защиту.
 */
export function thousandRub(value: number): ThousandRub {
  return value as ThousandRub;
}

/** Объявить голое число рублями. Правило места вызова — то же, что у `thousandRub`. */
export function rub(value: number): Rub {
  return value as Rub;
}

/** Тысячи → рубли. */
export function toRub(value: ThousandRub): Rub {
  return (value * RUB_PER_THOUSAND) as Rub;
}

/** Рубли → тысячи. */
export function toThousandRub(value: Rub): ThousandRub {
  return (value / RUB_PER_THOUSAND) as ThousandRub;
}

/**
 * Снять пометку и получить обычное число.
 *
 * Нужно там, где деньги перестают быть деньгами: вывод на экран, сериализация,
 * передача в постороннюю библиотеку. Для арифметики брать функции ниже —
 * они пометку сохраняют.
 */
export function moneyValue(value: ThousandRub | Rub): number {
  return value;
}

/** Сумма тысяч. Пустой список даёт ноль тысяч, а не пустоту. */
export function sumThousandRub(values: readonly ThousandRub[]): ThousandRub {
  let total = 0;
  for (const v of values) total += v;
  return total as ThousandRub;
}

/** Сложение тысяч. */
export function addThousandRub(a: ThousandRub, b: ThousandRub): ThousandRub {
  return (a + b) as ThousandRub;
}

/** Разность тысяч (a − b). Знак сохраняется: недобор отрицателен. */
export function subThousandRub(a: ThousandRub, b: ThousandRub): ThousandRub {
  return (a - b) as ThousandRub;
}

/** Модуль расхождения двух сумм в тысячах. */
export function absDiffThousandRub(a: ThousandRub, b: ThousandRub): ThousandRub {
  return Math.abs(a - b) as ThousandRub;
}

/**
 * Строго больше порога. Обе стороны обязаны быть в тысячах — на этой подписи
 * и ломается попытка сравнить сумму строки с порогом, записанным в рублях.
 */
export function exceedsThousandRub(value: ThousandRub, limit: ThousandRub): boolean {
  return value > limit;
}

/** Доля одной суммы в другой. Знаменатель ≤ 0 — доли нет (null, не ноль). */
export function shareThousandRub(part: ThousandRub, whole: ThousandRub): number | null {
  return whole > 0 ? part / whole : null;
}
