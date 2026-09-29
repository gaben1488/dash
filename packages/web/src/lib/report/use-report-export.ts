import { useEffect, useRef, useState } from 'react';
import { SelectedReportReleaseStatusSchema, type SelectedReportReleaseStatus } from '@aemr/shared';
import { fetchBlob, fetchParsed } from '../../api';
import type { ReportMode } from './request';

export interface ExportContext { date: string; year: number; quarter: number; mode: ReportMode }
type Kind = 'main' | 'extra';
type Release = NonNullable<SelectedReportReleaseStatus['selected']>;
const timestamp = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kamchatka',
});
const businessDay = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kamchatka',
});

/** Native Word actions share one frozen release, including across background updates. */
export function useReportExport(context: ExportContext | null) {
  const query = context ? new URLSearchParams({ date: context.date, year: String(context.year), quarter: String(context.quarter) }).toString() : null;
  const key = context ? `${context.mode}/${query}` : null;
  const [state, setState] = useState<{ key: string; data: SelectedReportReleaseStatus | null; error: string } | null>(null);
  const [pinned, setPinned] = useState<{ key: string; release: Release } | null>(null);
  const [transfer, setTransfer] = useState<{ key: string; saving: Kind | null; error: string } | null>(null);
  const downloadController = useRef<AbortController | null>(null);

  useEffect(() => {
    setPinned(null);
    setTransfer(null);
    if (!key || !query) return;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      const requestController = new AbortController();
      const abort = () => requestController.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 35_000);
      try {
        const data = await fetchParsed(`/report-releases?${query}`, SelectedReportReleaseStatusSchema, { signal: requestController.signal });
        if (!controller.signal.aborted) setState({ key: key!, data, error: '' });
      } catch {
        if (!controller.signal.aborted) setState({ key: key!, data: null, error: 'Не удалось проверить готовность Word. Повторим запрос автоматически.' });
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { controller.abort(); downloadController.current?.abort(); clearInterval(timer); };
  }, [key, query]);

  const current = state?.key === key ? state : null;
  const candidate = pinned?.key === key ? pinned.release : current?.data?.selected;
  // Guard the response boundary as well as the server: never trust stale/mismatched metadata.
  const release = candidate && context && candidate.report_year === context.year && candidate.quarter === context.quarter
    && candidate.report_date.split('.').reverse().join('-') === context.date ? candidate : null;
  const saving = transfer?.key === key ? transfer.saving : null;
  const downloadError = transfer?.key === key ? transfer.error : '';

  let status = !context ? 'Word станет доступен после загрузки выбранного среза.'
    : !current ? 'Проверяем готовность Word…'
      : current.error || 'Для выбранной даты, года и квартала проверенный комплект ещё не выпущен.';
  if (release) {
    status = `Word: ${release.status === 'VERIFIED' ? 'проверен' : 'проверен, есть замечания'}. Источники прочитаны ${timestamp.format(new Date(release.cutoff_at))} (Камчатка).`;
    if (context?.mode === 'live') status += ' Данные в прямом эфире могут обновиться позднее.';
  }
  const attempt = current?.data?.attempt;
  const attemptDay = attempt?.report_date?.split('.').reverse().join('-')
    ?? (attempt?.started_at ? businessDay.format(new Date(attempt.started_at)) : null);
  const attemptApplies = context?.mode === 'live' && attemptDay === context.date
    && context.year === Number(attemptDay?.slice(0, 4))
    && context.quarter === Math.ceil(Number(attemptDay?.slice(5, 7)) / 3);
  if (attemptApplies && attempt?.status === 'RUNNING') status += ' Готовится следующий комплект.';
  if (attemptApplies && attempt?.status === 'NOT_ISSUED') {
    status += ' Новый комплект не выпущен.';
    if (attempt.blockers?.length) status += ` ${attempt.blockers.map(x => x.message).join(' ')}`;
  }
  if (release && current?.error) status += ` ${current.error}`;

  async function download(kind: Kind) {
    if (!key || !release || saving || downloadController.current && !downloadController.current.signal.aborted) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setPinned({ key, release });
    setTransfer({ key, saving: kind, error: '' });
    try {
      const file = kind === 'main' ? 'main.docx' : 'supplement.docx';
      const blob = await fetchBlob(`/report-releases/${release.release_id}/${file}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind === 'main' ? 'Отчёт' : 'Дополнение'}-${release.report_date}.docx`;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
      setTransfer({ key, saving: null, error: '' });
    } catch {
      if (!controller.signal.aborted) setTransfer({ key, saving: null, error: 'Не удалось загрузить Word. Нажмите кнопку ещё раз.' });
    } finally {
      controller.abort();
    }
  }
  return { release, status, saving, downloadError, download };
}
