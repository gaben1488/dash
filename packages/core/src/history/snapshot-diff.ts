/**
 * snapshot-diff — слой 1 фичи «История изменений» (дрейф метрик, руководитель).
 *
 * Чистая функция над двумя срезами `metric_history` (две точки времени).
 * Для каждого `metricKey` считает дельту, направление и СЕНТИМЕНТ — цвет по
 * смыслу, не по знаку: рост доли ЕП = внимание (bad), рост экономии = хорошо
 * (good). Тестируется изолированно, без БД и сети.
 */

export type Direction = 'up' | 'down' | 'flat' | 'appeared' | 'disappeared';
export type Sentiment = 'good' | 'bad' | 'neutral';

export interface MetricRow {
  metricKey: string;
  numericValue: number | null;
  at: string;
}

export interface MetricDelta {
  metricKey: string;
  from: { value: number | null; at: string } | null;
  to: { value: number | null; at: string } | null;
  deltaAbs: number | null;
  /** доля (0.1 = +10%); null если from=0 или одной из точек нет */
  deltaPct: number | null;
  direction: Direction;
  sentiment: Sentiment;
}

// «рост = плохо» (внимание): доля ЕП, аномалии, просрочки, нарушения.
const UP_IS_BAD = [/доля.*еп|ep.*share|sole.*share|просроч|overdue|наруш|аномал/i];
// «рост = хорошо»: экономия, исполнение, потрачено.
const UP_IS_GOOD = [/эконом|econom|savings|исполн|exec|потрач|spent/i];

export function sentimentFor(metricKey: string, dir: Direction): Sentiment {
  if (dir === 'flat') return 'neutral';
  const up = dir === 'up' || dir === 'appeared';
  if (UP_IS_BAD.some((r) => r.test(metricKey))) return up ? 'bad' : 'good';
  if (UP_IS_GOOD.some((r) => r.test(metricKey))) return up ? 'good' : 'bad';
  return 'neutral';
}

/**
 * Сравнить два среза метрик. Результат отсортирован по убыванию |deltaAbs|
 * (самые крупные сдвиги — первыми).
 */
export function diffMetrics(from: MetricRow[], to: MetricRow[]): MetricDelta[] {
  const fm = new Map(from.map((r) => [r.metricKey, r]));
  const tm = new Map(to.map((r) => [r.metricKey, r]));
  const keys = new Set([...fm.keys(), ...tm.keys()]);
  const out: MetricDelta[] = [];
  for (const k of keys) {
    const f = fm.get(k);
    const t = tm.get(k);
    const fv = f?.numericValue ?? null;
    const tv = t?.numericValue ?? null;
    let direction: Direction;
    if (f && !t) direction = 'disappeared';
    else if (!f && t) direction = 'appeared';
    else if (fv === null || tv === null || fv === tv) direction = 'flat';
    else direction = tv > fv ? 'up' : 'down';
    const deltaAbs = fv !== null && tv !== null ? tv - fv : (tv ?? fv);
    const deltaPct = fv !== null && tv !== null && fv !== 0 ? (tv - fv) / Math.abs(fv) : null;
    out.push({
      metricKey: k,
      from: f ? { value: fv, at: f.at } : null,
      to: t ? { value: tv, at: t.at } : null,
      deltaAbs,
      deltaPct,
      direction,
      sentiment: sentimentFor(k, direction),
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaAbs ?? 0) - Math.abs(a.deltaAbs ?? 0));
}
