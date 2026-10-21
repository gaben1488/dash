import React, { useEffect, useState } from 'react';
import type { MetricExplanation } from '@aemr/shared';
import { api } from '../../api';
import { fmtNum } from '../../lib/recon/format';

export function MetricCalculationEvidence({ metricKey, snapshotId, year }: {
  metricKey: string; snapshotId: string; year: number | 'all';
}) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<MetricExplanation | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.getMetric(metricKey, { snapshotId, year }).then(result => {
      if (active) setEvidence(result.explanation ?? { status: 'unavailable', reason: 'NO_CALCULATED_VALUE' });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [open, metricKey, snapshotId, year]);

  if (!open) return <button className="mt-2 underline text-indigo-700 dark:text-indigo-300"
    onClick={() => setOpen(true)}>Показать основания расчёта</button>;
  if (error) return <p role="status">Не удалось получить основания этого снимка. Обновите страницу и повторите.</p>;
  if (!evidence) return <p role="status">Загружаем основания сохранённого расчёта…</p>;
  if (evidence.status === 'unavailable') return <p>Основания этого результата не восстановлены из сохранённых строк. Это не означает, что проверка пройдена.</p>;
  const sources = new Map<string, number[]>();
  for (const row of evidence.rows) {
    const rows = sources.get(row.sheet) ?? [];
    rows.push(row.row); sources.set(row.sheet, rows);
  }
  return <div className="mt-2 space-y-2 min-w-0">
    <p>Воспроизведено по строкам снимка от {new Date(evidence.asOf).toLocaleString('ru-RU', { timeZone: 'Asia/Kamchatka' })}.</p>
    {evidence.operands.map(operand => <p key={operand.key}>
      {operand.label}: <strong>{fmtNum(operand.value)}</strong> · строк в основании: {operand.rows.length}
    </p>)}
    <details>
      <summary className="cursor-pointer">Строки источников: {evidence.rows.length}</summary>
      <div className="max-h-48 overflow-y-auto break-words">
        {[...sources].map(([sheet, rows]) => <p key={sheet}>{sheet}: {rows.join(', ')}</p>)}
      </div>
    </details>
  </div>;
}
