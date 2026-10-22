import { METRIC_KB } from '@aemr/core';
import type { ReportOperations } from '@aemr/shared';
import { KbHover } from '../../components/contract/KbHover';

const clock = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Kamchatka', dateStyle: 'short', timeStyle: 'medium',
});
function duration(seconds: number) {
  if (seconds < 60) return `${seconds} с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
  return `${Math.floor(seconds / 3600)} ч ${Math.floor(seconds % 3600 / 60)} мин`;
}
const workerLabels: Record<ReportOperations['worker_state'], string> = {
  running: 'Выполняется попытка', idle: 'Нет активной попытки',
  interrupted: 'Предыдущая попытка прервана', unknown: 'Состояние процесса не подтверждено',
};

/** Uses the existing status read; never starts a generation or a second poller. */
export function ReportOperationsStatus({ value, apiState }: {
  value: ReportOperations | null;
  apiState: 'checking' | 'available' | 'unavailable';
}) {
  if (!value) return <p className="text-xs text-zinc-600 dark:text-zinc-300">
    {apiState === 'checking' ? 'Проверяем состояние автообновления…'
      : apiState === 'unavailable' ? 'Не удалось получить состояние автообновления. Последний проверенный Word сохраняется.'
        : 'Сервер не передал эксплуатационные показатели. Требуется проверка контракта API.'}
  </p>;
  const rows = [
    { key: 'api_read_available', text: apiState === 'unavailable' ? 'Последний запрос завершился ошибкой'
      : apiState === 'checking' ? 'Запрос выполняется' : 'Ответ получен' },
    { key: 'report_check_age_seconds', text: value.last_success_age_seconds === null
      ? 'Успешная попытка не записана' : duration(value.last_success_age_seconds) },
    { key: 'worker_cycle_duration_seconds', text: value.last_cycle_duration_seconds === null
      ? 'Завершённый цикл не записан' : duration(value.last_cycle_duration_seconds) },
    { key: 'worker_last_failure', text: value.last_failure_at
      ? clock.format(new Date(value.last_failure_at)) : 'В доступной диагностике отказ не записан' },
  ];
  return <details className="rounded-xl border border-zinc-200/70 bg-white/60 p-3 text-xs text-zinc-700 backdrop-blur dark:border-white/10 dark:bg-zinc-900/45 dark:text-zinc-200">
    <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
      Генератор отчётов: {workerLabels[value.worker_state]}
    </summary>
    {apiState === 'unavailable' && <p role="status" className="mt-2 text-amber-700 dark:text-amber-300">
      Показаны последние полученные сведения; свежие показатели из API не получены.
    </p>}
    <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map(row => <div key={row.key}>
        <dt><KbHover metricKey={row.key}><span className="border-b border-dotted border-current">{METRIC_KB[row.key].label}</span></KbHover></dt>
        <dd className="mt-1 font-medium tabular-nums">{row.text}</dd>
      </div>)}
    </dl>
    {value.last_failure_code && <p className="mt-2 break-words"><code>{value.last_failure_code}</code>
      {value.failure_resolved ? ' · После отказа подтверждена успешная проверка.' : ' · После этого успешная проверка не записана.'}
    </p>}
    {value.worker_state === 'running' && value.running_duration_seconds !== null &&
      <p className="mt-2">Текущая попытка: {duration(value.running_duration_seconds)}.</p>}
    {value.check_stale && <p className="mt-2 text-amber-700 dark:text-amber-300">Свежая успешная проверка не подтверждена.</p>}
    <p className="mt-2 text-zinc-500 dark:text-zinc-400">На момент <time dateTime={value.checked_at}>{clock.format(new Date(value.checked_at))}</time> (Камчатка).
      {' '}Свежесть проверки не является датой среза Word.</p>
  </details>;
}
