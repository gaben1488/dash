/**
 * Мапперы Report → view-модели страницы «Отчёт» (дуга-3, волна 2B).
 *
 * Чистый слой без React: форматирование чисел по правилам продукта
 * (процент с одним знаком и запятой, «нет плана» вместо нуля при D = 0 —
 * канон quarterExecution) и сборка секций ГРБС для контрактных элементов.
 * Подписи метрик страница берёт через productLabel по metricKey из этих
 * view-моделей — свободного текста подписей здесь нет.
 */
import type { BudgetMoney, GrbsReportBlock, LifecycleBreakdown, PendingPosition, ReasonBreakdown, Report, ReportSignal } from '@aemr/core';
import { DEPT_COLUMNS, isoOfDayNumber, quarterLabel } from '@aemr/shared';
import { formatDateCell } from '../sheet-date';
import { officialAnalogKey, type KpiScope } from './kpi-delta';

/** Происхождение view-модели — структурно совместим с ElementSource контракта. */
export type ViewSource = 'calc' | 'svod' | 'mixed';

// ── Форматтеры (канон продукта) ─────────────────────────────

/** Целое со стандартной ru-RU группировкой разрядов. */
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/**
 * Процент: один знак после запятой, запятая-разделитель, «нет плана» при null
 * (канон quarterExecution: D = 0 → pct = null, не 0 и не 100).
 */
export function fmtPct(pct: number | null): string {
  if (pct === null) return 'нет плана';
  return `${(Math.round(pct * 10) / 10).toFixed(1).replace('.', ',')}%`;
}

/** Сумма в тыс. руб. — то же целочисленное ru-RU (алиас, не вторая копия). */
export const fmtThousands = fmtCount;

/**
 * Дата среза «дд.мм.гггг» из period.asOfDay (номер суток dayNumberOf).
 * UTC-компоненты, не toLocaleDateString: локальное форматирование западнее
 * Гринвича сдвинуло бы срез-четверг на среду.
 */
export function fmtAsOfDate(asOfDay: number): string {
  // Каноны вместо ручных UTC-геттеров: номер суток → ISO → «дд.мм.гггг».
  return formatDateCell(isoOfDayNumber(asOfDay));
}

// ── Интегральная сводка → ряд KPI-плиток ────────────────────

export interface KpiVM {
  /** Ключ канон-словаря (METRIC_LABELS) — подпись рендерит KpiTile через productLabel */
  metricKey: string;
  value: string;
  unit: string;
  /** Честный скоуп числа: «2026 · год», «1 кв», … */
  periodBadge: string;
  source: ViewSource;
  tier: 'hero' | 'compact';
  /**
   * Из чего сложилось число — по частям: «заключено », 2 440, « из », 2 819.
   * Часть с metricKey несёт СВОЮ базу знаний по наведению. Так переплавка
   * не съела метрики, которые до неё стояли отдельными плитками
   * (plan_count/fact_count, счётчики КП и ЕП): плиток нет — ключи живы.
   */
  formula?: FormulaPart[];
  /** Процент для бара плитки (null — нет базы, бар не рисуется). */
  meter?: number | null;
  /** Смысловой акцент: способ закупки, тревога, экономия. */
  accent?: 'neutral' | 'brand' | 'violet' | 'amber' | 'emerald';
  /** Состав денежной плитки — тройка ФБ/КБ/МБ (страница рисует BudgetTriple). */
  budget?: { fb: number; kb: number; mb: number };
  /** Подстановка живых чисел в формулу этого показателя (блок «Сейчас»). */
  live?: string;
  /**
   * Официальный аналог плитки в слое снимков (dotted-ключ REPORT_MAP) —
   * дверь для дельта-бейджа «к прошлому снимку». Однозначного аналога той же
   * семантики в СВОДе нет → поля нет, плитка честно живёт без дельты.
   */
  officialKey?: string;
}

/** Кусок формулы: текст-связка либо число со своим ключом метрики. */
export interface FormulaPart {
  text: string;
  /** Задан — часть кликабельна для БЗ (KbHover). */
  metricKey?: string;
  /** Подстановка живых чисел именно для этой части («2 440 строк с датой…»). */
  live?: string;
}

/**
 * Колонки листов ГРБС, из которых берётся показатель, — в буквах A1.
 * Держатся здесь, а не в тексте: подстановка «Сейчас» обязана называть
 * адрес первички, а канон адресов — DEPT_COLUMNS.
 */
const COL = {
  planQuarter: colLetter(DEPT_COLUMNS.PLAN_QUARTER),
  planYear: colLetter(DEPT_COLUMNS.PLAN_YEAR),
  factDate: colLetter(DEPT_COLUMNS.FACT_DATE),
  method: colLetter(DEPT_COLUMNS.METHOD),
  planTotal: colLetter(DEPT_COLUMNS.TOTAL_PLAN),
  factTotal: colLetter(DEPT_COLUMNS.TOTAL_FACT),
} as const;

/** Индекс колонки (0-based) → буква A1. */
function colLetter(index: number): string {
  return index < 26
    ? String.fromCharCode(65 + index)
    : String.fromCharCode(64 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26));
}

/** «86,6 % = 2 440 ÷ 2 819 × 100» — процент с подставленными числами. */
function livePct(pct: number | null, done: number, plan: number, tail: string): string {
  if (pct === null) return `Плана нет (0 строк) — процент не считается.\n${tail}`;
  return `${fmtPct(pct)} = ${fmtCount(done)} ÷ ${fmtCount(plan)} × 100\n${tail}`;
}

/** «1 629 247 = ФБ 183 344 + КБ 361 414 + МБ 1 084 489» — сумма тройки. */
function liveMoney(m: { fb: number; kb: number; mb: number; total: number }, tail: string): string {
  return `${fmtThousands(m.total)} = ФБ ${fmtThousands(m.fb)} + КБ ${fmtThousands(m.kb)} ` +
    `+ МБ ${fmtThousands(m.mb)} тыс. руб.\n${tail}`;
}

interface ScopeCounts {
  kp: Report['integralSummary']['year']['kp'];
  ep: Report['integralSummary']['year']['ep'];
  total: Report['integralSummary']['year']['total'];
}

/**
 * Герой скоупа: главный процент исполнения крупно, с формулой и баром.
 * Отставание (<70 %) подсвечивается янтарём — цвет говорит раньше, чем
 * читатель сравнит числа; слово «заключено N из M» дублирует и то, и другое.
 */
function heroTile(scope: ScopeCounts, badge: string): KpiVM {
  const pct = scope.total.pct;
  return {
    metricKey: 'exec_count_pct',
    value: fmtPct(pct),
    unit: '',
    periodBadge: badge,
    source: scope.total.origin,
    tier: 'hero',
    live: livePct(
      pct, scope.total.doneCount, scope.total.planCount,
      `Строки книг ГРБС: план — колонка ${COL.planQuarter} (квартал) и ${COL.planYear} (год); ` +
      `факт — заполненная ${COL.factDate} (дата заключения).`,
    ),
    formula: [
      { text: 'заключено ' },
      {
        text: fmtCount(scope.total.doneCount),
        metricKey: 'fact_count',
        live: `${fmtCount(scope.total.doneCount)} строк с заполненной датой заключения ` +
          `(колонка ${COL.factDate} листов ГРБС) в этом периоде.`,
      },
      { text: ' из ' },
      {
        text: fmtCount(scope.total.planCount),
        metricKey: 'plan_count',
        live: `${fmtCount(scope.total.planCount)} строк плана периода ` +
          `(колонки ${COL.planQuarter}/${COL.planYear} листов ГРБС).`,
      },
      { text: ' позиций' },
    ],
    meter: pct,
    accent: pct !== null && pct < 70 ? 'amber' : 'brand',
  };
}

/** Две плитки способов одного скоупа: конкурентные и единственный поставщик. */
function methodTiles(scope: ScopeCounts, badge: string): KpiVM[] {
  return [
    {
      metricKey: 'comp_exec_count_pct',
      value: fmtPct(scope.kp.pct),
      unit: '',
      periodBadge: badge,
      source: scope.kp.origin,
      tier: 'compact',
      live: livePct(
        scope.kp.pct, scope.kp.doneCount, scope.kp.planCount,
        `Конкурентные — строки, где способ (колонка ${COL.method}) НЕ «ЕП»; ` +
        `заключённые — с датой в ${COL.factDate}.`,
      ),
      formula: [
        {
          text: fmtCount(scope.kp.doneCount),
          metricKey: 'comp_fact_count',
          live: `${fmtCount(scope.kp.doneCount)} конкурентных строк с датой заключения (${COL.factDate}).`,
        },
        { text: ' из ' },
        {
          text: fmtCount(scope.kp.planCount),
          metricKey: 'competitive_count',
          live: `${fmtCount(scope.kp.planCount)} строк плана со способом ≠ «ЕП» (колонка ${COL.method}).`,
        },
      ],
      meter: scope.kp.pct,
      accent: 'brand',
    },
    {
      metricKey: 'ep_exec_count_pct',
      value: fmtPct(scope.ep.pct),
      unit: '',
      periodBadge: badge,
      source: scope.ep.origin,
      tier: 'compact',
      live: livePct(
        scope.ep.pct, scope.ep.doneCount, scope.ep.planCount,
        `ЕП — строки со способом «ЕП» (колонка ${COL.method}); заключённые — с датой в ${COL.factDate}.`,
      ),
      formula: [
        {
          text: fmtCount(scope.ep.doneCount),
          metricKey: 'ep_fact_count',
          live: `${fmtCount(scope.ep.doneCount)} строк ЕП с датой заключения (${COL.factDate}).`,
        },
        { text: ' из ' },
        {
          text: fmtCount(scope.ep.planCount),
          metricKey: 'ep_count',
          live: `${fmtCount(scope.ep.planCount)} строк плана со способом «ЕП» (колонка ${COL.method}).`,
        },
      ],
      meter: scope.ep.pct,
      accent: 'violet',
    },
  ];
}

/**
 * Плиткам скоупа проставляется официальный аналог из слоя снимков — там,
 * где он однозначен (исполнение КП/ЕП; см. officialAnalogKey). Остальные
 * плитки остаются как есть: без аналога нет и дельты.
 */
function stampOfficialKeys(tiles: KpiVM[], scope: KpiScope, reportYear: number): KpiVM[] {
  return tiles.map((t) => {
    const officialKey = officialAnalogKey(t.metricKey, scope, reportYear);
    return officialKey === undefined ? t : { ...t, officialKey };
  });
}

/** Строка сверки остатка: наш пересчёт против яруса официального листа. */
export interface RemainderRowVM {
  /** Ключ БЗ показателя строки. */
  metricKey: string;
  label: string;
  /** Уточнение под подписью по частям — счётчик несёт свой ключ БЗ. */
  hint: FormulaPart[];
  /** Подстановка живых чисел для попапа строки. */
  live: string;
  value: string;
  budget: { fb: number; kb: number; mb: number };
  /** Префикс ключей БЗ бюджетной тройки. */
  budgetPrefix: 'pending' | 'economy';
  source: ViewSource;
  /** Адрес ИТОГО на листе СВОД («O2») — ссылка к первичке; null у расчёта. */
  cell: string | null;
  accent?: 'neutral' | 'emerald';
}

/** Интегральная сводка целиком: четыре яруса вместо ряда равных плиток. */
export interface IntegralSummaryVM {
  /** Год и отчётный квартал — главные проценты. */
  hero: KpiVM[];
  /** Способы: КП/ЕП года и квартала. */
  methods: KpiVM[];
  /** Деньги года: лимит, факт, утверждённая экономия — с составом бюджетов. */
  money: KpiVM[];
  /** Остаток к заключению: наш расчёт и обе официальные строки листа. */
  remainder: RemainderRowVM[];
  /**
   * Подпись расхождения нашего остатка с официальным ярусом (null — листа
   * нет или расхождение нулевое). Обе стороны показаны как есть: продукт
   * не подгоняет свой пересчёт под лист и не молчит о разнице.
   */
  remainderDiff: string | null;
}

export function buildIntegralSummary(report: Report): IntegralSummaryVM {
  const { period, integralSummary, official } = report;
  const yearBadge = `${period.year} · год`;
  const quarterBadge = quarterLabel(period.quarter);
  const money = integralSummary.money;
  const pending = integralSummary.pending.year;

  const moneyTile = (
    metricKey: string,
    m: { fb: number; kb: number; mb: number; total: number; origin: ViewSource },
    accent: KpiVM['accent'],
  ): KpiVM => ({
    metricKey,
    value: fmtThousands(m.total),
    unit: 'тыс. ₽',
    periodBadge: yearBadge,
    source: m.origin,
    tier: 'compact',
    accent,
    budget: { fb: m.fb, kb: m.kb, mb: m.mb },
    live: liveMoney(
      m,
      metricKey === 'plan_total'
        ? `Сумма плановых колонок листов ГРБС (итог — ${COL.planTotal}) по строкам плана года.`
        : metricKey === 'fact_total'
          ? `Сумма фактических колонок (итог — ${COL.factTotal}) по строкам с датой заключения.`
          : 'Сумма экономии по строкам с датой факта и флагом «учитывать» = «да» — то есть УТВЕРЖДЁННАЯ финансовым органом, в тысячах рублей. Экономия торгов «НМЦК минус цена аукциона» из книги мониторинга считается иначе и здесь не участвует.',
    ),
  });

  /**
   * Денежная плитка года из ОФИЦИАЛЬНОЙ строки «ИТОГО 2026:» листа СВОД
   * (решение пользователя 07.08: лимиты продукта — как на листе). Наш
   * пересчёт не прячется: живая подсказка называет обе стороны и величину
   * расхождения; при расхождении лимита причина — счётные строки без года
   * плана, их разбор — в сверках секций и сигнале «Без подтверждённого
   * финансирования».
   */
  const officialMoneyTile = (
    metricKey: string,
    row: { fb: number; kb: number; mb: number; total: number; row: number; cell: string },
    calc: { total: number },
    accent: KpiVM['accent'],
  ): KpiVM => {
    const delta = calc.total - row.total;
    const deltaNote = Math.abs(delta) > 0.5
      ? `Наш пересчёт из строк книг: ${fmtThousands(calc.total)} тыс. руб. ` +
        `(${delta > 0 ? '+' : '−'}${fmtThousands(Math.abs(delta))} к листу${
          metricKey === 'plan_total' ? ' — счётные строки без года плана, лист их не видит' : ''}).`
      : `Наш пересчёт из строк книг сходится: ${fmtThousands(calc.total)} тыс. руб.`;
    return {
      metricKey,
      value: fmtThousands(row.total),
      unit: 'тыс. ₽',
      periodBadge: yearBadge,
      source: 'svod',
      tier: 'compact',
      accent,
      budget: { fb: row.fb, kb: row.kb, mb: row.mb },
      live: liveMoney(
        row,
        `Строка «ИТОГО 2026:» листа СВОД ТД-ПМ, ячейка ${row.cell} (строка ${row.row}) — как есть, без пересчёта.\n${deltaNote}`,
      ),
    };
  };

  const remainder: RemainderRowVM[] = [];
  if (pending.count > 0 || pending.total > 0) {
    remainder.push({
      metricKey: 'pending_total',
      label: 'Наш пересчёт строк книг',
      hint: [
        { text: fmtCount(pending.count), metricKey: 'pending_count' },
        { text: ' позиций без даты заключения' },
      ],
      value: fmtThousands(pending.total),
      budget: { fb: pending.fb, kb: pending.kb, mb: pending.mb },
      budgetPrefix: 'pending',
      source: 'calc',
      cell: null,
      live: liveMoney(
        pending,
        `${fmtCount(pending.count)} строк плана года без даты заключения (пустая или «Х» в ${COL.factDate}); ` +
        `суммы — плановые колонки (итог ${COL.planTotal}).`,
      ),
    });
  }
  if (official?.remainderToConclude) {
    const r = official.remainderToConclude;
    // Периметр яруса уже, чем кажется: формулы `L2 =H14-L14` … `O2 =K14-O14`
    // берут обе стороны из строки 14 листа — «Итого ЭА 2026». Значит остаток
    // считается только по конкурентным процедурам и только за год этой строки;
    // единственный поставщик в него не входит вовсе. Подпись обязана это
    // назвать, иначе строка читается как остаток всего плана (карта метрик
    // 18.08.2026, расхождение №4).
    remainder.push({
      metricKey: 'remainder_to_conclude',
      label: 'Официальный лист СВОД — только ЭА',
      hint: [{ text: 'ярус «Остаток к заключ.» шапки листа: строка «Итого ЭА 2026», без ЕП' }],
      value: fmtThousands(r.total),
      budget: { fb: r.fb, kb: r.kb, mb: r.mb },
      budgetPrefix: 'pending',
      source: 'svod',
      cell: r.cell,
      live: liveMoney(
        r,
        `Ячейка ${r.cell} листа СВОД ТД-ПМ (строка ${r.row}) — как есть, без пересчёта.\n` +
        'Лист вычитает факт из плана строки «Итого ЭА 2026»: это остаток ТОЛЬКО по конкурентным ' +
        'процедурам и только за год этой строки. Наш пересчёт выше идёт по всем способам, ' +
        'включая единственного поставщика, — периметры разные.',
      ),
    });
  }
  if (official?.calcEconomy) {
    const e = official.calcEconomy;
    // НЕ economy_total: это ПРОГНОЗ листа по ещё не заключённым процедурам, а
    // не утверждённая финорганом экономия. Под ключом economy_total карточка
    // объясняла читателю не то число, на которое он смотрит (карта метрик
    // 18.08.2026, расхождение №5 — «две экономии под одним словом»).
    remainder.push({
      metricKey: 'calc_economy_remainder',
      label: 'Расчётная экономия по остатку — прогноз листа',
      hint: [{ text: 'та самая строка ручного отчёта: экономия по ещё не заключённым' }],
      value: fmtThousands(e.total),
      budget: { fb: e.fb, kb: e.kb, mb: e.mb },
      budgetPrefix: 'economy',
      source: 'svod',
      cell: e.cell,
      accent: 'emerald',
      live: liveMoney(e, `Ячейка ${e.cell} листа СВОД ТД-ПМ (строка ${e.row}) — как есть, без пересчёта.`),
    });
  }

  const officialTotal = official?.remainderToConclude?.total ?? 0;
  const delta = official?.remainderToConclude ? pending.total - officialTotal : null;
  // Расхождение здесь не дефект счёта, а разница периметров и определений, и
  // подпись обязана назвать обе причины поимённо (канон п.53: механизм, адрес,
  // действие). Периметр: лист берёт строку «Итого ЭА 2026» — только
  // конкурентные, только год строки; мы считаем по всем способам. Определение:
  // лист вычитает подешевевшую цену контракта и потому занижает объём
  // оставшейся работы ровно на величину экономии, а наш остаток складывает
  // ПЛАНОВЫЕ суммы строк без даты заключения.
  const remainderDiff = delta !== null && officialTotal > 0 && Math.abs(delta) >= 1
    ? `Расхождение с официальным листом: ${delta > 0 ? '+' : '−'}${fmtThousands(Math.abs(delta))} тыс. руб. ` +
      `(${fmtPct((Math.abs(delta) / officialTotal) * 100)}). Это не спор о числе, а две разные величины: ` +
      'лист считает остаток по строке «Итого ЭА 2026» — только конкурентные процедуры, без единственного ' +
      'поставщика, — и вычитает из плана уже подешевевший факт; наш пересчёт берёт плановые суммы всех ' +
      'строк без даты заключения. Обе стороны показаны как есть, ни одна не подгоняется под другую.'
    : null;

  return {
    hero: [
      { ...heroTile(integralSummary.year, yearBadge), ...officialStamp('exec_count_pct', 'year', period.year) },
      { ...heroTile(integralSummary.quarter, quarterBadge), ...officialStamp('exec_count_pct', period.quarter, period.year) },
    ],
    methods: [
      ...stampOfficialKeys(methodTiles(integralSummary.year, yearBadge), 'year', period.year),
      ...stampOfficialKeys(methodTiles(integralSummary.quarter, quarterBadge), period.quarter, period.year),
    ],
    // Лимиты — официальные (лист СВОД, строка «ИТОГО 2026:»), решение 07.08;
    // ярус листа не передан — честный фолбэк на наш пересчёт (origin calc).
    money: official?.yearMoney
      ? [
          officialMoneyTile('plan_total', official.yearMoney.plan, money.plan, 'neutral'),
          officialMoneyTile('fact_total', official.yearMoney.fact, money.fact, 'neutral'),
          officialMoneyTile('economy_total', official.yearMoney.economy, money.economy, 'emerald'),
        ]
      : [
          moneyTile('plan_total', money.plan, 'neutral'),
          moneyTile('fact_total', money.fact, 'neutral'),
          moneyTile('economy_total', money.economy, 'emerald'),
        ],
    remainder,
    remainderDiff,
  };
}

/** Официальный аналог одной плитки — как объект-накладка (spread). */
function officialStamp(metricKey: string, scope: KpiScope, year: number): { officialKey?: string } {
  const officialKey = officialAnalogKey(metricKey, scope, year);
  return officialKey === undefined ? {} : { officialKey };
}

// ── Блок ГРБС → view-модель секции ──────────────────────────

export interface MethodRowVM {
  /** Семейство способа — канон продукта (кириллические коды) */
  methodKey: 'КП' | 'ЕП';
  plan: number;
  fact: number;
  /** Числовой процент для бара (null = «нет плана», бар не рисуется). */
  pct: number | null;
  pctText: string;
}

/** Пара «расчёт против СВОД» для DiffText; подпись — productLabel(metricKey). */
export interface SvodPairVM {
  metricKey: string;
  calc: number;
  svod: number;
  /** Адрес ячейки листа СВОД («E268») — откуда взято официальное число. */
  svodCell?: string;
  /** Подпись строки, если productLabel(metricKey) не годится (деньги года). */
  label?: string;
  /** 'money' — форматировать fmtThousands (тыс. руб.), иначе целые счётчики. */
  fmt?: 'money';
}

export interface GrbsSectionVM {
  dept: string;
  deptLabel: string;
  /** 'mixed' когда в квартале есть официальные счётчики СВОД, иначе 'calc' */
  source: ViewSource;
  /** «40,0%» либо «нет плана» */
  executionPct: string;
  /** Формула-подпись: «заключено 6 из 15» */
  executionCaption: string;
  pendingCount: number;
  /** «Не заключено: 9» / «Все плановые процедуры квартала заключены» / «—» */
  pendingLabel: string;
  /** Итог квартала для строки «Всего» таблицы способов (канон G = E/D). */
  totalRow: { plan: number; fact: number; pct: number | null; pctText: string };
  /** Незаключённые позиции квартала с пояснениями из листа (ядро, канон эфира). */
  pendingPositions: PendingPosition[];
  /** Этапность года: вид деятельности и стадия жизненного цикла (ядро). */
  lifecycle: LifecycleBreakdown;
  /** Своды объяснений: основания ЕП и причины просрочек (ядро). */
  reasons: ReasonBreakdown;
  methodRows: MethodRowVM[];
  yearLine: string;
  /** Плоская строка денег — для «Копировать текстом»; UI рендерит тройки из money. */
  moneyLine: string;
  /** Сырые тройки года — цветная разметка ФБ/КБ/МБ на странице (BudgetTriple). */
  money: { plan: BudgetMoney; fact: BudgetMoney };
  /** null — экономии нет (total = 0), строка не рисуется */
  economyLine: string | null;
  signals: ReportSignal[];
  /** null — лист СВОД по кварталу не передан, сверки нет */
  svodPairs: SvodPairVM[] | null;
  /** Подпись под сверкой: почему её числа расходятся с отчётными (null — не расходятся). */
  svodNote: string | null;
}

function pendingLabelOf(execution: { planCount: number }, pendingCount: number): string {
  if (pendingCount > 0) return `Не заключено: ${fmtCount(pendingCount)}`;
  if (execution.planCount === 0) return 'План на квартал отсутствует';
  return 'Все плановые процедуры квартала заключены';
}

/** Блок ГРБС из Report → плоская view-модель секции страницы. */
export function buildGrbsSection(block: GrbsReportBlock): GrbsSectionVM {
  const q = block.quarter;
  const y = block.year;
  // Сверка идёт по q.live — расчёту БЕЗ гейта среза: формулы СВОДа дату факта
  // не сравнивают ни с чем и всегда считают «на сейчас». Сравнение отчётных
  // чисел (на срез) с живым официалом давало мнимые расхождения (УО +12, УЭР +1).
  // Ячейки способа опциональны (Д15): у скоупа на листе может быть один блок —
  // существующая половина сверки сохраняет провенанс, отсутствующая без ячейки.
  const cells = q.svodCells;
  const countPairs: SvodPairVM[] = q.svod
    ? [
        { metricKey: 'competitive_count', calc: q.live.kp.planCount, svod: q.svod.kp.planCount, ...(cells?.kp ? { svodCell: cells.kp.plan } : {}) },
        { metricKey: 'comp_fact_count', calc: q.live.kp.doneCount, svod: q.svod.kp.doneCount, ...(cells?.kp ? { svodCell: cells.kp.fact } : {}) },
        { metricKey: 'ep_count', calc: q.live.ep.planCount, svod: q.svod.ep.planCount, ...(cells?.ep ? { svodCell: cells.ep.plan } : {}) },
        { metricKey: 'ep_fact_count', calc: q.live.ep.doneCount, svod: q.svod.ep.doneCount, ...(cells?.ep ? { svodCell: cells.ep.fact } : {}) },
      ]
    : [];
  // Деньги плана-года: расчёт против строки «ИТОГО 2026:» листа. Именно здесь
  // всплыло расхождение УЭР 13 921/13 331 (счётные строки без года плана —
  // SUMIFS листа их не видят); прятать его — врать, показываем обе стороны.
  const sv = block.svodYearMoney;
  const moneyPairs: SvodPairVM[] = sv
    ? [
        { metricKey: 'plan_total', label: 'Лимит 2026, тыс. руб.', fmt: 'money', calc: block.money.plan.total, svod: sv.plan.total, svodCell: sv.cells.plan },
        { metricKey: 'fact_total', label: 'Факт, тыс. руб.', fmt: 'money', calc: block.money.fact.total, svod: sv.fact.total, svodCell: sv.cells.fact },
        { metricKey: 'economy_total', label: 'Утверждённая экономия, тыс. руб.', fmt: 'money', calc: block.economy.total, svod: sv.economy.total, svodCell: sv.cells.economy },
      ]
    : [];
  const svodPairs: SvodPairVM[] | null =
    countPairs.length + moneyPairs.length > 0 ? [...countPairs, ...moneyPairs] : null;
  // Сколько заключено после среза — этим объясняется разрыв между отчётными
  // числами секции и колонкой сверки.
  const afterSlice =
    (q.live.kp.doneCount - q.methods.kp.doneCount) + (q.live.ep.doneCount - q.methods.ep.doneCount);
  // Подпись под сверкой — по одной честной причине на каждое известное
  // расхождение; ни одной причины нет — подписи нет.
  const noteParts: string[] = [];
  if (afterSlice > 0) {
    noteParts.push(
      `Сверка — на текущий момент, как считает СВОД. После даты среза заключено ${fmtCount(afterSlice)} — ` +
      'в отчётные числа выше они не входят.',
    );
  }
  if (block.noYearRows && sv && Math.abs(block.money.plan.total - sv.plan.total) > 0.5) {
    noteParts.push(
      `Лимит расходится из-за ${fmtCount(block.noYearRows.count)} счётных строк книги на ` +
      `${fmtThousands(block.noYearRows.total)} тыс. руб. без года плана (колонка P): расчёт относит их ` +
      'к отчётному году, формулы листа СВОД считают год строго и эти строки не видят. ' +
      'Проставьте год — числа сойдутся.',
    );
  }
  return {
    dept: block.dept,
    deptLabel: block.deptLabel,
    source: q.svod ? 'mixed' : 'calc',
    executionPct: fmtPct(q.execution.pct),
    executionCaption: `заключено ${fmtCount(q.execution.doneCount)} из ${fmtCount(q.execution.planCount)}`,
    pendingCount: q.pendingCount,
    pendingLabel: pendingLabelOf(q.execution, q.pendingCount),
    // Итог квартала — те же канонические счётчики G = E/D, что и крупный
    // процент шапки: строка «Всего» таблицы способов не вторая семантика,
    // а тот же расчёт рядом с разбивкой.
    totalRow: {
      plan: q.execution.planCount,
      fact: q.execution.doneCount,
      pct: q.execution.pct,
      pctText: fmtPct(q.execution.pct),
    },
    methodRows: [
      { methodKey: 'КП', plan: q.methods.kp.planCount, fact: q.methods.kp.doneCount, pct: q.methods.kp.pct, pctText: fmtPct(q.methods.kp.pct) },
      { methodKey: 'ЕП', plan: q.methods.ep.planCount, fact: q.methods.ep.doneCount, pct: q.methods.ep.pct, pctText: fmtPct(q.methods.ep.pct) },
    ],
    yearLine: `За год: заключено ${fmtCount(y.counts.doneCount)} из ${fmtCount(y.counts.planCount)} (${fmtPct(y.counts.pct)})` +
      (y.pendingCount > 0 ? `, не заключено ${fmtCount(y.pendingCount)}` : ''),
    moneyLine: `Лимит ${fmtThousands(block.money.plan.total)} тыс. руб., факт ${fmtThousands(block.money.fact.total)} тыс. руб.`,
    money: block.money,
    economyLine: block.economy.total > 0
      ? `Утверждённая экономия: ${fmtThousands(block.economy.total)} тыс. руб.`
      : null,
    pendingPositions: block.quarter.pendingPositions,
    lifecycle: block.lifecycle,
    reasons: block.reasons,
    signals: block.signals,
    svodPairs,
    svodNote: noteParts.length > 0 ? noteParts.join(' ') : null,
  };
}
