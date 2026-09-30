import { useId } from 'react';
import type { ReportAssurance } from '@aemr/shared';

/** Visible counts first; raw engine codes never substitute for an actionable explanation. */
export function ReportAssurancePanel({ value, label }: { value: ReportAssurance | null; label: string }) {
  const headingId = useId();
  if (!value || value.actions.length === 0) return null;
  const groups = [
    { key: 'SOURCE_OWNER', title: 'Нужны уточнения в первичных данных', count: value.user_action_count },
    { key: 'ENGINE', title: 'Задачи сопровождения — от вас технических подтверждений не требуется', count: value.engine_action_count },
  ];
  return (
    <section aria-labelledby={headingId} className="rounded border-2 border-amber-500 p-3 text-sm text-zinc-950 dark:text-zinc-100">
      <h3 id={headingId} className="font-semibold">{label}</h3>
      <p className="mt-1">Проверенные расчёты не означают, что все пояснения и исторические действия уже разобраны. Ниже указано, что именно осталось и кто это исправляет.</p>
      {groups.filter(group => group.count > 0).map(group => (
        <div key={group.key} className="mt-3">
          <h4 className="font-semibold">{group.title}: {group.count}</h4>
          {value.actions.filter(item => item.owner_kind === group.key).map(item => (
            <details key={item.signal_id} className="mt-2 border-t border-amber-300 pt-2">
              <summary className="cursor-pointer font-medium">
                {item.title}{item.owner && ` · ${item.owner}`}
                {item.locations[0]?.sheet && ` · ${item.locations[0].sheet} ${item.locations.map(where => where.a1).filter(Boolean).join(', ')}`}
                {item.recommendation_id && ` · рекомендация ${item.recommendation_id}`}
                {item.severity === 'blocks_release' && ' · блокирует новый выпуск'}
              </summary>
              <p className="mt-2"><strong>Причина:</strong> {item.cause}</p>
              <p><strong>Влияние на отчёт:</strong> {item.report_effect}</p>
              <p><strong>Действие:</strong> {item.action}</p>
              <p><strong>Закроется автоматически, когда:</strong> {item.resolved_when}</p>
              {item.locations.map((where, index) => (
                <p key={`${where.a1}/${index}`}>
                  {where.subject && <span>{where.subject}. </span>}
                  {where.url && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/edit#gid=\d+&range=[A-Z]+\d+$/.test(where.url)
                    ? <a className="underline" href={where.url} target="_blank" rel="noopener noreferrer">Открыть {where.sheet}, {where.a1}</a>
                    : <span>{where.sheet} {where.a1}</span>}
                </p>
              ))}
            </details>
          ))}
        </div>
      ))}
    </section>
  );
}
