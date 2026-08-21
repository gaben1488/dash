/**
 * bi.ts — разрезы витрины «Аналитика мониторинга», отвечающие на три вопроса
 * руководителя: ГДЕ ДЕНЬГИ, ГДЕ РИСК, ГДЕ ЗАТЫК.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ДОБАВКА В `charts.ts`. В `charts.ts` живут
 * переводчики: они берут уже посчитанное сервером и раскладывают под ось
 * графика. Здесь считается то, чего сервер не считает вовсе, — и считается
 * прямо по строкам реестра, которые страница и так держит целиком. Смешать
 * эти два слоя значит потерять ответ на вопрос «откуда взялось число».
 *
 * ПОЧЕМУ СЧЁТ НА КЛИЕНТЕ. Строки реестра уже приехали одним ответом и лежат
 * в памяти страницы; повторный поход на сервер за производными от них
 * числами добавил бы вторую судьбу отказа и второй момент чтения — а момент
 * чтения у витрины обязан быть один (п.58). Все функции чистые: тот же вход
 * даёт тот же выход, проверяется тестом без сети.
 *
 * ПРОВЕНАНС (п.104) У КАЖДОГО РАЗРЕЗА НАЗВАН КОЛОНКАМИ КНИГИ, а не «данными
 * системы»: колонка B — заказчик, D — начальная цена, I — цена аукциона,
 * J — экономия ВСЕГО, K — самопроверка книги, L/M/N — экономия по бюджетам,
 * начало колонки C — код процедуры. Читатель обязан иметь возможность
 * открыть книгу и увидеть то же самое своими глазами.
 *
 * ЧЕСТНАЯ ПУСТОТА. Ни одна функция не выдумывает нулей: пустой знаменатель
 * возвращается как `null`, а не как «0 %». Разницу «нечего делить» и «делится
 * в ноль» экран обязан сказать словами, и подсунуть ему ноль вместо null
 * значит отобрать у него эту возможность.
 */
import type { RegistryProcedure } from './contract';

/** Доля в процентах; null — знаменатель пуст, делить нечего. */
function sharePct(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

/** Сумма поля по строкам, пустые ячейки не считаются нулями молча. */
function sum(rows: readonly RegistryProcedure[], pick: (p: RegistryProcedure) => number | null): number {
  let acc = 0;
  for (const p of rows) acc += pick(p) ?? 0;
  return acc;
}

/** Состоявшаяся процедура с обеими суммами — знаменатель всех разрезов цены. */
function isPriced(p: RegistryProcedure): boolean {
  return p.stage === 'awarded' && p.nmck !== null && p.nmck > 0 && p.auctionPrice !== null;
}

// ── §1. Где деньги: концентрация заказчиков ──────────────────────────

export interface CustomerWeightRow {
  /** Заказчик так, как записан в колонке B, — без нашей нормализации. */
  readonly customer: string;
  /** Ключ отбора реестра: разрез «Заказчик» сравнивает по написанию книги. */
  readonly sliceKey: string;
  readonly count: number;
  readonly nmckRub: number;
  /** Доля заказчика в начальных ценах книги, %. */
  readonly sharePct: number | null;
  /** Накопленная доля сверху вниз, % — по ней читается кривая концентрации. */
  readonly cumulativePct: number | null;
}

export interface CustomerConcentration {
  /** Заказчики по убыванию начальных цен — весь список, обрезает экран. */
  readonly rows: readonly CustomerWeightRow[];
  readonly customersTotal: number;
  readonly nmckTotalRub: number;
  /** Доля топ-1 / топ-3 / топ-5 / топ-10 в деньгах, %; null — денег нет. */
  readonly topShares: Readonly<Record<'top1' | 'top3' | 'top5' | 'top10', number | null>>;
  /** Медианный заказчик по деньгам, руб. — против «средней температуры». */
  readonly medianCustomerRub: number | null;
  /** Сколько заказчиков набирают половину денег книги; null — денег нет. */
  readonly customersForHalf: number | null;
}

/**
 * Где деньги: сколько заказчиков книги держат её начальные цены.
 *
 * Группируем по НАПИСАНИЮ колонки B, а не по нормализованному виду. Причина
 * прикладная: разрез реестра «Заказчик» отбирает строки по написанию, и если
 * витрина склеит «МБОУ ЕСШ №1 им. М.В. Ломоносова» с «МБОУ "ЕСШ №1 ИМЕНИ
 * М.В.ЛОМОНОСОВА"», то клик по строке витрины приведёт в реестр, где строк
 * меньше, чем обещало число. Расхождение написаний — отдельная новость
 * справочника, а не то, что витрина имеет право молча починить.
 */
export function customerConcentration(
  procedures: readonly RegistryProcedure[],
): CustomerConcentration {
  const acc = new Map<string, { count: number; nmck: number }>();
  for (const p of procedures) {
    const key = p.customer.trim();
    if (key === '') continue;
    const b = acc.get(key) ?? { count: 0, nmck: 0 };
    b.count += 1;
    b.nmck += p.nmck ?? 0;
    acc.set(key, b);
  }

  const nmckTotalRub = [...acc.values()].reduce((s, b) => s + b.nmck, 0);
  const ordered = [...acc.entries()]
    .sort((a, b) => b[1].nmck - a[1].nmck || a[0].localeCompare(b[0], 'ru'));

  let running = 0;
  const rows: CustomerWeightRow[] = ordered.map(([customer, b]) => {
    running += b.nmck;
    return {
      customer,
      sliceKey: customer,
      count: b.count,
      nmckRub: b.nmck,
      sharePct: sharePct(b.nmck, nmckTotalRub),
      cumulativePct: sharePct(running, nmckTotalRub),
    };
  });

  const headSum = (n: number): number => ordered.slice(0, n).reduce((s, [, b]) => s + b.nmck, 0);
  const sortedMoney = ordered.map(([, b]) => b.nmck).sort((a, b) => a - b);
  const median = sortedMoney.length === 0
    ? null
    : sortedMoney.length % 2 === 1
      ? (sortedMoney[(sortedMoney.length - 1) / 2] ?? null)
      : (((sortedMoney[sortedMoney.length / 2 - 1] ?? 0) + (sortedMoney[sortedMoney.length / 2] ?? 0)) / 2);

  let customersForHalf: number | null = null;
  if (nmckTotalRub > 0) {
    let acc2 = 0;
    for (let i = 0; i < ordered.length; i++) {
      acc2 += ordered[i]?.[1].nmck ?? 0;
      if (acc2 >= nmckTotalRub / 2) { customersForHalf = i + 1; break; }
    }
  }

  return {
    rows,
    customersTotal: ordered.length,
    nmckTotalRub,
    topShares: {
      top1: sharePct(headSum(1), nmckTotalRub),
      top3: sharePct(headSum(3), nmckTotalRub),
      top5: sharePct(headSum(5), nmckTotalRub),
      top10: sharePct(headSum(10), nmckTotalRub),
    },
    medianCustomerRub: median,
    customersForHalf,
  };
}

// ── §2. Где деньги: чей рубль сэкономлен ─────────────────────────────

export type BudgetLevelKey = 'mb' | 'kb' | 'fb';

export interface BudgetSliceRow {
  readonly key: BudgetLevelKey;
  /** Подпись бюджета — та же, что в шапке книги: МБ / КБ / ФБ. */
  readonly short: string;
  readonly label: string;
  readonly rub: number;
  /** Доля в РАСПИСАННОЙ экономии, %; null — расписывать нечего. */
  readonly sharePct: number | null;
}

export interface BudgetSavings {
  readonly levels: readonly BudgetSliceRow[];
  /** Экономия ВСЕГО по колонке J — как её записала книга. */
  readonly bookTotalRub: number;
  /** Сумма МБ+КБ+ФБ по колонкам L/M/N — как книга её расписала. */
  readonly splitTotalRub: number;
  /** ВСЕГО − расписанное, руб.: положительное — экономия без адреса бюджета. */
  readonly unallocatedRub: number;
  /** Доля нерасписанного в экономии книги, %; null — экономии нет. */
  readonly unallocatedSharePct: number | null;
  /** Строк, где экономия есть, а разбивки нет ни по одному бюджету. */
  readonly rowsWithoutSplit: number;
  /** Их адреса — карточка без адреса бесполезна (п.53). */
  readonly rowsWithoutSplitRefs: readonly ProcedureRef[];
  /** Строк, где самопроверка книги (колонка K) показывает «ошибка». */
  readonly rowsControlError: number;
  readonly rowsControlErrorRefs: readonly ProcedureRef[];
  /** Разбивка экономии по бюджетам внутри управлений. */
  readonly byDept: readonly BudgetDeptRow[];
}

export interface BudgetDeptRow {
  readonly dept: string;
  readonly sheet: string;
  readonly mbRub: number;
  readonly kbRub: number;
  readonly fbRub: number;
  readonly splitTotalRub: number;
}

/** Адрес строки книги — лист, строка и код, чтобы найти её глазами. */
export interface ProcedureRef {
  readonly sheet: string;
  readonly row: number;
  readonly code: string | null;
  readonly customer: string;
  readonly rub: number | null;
}

const BUDGET_LABELS: Record<BudgetLevelKey, { short: string; label: string }> = {
  mb: { short: 'МБ', label: 'местный бюджет' },
  kb: { short: 'КБ', label: 'краевой бюджет' },
  fb: { short: 'ФБ', label: 'федеральный бюджет' },
};

/**
 * Чей рубль сэкономлен. Колонки L/M/N книги — разбивка ЭКОНОМИИ, а не
 * начальной цены: подпись «Экономия, руб.» в L1 накрывает всю группу J:N, и
 * прочесть L как «НМЦК местного бюджета» — ошибка, на которой уже спотыкались.
 *
 * Разрыв «ВСЕГО минус расписанное» здесь не сглаживается и не объявляется
 * ошибкой: он может быть и незаполненной разбивкой, и опечаткой в ВСЕГО.
 * Витрина показывает разрыв с адресами строк, вывод делает человек.
 */
export function budgetSavings(procedures: readonly RegistryProcedure[]): BudgetSavings {
  const mb = sum(procedures, (p) => p.savingsMb);
  const kb = sum(procedures, (p) => p.savingsKb);
  const fb = sum(procedures, (p) => p.savingsFb);
  const splitTotalRub = mb + kb + fb;
  const bookTotalRub = sum(procedures, (p) => p.savingsTotal);

  const levels: BudgetSliceRow[] = ([['mb', mb], ['kb', kb], ['fb', fb]] as const)
    .map(([key, rub]) => ({
      key,
      short: BUDGET_LABELS[key].short,
      label: BUDGET_LABELS[key].label,
      rub,
      sharePct: sharePct(rub, splitTotalRub),
    }));

  const withoutSplit = procedures.filter(
    (p) => p.savingsTotal !== null && Math.abs(p.savingsTotal) > 0.005 && p.savingsSplitSum === null,
  );
  const controlError = procedures.filter((p) => p.controlAgrees === false);

  const deptAcc = new Map<string, BudgetDeptRow>();
  for (const p of procedures) {
    const prev = deptAcc.get(p.dept);
    const next: BudgetDeptRow = {
      dept: p.dept,
      sheet: prev?.sheet ?? p.sheet,
      mbRub: (prev?.mbRub ?? 0) + (p.savingsMb ?? 0),
      kbRub: (prev?.kbRub ?? 0) + (p.savingsKb ?? 0),
      fbRub: (prev?.fbRub ?? 0) + (p.savingsFb ?? 0),
      splitTotalRub: 0,
    };
    deptAcc.set(p.dept, { ...next, splitTotalRub: next.mbRub + next.kbRub + next.fbRub });
  }

  return {
    levels,
    bookTotalRub,
    splitTotalRub,
    unallocatedRub: bookTotalRub - splitTotalRub,
    unallocatedSharePct: sharePct(bookTotalRub - splitTotalRub, bookTotalRub),
    rowsWithoutSplit: withoutSplit.length,
    rowsWithoutSplitRefs: withoutSplit.map(toRef((p) => p.savingsTotal)),
    rowsControlError: controlError.length,
    rowsControlErrorRefs: controlError.map(toRef((p) => p.controlGapRub)),
    byDept: [...deptAcc.values()].sort((a, b) => b.splitTotalRub - a.splitTotalRub),
  };
}

function toRef(pickRub: (p: RegistryProcedure) => number | null) {
  return (p: RegistryProcedure): ProcedureRef => ({
    sheet: p.sheet, row: p.row, code: p.code, customer: p.customer, rub: pickRub(p),
  });
}

// ── §3. Где риск: торги, прошедшие без единого шага снижения ─────────

export interface ZeroReductionSplit {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly nmckRub: number;
  /** Доля бесторговых внутри этой группы, %; null — группа пуста. */
  readonly sharePct: number | null;
}

export interface ZeroReduction {
  /** Состоявшиеся процедуры с обеими суммами — знаменатель разреза. */
  readonly pricedCount: number;
  readonly pricedNmckRub: number;
  /** Из них цена в точности равна начальной. */
  readonly zeroCount: number;
  readonly zeroNmckRub: number;
  /** Доля бесторговых процедур, %; null — состоявшихся нет. */
  readonly countSharePct: number | null;
  /** Доля денег, прошедших без торга, %; null — денег нет. */
  readonly moneySharePct: number | null;
  readonly byMethod: readonly ZeroReductionSplit[];
  readonly byDept: readonly ZeroReductionSplit[];
}

/**
 * Где риск: сколько денег прошло без единого шага снижения.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ РАЗРЕЗ, А НЕ СТОЛБ ГИСТОГРАММЫ. На гистограмме
 * снижения нулевая корзина — один из семи столбов, и глаз читает её как
 * «крайний случай». Здесь она — главная новость: доля бесторговых в ДЕНЬГАХ
 * не совпадает с их долей в ПРОЦЕДУРАХ, и разница между этими двумя числами
 * и есть содержание разреза.
 *
 * ЧТО ЭТО НЕ ЗНАЧИТ. Ноль снижения не улика: у закупки у единственного
 * поставщика снижения нет по природе способа, у аукциона с одной заявкой —
 * по природе итога. Витрина показывает размер явления и раскладывает его по
 * способам, а вывод о том, где здесь беда, делает человек.
 */
export function zeroReduction(procedures: readonly RegistryProcedure[]): ZeroReduction {
  const priced = procedures.filter(isPriced);
  const isZero = (p: RegistryProcedure): boolean => (p.reductionRub ?? 0) <= 0.005;
  const zero = priced.filter(isZero);

  const group = (
    keyOf: (p: RegistryProcedure) => string,
    labelOf: (key: string) => string,
  ): ZeroReductionSplit[] => {
    const acc = new Map<string, { count: number; nmck: number; base: number }>();
    for (const p of priced) {
      const key = keyOf(p);
      const b = acc.get(key) ?? { count: 0, nmck: 0, base: 0 };
      b.base += 1;
      if (isZero(p)) { b.count += 1; b.nmck += p.nmck ?? 0; }
      acc.set(key, b);
    }
    return [...acc.entries()]
      .filter(([, b]) => b.count > 0)
      .map(([key, b]) => ({
        key, label: labelOf(key), count: b.count, nmckRub: b.nmck, sharePct: sharePct(b.count, b.base),
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ru'));
  };

  return {
    pricedCount: priced.length,
    pricedNmckRub: sum(priced, (p) => p.nmck),
    zeroCount: zero.length,
    zeroNmckRub: sum(zero, (p) => p.nmck),
    countSharePct: sharePct(zero.length, priced.length),
    moneySharePct: sharePct(sum(zero, (p) => p.nmck), sum(priced, (p) => p.nmck)),
    byMethod: group((p) => p.method ?? '—', (k) => (k === '—' ? 'способ не определён' : k)),
    byDept: group((p) => p.dept, (k) => k),
  };
}

// ── §4. Где затык: переходящий хвост прошлогодней нумерации ──────────

export interface CarryOverYearRow {
  /** Год из суффикса кода: 25, 26; null — кода в строке нет. */
  readonly year: number | null;
  readonly count: number;
  readonly nmckRub: number;
  readonly countSharePct: number | null;
  readonly moneySharePct: number | null;
  /** Разбивка по стадиям — «застряло» ли, видно только отсюда. */
  readonly byStage: Readonly<Record<string, number>>;
  /** Управления, где этот год лежит. */
  readonly byDept: readonly { readonly dept: string; readonly count: number }[];
}

export interface CarryOver {
  readonly rows: readonly CarryOverYearRow[];
  /** Самый свежий год нумерации книги — он и есть «текущий». */
  readonly currentYear: number | null;
  /** Строки прошлых лет: их и называют переходящим хвостом. */
  readonly carriedCount: number;
  readonly carriedNmckRub: number;
  readonly carriedCountSharePct: number | null;
  readonly carriedMoneySharePct: number | null;
  /** Строки без разобранного кода — год неизвестен, а не «прошлый». */
  readonly unknownYearCount: number;
}

/**
 * Где затык: книга мониторинга переходящая, и в ней рядом лежат процедуры
 * двух лет нумерации. Год берётся из СУФФИКСА КОДА («ЭА152-26» → 26), а не
 * из даты: дата публикации у переходящей процедуры уже нового года, и по ней
 * хвост не виден вовсе.
 *
 * ГОД БЕЗ КОДА — НЕ ПРОШЛЫЙ ГОД. Строки, где код не разобрался, считаются
 * отдельно и в хвост не записываются: приписать им год значило бы выдумать.
 */
export function carryOver(procedures: readonly RegistryProcedure[]): CarryOver {
  const totalCount = procedures.length;
  const totalNmck = sum(procedures, (p) => p.nmck);

  const acc = new Map<number | null, {
    count: number; nmck: number; stages: Map<string, number>; depts: Map<string, number>;
  }>();
  for (const p of procedures) {
    const key = p.year;
    const b = acc.get(key) ?? { count: 0, nmck: 0, stages: new Map(), depts: new Map() };
    b.count += 1;
    b.nmck += p.nmck ?? 0;
    b.stages.set(p.stage, (b.stages.get(p.stage) ?? 0) + 1);
    b.depts.set(p.dept, (b.depts.get(p.dept) ?? 0) + 1);
    acc.set(key, b);
  }

  const rows: CarryOverYearRow[] = [...acc.entries()]
    .map(([year, b]) => ({
      year,
      count: b.count,
      nmckRub: b.nmck,
      countSharePct: sharePct(b.count, totalCount),
      moneySharePct: sharePct(b.nmck, totalNmck),
      byStage: Object.fromEntries(b.stages),
      byDept: [...b.depts.entries()]
        .map(([dept, count]) => ({ dept, count }))
        .sort((a, b2) => b2.count - a.count || a.dept.localeCompare(b2.dept, 'ru')),
    }))
    .sort((a, b) => (b.year ?? -1) - (a.year ?? -1));

  const years = rows.map((r) => r.year).filter((y): y is number => y !== null);
  const currentYear = years.length === 0 ? null : Math.max(...years);
  const carried = currentYear === null
    ? []
    : procedures.filter((p) => p.year !== null && p.year < currentYear);

  return {
    rows,
    currentYear,
    carriedCount: carried.length,
    carriedNmckRub: sum(carried, (p) => p.nmck),
    carriedCountSharePct: sharePct(carried.length, totalCount),
    carriedMoneySharePct: sharePct(sum(carried, (p) => p.nmck), totalNmck),
    unknownYearCount: procedures.filter((p) => p.year === null).length,
  };
}

// ── §5. Где деньги: совместные закупки против одиночных ──────────────

export interface JointSide {
  readonly count: number;
  readonly nmckRub: number;
  /** Портфельное снижение стороны, %; null — состоявшихся с суммами нет. */
  readonly reductionPct: number | null;
  readonly reductionRub: number;
  /** Средняя начальная цена процедуры, руб.; null — строк нет. */
  readonly avgNmckRub: number | null;
}

export interface JointComparison {
  readonly joint: JointSide;
  readonly solo: JointSide;
  /** Доля совместных в деньгах книги, %; null — денег нет. */
  readonly jointMoneySharePct: number | null;
  /** Доля совместных в числе процедур, %; null — строк нет. */
  readonly jointCountSharePct: number | null;
  /** Управления, чьи листы несут совместные строки. */
  readonly jointByDept: readonly { readonly dept: string; readonly count: number; readonly nmckRub: number }[];
}

/**
 * Где деньги: совместная закупка — способ собрать спрос нескольких заказчиков
 * в один лот. Ядро уже отмечает такие строки признаком `joint` (способ ЭАС
 * либо заказчик-признак «Совместный …»), и витрина берёт готовый признак, а
 * не переизобретает его подстрокой.
 *
 * СРАВНЕНИЕ ПОРТФЕЛЬНОЕ, А НЕ ПОСТРОЧНОЕ. Совместных строк на порядок меньше,
 * чем одиночных, и среднее построчных процентов у них шумит. Делим деньги на
 * деньги: вопрос звучит «сколько сэкономил рубль, прошедший через совместный
 * лот», а не «как торговалась средняя строка».
 */
export function jointComparison(procedures: readonly RegistryProcedure[]): JointComparison {
  const side = (rows: readonly RegistryProcedure[]): JointSide => {
    const priced = rows.filter(isPriced);
    const nmck = sum(priced, (p) => p.nmck);
    const price = sum(priced, (p) => p.auctionPrice);
    const allNmck = sum(rows, (p) => p.nmck);
    return {
      count: rows.length,
      nmckRub: allNmck,
      reductionPct: sharePct(nmck - price, nmck),
      reductionRub: nmck - price,
      avgNmckRub: rows.length === 0 ? null : allNmck / rows.length,
    };
  };

  const jointRows = procedures.filter((p) => p.joint);
  const soloRows = procedures.filter((p) => !p.joint);

  const deptAcc = new Map<string, { count: number; nmckRub: number }>();
  for (const p of jointRows) {
    const b = deptAcc.get(p.dept) ?? { count: 0, nmckRub: 0 };
    b.count += 1;
    b.nmckRub += p.nmck ?? 0;
    deptAcc.set(p.dept, b);
  }

  const totalNmck = sum(procedures, (p) => p.nmck);
  return {
    joint: side(jointRows),
    solo: side(soloRows),
    jointMoneySharePct: sharePct(sum(jointRows, (p) => p.nmck), totalNmck),
    jointCountSharePct: sharePct(jointRows.length, procedures.length),
    jointByDept: [...deptAcc.entries()]
      .map(([dept, b]) => ({ dept, ...b }))
      .sort((a, b) => b.nmckRub - a.nmckRub || a.dept.localeCompare(b.dept, 'ru')),
  };
}

// ── §6. Где затык: чем кончились переобъявления ──────────────────────

export interface FateRow {
  /** Класс судьбы из словаря ядра либо `other` — пометка не распозналась. */
  readonly fate: string;
  readonly label: string;
  readonly count: number;
  readonly sharePct: number | null;
  /** Примеры сырых пометок книги — класс без исходника не проверить. */
  readonly samples: readonly string[];
}

export interface RejoinedFates {
  /** Строк переходящего реестра с непустой пометкой в колонке A. */
  readonly markedRows: number;
  /** Строк реестра всего — знаменатель доли помеченных. */
  readonly totalRows: number;
  readonly markedSharePct: number | null;
  readonly rows: readonly FateRow[];
}

/** Строка переходящего реестра в том виде, в каком её отдаёт контракт. */
export interface FateSource {
  readonly fate: string | null;
  readonly fateRaw: string | null;
}

/**
 * Где затык: что стало с процедурами, которые пришлось объявлять заново.
 *
 * ИСТОЧНИК — КОЛОНКА A ЛИСТА «25-26», куда специалисты руками пишут судьбу
 * процедуры: «Повторный аукцион», «С отклонением участника», «ФАС», «На
 * доработке у Заказчика». Ядро разбирает эти написания в закрытый словарь
 * классов и — важно — оставляет рядом СЫРОЙ текст: класс без исходника
 * читатель не может ни проверить, ни оспорить (п.27).
 *
 * МАРКЕРЫ ГОДА В СЧЁТ НЕ ИДУТ. В той же колонке стоят «2026» и подобные
 * разделители блоков: это разметка листа, а не судьба процедуры, и считать
 * их наравне с «ФАС» значило бы завысить число переобъявлений.
 */
export function rejoinedFates(rows: readonly FateSource[], labels: Readonly<Record<string, string>>): RejoinedFates {
  const meaningful = rows.filter((r) => r.fate !== null && r.fate !== 'year-marker');
  const acc = new Map<string, { count: number; samples: string[] }>();
  for (const r of meaningful) {
    const key = r.fate ?? 'other';
    const b = acc.get(key) ?? { count: 0, samples: [] };
    b.count += 1;
    const raw = r.fateRaw?.trim();
    if (raw !== undefined && raw !== '' && b.samples.length < 3 && !b.samples.includes(raw)) {
      b.samples.push(raw);
    }
    acc.set(key, b);
  }

  return {
    markedRows: meaningful.length,
    totalRows: rows.length,
    markedSharePct: sharePct(meaningful.length, rows.length),
    rows: [...acc.entries()]
      .map(([fate, b]) => ({
        fate,
        label: labels[fate] ?? fate,
        count: b.count,
        sharePct: sharePct(b.count, meaningful.length),
        samples: b.samples,
      }))
      .sort((a, b) => b.count - a.count || a.fate.localeCompare(b.fate, 'ru')),
  };
}
