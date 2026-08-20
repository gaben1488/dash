import { memo, useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { KBTooltip } from './ui/kb-tooltip';
import {
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Building2,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { quarterLabel, BUDGET_SOURCE_META } from '@aemr/shared';
import { getThresholdColor, getThresholdBg } from '@/lib/metrics-registry';
import { formatPercent, formatMetricValue } from './HeroKPICard';
import { pluralRu } from '@/lib/economy-copy';

// ────────────────────────────────────────────────────────────────
// RatingTableV2 — рейтинг управлений (ГРБС) на Пульте.
//
// Правила, которые держит компонент:
//   • Пустая ячейка означает «нечего исполнять» (плана за период не было),
//     а не «исполнено ноль». Поэтому null не красится в красный и не
//     участвует в сортировке как худшее значение.
//   • Место в списке — это место в ТЕКУЩЕЙ сортировке. Знаки отличия у
//     тройки лидеров показываются только тогда, когда сортировка
//     действительно ранжирует качество работы (по убыванию исполнения или
//     доверия), иначе «золото» доставалось бы управлению с наибольшим
//     числом замечаний.
//   • Всё, что делается мышью, доступно с клавиатуры: раскрытие строки —
//     настоящая кнопка в ячейке наименования.
// ────────────────────────────────────────────────────────────────

/** Подписи кварталов для кривой динамики — канон @aemr/shared, не локальные строки. */
const QUARTER_LABELS = [1, 2, 3, 4].map(quarterLabel);

/** Фраза для пустой ячейки процента: почему числа нет. */
const NO_PLAN_HINT = 'За выбранный период плана нет — исполнять нечего';

/** Полное наименование федерального бюджета — из реестра, а не строкой здесь. */
const FB_FULL = BUDGET_SOURCE_META.fb.label;

/**
 * Согласование «процентный пункт» с числом. При дробном числе существительное
 * стоит в родительном падеже единственного числа («5,3 процентного пункта»),
 * при целом склоняется по общему правилу. Раньше подсказка писала «процентных
 * пункта» при любом значении — форма, которой в русском нет.
 */
function pointsWord(value: number): string {
  return Number.isInteger(value)
    ? pluralRu(value, 'процентный пункт', 'процентных пункта', 'процентных пунктов')
    : 'процентного пункта';
}

export interface DeptRowV2 {
  id: string;
  name: string;
  nameShort: string;
  execAmountPct: number | null;
  execCountPct: number | null;
  fbExecPct?: number | null;
  trustScore: number | null;
  issueCount: number;
  criticalIssueCount: number;
  /**
   * Динамика по кварталам. `null` в точке — «плана за квартал не было»: кривая
   * там рвётся. Ноль вместо null означал бы «исполнено ноль процентов» и тянул
   * бы кривую на дно там, где работы просто не планировалось.
   */
  sparkData?: Array<number | null>;
  deltaQuarter?: number | null;
  subordinates?: SubRow[];
}

export interface SubRow {
  name: string;
  execAmountPct: number | null;
  execCountPct: number | null;
  /**
   * Замечания по подведомственной организации. `null` — «отдельного счёта нет»:
   * проверки ведутся по книге управления целиком и до организации не разложены.
   * Раньше сюда клали ноль, и таблица показывала «замечаний нет» для всех
   * подведов — выдуманное число вместо честной пустоты.
   */
  issueCount: number | null;
  /**
   * Аппарат управления (собственные строки ГРБС). Это не подведомственная
   * организация: в счётчик подведов он не входит и показывается отдельной
   * строкой над списком.
   */
  isSelf?: boolean;
}

type SortKey = 'execCountPct' | 'execAmountPct' | 'fbExecPct' | 'fbPct' | 'trustScore' | 'issueCount';

interface RatingTableV2Props {
  departments: DeptRowV2[];
  showSubordinates?: boolean;
  onDeptClick: (deptId: string) => void;
  onDeptDetail: (deptId: string) => void;
}

/** Знаки отличия для тройки лидеров рейтинга. */
const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold',
  2: 'bg-zinc-200 dark:bg-zinc-600/30 text-zinc-600 dark:text-zinc-300 font-bold',
  3: 'bg-amber-50 dark:bg-amber-800/20 text-amber-600 dark:text-amber-500 font-bold',
};

/** Столбцы, по которым «выше» действительно значит «лучше». */
const MERIT_SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  'execCountPct', 'execAmountPct', 'fbExecPct', 'fbPct', 'trustScore',
]);

/** Человеческое имя столбца сортировки — для подписи под таблицей. */
const SORT_LABELS: Record<SortKey, string> = {
  execCountPct: 'исполнению по количеству',
  execAmountPct: 'исполнению по сумме',
  fbExecPct: 'исполнению федерального бюджета',
  fbPct: 'исполнению федерального бюджета',
  trustScore: 'доверию к данным',
  issueCount: 'числу замечаний',
};

export function RatingTableV2({
  departments,
  showSubordinates = false,
  onDeptClick,
  onDeptDetail,
}: RatingTableV2Props) {
  const [sortKey, setSortKey] = useState<SortKey>('execCountPct');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  /**
   * Обработчики строк держатся неизменными между отрисовками, иначе memo на
   * DeptRowComponent не спасает: новая стрелка на каждый проход — новые пропсы,
   * и React перерисовывает все строки (SIMPLIFY_REGISTER_2026-06-05 §W1).
   * Управление узнаётся по коду, который строка передаёт назад.
   */
  const toggleExpanded = useCallback((deptId: string) => {
    setExpandedDept(prev => (prev === deptId ? null : deptId));
  }, []);

  const sorted = useMemo(
    () =>
      [...departments].sort((a, b) => {
        // Исполнение федерального бюджета: сначала текущее поле, затем прежнее
        // имя — чтобы не сломать вызовы, оставшиеся со старым названием.
        const pick = (d: DeptRowV2): number | null => {
          if (sortKey === 'fbExecPct' || sortKey === 'fbPct') {
            return (d.fbExecPct ?? (d as any).fbPct ?? null) as number | null;
          }
          return (d[sortKey as keyof DeptRowV2] ?? null) as number | null;
        };
        const va = pick(a);
        const vb = pick(b);
        // «Нечего исполнять» — не значение, а его отсутствие: такие управления
        // всегда внизу, в обе стороны сортировки. Прежний фолбэк −1 при
        // сортировке по возрастанию поднимал их наверх как «худших».
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return sortAsc ? va - vb : vb - va;
      }),
    [departments, sortKey, sortAsc],
  );

  // Знаки отличия только когда сортировка ранжирует качество работы.
  const showMedals = !sortAsc && MERIT_SORT_KEYS.has(sortKey);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortHeader = ({
    label,
    field,
    metricKey,
    hint,
    className,
  }: {
    label: string;
    field: SortKey;
    metricKey?: string;
    /** Расшифровка сокращённого заголовка — что за число стоит в столбце. */
    hint?: string;
    className?: string;
  }) => (
    // aria-sort принадлежит заголовку столбца, а не кнопке внутри него:
    // на кнопке этот атрибут диктору не виден и роль столбца не описывает.
    <th
      scope="col"
      aria-sort={sortKey === field ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase select-none',
        className,
      )}
    >
      <KBTooltip metric={metricKey} side="bottom">
        <button
          type="button"
          onClick={() => toggleSort(field)}
          title={hint
            ? `${hint}. Щелчок сортирует по этому столбцу`
            : `Сортировать по столбцу «${label}»`}
          className={cn(
            'inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-[10px] uppercase tracking-wider',
            'text-zinc-500 dark:text-zinc-400 hover:text-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded',
            'transition-colors duration-150 cursor-pointer',
          )}
        >
          {label}
          <ArrowUpDown
            size={10}
            aria-hidden="true"
            className={cn(
              'transition-colors',
              sortKey === field ? 'text-blue-500' : 'opacity-20',
            )}
          />
        </button>
      </KBTooltip>
    </th>
  );

  if (departments.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400 py-6 text-center">
        За выбранный период и набор фильтров ни одно управление в расчёт не попало.
        Снимите часть фильтров или выберите другой период.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-zinc-200/80 dark:border-zinc-700/60">
            {/* Заголовки без сортировки — не кнопки: фокусируемый элемент,
                который ничего не делает, обманывает клавиатуру. */}
            <th scope="col" className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-10">
              <KBTooltip metric="dept_rank" side="bottom">
                <span
                  className="font-semibold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                  title={`Место в текущей сортировке — по ${SORT_LABELS[sortKey]}, ${sortAsc ? 'по возрастанию' : 'по убыванию'}`}
                >
                  Место
                </span>
              </KBTooltip>
            </th>
            <th scope="col" className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase text-left min-w-[80px]">
              <KBTooltip metric="dept_name" side="bottom">
                <abbr
                  title="Главный распорядитель бюджетных средств — управление, ведущее книгу закупок"
                  className="font-semibold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 no-underline"
                >
                  ГРБС
                </abbr>
              </KBTooltip>
            </th>
            <SortHeader label="Кол-во, %" field="execCountPct" metricKey="dept_exec_count_pct"
              hint="Исполнено процентов от запланированного числа процедур" />
            <SortHeader label="Сумма, %" field="execAmountPct" metricKey="dept_exec_amount_pct"
              hint="Исполнено процентов от плановой суммы" />
            <SortHeader label="ФБ, %" field="fbExecPct" metricKey="dept_fb_exec_pct"
              hint={`Исполнено процентов от плана по источнику «${FB_FULL}»`} />
            {/* «Спарк» — калька от sparkline; в интерфейсе стоит русское слово. */}
            <th scope="col" className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase w-20">
              <KBTooltip metric="dept_sparkline" side="bottom">
                <span className="font-semibold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Динамика
                </span>
              </KBTooltip>
            </th>
            <SortHeader label="Доверие" field="trustScore" metricKey="dept_trust"
              hint="Оценка доверия к данным управления, балл из ста" />
            {/* «Замеч.» — обрубок слова; столбец подписан целиком. */}
            <SortHeader label="Замечания" field="issueCount" metricKey="dept_issues"
              hint="Число замечаний проверок, в кружке — критические" />
            <th scope="col" className="px-2 py-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
              <KBTooltip metric="dept_delta_quarter" side="bottom">
                {/* Греческая «дельта» заменена русским сокращением: значок
                    понятен только тому, кто и так знает, что за ним стоит. */}
                <span
                  className="font-semibold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 whitespace-nowrap"
                  title="Изменение исполнения к предыдущему кварталу, в процентных пунктах"
                >
                  Изм. за кв.
                </span>
              </KBTooltip>
            </th>
            <th scope="col" className="px-1 py-3 w-8">
              <span className="sr-only">Переход к подробностям управления</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((dept, i) => (
            <DeptRowComponent
              key={dept.id}
              dept={dept}
              rank={i + 1}
              showMedals={showMedals}
              isExpanded={expandedDept === dept.id}
              showSubordinates={showSubordinates}
              onToggleExpand={toggleExpanded}
              onDeptClick={onDeptClick}
              onDeptDetail={onDeptDetail}
            />
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-2">
        Отсортировано по {SORT_LABELS[sortKey]}, {sortAsc ? 'по возрастанию' : 'по убыванию'}.
        Прочерк в столбце процентов означает, что плана за период не было.
      </p>
    </div>
  );
}

/** Ячейка процента: число, мини-полоса и честная причина, когда числа нет. */
function CellProgress({ value, metricKey }: { value: number | null; metricKey: string }) {
  // Прочерк без объяснения читается как «ноль» или «сломалось». Подсказка
  // называет причину: плана за период не было, исполнять нечего.
  if (value == null) {
    return (
      <span className="text-zinc-300 dark:text-zinc-600" title={NO_PLAN_HINT} aria-label={NO_PLAN_HINT}>
        —
      </span>
    );
  }

  const color = getThresholdColor(metricKey, value);
  const barColor = value >= 90 ? 'bg-emerald-500'
    : value >= 70 ? 'bg-blue-500'
    : value >= 50 ? 'bg-amber-500'
    : 'bg-red-500';
  const barWidth = Math.min(100, Math.max(0, value));

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn('font-bold tabular-nums', color)}>
        {formatPercent(value)}
      </span>
      <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Строка вложенной таблицы: организация (или аппарат), два процента исполнения
 * и число замечаний. Пустое значение не красится в красный и не превращается в
 * ноль: «плана не было» и «исполнено ноль» — разные вещи.
 */
function SubLine({ sub }: { sub: SubRow }) {
  const issuesHint = sub.issueCount == null
    ? 'Замечания ведутся по книге управления целиком — по организациям они не разложены'
    : sub.issueCount === 0
      ? 'Замечаний нет'
      : `Замечаний: ${sub.issueCount}`;

  return (
    <div className="flex items-center gap-4 px-3 py-2 rounded-xl hover:bg-white dark:hover:bg-zinc-800/60 transition-colors text-xs group/sub">
      <span
        className="text-zinc-600 dark:text-zinc-300 flex-1 truncate group-hover/sub:text-zinc-900 dark:group-hover/sub:text-white transition-colors"
        title={sub.name}
      >
        {sub.name}
      </span>
      <span
        className={cn(
          'font-bold tabular-nums w-16 text-right',
          sub.execCountPct != null
            ? getThresholdColor('dept_exec_count_pct', sub.execCountPct)
            : 'text-zinc-300 dark:text-zinc-600',
        )}
        title={sub.execCountPct == null ? NO_PLAN_HINT : undefined}
      >
        {sub.execCountPct != null ? formatPercent(sub.execCountPct) : '—'}
      </span>
      <span
        className={cn(
          'tabular-nums w-16 text-right',
          sub.execAmountPct != null
            ? getThresholdColor('dept_exec_amount_pct', sub.execAmountPct)
            : 'text-zinc-300 dark:text-zinc-600',
        )}
        title={sub.execAmountPct == null ? NO_PLAN_HINT : undefined}
      >
        {sub.execAmountPct != null ? formatPercent(sub.execAmountPct) : '—'}
      </span>
      {/* Ноль замечаний — это факт, его и показываем числом. Прочерк остаётся
          только там, где отдельного счёта по организации вообще нет. */}
      <span
        className={cn(
          'tabular-nums w-10 text-right',
          sub.issueCount == null ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400',
        )}
        title={issuesHint}
        aria-label={`${sub.name}: ${issuesHint}`}
      >
        {sub.issueCount == null ? '—' : formatMetricValue(sub.issueCount)}
      </span>
    </div>
  );
}

/**
 * Строка рейтинга. Обёрнута в memo: управлений два десятка, а внутри строки
 * живёт кривая динамики на recharts — при сортировке или раскрытии соседа
 * перерисовывались все строки разом (SIMPLIFY_REGISTER_2026-06-05 §W1).
 * Обработчики принимают код управления, чтобы таблица могла держать их
 * неизменными и memo действительно срабатывал.
 */
const DeptRowComponent = memo(function DeptRowComponent({
  dept,
  rank,
  showMedals,
  isExpanded,
  showSubordinates,
  onToggleExpand,
  onDeptClick,
  onDeptDetail,
}: {
  dept: DeptRowV2;
  rank: number;
  showMedals: boolean;
  isExpanded: boolean;
  showSubordinates: boolean;
  onToggleExpand: (deptId: string) => void;
  onDeptClick: (deptId: string) => void;
  onDeptDetail: (deptId: string) => void;
}) {
  const hasTrust = dept.trustScore != null;
  const trustColor = getThresholdColor('dept_trust', dept.trustScore ?? 0);
  const trustBg = getThresholdBg('dept_trust', dept.trustScore ?? 0);

  // Кривая динамики. Направление считается по первой и последней ИЗВЕСТНЫМ
  // точкам: раньше сравнивались концы массива, а квартал без плана приходил
  // нулём — управление без плана в четвёртом квартале выглядело падающим.
  const sparkKnown = dept.sparkData?.filter((v): v is number => v != null) ?? [];
  const sparkTrend = sparkKnown.length >= 2
    ? sparkKnown[sparkKnown.length - 1] >= sparkKnown[0] ? 'up' : 'down'
    : 'stable';
  const sparkColor = sparkTrend === 'down' ? '#f87171' : sparkTrend === 'up' ? '#34d399' : '#94a3b8';
  // Кривая без подписей — немая картинка. Расшифровка идёт в подсказку, и
  // квартал без плана называется словами, а не изображается провалом.
  const sparkHint = dept.sparkData
    ? `Исполнение по кварталам — ${dept.sparkData
        .map((v, i) => {
          const point = QUARTER_LABELS[i] ?? `точка ${i + 1}`;
          return v == null ? `${point}: плана нет` : `${point}: ${formatPercent(v)}`;
        })
        .join(', ')}`
    : '';

  // Изменение к предыдущему кварталу
  const deltaColor = dept.deltaQuarter == null
    ? 'text-zinc-300 dark:text-zinc-600'
    : dept.deltaQuarter > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : dept.deltaQuarter < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-zinc-400';

  const rankStyle = (showMedals && RANK_STYLES[rank]) || 'text-zinc-400 dark:text-zinc-500';
  // Аппарат управления — отдельное слагаемое, не подведомственная организация:
  // ни в счётчик подведов, ни в их список он не входит. Раньше признак искали
  // по сырому имени строки, а страница присылала аппарат под русской подписью —
  // фильтр не срабатывал, и счётчик «Подведомственные организации» завышался
  // ровно на единицу у каждого управления.
  const orgSelfRow = dept.subordinates?.find(s => s.isSelf) ?? null;
  const realSubs = dept.subordinates?.filter(s => !s.isSelf) ?? [];
  const hasSubs = realSubs.length > 0;
  // Список не пришёл вовсе — это не то же самое, что «подведомственных
  // организаций нет»: причины разные, и фразы тоже.
  const subsNotLoaded = dept.subordinates == null;

  return (
    <>
      <tr
        className={cn(
          'border-b border-zinc-100 dark:border-zinc-800/50 cursor-pointer transition-all duration-200 group',
          'hover:bg-blue-50/40 dark:hover:bg-blue-950/10',
          isExpanded && 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/30 dark:border-blue-800/30',
        )}
        onClick={() => {
          onDeptClick(dept.id);
          onToggleExpand(dept.id);
        }}
      >
        {/* Место в текущей сортировке */}
        <td className="px-2 py-3 text-center">
          <span className={cn(
            'inline-flex w-6 h-6 items-center justify-center rounded-lg text-[10px] tabular-nums',
            rankStyle,
          )}>
            {rank}
          </span>
        </td>

        {/* Наименование управления — настоящая кнопка: раскрытие строки должно
            работать и с клавиатуры, а не только по клику мышью по <tr>. */}
        <td className="px-2 py-3 font-semibold text-zinc-700 dark:text-zinc-200">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeptClick(dept.id);
              onToggleExpand(dept.id);
            }}
            aria-expanded={isExpanded}
            title={`${dept.name} — раскрыть подробности и отфильтровать страницу по этому управлению`}
            className="flex items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {(showSubordinates || hasSubs) && (
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={cn(
                  'text-zinc-400 transition-transform duration-200 shrink-0',
                  isExpanded ? 'rotate-0' : '-rotate-90',
                )}
              />
            )}
            <span className="group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {dept.nameShort}
            </span>
          </button>
        </td>

        {/* Исполнение по количеству процедур */}
        <td className="px-2 py-3 text-center w-20">
          <CellProgress value={dept.execCountPct} metricKey="dept_exec_count_pct" />
        </td>

        {/* Исполнение по сумме */}
        <td className="px-2 py-3 text-center w-20">
          <CellProgress value={dept.execAmountPct} metricKey="dept_exec_amount_pct" />
        </td>

        {/* Исполнение федерального бюджета. Ключ порогов — `dept_fb_pct`: под
            ключом подсказки (`dept_fb_exec_pct`) реестр порогов ничего не знает,
            и столбец оставался серым, пока соседние красились по норме. */}
        <td className="px-2 py-3 text-center w-16">
          <CellProgress value={dept.fbExecPct ?? null} metricKey="dept_fb_pct" />
        </td>

        {/* Динамика по кварталам */}
        <td className="px-1 py-1">
          {sparkKnown.length >= 2 ? (
            <div
              className="w-16 h-6 opacity-70 group-hover:opacity-100 transition-opacity"
              role="img"
              title={sparkHint}
              aria-label={sparkHint}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={(dept.sparkData ?? []).map((v, i) => ({ v, i }))}>
                  <defs>
                    <linearGradient id={`sp-${dept.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {/* Квартал без плана — разрыв кривой, а не отрезок сквозь него. */}
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={sparkColor}
                    strokeWidth={1.5}
                    fill={`url(#sp-${dept.id})`}
                    dot={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <span
              className="text-zinc-200 dark:text-zinc-700"
              title="Плановые кварталы известны меньше чем за два — кривую строить не из чего"
              aria-label="Плановые кварталы известны меньше чем за два — кривую строить не из чего"
            >
              —
            </span>
          )}
        </td>

        {/* Доверие к данным */}
        <td className="px-2 py-3 text-center">
          <span
            className={cn(
              'inline-block px-2 py-0.5 rounded-md text-[10px] font-bold',
              hasTrust ? trustBg : 'bg-zinc-500/10',
              hasTrust ? trustColor : 'text-zinc-400 dark:text-zinc-500',
            )}
            title={hasTrust
              ? `Доверие к данным управления: ${formatMetricValue(dept.trustScore as number)} из 100`
              : 'Оценка доверия ещё не рассчитана для этого управления'}
          >
            {dept.trustScore != null ? formatMetricValue(dept.trustScore) : '—'}
          </span>
        </td>

        {/* Замечания */}
        <td className="px-2 py-3 text-center tabular-nums">
          <div
            className="flex items-center justify-center gap-1"
            title={dept.criticalIssueCount > 0
              ? `Всего замечаний: ${dept.issueCount}, из них критических: ${dept.criticalIssueCount}`
              : `Всего замечаний: ${dept.issueCount}`}
          >
            {dept.criticalIssueCount > 0 && (
              // `w-4.5`/`h-4.5` в шкале Tailwind нет — классы молча не
              // применялись, и кружок критических замечаний расплывался по
              // содержимому. Размер задан явно, с запасом на двузначное число.
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold">
                {dept.criticalIssueCount}
              </span>
            )}
            <span className="text-zinc-400">{dept.issueCount}</span>
          </div>
        </td>

        {/* Изменение к предыдущему кварталу */}
        <td className={cn('px-2 py-3 text-center tabular-nums text-xs font-medium', deltaColor)}>
          {dept.deltaQuarter != null ? (
            <span
              className="flex items-center justify-center gap-0.5"
              title={`Изменение исполнения к предыдущему кварталу: ${dept.deltaQuarter > 0 ? '+' : ''}${formatMetricValue(dept.deltaQuarter)} ${pointsWord(Math.abs(dept.deltaQuarter))}`}
            >
              {dept.deltaQuarter > 0 ? (
                <TrendingUp size={10} aria-hidden="true" />
              ) : dept.deltaQuarter < 0 ? (
                <TrendingDown size={10} aria-hidden="true" />
              ) : (
                <Minus size={10} aria-hidden="true" />
              )}
              {dept.deltaQuarter > 0 ? '+' : ''}
              {formatMetricValue(dept.deltaQuarter)}&nbsp;п.п.
            </span>
          ) : (
            <span title="Не с чем сравнивать: за предыдущий квартал плана не было">—</span>
          )}
        </td>

        {/* Переход к подробностям управления */}
        <td className="px-1 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeptDetail(dept.id);
            }}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            title={`Открыть реестр строк управления «${dept.nameShort}»`}
            aria-label={`Открыть реестр строк управления «${dept.nameShort}»`}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </td>
      </tr>

      {/* Раскрытая строка: аппарат управления и подведомственные организации */}
      {isExpanded && (
        <tr>
          <td colSpan={10} className="p-0">
            <div className="bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-800/40 dark:to-zinc-900 border-t border-b border-zinc-200/60 dark:border-zinc-700/30 px-6 py-4 animate-in slide-in-from-top-1 duration-200">
              {/* Аппарат — собственные строки управления. Он не подвед и стоит
                  над списком отдельно, иначе счётчик организаций врёт. */}
              {orgSelfRow && (
                <div className="space-y-1 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 size={13} className="text-zinc-400" aria-hidden="true" />
                    <h4 className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Собственные закупки управления
                    </h4>
                  </div>
                  <SubLine sub={orgSelfRow} />
                </div>
              )}

              {hasSubs ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={13} className="text-zinc-400" aria-hidden="true" />
                    <h4 className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Подведомственные организации
                    </h4>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-bold"
                      title={`${realSubs.length} ${pluralRu(realSubs.length, 'организация', 'организации', 'организаций')} в расчёте; аппарат управления сюда не входит`}
                    >
                      {realSubs.length}
                    </span>
                  </div>

                  {/* Заголовки вложенной таблицы */}
                  <div className="flex items-center gap-4 px-3 py-1 text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    <span className="flex-1">Организация</span>
                    <span className="w-16 text-right" title="Исполнено процентов от запланированного числа процедур">Кол-во, %</span>
                    <span className="w-16 text-right" title="Исполнено процентов от плановой суммы">Сумма, %</span>
                    <span className="w-10 text-right" title="Замечания проверок">Замечания</span>
                  </div>

                  <div className="grid gap-0.5">
                    {realSubs.map((sub, i) => (
                      <SubLine key={`${sub.name}-${i}`} sub={sub} />
                    ))}
                  </div>
                </div>
              ) : (
                // Две разные причины пустоты — две разные фразы. «Ничего нет»
                // без причины оставляет пользователя гадать, сломалось или так и надо.
                <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400 py-2">
                  <Building2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {subsNotLoaded
                      ? 'Список подведомственных организаций ещё не загружен — выберите управление в шапке, чтобы страница подтянула детализацию.'
                      : 'У этого управления подведомственных организаций в реестре нет: все закупки ведёт аппарат.'}
                  </span>
                </div>
              )}

              {/* Переход к построчному реестру управления */}
              <div className="mt-3 pt-3 border-t border-zinc-200/40 dark:border-zinc-700/30 flex justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeptDetail(dept.id);
                  }}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  Открыть реестр строк
                  <ExternalLink size={11} aria-hidden="true" />
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});
