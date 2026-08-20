/**
 * Ряды графиков вкладки «Мониторинг · Аналитика» — ЧИСТЫМИ функциями.
 *
 * ПОЧЕМУ РЯДЫ ЖИВУТ ОТДЕЛЬНО ОТ КОМПОНЕНТОВ. Ошибка в графике — это почти
 * всегда ошибка в ряде, а не в разметке: не тот знаменатель у доли, ноль
 * вместо пропуска, месяц без года. Разметку проверить тестом дорого, ряд —
 * дёшево, поэтому вся счётная часть вынесена сюда и накрыта юнит-тестами, а
 * компонент остаётся тонким.
 *
 * ГЛАВНОЕ ОБЕЩАНИЕ ЭТОГО ФАЙЛА: ТРИ КОЭФФИЦИЕНТА СНИЖЕНИЯ НЕ ПОДМЕНЯЮТ ДРУГ
 * ДРУГА. Портфельный (деньги ÷ деньги), средний построчный (проценты ÷ число
 * процедур) и средний там, где снижение было, отвечают на три разных вопроса
 * и расходятся втрое. Ни один не имеет права выступать от имени остальных, и
 * `reductionMethods` возвращает все три вместе с их знаменателями и вопросом,
 * на который каждый отвечает. Отдельный тест волны стережёт это.
 *
 * ПУСТОТА ОСТАЁТСЯ ПУСТОТОЙ. Функции не подставляют ноль вместо null: график
 * рисует разрыв, а подпись говорит «считать не из чего». Ноль показывается
 * только там, где он содержателен (снижение ровно 0 % — это состоявшиеся
 * торги без единого шага).
 */
import type {
  AnomalyGroup,
  DeptComparisonRow,
  DiscountBucket,
  DurationStats,
  MatchViewPayload,
  MatchedPair,
  NmckBucket,
  ReductionCoefficients,
  SeasonPoint,
  Seasonality,
  StageFunnelData,
  SupplierProfile,
  SupplierRow,
} from './analytics-contract';
import type { RegistryProcedure } from './contract';
import { pluralCount } from './format';

// ── Воронка стадий ───────────────────────────────────────────────────

export interface FunnelBar {
  key: string;
  label: string;
  count: number;
  /** Ширина полосы, % от первой ступени с наибольшим счётом. */
  widthPct: number;
  /** Конверсия из предыдущей ступени, %; null — ступень первая. */
  conversionPct: number | null;
  /** Оговорка ядра: ступень заполнена полнее предыдущей. */
  note: string | null;
}

/**
 * Полосы воронки. Ширина считается от НАИБОЛЬШЕГО счёта, а не от первой
 * ступени: колонки книги заполняются не по порядку (дата торгов есть, даты
 * публикации нет), и полоса шире ста процентов выглядела бы поломкой вместо
 * находки. Сама находка не прячется — она едет оговоркой ступени.
 */
export function funnelBars(funnel: StageFunnelData): FunnelBar[] {
  const max = funnel.steps.reduce((m, s) => Math.max(m, s.count), 0);
  return funnel.steps.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.count,
    widthPct: max === 0 ? 0 : (s.count / max) * 100,
    conversionPct: s.conversionPct,
    note: s.note,
  }));
}

/** Деньги ступени: НМЦК тех строк, что до неё дошли, и цена там, где она есть. */
export interface FunnelMoneyStep {
  key: string;
  count: number;
  nmckRub: number;
  /** Строк, у которых НМЦК не читается числом, — знаменатель честности суммы. */
  nmckMissing: number;
  /** Сумма цен победителей; null — на этой ступени цены ещё нет по природе. */
  priceRub: number | null;
}

/**
 * Деньги по ступеням считаются НА ЭКРАНЕ из строк реестра, потому что ядро
 * отдаёт воронку счётами штук. Правило попадания на ступень повторяет ядро
 * дословно — заполненность колонки книги, а не стадия строки, — и накрыто
 * отдельным тестом: если правило разъедется с ядром, деньги ступени начнут
 * описывать другие строки, чем её счёт, и это надо ловить здесь.
 */
export function funnelMoney(procedures: readonly RegistryProcedure[]): FunnelMoneyStep[] {
  const defs: Array<{ key: string; hit: (p: RegistryProcedure) => boolean; priced: boolean }> = [
    { key: 'application', hit: (p) => p.applicationDate !== null, priced: false },
    { key: 'published', hit: (p) => p.publicationDate !== null, priced: false },
    { key: 'auction', hit: (p) => p.auctionDate !== null, priced: false },
    { key: 'priced', hit: (p) => p.auctionPrice !== null && p.auctionPrice > 0, priced: true },
    {
      key: 'split',
      hit: (p) => p.savingsSplitSum !== null && p.controlAgrees === true,
      priced: true,
    },
  ];

  return defs.map((def) => {
    let count = 0;
    let nmckRub = 0;
    let nmckMissing = 0;
    let priceRub = 0;
    for (const p of procedures) {
      if (!def.hit(p)) continue;
      count += 1;
      if (p.nmck === null) nmckMissing += 1;
      else nmckRub += p.nmck;
      if (p.auctionPrice !== null) priceRub += p.auctionPrice;
    }
    return {
      key: def.key,
      count,
      nmckRub,
      nmckMissing,
      priceRub: def.priced ? priceRub : null,
    };
  });
}

// ── Гистограмма снижения ─────────────────────────────────────────────

export interface HistogramBar {
  key: string;
  label: string;
  count: number;
  /** Доля корзины среди состоявшихся процедур, %; null — знаменатель пуст. */
  sharePct: number | null;
  nmckRub: number;
  priceRub: number;
  /** Деньги, которые дала эта корзина, руб. */
  savingsRub: number;
}

export function histogramBars(buckets: readonly DiscountBucket[]): HistogramBar[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    count: b.count,
    sharePct: total === 0 ? null : (b.count / total) * 100,
    nmckRub: b.nmckRub,
    priceRub: b.priceRub,
    savingsRub: b.nmckRub - b.priceRub,
  }));
}

// ── Три коэффициента снижения ────────────────────────────────────────

export interface ReductionMethod {
  id: 'portfolio' | 'row' | 'reduced';
  /** Короткое имя коэффициента — заголовок плитки. */
  title: string;
  /** На какой вопрос он отвечает — без этого число нечитаемо. */
  question: string;
  valuePct: number | null;
  /** Медиана того же ряда; у портфельного её нет по природе — он один. */
  medianPct: number | null;
  /** Знаменатель словами: «по 351 состоявшейся процедуре». */
  basis: string;
  /** Как считается — методика одной фразой (обязательство волны). */
  method: string;
}

/**
 * Три коэффициента разом. Возвращаются ВСЕГДА все три, даже когда часть
 * пуста: исчезнувшая плитка читалась бы как «такого коэффициента нет», а он
 * есть — просто считать его не из чего.
 */
export function reductionMethods(r: ReductionCoefficients): ReductionMethod[] {
  return [
    {
      id: 'portfolio',
      title: 'Портфельный',
      question: 'На сколько подешевел весь портфель денег?',
      valuePct: r.portfolioPct,
      medianPct: null,
      basis: `по ${pluralCount(r.portfolio.count, 'состоявшейся процедуре', 'состоявшимся процедурам', 'состоявшимся процедурам')}`,
      method: 'Сумма начальных цен минус сумма цен победителей, делённая на сумму начальных цен. Делит деньги на деньги, поэтому крупная закупка весит в нём больше мелкой.',
    },
    {
      id: 'row',
      title: 'Средний построчный',
      question: 'Как ведёт себя типичная процедура?',
      valuePct: r.rowMeanPct,
      medianPct: r.rowMedianPct,
      basis: `по ${pluralCount(r.rowCount, 'состоявшейся процедуре', 'состоявшимся процедурам', 'состоявшимся процедурам')}`,
      method: 'Среднее процентов снижения по каждой строке — включая те, где снижения не было вовсе. Все процедуры весят одинаково: закупка на сто тысяч влияет столько же, сколько закупка на сто миллионов.',
    },
    {
      id: 'reduced',
      title: 'Средний там, где снижение было',
      question: 'Насколько падает цена, когда торги реально идут?',
      valuePct: r.reducedMeanPct,
      medianPct: r.reducedMedianPct,
      basis: `по ${pluralCount(r.reducedCount, 'процедуре со снижением', 'процедурам со снижением', 'процедурам со снижением')}`,
      method: 'Среднее только по тем строкам, где цена победителя ниже начальной. Процедуры с единственным участником в знаменатель не входят — иначе они тянут число вниз и прячут поведение живых торгов.',
    },
  ];
}

/**
 * Разрез снижения по способу определения поставщика. Разные способы — разные
 * явления: у закупки с единственным поставщиком снижения нет по природе, и
 * складывать её в один средний процент с электронным аукционом бессмысленно.
 * Ядро такого разреза не отдаёт, поэтому он считается из строк реестра.
 */
export interface ReductionByMethodRow {
  method: string;
  /** Состоявшихся процедур этого способа. */
  count: number;
  nmckRub: number;
  priceRub: number;
  /** Портфельное снижение внутри способа, %. */
  portfolioPct: number | null;
  /** Процедур, где цена в точности равна начальной. */
  equalPriceCount: number;
}

export function reductionByMethod(
  procedures: readonly RegistryProcedure[],
): ReductionByMethodRow[] {
  const acc = new Map<string, { count: number; nmck: number; price: number; equal: number }>();
  for (const p of procedures) {
    if (p.stage !== 'awarded' || p.auctionPrice === null || p.nmck === null || p.nmck <= 0) continue;
    const key = p.method ?? 'способ не определён';
    const b = acc.get(key) ?? { count: 0, nmck: 0, price: 0, equal: 0 };
    b.count += 1;
    b.nmck += p.nmck;
    b.price += p.auctionPrice;
    if (Math.abs(p.nmck - p.auctionPrice) < 0.005) b.equal += 1;
    acc.set(key, b);
  }
  return [...acc.entries()]
    .map(([method, b]) => ({
      method,
      count: b.count,
      nmckRub: b.nmck,
      priceRub: b.price,
      portfolioPct: b.nmck === 0 ? null : ((b.nmck - b.price) / b.nmck) * 100,
      equalPriceCount: b.equal,
    }))
    .sort((a, b) => b.count - a.count || a.method.localeCompare(b.method, 'ru'));
}

/** Корзины размера закупки: мелкие и крупные торгуются по-разному. */
export interface NmckBucketBar {
  key: string;
  label: string;
  count: number;
  nmckRub: number;
  reductionPct: number | null;
  /** Доля корзины в числе процедур, %. */
  sharePct: number | null;
}

export function nmckBucketBars(buckets: readonly NmckBucket[]): NmckBucketBar[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    count: b.count,
    nmckRub: b.nmckRub,
    reductionPct: b.reductionPct,
    sharePct: total === 0 ? null : (b.count / total) * 100,
  }));
}

// ── Сезонность ───────────────────────────────────────────────────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** «2026-03» → «март 2026». Незнакомый ключ показывается как есть, не прячется. */
export function seasonLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m !== null) {
    const idx = Number(m[2]) - 1;
    const name = MONTH_NAMES[idx];
    return name === undefined ? period : `${name} ${m[1]}`;
  }
  const q = /^(\d{4})-(I{1,3}V?|IV)$/.exec(period);
  if (q !== null) return `${q[2]} квартал ${q[1]}`;
  return period;
}

/** Короткая подпись оси: «мар 26». */
export function seasonShortLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m === null) return period;
  const short = MONTH_SHORT[Number(m[2]) - 1];
  return short === undefined ? period : `${short} ${m[1].slice(2)}`;
}

export interface SeasonBar {
  period: string;
  label: string;
  shortLabel: string;
  count: number;
  nmckRub: number;
  priceRub: number;
  /** Снижение месяца, %; null — состоявшихся процедур в месяце нет. */
  reductionPct: number | null;
}

/**
 * Ряд сезонности. Месяцы НЕ достраиваются до полного календаря: пустой месяц
 * в книге и месяц, которого ещё не было, — разные вещи, и нарисованный ноль
 * там, где данных просто нет, был бы неправдой.
 */
export function seasonBars(points: readonly SeasonPoint[]): SeasonBar[] {
  return [...points]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((p) => ({
      period: p.period,
      label: seasonLabel(p.period),
      shortLabel: seasonShortLabel(p.period),
      count: p.count,
      nmckRub: p.nmckRub,
      priceRub: p.priceRub,
      reductionPct: p.nmckRub === 0 ? null : ((p.nmckRub - p.priceRub) / p.nmckRub) * 100,
    }));
}

/** Основание сезонности словами — подмена основания меняет картину. */
export function seasonBasisLabel(s: Seasonality): string {
  return s.basis === 'auction' ? 'по дате проведения торгов' : 'по дате публикации';
}

// ── Сроки этапов ─────────────────────────────────────────────────────

export interface DurationBox {
  key: string;
  label: string;
  count: number;
  medianDays: number | null;
  meanDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  q1Days: number | null;
  q3Days: number | null;
  negativeCount: number;
  /** Выбивающиеся строки с адресами — их показывают под ящиком (п.53). */
  outliers: DurationStats['outliers'];
  /** Геометрия «ящика» в процентах общей шкалы; null — рисовать нечего. */
  box: { leftPct: number; widthPct: number; medianPct: number } | null;
}

/**
 * Ящики с усами по общей шкале дней. Шкала одна на все этапы намеренно:
 * этапы сравниваются между собой, а не каждый со своим масштабом. Ноль на
 * шкале не прячется — отрицательная длительность (торги раньше публикации)
 * существует в книге двенадцать раз, и ящик обязан заезжать левее нуля.
 */
export function durationBoxes(stats: readonly DurationStats[]): {
  boxes: DurationBox[];
  scale: { minDays: number; maxDays: number } | null;
} {
  const lows: number[] = [];
  const highs: number[] = [];
  for (const s of stats) {
    if (s.minDays !== null) lows.push(s.minDays);
    if (s.maxDays !== null) highs.push(s.maxDays);
  }
  if (lows.length === 0 || highs.length === 0) {
    return {
      boxes: stats.map((s) => ({ ...s, box: null })),
      scale: null,
    };
  }
  const minDays = Math.min(0, ...lows);
  const maxDays = Math.max(...highs);
  const span = maxDays - minDays;
  const at = (v: number) => (span === 0 ? 0 : ((v - minDays) / span) * 100);

  return {
    scale: { minDays, maxDays },
    boxes: stats.map((s) => ({
      ...s,
      box: s.q1Days === null || s.q3Days === null || s.medianDays === null
        ? null
        : {
          leftPct: at(s.q1Days),
          widthPct: Math.max(at(s.q3Days) - at(s.q1Days), 0.5),
          medianPct: at(s.medianDays),
        },
    })),
  };
}

// ── Сравнение управлений ─────────────────────────────────────────────

export type DeptMetricKey =
  | 'reductionPct'
  | 'withReductionSharePct'
  | 'noResultSharePct'
  | 'medianTotalDays'
  | 'controlErrorSharePct';

export interface DeptMetricDef {
  key: DeptMetricKey;
  label: string;
  /** Единица — «%» либо «дней»: без неё столбцы двух разных величин сольются. */
  unit: '%' | 'дней';
  /** Что означает высокое значение: у половины метрик это не «лучше». */
  meaning: string;
}

export const DEPT_METRICS: readonly DeptMetricDef[] = [
  {
    key: 'reductionPct',
    label: 'Снижение на торгах',
    unit: '%',
    meaning: 'Портфельное снижение управления. Высокое значение говорит о живых торгах, но у управления, закупающего квартиры, снижения нет по природе предмета.',
  },
  {
    key: 'withReductionSharePct',
    label: 'Доля процедур со снижением',
    unit: '%',
    meaning: 'Сколько состоявшихся процедур управления реально подешевели. Мера конкуренции, не зависящая от размера закупок.',
  },
  {
    key: 'noResultSharePct',
    label: 'Доля процедур без результата',
    unit: '%',
    meaning: 'Торги прошли, цена ровно ноль. Высокая доля означает, что заявок не подают: повод посмотреть на условия, а не на управление.',
  },
  {
    key: 'medianTotalDays',
    label: 'Медианный путь «заявка → торги»',
    unit: 'дней',
    meaning: 'Половина процедур управления проходит путь быстрее этого срока. Медиана, а не среднее: одна процедура с ошибочной датой сдвинула бы среднее на месяц.',
  },
  {
    key: 'controlErrorSharePct',
    label: 'Доля строк с расхождением контроля',
    unit: '%',
    meaning: 'Собственный контроль книги («ВСЕГО = МБ+КБ+ФБ») не сходится. Это про заполнение книги, а не про работу управления.',
  },
];

export interface DeptBar {
  dept: string;
  sheet: string;
  count: number;
  value: number | null;
  nmckRub: number;
}

/**
 * Столбцы сравнения по НОРМИРОВАННОЙ величине. Управления с разным числом
 * процедур иначе сравнивать нельзя: у одного их сто восемь, у другого
 * четыре, и абсолютные суммы всегда назовут «лучшим» самое большое.
 * Управления без значения остаются в ряду с null — они не выпадают молча.
 */
export function deptBars(
  rows: readonly DeptComparisonRow[],
  metric: DeptMetricKey,
): DeptBar[] {
  return rows
    .map((r) => ({
      dept: r.dept,
      sheet: r.sheet,
      count: r.count,
      value: r[metric],
      nmckRub: r.nmckRub,
    }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return b.count - a.count;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });
}

// ── Поставщики ───────────────────────────────────────────────────────

export type SupplierSortKey = 'money' | 'wins';

export interface SupplierBar {
  key: string;
  name: string;
  inn: string | null;
  wins: number;
  moneyRub: number;
  /** Доля в выбранной величине, %; null — итог нулевой. */
  sharePct: number | null;
  depts: string[];
  customers: string[];
}

export function supplierTop(
  profile: SupplierProfile,
  by: SupplierSortKey,
  limit = 10,
): SupplierBar[] {
  const totals = by === 'money' ? profile.totalMoneyRub : profile.totalWins;
  const sorted: SupplierRow[] = [...profile.suppliers].sort((a, b) => (
    by === 'money'
      ? b.moneyRub - a.moneyRub || b.wins - a.wins
      : b.wins - a.wins || b.moneyRub - a.moneyRub
  ));
  return sorted.slice(0, limit).map((s) => ({
    key: s.key,
    name: s.name,
    inn: s.inn,
    wins: s.wins,
    moneyRub: s.moneyRub,
    sharePct: totals === 0 ? null : ((by === 'money' ? s.moneyRub : s.wins) / totals) * 100,
    depts: s.depts,
    customers: s.customers,
  }));
}

export interface ConcentrationRow {
  label: string;
  winsPct: number | null;
  moneyPct: number | null;
  /** Что означает разрыв между долей побед и долей денег. */
  note: string;
}

/**
 * Концентрация двумя величинами сразу. Одна доля побед ничего не говорит:
 * пятёрка крупнейших может выигрывать редко, но забирать половину денег —
 * именно разрыв между двумя долями и есть содержание блока.
 */
export function concentrationRows(profile: SupplierProfile): ConcentrationRow[] {
  const c = profile.concentration;
  return [
    {
      label: 'Топ-5 поставщиков',
      winsPct: c.top5WinsPct,
      moneyPct: c.top5MoneyPct,
      note: 'Доля денег заметно выше доли побед: пятёрка выигрывает нечасто, но берёт крупные закупки.',
    },
    {
      label: 'Топ-10 поставщиков',
      winsPct: c.top10WinsPct,
      moneyPct: c.top10MoneyPct,
      note: 'Тот же разрыв на десятке показывает, насколько деньги собраны в немногих руках.',
    },
  ];
}

// ── Сверка с книгами управлений ──────────────────────────────────────

export interface MatchClassRow {
  kind: string;
  title: string;
  count: number;
  /** Отчего класс возникает — механизм, не упрёк (п.104). */
  mechanism: string;
  action: string;
  /** Примеры с адресами: «код · где найден». */
  examples: Array<{ code: string; addresses: string[] }>;
}

/**
 * Шесть классов исхода сверки. Показываются ВСЕ, включая нулевые: класс с
 * нулём — это утверждение «таких расхождений нет», и оно ценно ровно так же,
 * как ненулевой счёт. Скрытый нулевой класс читался бы как «не проверяли».
 */
export function matchClasses(m: MatchViewPayload, exampleLimit = 8): MatchClassRow[] {
  const across = m.ambiguous.filter((a) => !a.sameBook);
  const same = m.ambiguous.filter((a) => a.sameBook);
  return [
    {
      kind: 'matched',
      title: 'Пара найдена',
      count: m.summary.matched,
      mechanism: 'Код процедуры из мониторинга нашёлся ровно в одной строке одной книги управления.',
      action: 'Дальше сравниваются суммы: план книги против начальной цены, факт книги против цены победителя.',
      examples: m.matched.slice(0, exampleLimit).map((p) => ({
        code: p.code,
        addresses: [`книга ${p.bookRowKey}`, `мониторинг ${p.procKey}`],
      })),
    },
    {
      kind: 'book-only',
      title: 'Код есть в книге управления, в мониторинге нет',
      count: m.summary.bookOnly,
      mechanism: 'Управление записало номер процедуры в свою книгу, а на лист ежедневного мониторинга строка не попала — либо попала с иначе набранным кодом.',
      action: 'Проверить, ведётся ли эта процедура в мониторинге вообще: пропущенная строка не попадёт ни в один свод.',
      examples: m.bookOnly.slice(0, exampleLimit).map((b) => ({ code: b.code, addresses: b.addresses })),
    },
    {
      kind: 'monitoring-only',
      title: 'Процедура в мониторинге без строки книги',
      count: m.summary.monitoringOnly,
      mechanism: 'Уполномоченный орган ведёт процедуру, а в книге управления её номер не проставлен: колонка с номером процедуры заполняется вручную и заполняется не всегда.',
      action: 'Попросить управление проставить номер процедуры — без него закупку невозможно связать с планом и фактом.',
      examples: m.monitoringOnly.slice(0, exampleLimit).map((x) => ({ code: x.code, addresses: x.addresses })),
    },
    {
      kind: 'ambiguous-across',
      title: 'Один код в нескольких книгах',
      count: m.summary.ambiguousAcrossBooks,
      mechanism: 'Штатная форма совместной закупки: каждое управление ведёт свою долю одной и той же процедуры.',
      action: 'Читать как норму. Сравнивать суммы построчно здесь нельзя — доли складываются в целое.',
      examples: across.slice(0, exampleLimit).map((a) => ({ code: a.code, addresses: a.bookAddresses })),
    },
    {
      kind: 'ambiguous-same',
      title: 'Один код дважды в одной книге',
      count: m.summary.ambiguousSameBook,
      mechanism: 'Повтор внутри одной книги: чаще всего строка скопирована, реже — номер процедуры набран не тому объекту закупки.',
      action: 'Сверить строки между собой: одна из них лишняя либо несёт чужой номер.',
      examples: same.slice(0, exampleLimit).map((a) => ({ code: a.code, addresses: a.bookAddresses })),
    },
    {
      kind: 'list-cell',
      title: 'В ячейке книги список кодов',
      count: m.summary.listCells,
      mechanism: 'В одну ячейку записано несколько номеров процедур сразу — так ведут закупки, разбитые на лоты.',
      action: 'Парная сверка сумм по такой строке невозможна: план строки один, процедур несколько.',
      examples: m.listCells.slice(0, exampleLimit).map((l) => ({
        code: l.codes.join(', '),
        addresses: [l.address],
      })),
    },
  ];
}

/** Расхождение сумм по сошедшейся паре — с адресами ОБЕИХ сторон. */
export interface MatchDisagreement {
  code: string;
  /** 'nmck' — план книги против начальной цены; 'fact' — факт против цены победителя. */
  field: 'nmck' | 'fact';
  fieldLabel: string;
  bookAddress: string;
  monitoringAddress: string;
  bookRub: number | null;
  monitoringRub: number | null;
  deltaRub: number | null;
  relDiff: number | null;
}

/**
 * Расхождения сумм, по убыванию размера разрыва. Правая сторона НЕ
 * выбирается: продукт называет обе суммы, оба адреса и разницу, а какая
 * запись верна — решение человека, у которого есть договор.
 */
export function matchDisagreements(
  matched: readonly MatchedPair[],
  limit = 40,
): MatchDisagreement[] {
  const out: MatchDisagreement[] = [];
  for (const p of matched) {
    const sides: Array<{ field: 'nmck' | 'fact'; label: string; cmp: MatchedPair['nmck'] }> = [
      { field: 'nmck', label: 'план книги ↔ начальная цена', cmp: p.nmck },
      { field: 'fact', label: 'факт книги ↔ цена победителя', cmp: p.fact },
    ];
    for (const s of sides) {
      if (s.cmp.agrees !== false) continue;
      out.push({
        code: p.code,
        field: s.field,
        fieldLabel: s.label,
        bookAddress: p.bookRowKey,
        monitoringAddress: p.procKey,
        bookRub: s.cmp.bookRub,
        monitoringRub: s.cmp.monitoringRub,
        deltaRub: s.cmp.deltaRub,
        relDiff: s.cmp.relDiff,
      });
    }
  }
  return out
    .sort((a, b) => Math.abs(b.deltaRub ?? 0) - Math.abs(a.deltaRub ?? 0))
    .slice(0, limit);
}

// ── Аномалии ─────────────────────────────────────────────────────────

/** Адрес строки книги как его ищут глазами: «8. УО · строка 100». */
export function refAddress(ref: { sheet: string; row: number; code: string | null }): string {
  const tail = ref.code === null ? '' : ` · ${ref.code}`;
  return `${ref.sheet} · строка ${ref.row}${tail}`;
}

/** Аномалии по убыванию числа случаев — сверху то, что встречается чаще. */
export function anomalyOrder(groups: readonly AnomalyGroup[]): AnomalyGroup[] {
  return [...groups].sort((a, b) => b.count - a.count);
}
