import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { ReportReleaseStatusSchema, type ReportReleaseStatus } from '@aemr/shared';
import { fetchBlob, fetchParsed } from '../../api';
import { EMPTY_FILTER_CONTEXT } from '../../lib/filter-context';
import { SectionCard } from '../contract/SectionCard';

const timestamp = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC',
});
const buttonStyle = 'inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800';

/** Все три файла адресуются одним release_id; живые фильтры здесь неприменимы. */
export function PublishedReleasePanel() {
  const [state, setState] = useState<ReportReleaseStatus | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const next = await fetchParsed('/report-releases', ReportReleaseStatusSchema, { signal: controller.signal });
        if (!controller.signal.aborted) { setState(next); setError(''); }
      } catch {
        if (!controller.signal.aborted) setError('Не удалось проверить состояние выпуска. Повторите запрос.');
      }
    }
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refresh]);

  async function download(file: 'main.docx' | 'supplement.docx' | 'dashboard') {
    const release = state?.latest;
    if (!release) return;
    setSaving(file);
    setDownloadError('');
    try {
      const blob = await fetchBlob(`/report-releases/${release.release_id}/${file}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${release.report_date}-${file === 'dashboard' ? 'report-data.json' : file}`;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
    } catch {
      setDownloadError('Не удалось загрузить файл выпуска. Повторите загрузку.');
    } finally { setSaving(null); }
  }

  const latest = state?.latest;
  const attempt = state?.attempt;
  return (
    <SectionCard title="Проверенный выпуск" source="calc" filterCtx={EMPTY_FILTER_CONTEXT} collapsible={false}>
      <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
        <div aria-live="polite" className="space-y-2">
          {!state && !error && <p>Проверяем состояние выпуска…</p>}
          {error && <p role="alert">{error}</p>}
          {state && !latest && <p>Проверенных выпусков пока нет.</p>}
          {latest && <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Отчёт на {latest.report_date}</h4>
              <span>{latest.status === 'VERIFIED' ? 'Проверен' : 'Проверен, есть замечания'}</span>
            </div>
            <p>Основной отчёт, дополнение и данные среза принадлежат одному сохранённому выпуску. Фильтры страницы его не меняют.</p>
            <p className="text-xs">Источники прочитаны: <time dateTime={latest.cutoff_at}>{timestamp.format(new Date(latest.cutoff_at))} UTC</time>.
              {' '}Опубликован: <time dateTime={latest.published_at}>{timestamp.format(new Date(latest.published_at))} UTC</time>.</p>
          </>}
          {attempt?.status === 'RUNNING' && <p>Готовится новый выпуск. Сохранённые документы остаются доступны.</p>}
          {attempt?.status === 'NOT_ISSUED' && <div className="space-y-1">
            <p className="font-medium">{attempt.report_date ? `Новый отчёт на ${attempt.report_date} не выпущен.` : 'Новый отчёт не выпущен.'}</p>
            {attempt.blockers?.length
              ? <ul className="list-disc space-y-1 pl-5">{attempt.blockers.map((blocker, i) => <li key={`${blocker.code}-${i}`}>{blocker.message}</li>)}</ul>
              : <p>Запуск завершился с ошибкой. Причина сохранена в журнале выпуска.</p>}
          </div>}
        </div>
        {latest && <div className="flex flex-wrap gap-2" aria-busy={saving !== null}>
          <button className={buttonStyle} disabled={saving !== null} onClick={() => void download('main.docx')}><FileDown size={16} aria-hidden="true" />Основной отчёт · Word</button>
          <button className={buttonStyle} disabled={saving !== null} onClick={() => void download('supplement.docx')}><FileDown size={16} aria-hidden="true" />Дополнение · Word</button>
          <button className={buttonStyle} disabled={saving !== null} onClick={() => void download('dashboard')}>Данные среза · JSON</button>
        </div>}
        {saving && <p role="status">Загружаем файл…</p>}
        {downloadError && <p role="alert">{downloadError}</p>}
        <button className="text-xs underline underline-offset-4 hover:text-zinc-900 dark:hover:text-white" onClick={() => setRefresh(v => v + 1)}>Обновить состояние выпуска</button>
      </div>
    </SectionCard>
  );
}
