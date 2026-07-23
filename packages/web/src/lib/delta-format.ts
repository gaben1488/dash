import type { MetricDelta } from '@aemr/core';

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

  let text: string;
  if (d.direction === 'appeared') text = 'новое';
  else if (d.direction === 'disappeared') text = 'убыло';
  else if (d.deltaPct !== null && Number.isFinite(d.deltaPct)) text = `${(Math.abs(d.deltaPct) * 100).toFixed(1)}%`;
  else if (d.deltaAbs !== null && Number.isFinite(d.deltaAbs)) text = NF.format(Math.abs(d.deltaAbs));
  else text = '—';

  const fromPart = d.from ? `${fmtVal(d.from.value)} · ${fmtDate(d.from.at)}` : '—';
  const toPart = d.to ? `${fmtVal(d.to.value)} · ${fmtDate(d.to.at)}` : '—';

  return { arrow, text, tone: d.sentiment, title: `было ${fromPart} → стало ${toPart}` };
}
