import { useState, useMemo, useCallback, useId } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts';
import { ChevronLeft, Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KBTooltip } from '../ui/kb-tooltip';
import { useTheme } from '../ThemeProvider';
import {
  getChartColors,
  getTooltipStyle,
  getBudgetColor,
  getMethodColor,
  getSeriesPattern,
  type SeriesPattern,
} from '@/lib/chart-colors';
import { useStore } from '../../store';
import { pluralRu } from '../../lib/economy-copy';
import { isMeaningfulGap, splitDrawable } from '../../lib/chart-slices';
import { periodDataLabel, MONTH_ABBR } from '../../lib/period-label';
import type { MultiDimResult, ExecutionMetrics } from '../../hooks/useMultiDimMetrics';

// ────────────────────────────────────────────────────────────────
// DrillPieChart — круг долей с раскрытием иерархии.
//
// ПРАВИЛА, ОБЩИЕ ДЛЯ ВСЕХ МНОГОМЕРНЫХ ЭЛЕМЕНТОВ:
//
// 1. ЕДИНЫЙ СТЕК РАЗРЕЗОВ
//    Клик кладёт «разрез» в стек, хлебная крошка снимает. Разрезы
//    складываются: управление ∩ способ ∩ бюджет держатся одновременно.
//
// 2. ПЕРЕКРЁСТНОЕ РАСКРЫТИЕ (матрица, не дерево)
//    Из любого среза одного измерения — разбивка по другому измерению.
//
// 3. КЛИК НИКОГДА НЕ УВОДИТ СО СТРАНИЦЫ
//    Клик = раскрытие на месте. Уход — только по явной команде.
//
// 4. ПЕРИОД ВИДЕН ВСЕГДА
//    Плашка периода называет отрезок, за который посчитаны числа.
//
// 5. ЦВЕТ УПРАВЛЕНИЯ ПОСТОЯНЕН МЕЖДУ УРОВНЯМИ
//
// 6. ХЛЕБНАЯ КРОШКА = ОБРАТНЫЙ ПУТЬ
//
// 7. ПОКАЗАТЕЛЬ НЕЗАВИСИМ ОТ ГЛУБИНЫ РАСКРЫТИЯ
//
// 8. КРУГ ПОКАЗЫВАЕТ ТОЛЬКО СКЛАДЫВАЕМЫЕ ВЕЛИЧИНЫ
//    Доли имеют смысл, когда части складываются в целое. Проценты не
//    складываются: сумма процентов исполнения восьми управлений — число
//    без смысла, а доля одного управления в этой сумме — тем более.
//    Поэтому измерение «Исполнение» рисует ЗАКРЫТЫЕ ПРОЦЕДУРЫ (штуки —
//    величина складываемая), а сам процент стоит в центре и считается
//    честно: Σ факта / Σ плана, а не среднее из долей.
//
// 9. ИТОГ И ЧАСТИ — ИЗ ОДНОГО ИСТОЧНИКА, ИНАЧЕ РАЗНИЦА НАЗВАНА ВСЛУХ
//    Под кругом сверяется сумма срезов с итогом страницы за тот же период.
//    Разошлись — это видно и подписано, а не спрятано округлением.
// ────────────────────────────────────────────────────────────────

export type DrillDimension = 'procurement' | 'budget' | 'department' | 'execution';

export const DRILL_DIMENSION_LABELS: Record<DrillDimension, string> = {
  procurement: 'Способ закупки',
  budget: 'Бюджеты',
  department: 'Управления',
  execution: 'Исполнение',
};

/**
 * Показатели круга. «Исполнение, %» здесь сознательно отсутствует: доля
 * процента в сумме процентов — величина без смысла (правило 8 выше).
 */
type Metric = 'plan' | 'fact' | 'economy' | 'count';

/**
 * Подписи не называют единицу денег: единица переключается в шапке
 * (тысячи / миллионы / миллиарды) и печатается рядом с каждым числом
 * форматтером. Прежние «План ₽» обещали рубли, а число рядом стояло в
 * тысячах — подпись и значение противоречили друг другу.
 */
const METRIC_LABELS: Record<Metric, string> = {
  plan: 'План',
  fact: 'Факт',
  economy: 'Экономия',
  count: 'Закупки, шт.',
};

type ViewLevel = 'grbs' | 'orgs';
const VIEW_LEVEL_LABELS: Record<ViewLevel, string> = {
  grbs: 'ГРБС',
  orgs: 'Организации',
};

/** Что стоит за числом среза: деньги, штуки или проценты. */
type Unit = 'money' | 'count';

const METRIC_UNIT: Record<Metric, Unit> = {
  plan: 'money', fact: 'money', economy: 'money', count: 'count',
};

// Разрезы — складываются, порядок хранится в стеке
type Scope =
  | { kind: 'dept'; deptName: string }
  | { kind: 'method'; m: 'КП' | 'ЕП' }
  | { kind: 'budget'; b: 'ФБ' | 'КБ' | 'МБ' };

interface Slice {
  id: string;
  name: string;
  value: number;
  color?: string;
  drillable: boolean;
}

/** Всё, что нужно нарисовать один уровень раскрытия. */
interface DrillView {
  data: Slice[];
  /** Сумма показанных срезов. */
  total: number;
  unit: Unit;
  centerLabel: string;
  /** Крупное число в центре; null — считать не из чего. */
  centerValue: string | null;
  centerSub: string;
  /**
   * Итог за тот же период из общего источника страницы. Круг обязан
   * сойтись с ним. null — сверять не с чем (например включён фильтр,
   * который сузил данные намеренно).
   */
  reference: number | null;
  /** Срезы, которые круг изобразить не может: ноль и отрицательные. */
  hidden: { count: number; sum: number };
  /** Пояснение под кругом, когда измерение читается не буквально. */
  note: string | null;
}

export interface DrillPieChartProps {
  mdm: MultiDimResult;
  procurementFilter: string;
  formatMoney: (v: number) => string;
  onDeptToggle?: (deptShort: string) => void;
  /** Оставлен для совместимости; из кликов по срезам не вызывается. */
  onNavigate?: (page: 'analytics', opts?: any) => void;
}

// ── Вспомогательное ──

function scopeLabel(s: Scope): string {
  if (s.kind === 'dept') return s.deptName;
  if (s.kind === 'method') return s.m;
  return s.b;
}

function scopeHasMethod(stack: Scope[]): 'КП' | 'ЕП' | null {
  const m = stack.find(s => s.kind === 'method');
  return m ? (m as Extract<Scope, { kind: 'method' }>).m : null;
}
function scopeHasBudget(stack: Scope[]): 'ФБ' | 'КБ' | 'МБ' | null {
  const b = stack.find(s => s.kind === 'budget');
  return b ? (b as Extract<Scope, { kind: 'budget' }>).b : null;
}
function scopeHasDept(stack: Scope[]): string | null {
  const d = stack.find(s => s.kind === 'dept');
  return d ? (d as Extract<Scope, { kind: 'dept' }>).deptName : null;
}

const BUDGET_FIELD = { 'ФБ': 'FB', 'КБ': 'KB', 'МБ': 'MB' } as const;

function readBudget(m: ExecutionMetrics | null | undefined, budget: 'ФБ' | 'КБ' | 'МБ', metric: Metric): number {
  if (!m?.budget) return 0;
  const suffix = BUDGET_FIELD[budget];
  if (metric === 'plan') return m.budget[`plan${suffix}`] ?? 0;
  if (metric === 'fact') return m.budget[`fact${suffix}`] ?? 0;
  if (metric === 'economy') return m.budget[`economy${suffix}`] ?? 0;
  return 0;
}

function readMetric(m: ExecutionMetrics | null | undefined, metric: Metric, scope: Scope[]): number {
  if (!m) return 0;
  const budgetScope = scopeHasBudget(scope);
  if (budgetScope && (metric === 'plan' || metric === 'fact' || metric === 'economy')) {
    return readBudget(m, budgetScope, metric);
  }
  const methodScope = scopeHasMethod(scope);
  if (methodScope && metric === 'count') {
    return methodScope === 'КП' ? (m.competitiveCount ?? 0) : (m.epCount ?? 0);
  }
  switch (metric) {
    case 'plan': return m.planTotal ?? 0;
    case 'fact': return m.factTotal ?? 0;
    case 'economy': return m.economyTotal ?? 0;
    case 'count': return (m.competitiveCount ?? 0) + (m.epCount ?? 0);
  }
}

// ── Штриховка: второй, нецветовой признак ряда ──

const PATTERN_INK_DARK = 'rgba(0,0,0,0.38)';
const PATTERN_INK_LIGHT = 'rgba(255,255,255,0.5)';

/**
 * Определения штриховок живут в отдельном нулевого размера `svg`: ссылка
 * `url(#id)` разрешается в пределах документа, а вкладывать `defs` внутрь
 * Recharts-графика нельзя — библиотека разбирает своих детей по типам и
 * посторонний узел до отрисовки не доходит.
 */
function PatternDefs({ series, ink }: { series: Array<{ key: string; color: string; pattern: SeriesPattern }>; ink: string }) {
  return (
    <svg width={0} height={0} aria-hidden className="absolute pointer-events-none">
      <defs>
        {/* Сплошному ряду узор не нужен — он красится чистым цветом. */}
        {series.filter(s => s.pattern !== 'solid').map(s => (
          <pattern key={s.key} id={s.key} width="7" height="7" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill={s.color} />
            {s.pattern === 'diagonal' && (
              <path d="M-1,1 l2,-2 M0,7 l7,-7 M6,8 l2,-2" stroke={ink} strokeWidth="1.6" />
            )}
            {s.pattern === 'dots' && (
              <circle cx="3.5" cy="3.5" r="1.5" fill={ink} />
            )}
            {s.pattern === 'grid' && (
              <path d="M0,3.5 H7 M3.5,0 V7" stroke={ink} strokeWidth="1.3" />
            )}
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

/** Метка ряда в легенде: тот же цвет и та же штриховка, что у сектора. */
function SeriesSwatch({ fill, active }: { fill: string; active: boolean }) {
  return (
    <svg
      width={10} height={10} viewBox="0 0 10 10" aria-hidden
      className="shrink-0 transition-transform"
      style={{ transform: active ? 'scale(1.35)' : 'scale(1)' }}
    >
      <circle cx="5" cy="5" r="5" fill={fill} />
    </svg>
  );
}

// ── Компонент ──

export function DrillPieChart({
  mdm,
  procurementFilter,
  formatMoney,
  onDeptToggle,
}: DrillPieChartProps) {
  const isDark = useTheme(s => s.theme) === 'dark';
  const chartColors = getChartColors(isDark);
  const { contentStyle: tooltipStyle } = getTooltipStyle(isDark);
  const cursorStyle = { fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' };
  const patternInk = isDark ? PATTERN_INK_DARK : PATTERN_INK_LIGHT;
  // Идентификаторы штриховок уникальны на экземпляр: два круга на одной
  // странице иначе поделят один узор и покрасятся чужим цветом. React
  // обрамляет свой идентификатор служебными знаками (двоеточия, кавычки-
  // ёлочки в зависимости от версии) — в ссылке `url(#…)` им не место.
  const patternPrefix = `p${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Период показа
  const year = useStore(s => s.year);
  const activeMonths = useStore(s => s.activeMonths);
  const periodMode = useStore(s => s.periodMode);
  const period = useStore(s => s.period);
  const focusedWeekStart = useStore(s => s.focusedWeekStart);

  // Подпись обязана называть период ДАННЫХ, а не выбор в шапке.
  // Было: при недельном режиме бейдж писал «Нед. 3–9 авг», хотя расчёт неделю
  // не сужает — periodMode и focusedWeekStart не читает ни один агрегат
  // (resolvePeriodSelection принимает только квартал и месяцы). На экране
  // стояло годовое число под недельной подписью, и это читалось как неверные
  // данные. Пока недельный срез не реализован в расчёте, называем реальный
  // период, а про недельный выбор говорим отдельно и прямо.
  const weekLabel = useMemo(() => {
    const d = new Date(focusedWeekStart);
    const end = new Date(d); end.setDate(d.getDate() + 6);
    const sameMonth = d.getMonth() === end.getMonth();
    const fmt = (x: Date) => `${x.getDate()} ${MONTH_ABBR[x.getMonth()]}`;
    return sameMonth ? `${d.getDate()}–${end.getDate()} ${MONTH_ABBR[d.getMonth()]}` : `${fmt(d)}–${fmt(end)}`;
  }, [focusedWeekStart]);

  // Один дом подписи периода (lib/period-label). Прежняя локальная копия несла
  // сдвиг на месяц: MONTH_ABBR[id] при 1-базных id месяцев — выбранный май
  // подписывался «июн» (Д19 реестра дефектов).
  const periodLabel = useMemo(
    () => periodDataLabel({ year, period, activeMonths }),
    [activeMonths, year, period],
  );

  /** Недельный выбор сделан, но на числа не влияет — предупреждаем, а не молчим. */
  const weekNotApplied = periodMode === 'week';

  // Постоянный цвет управления между уровнями раскрытия
  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    mdm.departments.forEach((d, i) => map.set(d.dept, chartColors[i % chartColors.length]!));
    return map;
  }, [mdm.departments, chartColors]);

  // ── Состояние ──
  const [dimension, setDimension] = useState<DrillDimension>('department');
  const [metric, setMetric] = useState<Metric>('plan');
  const [scope, setScope] = useState<Scope[]>([]);
  const [activeSliceId, setActiveSliceId] = useState<string | null>(null);
  const [viewLevel, setViewLevel] = useState<ViewLevel>('grbs');

  const pushScope = useCallback((s: Scope) => {
    setScope(prev => [...prev, s]);
    setActiveSliceId(null);
  }, []);

  const popTo = useCallback((idx: number) => {
    setScope(prev => prev.slice(0, idx));
    setActiveSliceId(null);
  }, []);

  const resetAll = useCallback(() => {
    setScope([]);
    setActiveSliceId(null);
  }, []);

  const inDeptComposition = scopeHasDept(scope) !== null;

  // ── Сборка данных уровня ──
  const view: DrillView = useMemo(() => {
    const deptName = scopeHasDept(scope);
    const methodName = scopeHasMethod(scope);
    const budgetName = scopeHasBudget(scope);
    const suffix = [methodName, budgetName].filter(Boolean).join(' • ');

    /**
     * Итог того же показателя за тот же период из общего источника страницы.
     * `mdm.totals` собирается тем же ядром, что и суммы карточек, поэтому
     * сравнение с ним отвечает на вопрос «сходится ли круг с экраном».
     */
    const pageTotal = (m: Metric) => readMetric(mdm.totals, m, scope);

    // Состав управления: сам аппарат + подведомственные
    if (deptName) {
      const dm = mdm.departments.find(d => d.dept === deptName);
      if (!dm) {
        return {
          data: [], total: 0, unit: METRIC_UNIT[metric], centerLabel: deptName,
          centerValue: null, centerSub: 'управление не найдено',
          reference: null, hidden: { count: 0, sum: 0 }, note: null,
        };
      }
      const raw: Slice[] = [];
      if (dm.orgSelf) {
        raw.push({
          id: `self:${dm.dept}`,
          name: `${dm.dept} (само)`,
          value: readMetric(dm.orgSelf.metrics, metric, scope),
          color: deptColorMap.get(dm.dept),
          drillable: false,
        });
      }
      for (const sub of dm.realSubs) {
        raw.push({
          id: `sub:${sub.name}`,
          name: sub.displayName,
          value: readMetric(sub.metrics, metric, scope),
          drillable: false,
        });
      }
      const { drawable, hidden } = splitDrawable(raw);
      const total = drawable.reduce((s, x) => s + x.value, 0);
      return {
        data: drawable, total, unit: METRIC_UNIT[metric],
        centerLabel: dm.dept,
        centerValue: null,
        centerSub: suffix || `${dm.realSubCount} подвед.`,
        reference: readMetric(dm.total, metric, scope),
        hidden, note: null,
      };
    }

    switch (dimension) {
      case 'procurement': {
        // Разбивка по способу есть только в штуках: денежного разреза
        // «план по способу» на этом слое данных не существует, и
        // подставлять вместо него счётчик значило бы выдать штуки за рубли.
        const fd = mdm.fd;
        const raw: Slice[] = ([
          { id: 'm:КП', name: 'Конкурсные (КП)', short: 'КП' as const, value: fd.totalKP || 0 },
          { id: 'm:ЕП', name: 'Единственный поставщик (ЕП)', short: 'ЕП' as const, value: fd.totalEP || 0 },
        ]).filter(d => {
          if (procurementFilter === 'competitive') return d.short === 'КП';
          if (procurementFilter === 'single') return d.short === 'ЕП';
          return true;
        }).map(d => ({
          id: d.id, name: d.name, value: d.value,
          color: getMethodColor(d.short, isDark), drillable: true,
        }));
        const { drawable, hidden } = splitDrawable(raw);
        const total = drawable.reduce((s, x) => s + x.value, 0);
        return {
          data: drawable, total, unit: 'count',
          centerLabel: 'Закупки', centerValue: null, centerSub: 'КП / ЕП',
          // При включённом фильтре способа круг показывает часть намеренно —
          // сверять его с общим итогом не с чем.
          reference: procurementFilter === 'all' ? (fd.totalKP || 0) + (fd.totalEP || 0) : null,
          hidden, note: null,
        };
      }

      case 'budget': {
        let fb = 0, kb = 0, mb = 0;
        for (const d of mdm.departments) {
          fb += readBudget(d.total, 'ФБ', metric);
          kb += readBudget(d.total, 'КБ', metric);
          mb += readBudget(d.total, 'МБ', metric);
        }
        const raw: Slice[] = [
          { id: 'b:ФБ', name: 'ФБ (федеральный)', value: fb, color: getBudgetColor('ФБ', isDark), drillable: true },
          { id: 'b:КБ', name: 'КБ (краевой)', value: kb, color: getBudgetColor('КБ', isDark), drillable: true },
          { id: 'b:МБ', name: 'МБ (местный)', value: mb, color: getBudgetColor('МБ', isDark), drillable: true },
        ];
        const { drawable, hidden } = splitDrawable(raw);
        const total = drawable.reduce((s, x) => s + x.value, 0);
        return {
          data: drawable, total, unit: METRIC_UNIT[metric],
          centerLabel: 'Бюджеты', centerValue: null, centerSub: 'ФБ / КБ / МБ',
          // Разбивка по источникам обязана складываться в общий итог: если
          // строка не отнесена ни к одному бюджету, разница видна здесь.
          reference: readMetric(mdm.totals, metric, []),
          hidden, note: null,
        };
      }

      case 'department': {
        const raw: Slice[] = [];
        if (viewLevel === 'orgs') {
          for (const dm of mdm.departments) {
            if (dm.orgSelf) {
              raw.push({
                id: `org:self:${dm.dept}`,
                name: `${dm.dept} (само)`,
                value: readMetric(dm.orgSelf.metrics, metric, scope),
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
            for (const sub of dm.realSubs) {
              raw.push({
                id: `org:sub:${dm.dept}:${sub.name}`,
                name: sub.displayName,
                value: readMetric(sub.metrics, metric, scope),
                color: deptColorMap.get(dm.dept),
                drillable: false,
              });
            }
          }
        } else {
          for (const dm of mdm.departments) {
            raw.push({
              id: `d:${dm.dept}`,
              name: dm.dept,
              value: readMetric(dm.total, metric, scope),
              color: deptColorMap.get(dm.dept),
              drillable: true,
            });
          }
        }
        const { drawable, hidden } = splitDrawable(raw);
        const total = drawable.reduce((s, x) => s + x.value, 0);
        return {
          data: drawable, total, unit: METRIC_UNIT[metric],
          centerLabel: suffix || (viewLevel === 'orgs' ? 'Организации' : 'Управления'),
          centerValue: null,
          centerSub: viewLevel === 'orgs' ? `${drawable.length} орг.` : `${drawable.length} ГРБС`,
          // Оба уровня — ГРБС и организации — обязаны дать один итог: это
          // одни и те же строки, сложенные с разной глубиной.
          reference: pageTotal(metric),
          hidden, note: null,
        };
      }

      case 'execution': {
        // Круг показывает ЗАКРЫТЫЕ ПРОЦЕДУРЫ (складываются), а не проценты.
        const raw: Slice[] = [];
        let planCount = 0;
        let factCount = 0;
        if (viewLevel === 'orgs') {
          for (const dm of mdm.departments) {
            const nodes = [
              ...(dm.orgSelf ? [{ id: `eo:self:${dm.dept}`, name: `${dm.dept} (само)`, m: dm.orgSelf.metrics }] : []),
              ...dm.realSubs.map(sub => ({ id: `eo:sub:${dm.dept}:${sub.name}`, name: sub.displayName, m: sub.metrics })),
            ];
            for (const n of nodes) {
              planCount += n.m.planCount ?? 0;
              factCount += n.m.factCount ?? 0;
              raw.push({
                id: n.id, name: n.name, value: n.m.factCount ?? 0,
                color: deptColorMap.get(dm.dept), drillable: false,
              });
            }
          }
        } else {
          for (const dm of mdm.departments) {
            planCount += dm.total.planCount ?? 0;
            factCount += dm.total.factCount ?? 0;
            raw.push({
              id: `e:${dm.dept}`, name: dm.dept, value: dm.total.factCount ?? 0,
              color: deptColorMap.get(dm.dept), drillable: true,
            });
          }
        }
        const { drawable, hidden } = splitDrawable(raw);
        const total = drawable.reduce((s, x) => s + x.value, 0);
        // Процент считается от сложенных плана и факта, а не усреднением
        // долей: у управления с планом в три позиции и у управления с
        // планом в триста вес в общем исполнении разный.
        const pct = planCount > 0 ? (factCount / planCount) * 100 : null;
        return {
          data: drawable, total, unit: 'count',
          centerLabel: 'Исполнение',
          centerValue: pct === null ? null : `${pct.toFixed(1).replace('.', ',')} %`,
          centerSub: pct === null
            ? 'плана за период нет'
            : `${factCount.toLocaleString('ru-RU')} из ${planCount.toLocaleString('ru-RU')} шт.`,
          // Сверяем не с собственной суммой (она сойдётся всегда), а с числом
          // закрытых процедур на странице: круг обязан говорить то же, что
          // плитка исполнения.
          reference: mdm.totals.factCount ?? 0,
          hidden,
          note: 'доли круга — вклад в закрытые процедуры; процент в центре — факт к плану',
        };
      }
    }
  }, [dimension, metric, scope, mdm, procurementFilter, deptColorMap, viewLevel, isDark]);

  const { data, total, unit, centerLabel, centerValue, centerSub, reference, hidden, note } = view;

  const formatValue = useCallback((v: number) => {
    if (unit === 'money') return formatMoney(v);
    return `${Math.round(v).toLocaleString('ru-RU')} шт.`;
  }, [unit, formatMoney]);

  /** Расхождение суммы срезов с итогом страницы — если оно есть. */
  const gap = useMemo(() => {
    if (reference === null) return null;
    const diff = reference - total;
    if (!isMeaningfulGap(diff, reference)) return null;
    // Причина расхождения не додумывается: называются оба числа и то, как
    // каждое посчитано. Утверждать «потерялись строки» нельзя — разница
    // может идти и от разных путей расчёта при активном фильтре.
    return {
      diff,
      text: `срезы дают ${formatValue(total)}, итог страницы — ${formatValue(reference)}`,
      title: 'Круг сложен из показанных срезов, итог страницы — из общей суммы за тот же период. '
        + 'Пока эти два пути не сведены к одному, за основу берётся итог страницы.',
    };
  }, [reference, total, formatValue]);

  // ── Клики: только раскрытие на месте ──
  const handleSliceClick = useCallback((slice: Slice) => {
    setActiveSliceId(slice.id);
    if (!slice.drillable) return;

    if (slice.id.startsWith('d:') || slice.id.startsWith('e:')) {
      pushScope({ kind: 'dept', deptName: slice.name });
      return;
    }
    if (slice.id.startsWith('m:')) {
      pushScope({ kind: 'method', m: slice.id === 'm:КП' ? 'КП' : 'ЕП' });
      // Показатель переводится в штуки: разбивки денег по способу закупки
      // на этом слое данных нет.
      setDimension('department');
      if (metric !== 'count') setMetric('count');
      return;
    }
    if (slice.id.startsWith('b:')) {
      const b = slice.id === 'b:ФБ' ? 'ФБ' : slice.id === 'b:КБ' ? 'КБ' : 'МБ';
      pushScope({ kind: 'budget', b });
      setDimension('department');
      if (!['plan', 'fact', 'economy'].includes(metric)) setMetric('plan');
    }
  }, [pushScope, metric]);

  // Хлебная крошка — обратный путь
  const crumbs: { label: string; onClick: () => void }[] = useMemo(() => {
    const list: { label: string; onClick: () => void }[] = [{ label: 'Все', onClick: resetAll }];
    scope.forEach((s, i) => list.push({ label: scopeLabel(s), onClick: () => popTo(i + 1) }));
    return list;
  }, [scope, resetAll, popTo]);

  // Показатели, доступные на текущем уровне
  const availableMetrics: Metric[] = useMemo(() => {
    const hasBudget = scopeHasBudget(scope) !== null;
    const hasMethod = scopeHasMethod(scope) !== null;
    if (inDeptComposition) {
      if (hasBudget) return ['plan', 'fact', 'economy'];
      if (hasMethod) return ['count'];
      return ['plan', 'fact', 'economy', 'count'];
    }
    if (dimension === 'procurement') return ['count'];
    if (dimension === 'budget') return ['plan', 'fact', 'economy'];
    if (dimension === 'execution') return ['count'];
    if (hasBudget) return ['plan', 'fact', 'economy'];
    if (hasMethod) return ['count'];
    return ['plan', 'fact', 'economy', 'count'];
  }, [dimension, scope, inDeptComposition]);

  // Показатель мог остаться от прошлого уровня — вернуть в допустимые
  if (!availableMetrics.includes(metric)) {
    queueMicrotask(() => setMetric(availableMetrics[0] ?? 'plan'));
  }

  // Цвет и штриховка ряда: пара, а не один только цвет. Постоянство между
  // уровнями раскрытия несёт цвет (deptColorMap); штриховка различает
  // соседние сектора внутри одного круга и потому идёт по месту в нём.
  const series = useMemo(() => data.map((d, i) => {
    const color = d.color ?? chartColors[i % chartColors.length]!;
    const pattern = getSeriesPattern(i);
    const key = `${patternPrefix}-s${i}`;
    return { key, color, pattern, fill: pattern === 'solid' ? color : `url(#${key})` };
  }), [data, chartColors, patternPrefix]);

  const activeIndex = data.findIndex(d => d.id === activeSliceId);

  /** Выдвинутый сектор. Тень берёт чистый цвет: заливка может быть узором. */
  const renderActiveShape = useCallback((props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    const glow = series.find(s => s.fill === fill)?.color ?? '#71717a';
    return (
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        style={{ filter: `drop-shadow(0 2px 8px ${glow}66)` }}
      />
    );
  }, [series]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5 hover:shadow-lg transition-shadow duration-300">
      <PatternDefs series={series} ink={patternInk} />

      {/* Заголовок + период */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <KBTooltip metric={inDeptComposition ? 'dept_composition' : `pie_${dimension}`}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 truncate">
              {inDeptComposition ? 'Состав управления' : DRILL_DIMENSION_LABELS[dimension]}
            </h3>
          </KBTooltip>
        </div>
        {/* Период ДАННЫХ + честная оговорка про недельный выбор */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
            <Calendar size={10} />
            <span className="tabular-nums">{periodLabel}</span>
          </div>
          {weekNotApplied && (
            <span
              className="text-[9px] leading-tight text-amber-600 dark:text-amber-400 text-right max-w-[13rem]"
              title="Недельный выбор пока не сужает расчёт: агрегаты считаются по кварталам и месяцам. Числа выше — за указанный период, не за неделю."
            >
              неделя {weekLabel} выбрана, но числа за {periodLabel}
            </span>
          )}
        </div>
      </div>

      {/* Хлебная крошка */}
      {crumbs.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap mb-2 text-[10px]">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <div key={i} className="flex items-center gap-1">
                <button
                  onClick={c.onClick}
                  disabled={isLast}
                  className={cn(
                    'px-1.5 py-0.5 rounded-md font-medium transition',
                    isLast
                      ? 'bg-blue-600 text-white cursor-default'
                      : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer'
                  )}
                >
                  {c.label}
                </button>
                {!isLast && <ChevronLeft size={10} className="text-zinc-400 rotate-180" />}
              </div>
            );
          })}
          <button
            onClick={resetAll}
            className="ml-auto flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
            title="Вернуться к общему кругу"
          >
            <X size={10} />
            сбросить
          </button>
        </div>
      )}

      {/* Измерения */}
      {!inDeptComposition && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(Object.keys(DRILL_DIMENSION_LABELS) as DrillDimension[]).map(dim => (
            <button
              key={dim}
              onClick={() => setDimension(dim)}
              className={cn(
                'px-2 py-1 text-[10px] font-medium rounded-full transition',
                dimension === dim
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {DRILL_DIMENSION_LABELS[dim]}
            </button>
          ))}
        </div>
      )}

      {/* ГРБС / Организации */}
      {!inDeptComposition && (dimension === 'department' || dimension === 'execution') && (
        <div className="inline-flex items-center gap-0 mb-2 p-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
          {(Object.keys(VIEW_LEVEL_LABELS) as ViewLevel[]).map(lv => (
            <button
              key={lv}
              onClick={() => setViewLevel(lv)}
              className={cn(
                'px-2.5 py-0.5 text-[10px] font-medium rounded-full transition',
                viewLevel === lv
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              )}
            >
              {VIEW_LEVEL_LABELS[lv]}
            </button>
          ))}
        </div>
      )}

      {/* Показатели */}
      {availableMetrics.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {availableMetrics.map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded-full transition',
                metric === m
                  ? 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
              )}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {/* Круг */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
              cursor="pointer"
              onClick={(d: any) => handleSliceClick(d as Slice)}
              onMouseEnter={(d: any) => setActiveSliceId((d as Slice).id)}
              onMouseLeave={() => setActiveSliceId(null)}
              activeIndex={activeIndex >= 0 ? activeIndex : undefined}
              activeShape={renderActiveShape}
              isAnimationActive={true}
              animationDuration={400}
            >
              {data.map((d, i) => (
                <Cell
                  key={d.id}
                  fill={series[i]?.fill ?? chartColors[i % chartColors.length]}
                  stroke={isDark ? '#18181b' : '#ffffff'}
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, name: string) => [formatValue(v), name]}
              contentStyle={tooltipStyle}
              cursor={cursorStyle}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Центр круга */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[9px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold">
            {centerLabel}
          </span>
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tabular-nums leading-tight">
            {centerValue ?? formatValue(total)}
          </span>
          <span className="text-[9px] text-zinc-400 mt-0.5 text-center px-6">
            {centerSub}
          </span>
        </div>
      </div>

      {/* Что круг изобразить не смог и где он не сошёлся с итогом */}
      {(gap || hidden.count > 0 || note) && (
        <div className="mt-2 space-y-0.5 text-[9px] leading-tight text-center">
          {note && <p className="text-zinc-400 dark:text-zinc-500">{note}</p>}
          {hidden.count > 0 && (
            <p className="text-amber-600 dark:text-amber-400">
              {hidden.count} {pluralRu(hidden.count, 'срез', 'среза', 'срезов')} с отрицательным
              значением ({formatValue(hidden.sum)}) круг не изображает
            </p>
          )}
          {gap && (
            <p className="text-amber-600 dark:text-amber-400" title={gap.title}>
              {gap.text}
            </p>
          )}
        </div>
      )}

      {/* Легенда — синхронна с кругом */}
      <div className="mt-3 space-y-0.5 max-h-28 overflow-y-auto">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const active = activeSliceId === d.id;
          return (
            <button
              key={d.id}
              onClick={() => handleSliceClick(d)}
              onMouseEnter={() => setActiveSliceId(d.id)}
              onMouseLeave={() => setActiveSliceId(null)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition',
                active
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : d.drillable
                    ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                    : ''
              )}
            >
              <SeriesSwatch fill={series[i]?.fill ?? chartColors[i % chartColors.length]!} active={active} />
              <span className="text-[10px] text-zinc-600 dark:text-zinc-300 truncate flex-1">
                {d.name}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                {formatValue(d.value)}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-zinc-400 shrink-0 w-8 text-right">
                {pct.toFixed(0)} %
              </span>
            </button>
          );
        })}
        {data.length === 0 && (
          <div className="text-[10px] text-zinc-400 text-center py-4">
            За выбранный период и фильтры здесь нет ни одной строки
          </div>
        )}
      </div>

      {/* Подсказка по управлению */}
      {!inDeptComposition && data.some(d => d.drillable) && (
        <div className="mt-2 text-[9px] text-zinc-400 text-center">
          клик по срезу = детализация • клик по пути сверху = шаг назад
        </div>
      )}

      {/* Явное действие — не побочный эффект клика по срезу */}
      {inDeptComposition && onDeptToggle && (
        <button
          onClick={() => onDeptToggle(scopeHasDept(scope)!)}
          className="mt-2 w-full text-[10px] font-medium px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
        >
          Применить как глобальный фильтр →
        </button>
      )}
    </div>
  );
}
