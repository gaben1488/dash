import type { MetricDelta } from '@aemr/core';
import { getMetricByKey } from '@aemr/shared';

/**
 * Презентация дельты метрики для <DeltaBadge> (слой 1 истории изменений).
 * Чистая функция — тон (цвет) берётся из сентимента ядра, направление → стрелка,
 * величина → текст. Тестируется в node-окружении, без рендера.
 */

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface DeltaView {
  arrow: '▲' | '▼' | '→';
  /** «7.3%» / «19 278» / «новое» / «убыло» */
  text: string;
  tone: DeltaTone;
  /** подсказка «было X · дата → стало Y · дата» */
  title: string;
}

const NF = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function fmtVal(v: number | null): string {
  return v === null ? '—' : NF.format(v);
}

/**
 * Процент-метрика СВОДа может храниться долей 0–1 (Excel-формат «%») либо
 * числом 0–100 — канон нормализации тот же, что в rule-book (G ≤ 1.5 →
 * десятичная доля). Наружу — всегда проценты.
 */
const normPct = (v: number): number => (Math.abs(v) <= 1.5 ? v * 100 : v);

const isPercentMetric = (metricKey: string): boolean =>
  getMetricByKey(metricKey)?.displayUnit === 'percent';

/** Значение метрики в единицах показа REPORT_MAP: проценты — с «%», прочее — числом. */
export function fmtMetricValue(metricKey: string, v: number | null): string {
  if (v === null) return '—';
  return isPercentMetric(metricKey) ? `${NF.format(normPct(v))}%` : NF.format(v);
}

function fmtDate(iso: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}` : iso;
}

export function formatDelta(d: MetricDelta): DeltaView {
  const arrow: DeltaView['arrow'] =
    d.direction === 'up' || d.direction === 'appeared'
      ? '▲'
      : d.direction === 'down' || d.direction === 'disappeared'
        ? '▼'
        : '→';

  const percent = isPercentMetric(d.metricKey);

  let text: string;
  if (d.direction === 'appeared') text = 'новое';
  else if (d.direction === 'disappeared') text = 'убыло';
  else if (percent && d.from?.value != null && d.to?.value != null) {
    // Процент-метрика: дельта в ПРОЦЕНТНЫХ ПУНКТАХ, не относительный сдвиг —
    // «▲ 5,0%» рядом с «42,0%» читался бы как п.п., являясь при этом
    // отношением (ponytail-ревью R1-хвоста #3). Нормализация по-точечная:
    // снимки разных недель могли хранить G и долей, и числом.
    text = `${NF.format(Math.abs(normPct(d.to.value) - normPct(d.from.value)))} п.п.`;
  }
  else if (d.deltaPct !== null && Number.isFinite(d.deltaPct)) text = `${(Math.abs(d.deltaPct) * 100).toFixed(1)}%`;
  else if (d.deltaAbs !== null && Number.isFinite(d.deltaAbs)) text = NF.format(Math.abs(d.deltaAbs));
  else text = '—';

  const fromPart = d.from ? `${fmtMetricValue(d.metricKey, d.from.value)} · ${fmtDate(d.from.at)}` : '—';
  const toPart = d.to ? `${fmtMetricValue(d.metricKey, d.to.value)} · ${fmtDate(d.to.at)}` : '—';

  return { arrow, text, tone: d.sentiment, title: `было ${fromPart} → стало ${toPart}` };
}
