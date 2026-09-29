import { useEffect, useState } from 'react';
import { PublishedReportMetricsSchema, productLabel, type PublishedReportMetrics, type ReportReleaseStatus } from '@aemr/shared';
import { fetchParsed } from '../../api';
import { EMPTY_FILTER_CONTEXT } from '../../lib/filter-context';
import { fmtCount } from '../../lib/report/mappers';
import { ReportTable } from '../contract/ReportTable';

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const columns = [
  { key: 'period', label: 'Совокупность' },
  { key: 'plan_count', label: productLabel('plan_count'), align: 'right' as const },
  { key: 'fact_count', label: productLabel('fact_count'), align: 'right' as const },
  { key: 'plan_amount', label: 'План, тыс. руб.', align: 'right' as const },
  { key: 'fact_amount', label: 'Факт, тыс. руб.', align: 'right' as const },
];

/** Проекция зарегистрированных plan_count/fact_count и сумм из ReportModel; пересчёта нет. */
export function PublishedReleaseMetrics({ release }: { release: NonNullable<ReportReleaseStatus['latest']> }) {
  const [data, setData] = useState<PublishedReportMetrics | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { release_id, snapshot_id, report_date, rules_version, renderer_version } = release;
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    void fetchParsed(`/report-releases/${release_id}/dashboard`, PublishedReportMetricsSchema, { signal: controller.signal })
      .then(result => {
        if (result.snapshot_id !== snapshot_id || result.report_date !== report_date || result.headline.report_date !== report_date
            || result.rules_version !== rules_version || result.renderer_version !== renderer_version) throw new Error('Release mismatch');
        if (!controller.signal.aborted) setData(result);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [release_id, snapshot_id, report_date, rules_version, renderer_version, retry]);

  if (error) return <div role="alert">Не удалось проверить показатели сохранённого выпуска. <button className="underline underline-offset-4" onClick={() => setRetry(x => x + 1)}>Повторить</button></div>;
  if (!data) return <p role="status">Загружаем показатели выпуска…</p>;
  const rows = (['competitive', 'single_supplier'] as const).flatMap(kind => (['year', 'quarter'] as const).map(period => {
    const block = data.headline[kind][period];
    return { period: `${kind === 'competitive' ? 'Конкурентные' : 'Единственный поставщик'} · ${period === 'year' ? 'год' : `${data.headline.current_quarter} квартал`}`,
      plan_count: fmtCount(block.plan_count), fact_count: fmtCount(block.fact_count),
      plan_amount: money.format(block.plan_amount), fact_amount: money.format(block.fact_amount) };
  }));
  return <div className="space-y-2">
    <p>Период определяется плановой датой позиции. Факт — позиции с датой Q на момент среза; он не означает исполнение или оплату договора.</p>
    <ReportTable columns={columns} rows={rows} caption={`Сохранённый срез на ${data.report_date} · первичные реестры`} source="calc" filterCtx={EMPTY_FILTER_CONTEXT} />
  </div>;
}
