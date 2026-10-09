import { useId } from 'react';
import type { ReportAssurance } from '@aemr/shared';

/** Technical diagnostics are available, but never dominate the weekly report. */
export function ReportAssurancePanel({ value, label }: { value: ReportAssurance | null; label: string }) {
  const headingId = useId();
  if (!value || value.actions.length === 0) return null;
  const hasBusinessAction = value.user_action_count > 0;
  const hasBlocker = value.actions.some(action => action.severity === 'blocks_release');
  const groups = [
    { key: 'SOURCE_OWNER', title: 'Что нужно уточнить в исходных таблицах',
      count: value.user_action_count },
    { key: 'ENGINE', title: 'Справка для технического сопровождения',
      count: value.engine_action_count },
  ];
  return (
    <details className={'rounded-lg border px-3 py-2 text-sm ' + (hasBlocker
      ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20'
      : 'border-zinc-200 bg-zinc-50/40 dark:border-zinc-700 dark:bg-zinc-800/30')}>
      <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {hasBlocker ? 'Нужны уточнения перед новым выпуском' : 'Пояснения к проверке отчёта'}
        <span className="ml-2 font-normal text-xs text-zinc-500 dark:text-zinc-400">
          {hasBusinessAction ? 'Уточнений по данным: ' + value.user_action_count + '. ' : ''}
          {value.engine_action_count > 0 ? 'Есть справка для сопровождения.' : ''}
        </span>
      </summary>
      <section aria-labelledby={headingId} className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        <h3 id={headingId} className="font-semibold">{label}</h3>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Технические замечания не означают, что проверенный Word ошибочен.
          Уточнения исходных данных показаны отдельно от служебной диагностики.
        </p>
        {groups.filter(group => group.count > 0).map(group => (
          <details key={group.key} className="mt-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
            <summary className="cursor-pointer font-medium">
              {group.title} · {group.count}
            </summary>
            <div className="mt-2 space-y-2">
              {value.actions.filter(item => item.owner_kind === group.key).map(item => (
                <details key={item.signal_id} className={'rounded-md border-l-2 px-2 py-1 ' + (
                  item.severity === 'blocks_release' ? 'border-amber-500' : 'border-zinc-300 dark:border-zinc-600'
                )}>
                  <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {item.title}{item.owner && ' · ' + item.owner}
                    {item.severity === 'blocks_release' && ' · требуется для нового выпуска'}
                  </summary>
                  <div className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    <p><strong>Что произошло:</strong> {item.cause}</p>
                    <p><strong>На что влияет:</strong> {item.report_effect}</p>
                    <p><strong>Что сделать:</strong> {item.action}</p>
                    <p><strong>Когда вопрос будет закрыт:</strong> {item.resolved_when}</p>
                    {item.locations.map((where, index) => (
                      <p key={where.a1 + '/' + index}>
                        {where.subject && <span>{where.subject}. </span>}
                        {where.url && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/edit#gid=\d+&range=[A-Z]+\d+$/.test(where.url)
                          ? <a className="underline" href={where.url} target="_blank" rel="noopener noreferrer">Открыть {where.sheet}, {where.a1}</a>
                          : <span>{where.sheet} {where.a1}</span>}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </section>
    </details>
  );
}
