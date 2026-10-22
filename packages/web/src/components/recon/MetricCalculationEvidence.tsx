import React, { useEffect, useState } from 'react';
import type { MetricExplanation } from '@aemr/shared';
import { api } from '../../api';
import { fmtNum } from '../../lib/recon/format';

export function MetricCalculationEvidence({ metricKey, snapshotId, year }: {
  metricKey: string; snapshotId: string; year: number | 'all';
}) {
  const [open, setOpen] = useState(false);
  const requestKey = JSON.stringify([metricKey, snapshotId, year]);
  const [loaded, setLoaded] = useState<{
    requestKey: string; evidence: MetricExplanation | null; error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.getMetric(metricKey, { snapshotId, year }).then(result => {
      if (active) setLoaded({ requestKey, evidence: result.explanation ?? {
        status: 'unavailable', reason: 'NO_CALCULATED_VALUE',
      }, error: false });
    }).catch(() => {
      if (active) setLoaded({ requestKey, evidence: null, error: true });
    });
    return () => { active = false; };
  }, [open, metricKey, snapshotId, year, requestKey]);

  // A changed scope must never render evidence from the preceding snapshot —
  // not even for the paint before useEffect fetches the new request.
  const current = loaded?.requestKey === requestKey ? loaded : null;
  const evidence = current?.evidence ?? null;
  const error = current?.error ?? false;
  if (!open) return <button className="mt-2 underline text-indigo-700 dark:text-indigo-300"
    onClick={() => setOpen(true)}>Показать основания расчёта</button>;
  if (error) return <p role="status">Не удалось получить основания этого снимка. Обновите страницу и повторите.</p>;
  if (!evidence) return <p role="status">Загружаем основания сохранённого расчёта…</p>;
  if (evidence.status === 'unavailable') return <p>Основания этого результата не восстановлены из сохранённых строк. Это не означает, что проверка пройдена.</p>;
  const context = evidence.resultContext;
  const methodLabel = context.scope.method === 'competitive' ? 'конкурентные'
    : context.scope.method === 'ep' ? 'единственный поставщик' : 'все способы';
  const sources = new Map<string, number[]>();
  for (const row of evidence.rows) {
    const rows = sources.get(row.sheet) ?? [];
    rows.push(row.row); sources.set(row.sheet, rows);
  }
  return <div className="mt-2 space-y-2 min-w-0">
    <p>Воспроизведено по строкам снимка от {new Date(evidence.asOf).toLocaleString('ru-RU', { timeZone: 'Asia/Kamchatka' })}.</p>
    <p data-testid="metric-evidence-scope">
      Периметр: {context.scope.sourceSheets.join(', ')} · {context.scope.period} ·
      {context.scope.year === null ? ' все годы' : ` ${context.scope.year} г.`} · {methodLabel}.
      Единица наблюдения — строка исходной книги, не отдельный договор.
    </p>
    {evidence.operands.map(operand => <p key={operand.key}>
      {operand.label}: <strong>{fmtNum(operand.unit === 'percent' && operand.value !== null ? operand.value * 100 : operand.value)}
        {operand.unit === 'currency' ? ' тыс. руб.' : operand.unit === 'count' ? ' поз.' : operand.unit === 'percent' ? '%' : ''}
      </strong> · строк в основании: {operand.rows.length}
    </p>)}
    <details>
      <summary className="cursor-pointer">Контекст расчёта и версия правил</summary>
      <div className="mt-1 space-y-1 break-words text-xs" data-testid="metric-evidence-version">
        <p>Показатель: {evidence.definition.label} ({evidence.definition.key}) · зависимости: {
          context.dependencies.length ? context.dependencies.join(', ') : 'нет (базовый показатель)'
        }.</p>
        <p>Исполняемая формула: <code>{context.formula}</code>.</p>
        <p>Идентификатор снимка: <code>{context.version.snapshotId}</code>.</p>
        {context.version.status === 'captured'
          ? <><p>Версия расчёта: <code>{context.version.calculationContextId}</code>.</p>
              <p>Отпечаток правил: <code>{context.version.semanticsHash}</code>.</p>
              <p>Отпечатки данных и профилей: <code>{context.version.sourceContentHash}</code> / <code>{context.version.sourceProfilesHash}</code>.</p></>
          : <p>В старом снимке отсутствует сохранённая версия расчётного контекста.
              Число воспроизведено текущим движком, но исторический набор правил не удостоверен.</p>}
      </div>
    </details>
    <details>
      <summary className="cursor-pointer">Строки источников: {evidence.rows.length}</summary>
      <div className="max-h-48 overflow-y-auto break-words">
        {[...sources].map(([sheet, rows]) => <p key={sheet}>{sheet}: {rows.join(', ')}</p>)}
      </div>
    </details>
  </div>;
}
