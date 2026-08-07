import { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { BUDGET_SOURCE_META } from '@aemr/shared';
import { cn } from '@/lib/utils';
import { KBTooltip } from './ui/kb-tooltip';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Area, AreaChart } from 'recharts';

// ────────────────────────────────────────────────────────────────
// HeroKPICard — плитка ключевого показателя Пульта.
//
// Правила, которые держит компонент:
//   • Клик разворачивает подробности на месте, а не уводит на другую страницу.
//   • Число объяснимо: подпись, подсказка базы знаний, динамика по кварталам.
//   • Нулевой знаменатель — это НЕ ноль процентов. Когда считать не из чего,
//     вместо цифры показывается причина (`emptyReason`), иначе интерфейс
//     врёт «0 %» там, где плана просто не было. Причина сильнее любого
//     оформления: даже двоичная плитка доверия не имеет права нарисовать
//     вердикт «Требует проверки», если оценки вообще не считали.
//   • Никакой латиницы в видимом тексте (закон продукта, дефект Д12).
// ────────────────────────────────────────────────────────────────

// ── Единственный дом числового формата плиток и таблиц Пульта ──
// Раньше часть чисел шла через toFixed («62.0%»), часть — через
// toLocaleString («5,3»), и на одной карточке встречались обе записи. В
// русском тексте разделитель — запятая, а перед знаком процента стоит
// неразрывный пробел, иначе «%» переносится на новую строку отдельно.
const NF_ONE = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF_INT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
/** Неразрывный пробел: знак единицы не отрывается от числа при переносе строки. */
const NBSP = ' ';

/** «62,4 %» — процент с одним знаком и неразрывным пробелом. */
export function formatPercent(value: number): string {
  return `${NF_ONE.format(value)}${NBSP}%`;
}

/** Значение с единицей: проценты — с десятыми, счётные величины — целыми. */
export function formatMetricValue(value: number, unit?: string): string {
  if (unit === '%') return formatPercent(value);
  const num = Number.isInteger(value) ? NF_INT.format(value) : NF_ONE.format(value);
  return unit ? `${num}${NBSP}${unit}` : num;
}

export interface HeroKPICardProps {
  metricKey: string;
  label: string;
  value: number;
  displayValue?: string;
  // Латинское «binary» из перечня единиц убрано: единица подписывается рядом с
  // числом, и слово «binary» однажды доехало бы до глаз пользователя. Признак
  // двоичной плитки живёт в `isTrust`/`metricKey`, где ему и место.
  unit?: '%' | 'шт.' | '₽' | 'тыс. ₽' | 'млн ₽';
  status?: 'normal' | 'warning' | 'critical';
  trend?: 'up' | 'down' | 'stable';
  /** Готовая подпись изменения. Если не задана, собирается из `deltaValue`. */
  delta?: string;
  /** Изменение числом; знак «плюс» означает рост. Единица берётся из `unit`. */
  deltaValue?: number;
  /** Для показателей, где меньше — лучше (число критических замечаний). */
  invertDelta?: boolean;
  /**
   * Динамика по кварталам: ровно четыре точки (1 кв … 4 кв).
   * `null` в точке означает «плана за квартал не было» — это не ноль
   * процентов: кривая в таком месте рвётся, а не падает на дно.
   */
  sparkData?: Array<number | null>;
  /**
   * Подписи точек динамики («1 кв» … «4 кв»). Нужны, чтобы кривая не была
   * немой картинкой: из них строится текстовое описание для наведения мышью
   * и для чтения с клавиатуры (критерий «каждое число объяснимо»).
   */
  sparkLabels?: string[];
  /**
   * Причина отсутствия числа: «нет плана за период», «книга не прочитана».
   * Когда задана — вместо цифры показывается эта фраза. Пустой знаменатель
   * не имеет права выглядеть как достигнутый ноль.
   */
  emptyReason?: string;
  /** То же для дополнительного показателя плитки. */
  secondaryEmptyReason?: string;
  sourceCell?: string;
  origin?: 'official' | 'calculated' | string;
  /** Плитка-вердикт «Норма / Требует проверки». Также включается по `metricKey`. */
  isTrust?: boolean;
  /** Итог проверки. Если не задан и балл известен, считается порогом 75 из 100. */
  trustOk?: boolean;
  secondaryValue?: number;
  secondaryLabel?: string;
  secondaryUnit?: '%' | 'шт.' | '₽' | 'тыс. ₽' | 'млн ₽';
  secondaryMetricKey?: string;
  secondaryTrend?: 'up' | 'down' | 'stable';
  secondarySparkData?: Array<number | null>;
  expandContent?: () => React.ReactNode;
  expanded?: boolean;
  onToggleExpand?: () => void;
  id?: string;
}

/**
 * Оформление плитки по состоянию показателя.
 * Поля `badge`/`badgeText` с латинским «OK» удалены: они не рисовались ни разу
 * (мёртвый код) и нарушали запрет на латиницу в видимом тексте.
 */
const STATUS_CONFIG = {
  normal: {
    border: 'border-zinc-200/80 dark:border-zinc-800/80',
    glow: '',
    accent: 'bg-emerald-500',
    bgGradient: '',
    /** Словесный дубль цветного индикатора — для чтения без цвета. */
    statusWord: 'в норме',
  },
  warning: {
    border: 'border-amber-200/60 dark:border-amber-700/40',
    glow: 'shadow-amber-500/5',
    accent: 'bg-amber-500',
    bgGradient: 'bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10 dark:to-transparent',
    statusWord: 'требует внимания',
  },
  critical: {
    border: 'border-red-200/60 dark:border-red-700/40',
    glow: 'shadow-red-500/5',
    accent: 'bg-red-500',
    bgGradient: 'bg-gradient-to-br from-red-50/40 to-transparent dark:from-red-950/10 dark:to-transparent',
    statusWord: 'критично',
  },
};

/**
 * Единый дом подписи точек динамики: «1 кв: 62,0 %, 2 кв: плана нет».
 * Квартал без плана называется словами — иначе разрыв кривой читается как
 * провал до нуля.
 */
function describeSpark(values: Array<number | null>, labels: string[] | undefined, unit?: string): string {
  return values
    .map((v, i) => {
      const point = labels?.[i] ?? `точка ${i + 1}`;
      return v == null ? `${point}: плана нет` : `${point}: ${formatMetricValue(v, unit)}`;
    })
    .join(', ');
}

/** Индекс последней известной точки — к ней рисуется метка конца кривой. */
function lastKnownIndex(values: Array<number | null>): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}

export function HeroKPICard({
  metricKey,
  label,
  value,
  displayValue,
  unit,
  status = 'normal',
  trend,
  delta,
  deltaValue,
  invertDelta = false,
  sparkData,
  sparkLabels,
  emptyReason,
  secondaryEmptyReason,
  sourceCell,
  origin,
  isTrust,
  trustOk,
  secondaryValue,
  secondaryLabel,
  secondaryUnit,
  secondaryTrend,
  secondarySparkData,
  expandContent,
  expanded: controlledExpanded,
  onToggleExpand,
}: HeroKPICardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? internalExpanded;
  const toggleExpand = onToggleExpand ?? (() => setInternalExpanded(v => !v));

  const config = STATUS_CONFIG[status];
  // Идентификатор панели нужен, чтобы связать кнопку и раскрытый блок для
  // экранного диктора (aria-controls). Ключ метрики уникален в пределах ряда.
  const panelId = `kpi-panel-${metricKey}`;
  // Градиенты заливки живут в <defs> внутри карточки. Идентификаторы обязаны
  // быть уникальными на страницу: раньше все плитки объявляли один и тот же
  // `sparkGreenGrad`, и браузер брал заливку первой встреченной карточки.
  const gradId = (tone: string) => `spark-${tone}-${metricKey}`;

  // ── Плитка-вердикт «Норма / Требует проверки» ──────────────────
  // Признак берётся из `isTrust` либо из ключа метрики. Вердикт рисуется
  // ТОЛЬКО когда причины пустоты нет: непосчитанная оценка — это не
  // проваленная проверка (см. порядок ветвей ниже).
  const isBinaryTrust = isTrust === true || metricKey === 'trust_binary';
  const resolvedTrustOk = trustOk ?? (typeof value === 'number' ? value >= 75 : true);

  // ── Значок изменения за неделю ─────────────────────────────────
  // Без числа значок молча не рисуется. Цвет кодирует «лучше/хуже», а не знак:
  // для замечаний убывание — это улучшение (invertDelta).
  const hasDelta = deltaValue != null && Number.isFinite(deltaValue);
  const deltaIsZero = hasDelta && deltaValue === 0;
  const deltaIsPositive = hasDelta && (deltaValue as number) > 0;
  // «Лучше» — это улучшение: по умолчанию рост, а для числа замечаний убыль.
  const deltaIsGood = hasDelta
    ? (invertDelta ? (deltaValue as number) < 0 : (deltaValue as number) > 0)
    : false;
  const deltaColor = !hasDelta || deltaIsZero
    ? 'text-zinc-400 dark:text-zinc-500'
    : deltaIsGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  const deltaBg = !hasDelta || deltaIsZero
    ? 'bg-zinc-100 dark:bg-zinc-800'
    : deltaIsGood
      ? 'bg-emerald-50 dark:bg-emerald-500/10'
      : 'bg-red-50 dark:bg-red-500/10';
  // Подпись по умолчанию: «+1,2 п.п.» / «−3,0 п.п.».
  // Латинское «pp» заменено русским «п.п.» — сокращение «процентных пункта».
  const deltaUnitSuffix = unit === '%' ? 'п.п.' : unit ?? '';
  const autoDeltaText = hasDelta
    ? `${deltaIsPositive ? '+' : ''}${(deltaValue as number).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${deltaUnitSuffix ? ' ' + deltaUnitSuffix : ''}`
    : '';
  const deltaLabel = delta ?? autoDeltaText;
  // Значок показывает направление, цвет — оценку; смысл не держится на одном цвете.
  const DeltaIcon = deltaIsZero ? Minus : deltaIsPositive ? TrendingUp : TrendingDown;

  // ── Кривая динамики: договор на четыре квартала ────────────────
  // Кривую строим только когда известны хотя бы две точки: из одной точки
  // динамики не бывает, а рисованная «линия» из неё вводит в заблуждение.
  const sparkLen = sparkData?.length ?? 0;
  const sparkKnownCount = sparkData?.filter((v) => v != null).length ?? 0;
  const showSparkline = !!sparkData && sparkKnownCount >= 2 && !isBinaryTrust;
  const sparkLastIdx = sparkData ? lastKnownIndex(sparkData) : -1;
  // Предупреждение только в разработке, чтобы не засорять консоль на проде.
  // `as any` на import.meta — ради переносимости настроек сборки.
  if (
    (import.meta as any)?.env?.DEV &&
    sparkData &&
    sparkLen > 0 &&
    sparkLen < 4
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[HeroKPICard] sparkData for "${metricKey}" has ${sparkLen} points; expected 4 quarterly buckets.`,
    );
  }

  // Цвета кривой динамики
  const sparkColor = trend === 'down' ? '#f87171' : trend === 'up' ? '#34d399' : '#94a3b8';
  const sparkFill = trend === 'down'
    ? `url(#${gradId('red')})`
    : trend === 'up'
      ? `url(#${gradId('green')})`
      : `url(#${gradId('gray')})`;
  // Текстовое описание кривой — чтобы динамика читалась мышью и диктором,
  // а не оставалась немой картинкой без единой подписи.
  const sparkDescription = sparkData ? describeSpark(sparkData, sparkLabels, unit) : '';

  return (
    <div className="flex flex-col">
      {/* Сама плитка */}
      <KBTooltip metric={metricKey}>
        <button
          type="button"
          onClick={toggleExpand}
          aria-expanded={expandContent ? isExpanded : undefined}
          aria-controls={expandContent ? panelId : undefined}
          className={cn(
            'w-full text-left rounded-2xl border bg-white dark:bg-zinc-900 transition-all duration-300 group relative overflow-hidden',
            config.border,
            config.bgGradient,
            'hover:shadow-xl hover:shadow-zinc-900/5 dark:hover:shadow-black/20',
            'hover:scale-[1.01] active:scale-[0.995]',
            'hover:border-blue-300/60 dark:hover:border-blue-600/40',
            // Плитка — кнопка, и с клавиатуры до неё доходят. Без видимой рамки
            // фокуса идущий по табуляции не понимал, на какой плитке стоит.
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900',
            isExpanded && 'ring-2 ring-blue-500/20 border-blue-300/60 dark:border-blue-600/40 shadow-xl shadow-blue-500/5',
            config.glow,
          )}
        >
          {/* Цветная полоска состояния по верхнему краю */}
          <div className={cn('absolute top-0 left-4 right-4 h-[2px] rounded-b-full opacity-60', config.accent)} />

          <div className="p-4 pt-5">
            {/* Строка заголовка: подпись показателя и точка состояния */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 leading-tight">
                {label}
              </span>
              <div className="flex items-center gap-1.5">
                {/* Индикатор состояния: цвет плюс словесный дубль в подсказке
                    и для диктора — цвет не должен быть единственным носителем
                    смысла. */}
                <span
                  role="img"
                  aria-label={`Состояние: ${config.statusWord}`}
                  title={`Состояние: ${config.statusWord}`}
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    status === 'normal' && 'bg-emerald-500',
                    status === 'warning' && 'bg-amber-500 animate-pulse',
                    status === 'critical' && 'bg-red-500 animate-pulse',
                  )}
                />
              </div>
            </div>

            {/* Строка значения */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                {emptyReason ? (
                  // Причина пустоты проверяется ПЕРВОЙ — раньше вердикта доверия.
                  // Прежний порядок ветвей давал непосчитанной оценке красный
                  // ярлык «Требует проверки»: балл отсутствовал, приводился к
                  // нулю, ноль не дотягивал до порога 75 — и интерфейс выдавал
                  // приговор там, где проверка вообще не отрабатывала.
                  <p className="text-sm font-semibold text-zinc-400 dark:text-zinc-500 leading-snug">
                    {emptyReason}
                  </p>
                ) : isBinaryTrust ? (
                  // ── Двоичный вердикт доверия ──────────────────
                  // Вместо балла — ярлык «Норма» (от 75 из 100) либо
                  // «Требует проверки»; сам балл идёт мелкой подписью рядом.
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-bold leading-none',
                        'ring-1 tabular-nums',
                        resolvedTrustOk
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30'
                          : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30',
                      )}
                      role="status"
                      aria-label={resolvedTrustOk ? 'Норма' : 'Требует проверки'}
                    >
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          resolvedTrustOk ? 'bg-emerald-500' : 'bg-red-500 animate-pulse',
                        )}
                        aria-hidden="true"
                      />
                      {resolvedTrustOk ? 'Норма' : 'Требует проверки'}
                    </span>
                    {typeof value === 'number' && value > 0 && (
                      // Латинское «Score» заменено русской подписью (дефект Д12).
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {formatMetricValue(value)} из 100
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold text-zinc-900 dark:text-white tabular-nums leading-none tracking-tight">
                        {displayValue ?? (
                          // Локаль задана явно: без неё разделитель дробной части
                          // зависел бы от настроек браузера, и на одной странице
                          // соседствовали бы «62,4» и «62.4».
                          <NumberFlow
                            value={value}
                            locales="ru-RU"
                            format={{ maximumFractionDigits: 1 }}
                            transformTiming={{ duration: 600, easing: 'ease-out' }}
                          />
                        )}
                      </span>
                      {unit && (
                        <span className="text-sm text-zinc-400 dark:text-zinc-500 font-medium mb-0.5">
                          {unit}
                        </span>
                      )}
                    </div>
                    {/* Направление и изменение за неделю */}
                    <div className="flex items-center gap-2 mt-1.5">
                      {trend && (
                        <span className={cn(
                          'flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                          trend === 'up' && 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          trend === 'down' && 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
                          trend === 'stable' && 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400',
                        )}>
                          {trend === 'up' && <TrendingUp size={10} />}
                          {trend === 'down' && <TrendingDown size={10} />}
                          {trend === 'stable' && <Minus size={8} />}
                          {trend === 'up' ? 'Рост' : trend === 'down' ? 'Падение' : 'Стабильно'}
                        </span>
                      )}
                      {/* Изменение за неделю. Числа нет — значка нет, без «—». */}
                      {hasDelta && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums',
                            deltaBg,
                            deltaColor,
                          )}
                          title={`Изменение за неделю: ${deltaLabel}`}
                          aria-label={`Изменение за неделю: ${deltaLabel}`}
                        >
                          <DeltaIcon size={10} aria-hidden="true" />
                          {/* Греческая «дельта» заменена русским сокращением:
                              символ читается только теми, кто и так в теме. */}
                          Изм. {deltaLabel}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Кривая по четырём кварталам. Данных нет — кривой нет, без «—». */}
              {showSparkline && sparkData && (
                <div
                  className="w-20 h-10 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                  role="img"
                  title={`Динамика по кварталам — ${sparkDescription}`}
                  aria-label={`Динамика по кварталам: ${sparkDescription}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparkData.map((v, i) => ({ v, i }))}>
                      <defs>
                        <linearGradient id={gradId('green')} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id={gradId('red')} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id={gradId('gray')} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      {/* connectNulls выключен намеренно: квартал без плана —
                          разрыв кривой, а не отрезок между соседями. */}
                      <Area
                        type="monotone"
                        dataKey="v"
                        stroke={sparkColor}
                        strokeWidth={1.5}
                        fill={sparkFill}
                        dot={false}
                        activeDot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      {sparkLastIdx >= 0 && (
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke="transparent"
                          strokeWidth={0}
                          connectNulls={false}
                          dot={(props: any) => {
                            // Метка ставится на последнюю ИЗВЕСТНУЮ точку: если
                            // последний квартал без плана, точки там нет вовсе.
                            if (props?.index !== sparkLastIdx) return (<g key={props?.index} />) as any;
                            return (
                              <circle
                                key={`spark-dot-${props.index}`}
                                cx={props.cx}
                                cy={props.cy}
                                r={2}
                                fill={sparkColor}
                                stroke="#ffffff"
                                strokeWidth={1}
                              />
                            ) as any;
                          }}
                          activeDot={false}
                          isAnimationActive={false}
                          legendType="none"
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Дополнительный показатель плитки (двойная метрика) */}
            {(secondaryValue != null || secondaryEmptyReason) && !isBinaryTrust && (
              <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">
                    {secondaryLabel ?? 'Дополнительно'}
                  </span>
                  <div className="flex items-center gap-2">
                    {secondaryEmptyReason ? (
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {secondaryEmptyReason}
                      </span>
                    ) : (
                      <>
                        <span className="text-lg font-bold text-zinc-600 dark:text-zinc-300 tabular-nums">
                          <NumberFlow
                            value={secondaryValue as number}
                            locales="ru-RU"
                            format={{ maximumFractionDigits: 1 }}
                            transformTiming={{ duration: 600, easing: 'ease-out' }}
                          />
                        </span>
                        {secondaryUnit && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                            {secondaryUnit}
                          </span>
                        )}
                        {secondaryTrend === 'up' && <TrendingUp size={12} className="text-emerald-500" aria-label="Рост" />}
                        {secondaryTrend === 'down' && <TrendingDown size={12} className="text-red-500" aria-label="Падение" />}
                        {secondaryTrend === 'stable' && <Minus size={10} className="text-zinc-400" aria-label="Стабильно" />}
                      </>
                    )}
                  </div>
                </div>

                {/* Наложение двух кривых: основной показатель и дополнительный.
                    Обе строятся только когда у каждой есть хотя бы две известные
                    точки — иначе рисовать нечего, а не «ноль». */}
                {!secondaryEmptyReason && secondarySparkData && sparkData
                  && secondarySparkData.filter((v) => v != null).length >= 2
                  && sparkKnownCount >= 2 && (
                  <div
                    className="mt-2 h-6 -mx-1"
                    role="img"
                    title={`Динамика «${secondaryLabel ?? 'дополнительно'}» — ${describeSpark(secondarySparkData, sparkLabels, secondaryUnit)}`}
                    aria-label={`Динамика «${secondaryLabel ?? 'дополнительно'}»: ${describeSpark(secondarySparkData, sparkLabels, secondaryUnit)}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sparkData.map((v, i) => ({
                        v,
                        s: secondarySparkData?.[i] ?? null,
                        i,
                      }))}>
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={sparkColor}
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="s"
                          stroke="#d6bf85"
                          strokeWidth={1}
                          strokeDasharray="4 2"
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Указатель раскрытия */}
          {expandContent && (
            <div className={cn(
              'absolute bottom-2.5 right-3 w-5 h-5 rounded-full flex items-center justify-center',
              'bg-zinc-100 dark:bg-zinc-800 transition-all duration-200',
              'group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30',
              isExpanded && 'bg-blue-50 dark:bg-blue-900/30',
            )}>
              <ChevronDown
                size={12}
                className={cn(
                  'text-zinc-400 dark:text-zinc-500 transition-transform duration-300',
                  isExpanded && 'rotate-180 text-blue-500',
                  'group-hover:text-blue-500',
                )}
              />
            </div>
          )}

          {/* Происхождение числа: адрес ячейки официального листа при наведении.
              Условие сужено до `sourceCell` — при одном лишь `origin` рисовался
              пустой блок. Адрес ячейки («K1481») — единственная допустимая
              форма упоминания буквы колонки. */}
          {sourceCell && (
            <div
              className="absolute top-3 right-10 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono text-zinc-400 dark:text-zinc-600"
              title={origin === 'official' ? `Официальный лист, ячейка ${sourceCell}` : `Ячейка источника ${sourceCell}`}
            >
              {sourceCell}
            </div>
          )}
        </button>
      </KBTooltip>

      {/* Подробности разворачиваются здесь же, без перехода на другую страницу */}
      {isExpanded && expandContent && (
        <div
          id={panelId}
          role="region"
          aria-label={`Подробности показателя «${label}»`}
          className={cn(
            'mt-1.5 rounded-2xl border border-blue-200/60 dark:border-blue-700/40',
            'bg-white dark:bg-zinc-900 shadow-lg shadow-blue-500/5 p-5',
            'animate-in slide-in-from-top-2 fade-in-0 duration-200',
          )}
        >
          {expandContent()}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Составные части раскрытой панели показателя
// ────────────────────────────────────────────────────────────────

interface DeptBreakdownProps {
  departments: Array<{
    id: string;
    name: string;
    /** null — считать не из чего (нулевой знаменатель), а не «ноль процентов». */
    value: number | null;
    secondaryValue?: number | null;
    color?: string;
    secondaryColor?: string;
  }>;
  unit?: string;
  secondaryUnit?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** Чем заменить число, когда его нет. По умолчанию — «нет плана». */
  emptyLabel?: string;
  /**
   * К чему приводить длину полосы. Задаётся, когда у показателя есть своя
   * природная граница (балл доверия — сто), но он не процент. Без этого
   * полоса мерялась бы лучшим управлением, и балл 40 из 100 у лидера
   * выглядел бы как заполненная до края шкала.
   */
  scaleTo?: number;
  onDeptClick?: (deptId: string) => void;
}

/** Разбивка по управлениям — горизонтальные полосы с подписью значения. */
export function DeptBreakdown({
  departments,
  unit = '%',
  secondaryUnit,
  primaryLabel,
  secondaryLabel,
  emptyLabel = 'нет плана',
  scaleTo,
  onDeptClick,
}: DeptBreakdownProps) {
  // Шкала полосы. Для процентов отсчёт идёт от ста, а не от лучшего управления:
  // раньше полоса лидера всегда доходила до края, и «исполнено 34 %» выглядело
  // как выполненный до конца план. Для счётных величин точки отсчёта нет —
  // масштабируем по наибольшему значению.
  const isPercent = unit === '%';
  const observedMax = Math.max(...departments.map(d => d.value ?? 0), 0);
  const scaleMax = scaleTo != null
    ? Math.max(scaleTo, observedMax)
    : isPercent ? Math.max(100, observedMax) : Math.max(observedMax, 1);
  // Пороги «зелёный — жёлтый — красный» осмысленны там, где шкала известна
  // заранее: проценты исполнения и балл из ста. Для счётных величин шкалы нет.
  const hasRatedScale = isPercent || scaleTo != null;

  if (departments.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">
        За выбранный период и фильтры управлений в расчёте нет — снимите часть фильтров.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {secondaryLabel && (
        <div className="flex items-center justify-end gap-4 text-[9px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1 pr-1">
          <span>{primaryLabel ?? 'Кол-во'}</span>
          <span>{secondaryLabel}</span>
        </div>
      )}
      {departments.map(d => {
        const hasValue = d.value != null;
        const barPct = hasValue ? Math.min(100, ((d.value as number) / scaleMax) * 100) : 0;
        const v = d.value ?? 0;
        // Для счётных величин (число замечаний) пороги врут наоборот: сотня
        // замечаний красилась в зелёный как «много — значит хорошо».
        const barColor = !hasRatedScale
          ? 'from-zinc-400 to-zinc-300 dark:from-zinc-500 dark:to-zinc-600'
          : v >= 90 ? 'from-emerald-500 to-emerald-400'
          : v >= 70 ? 'from-blue-500 to-blue-400'
          : v >= 50 ? 'from-amber-500 to-amber-400'
          : 'from-red-500 to-red-400';

        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onDeptClick?.(d.id)}
            aria-label={`${d.name}: ${hasValue ? formatMetricValue(v, unit) : emptyLabel}`}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-left',
              'hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              'cursor-pointer group/dept active:scale-[0.99]',
            )}
          >
            <span className="text-[11px] text-zinc-600 dark:text-zinc-300 w-14 shrink-0 truncate font-semibold group-hover/dept:text-blue-600 dark:group-hover/dept:text-blue-400 transition-colors">
              {d.name}
            </span>
            <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              {hasValue && (
                <div
                  className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out', barColor)}
                  style={{ width: `${barPct}%` }}
                />
              )}
            </div>
            {hasValue ? (
              <span className={cn('text-xs font-bold tabular-nums min-w-14 text-right whitespace-nowrap', d.color ?? 'text-zinc-700 dark:text-zinc-200')}>
                {formatMetricValue(v, unit)}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 w-14 text-right">
                {emptyLabel}
              </span>
            )}
            {d.secondaryValue !== undefined && (
              d.secondaryValue != null ? (
                <span className={cn('text-[11px] tabular-nums w-14 text-right', d.secondaryColor ?? 'text-zinc-400')}>
                  {formatMetricValue(d.secondaryValue, secondaryUnit ?? unit)}
                </span>
              ) : (
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 w-14 text-right">
                  {emptyLabel}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

interface BudgetBreakdownProps {
  fb: number;
  kb: number;
  mb: number;
  formatter?: (v: number) => string;
}

/** Разбивка плана по уровням бюджета — полоса долей и легенда с суммами. */
export function BudgetBreakdown({ fb, kb, mb, formatter }: BudgetBreakdownProps) {
  const fmt = formatter ?? ((v: number) => v.toLocaleString('ru-RU'));
  const total = fb + kb + mb;
  /** Доля для подписи — округлённая до целых процентов. */
  const pctLabel = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0;
  /** Доля для ширины полосы — точная: округлённые доли не складываются в сто,
   *  и полоса не дотягивала до края либо переполнялась. */
  const pctExact = (v: number) => total > 0 ? (v / total) * 100 : 0;
  /** Подпись доли: целые проценты, знак не отрывается от числа. */
  const shareText = (v: number) => `${NF_INT.format(pctLabel(v))}${NBSP}%`;

  // Сокращение и полное наименование берутся из реестра @aemr/shared, а не
  // придумываются здесь: «ФБ» без расшифровки читает только тот, кто и так в
  // теме, а разночтения между вкладками рождаются именно из локальных подписей.
  const budgets = [
    { code: 'fb' as const, value: fb, gradient: 'from-blue-500 to-blue-400', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500' },
    { code: 'kb' as const, value: kb, gradient: 'from-emerald-500 to-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500' },
    { code: 'mb' as const, value: mb, gradient: 'from-amber-500 to-amber-400', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500' },
  ].map(b => ({ ...b, label: BUDGET_SOURCE_META[b.code].abbr, full: BUDGET_SOURCE_META[b.code].label }));

  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        По бюджетам
      </h4>

      {total > 0 ? (
        <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
          {budgets.filter(b => b.value > 0).map(b => (
            <div
              key={b.label}
              className={cn('h-full bg-gradient-to-r transition-all duration-500', b.gradient)}
              style={{ width: `${pctExact(b.value)}%` }}
              title={`${b.full}: ${fmt(b.value)} (${shareText(b.value)})`}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          За выбранный период разбивка по уровням бюджета в книгах не заполнена.
        </p>
      )}

      {/* Легенда: сокращение, полное наименование в подсказке, сумма и доля */}
      {total > 0 && (
        <div className="space-y-1.5">
          {budgets.map(b => (
            <div key={b.label} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-10">
                <span className={cn('w-2 h-2 rounded-full', b.bg)} aria-hidden="true" />
                <abbr title={b.full} className={cn('text-xs font-bold no-underline', b.text)}>{b.label}</abbr>
              </div>
              <div className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 tabular-nums text-right">
                {fmt(b.value)}
              </div>
              <span className="text-[10px] text-zinc-400 tabular-nums w-10 text-right">
                {shareText(b.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TrustComponentsProps {
  components: Array<{
    label: string;
    score: number;
    weight: string;
    metricKey?: string;
  }>;
}

/** Пять слагаемых доверия к данным — полосы с весом и баллом из ста. */
export function TrustComponents({ components }: TrustComponentsProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Из чего сложено доверие
      </h4>
      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-snug">
        Каждое слагаемое — балл от 0 до 100; в скобках его вес в общей оценке.
      </p>
      <div className="space-y-2.5">
        {components.map(c => {
          const gradient = c.score >= 80 ? 'from-emerald-500 to-emerald-400'
            : c.score >= 60 ? 'from-blue-500 to-blue-400'
            : c.score >= 40 ? 'from-amber-500 to-amber-400'
            : 'from-red-500 to-red-400';
          return (
            <KBTooltip key={c.label} metric={c.metricKey}>
              <div
                className="flex items-center gap-3 w-full group/trust"
                title={`${c.label}: ${formatMetricValue(c.score)} из 100, вес ${c.weight}`}
              >
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 w-32 shrink-0 truncate group-hover/trust:text-zinc-700 dark:group-hover/trust:text-zinc-200 transition-colors">
                  {c.label}
                  <span className="text-zinc-300 dark:text-zinc-600 ml-1">({c.weight})</span>
                </span>
                <div className="flex-1 h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out', gradient)}
                    style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                  />
                </div>
                <span className="text-xs font-bold tabular-nums w-8 text-right text-zinc-700 dark:text-zinc-200">
                  {formatMetricValue(c.score)}
                </span>
              </div>
            </KBTooltip>
          );
        })}
      </div>
    </div>
  );
}
