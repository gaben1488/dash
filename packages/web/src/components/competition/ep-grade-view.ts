// ────────────────────────────────────────────────────────────────
// Выборка разбора ЕП по степеням обоснованности под периметр шапки.
//
// Чистая функция без React: её проверяет тест, а не отрисовка. Считает
// ядро (@aemr/core/ep-justification), здесь только СЛОЖЕНИЕ нужных
// управлений и нужных кварталов — то есть перевод «периметра шапки» в
// периметр расчёта.
//
// Единственная тонкость периметра: разбор живёт на КВАРТАЛЬНОЙ сетке
// (столбец O), месячной у обоснований нет. Поэтому выбор отдельных
// месяцев округляется до кварталов, в которые они попали, и об этом
// говорится на карточке (`roundedToQuarters`), а не умалчивается.
// ────────────────────────────────────────────────────────────────

import {
  EP_QUARTER_KEYS,
  emptyEpGradeBucket,
  epQuarterDynamics,
  mergeEpClusters,
  mergeEpGradeBuckets,
  summarizeEpGrades,
  type EpCell,
  type EpJustificationDept,
  type EpJustificationSummary,
  type EpQuarterKey,
  type EpQuarterPoint,
} from '@aemr/core';
import { bothDeptKeyForms } from '../../lib/dept-key';

/** Что нужно выборке от периметра шапки — узкий контракт, не весь хук. */
export interface EpGradePerimeter {
  /** Ключи управлений периметра в любой форме (кириллица или латиница). */
  deptKeys: readonly string[];
  /** Активные ключи периода: ['year'] либо кварталы ('q1'…'q4'). */
  periodKeys: readonly string[];
  /** Выбраны отдельные месяцы — квартальная сетка их округлит. */
  hasActiveMonths: boolean;
}

export interface EpGradeView {
  summary: EpJustificationSummary;
  /** Кластеры причин за ГОД выбранных управлений — «что именно писали». */
  clusters: Record<string, EpCell>;
  /** Динамика по всем четырём кварталам года — она всегда годовая. */
  dynamics: EpQuarterPoint[];
  /** Строки ЕП без квартала плана у выбранных управлений. */
  noQuarter: EpCell;
  /** Периметр сузился до кварталов, потому что выбраны месяцы. */
  roundedToQuarters: boolean;
  /** Разбор считался по году целиком (квартал в шапке не выбран). */
  wholeYear: boolean;
  /** Ни одного управления периметра в ответе сервера не нашлось. */
  noDeptsMatched: boolean;
}

const isQuarterKey = (k: string): k is EpQuarterKey =>
  (EP_QUARTER_KEYS as readonly string[]).includes(k);

/** Свод четырёх пустых кварталов — динамика без данных остаётся структурой. */
function emptyQuarters(): Record<EpQuarterKey, ReturnType<typeof emptyEpGradeBucket>> {
  return {
    q1: emptyEpGradeBucket(),
    q2: emptyEpGradeBucket(),
    q3: emptyEpGradeBucket(),
    q4: emptyEpGradeBucket(),
  };
}

/**
 * Сводит ответ сервера к одному виду под периметр шапки.
 *
 * Отбор управлений применяется всегда (обе формы ключа ГРБС). Период —
 * только квартальной сеткой: 'year' берёт годовой свод управления (в него
 * входят и строки без квартала плана), выбранные кварталы складываются.
 */
export function selectEpGradeView(
  byDept: Record<string, EpJustificationDept> | null | undefined,
  perimeter: EpGradePerimeter,
): EpGradeView {
  const quarterKeys = perimeter.periodKeys.filter(isQuarterKey);
  const wholeYear = quarterKeys.length === 0;

  const wanted = bothDeptKeyForms(perimeter.deptKeys);
  const depts = Object.entries(byDept ?? {})
    .filter(([id]) => wanted.size === 0 || wanted.has(id))
    .map(([, d]) => d);

  if (depts.length === 0) {
    return {
      summary: summarizeEpGrades(emptyEpGradeBucket()),
      clusters: {},
      dynamics: epQuarterDynamics(emptyQuarters()),
      noQuarter: { rows: 0, sum: 0 },
      roundedToQuarters: false,
      wholeYear,
      noDeptsMatched: true,
    };
  }

  const bucket = wholeYear
    ? mergeEpGradeBuckets(depts)
    : mergeEpGradeBuckets(depts.flatMap((d) => quarterKeys.map((qk) => d.quarters[qk])));

  const dynamics = epQuarterDynamics({
    q1: mergeEpGradeBuckets(depts.map((d) => d.quarters.q1)),
    q2: mergeEpGradeBuckets(depts.map((d) => d.quarters.q2)),
    q3: mergeEpGradeBuckets(depts.map((d) => d.quarters.q3)),
    q4: mergeEpGradeBuckets(depts.map((d) => d.quarters.q4)),
  });

  const noQuarter = depts.reduce<EpCell>(
    (acc, d) => ({ rows: acc.rows + d.noQuarter.rows, sum: acc.sum + d.noQuarter.sum }),
    { rows: 0, sum: 0 },
  );

  return {
    summary: summarizeEpGrades(bucket),
    // Кластеры считаются по году: срез «частые формулировки» отвечает на
    // вопрос «как обычно пишут», а квартальной разбивки формулировок в
    // ответе нет — и выдумывать её из годовой было бы враньём.
    clusters: mergeEpClusters(depts.map((d) => d.byCluster)),
    dynamics,
    noQuarter,
    roundedToQuarters: perimeter.hasActiveMonths && !wholeYear,
    wholeYear,
    noDeptsMatched: false,
  };
}

/**
 * Куда сместилась сокращаемая доля от первого квартала с данными к
 * последнему — фраза «снижение видно» либо «пока не видно», без выдумки.
 * Возвращает null, когда сравнивать нечего (меньше двух кварталов с данными).
 */
export function reducibleTrend(points: readonly EpQuarterPoint[]): {
  first: EpQuarterPoint;
  last: EpQuarterPoint;
  deltaPp: number;
} | null {
  const withData = points.filter((p) => p.hasData && p.reducibleShareOfAll !== null);
  if (withData.length < 2) return null;
  const first = withData[0]!;
  const last = withData[withData.length - 1]!;
  return {
    first,
    last,
    deltaPp: Math.round(((last.reducibleShareOfAll ?? 0) - (first.reducibleShareOfAll ?? 0)) * 10) / 10,
  };
}
