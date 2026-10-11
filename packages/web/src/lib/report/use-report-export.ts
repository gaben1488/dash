import { useEffect, useRef, useState } from 'react';
import { SelectedReportReleaseStatusSchema, ReportRefreshResponseSchema, type SelectedReportReleaseStatus } from '@aemr/shared';
import { ApiContractError, ApiError, fetchBlob, fetchParsed } from '../../api';
import type { ReportMode } from './request';

export interface ExportContext { date: string; year: number; quarter: number; mode: ReportMode }
type Kind = 'main' | 'extra' | 'operational';
type Release = NonNullable<SelectedReportReleaseStatus['selected']>;
const timestamp = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kamchatka',
});
const businessDay = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kamchatka',
});

/** Distinguish edge auth, server failure and schema drift without showing private API bodies. */
function wordReadFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return `Вход на сайте не подтверждён (HTTP ${error.status}). Проверьте авторизацию домена и обновите страницу.`;
    }
    if (error.status === 404) return 'Сервер не нашёл сведения о выбранном выпуске (HTTP 404).';
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return `Сервис отчётов не ответил (HTTP ${error.status}). Последний опубликованный Word при этом может сохраниться.`;
    }
    return `Проверка готовности Word отклонена сервером (HTTP ${error.status}).`;
  }
  if (error instanceof ApiContractError) {
    return 'Несовместимый формат сведений о выпуске Word. Требуется синхронизация интерфейса и серверного контракта.';
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Проверка готовности Word превысила время ожидания. Серверный выпуск может сохраниться.';
  }
  return 'Не удалось проверить готовность Word. Причина не определена; автоматический повтор запланирован.';
}

/** Native Word actions share one frozen release, including across background updates. */
export function useReportExport(context: ExportContext | null) {
  const query = context ? new URLSearchParams({ date: context.date, year: String(context.year), quarter: String(context.quarter) }).toString() : null;
  const key = context ? `${context.mode}/${query}` : null;
  const archiveMode = context?.mode === 'archive';
  const [state, setState] = useState<{ key: string; data: SelectedReportReleaseStatus | null; error: string } | null>(null);
  const [pinned, setPinned] = useState<{ key: string; release: Release } | null>(null);
  const [transfer, setTransfer] = useState<{ key: string; saving: Kind | null; error: string } | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [refreshState, setRefreshState] = useState<{ key: string; busy: boolean; notice: string } | null>(null);

  useEffect(() => {
    setPinned(null);
    setTransfer(null);
    setRefreshState(null);
    if (!key || !query) return;
    const controller = new AbortController();
    let loading = false;
    let preparationRequested = false;
    async function load() {
      if (loading) return;
      loading = true;
      const requestController = new AbortController();
      const abort = () => requestController.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      let timeout = setTimeout(abort, 35_000);
      try {
        const data = await fetchParsed(`/report-releases?${query}`, SelectedReportReleaseStatusSchema, { signal: requestController.signal });
        if (controller.signal.aborted) return;
        setState({ key: key!, data, error: '' });
        if (archiveMode && !data.selected && data.archive?.status !== 'RUNNING' && !preparationRequested) {
          preparationRequested = true;
          setState({ key: key!, data: { ...data, archive: { status: 'RUNNING', code: 'ARCHIVE_BUSY',
            message: 'Собираем Word из сохранённого среза. Текущие таблицы не используются.' } }, error: '' });
          clearTimeout(timeout);
          timeout = setTimeout(abort, 610_000);
          const params = new URLSearchParams(query!);
          const prepared = await fetchParsed('/report-releases/prepare', SelectedReportReleaseStatusSchema, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: requestController.signal,
            body: JSON.stringify({ date: params.get('date'), year: Number(params.get('year')), quarter: Number(params.get('quarter')) }),
          });
          if (!controller.signal.aborted) setState({ key: key!, data: prepared, error: '' });
          if (prepared.archive?.code === 'ARCHIVE_BUSY') preparationRequested = false;
        }
      } catch (error) {
        preparationRequested = false;
        if (!controller.signal.aborted) setState({ key: key!, data: null, error: wordReadFailure(error) });
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { controller.abort(); downloadController.current?.abort(); clearInterval(timer); };
  }, [key, query, archiveMode]);

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
    const assurance = release.automation_assurance;
    if (assurance?.user_action_count) {
      status += ' Есть вопросы по исходным данным; подробности можно открыть ниже.';
    }
    // Engine-only historical uncertainty is kept in the collapsed diagnostics,
    // never framed as an error in an otherwise verified Word release.
    if (context?.mode === 'live') status += ' Данные в прямом эфире могут обновиться позднее.';
  }
  if (archiveMode && !release && current?.data?.archive) {
    status = current.data.archive.message;
    const missing = current.data.archive.coverage?.missing_sections;
    if (missing?.length) status += ` Не сохранены: ${missing.join('; ')}.`;
  }
  const attempt = current?.data?.attempt;
  const attemptDay = attempt?.report_date?.split('.').reverse().join('-')
    ?? (attempt?.started_at ? businessDay.format(new Date(attempt.started_at)) : null);
  const attemptApplies = context?.mode === 'live' && attemptDay === context.date
    && context.year === Number(attemptDay?.slice(0, 4))
    && context.quarter === Math.ceil(Number(attemptDay?.slice(5, 7)) / 3);
  const attemptStartMs = attempt?.started_at ? Date.parse(attempt.started_at) : NaN;
  const staleAttempt = attempt?.status === 'RUNNING' && Number.isFinite(attemptStartMs) &&
    Date.now() - attemptStartMs > 20 * 60_000;
  if (context?.mode === 'live' && staleAttempt) {
    // A terminated worker may leave an orphaned RUNNING marker.
    status += ' Предыдущая попытка имеет устаревший статус «выполняется». Новый выпуск не подтверждён; требуется проверка генератора.';
  }
  if (attemptApplies && attempt?.status === 'RUNNING' && !staleAttempt) status += ' Готовится следующий комплект.';
  if (attemptApplies && attempt?.status === 'NOT_ISSUED') {
    status += ' Новый комплект не выпущен.';
    const safeReason = attempt.error_code === 'MONITORING_SCHEMA_LIVE_GEOMETRY_MISMATCH'
      ? 'Изменилась схема справочника заказчиков; необходима проверенная совместимая версия генератора.'
      : attempt.error_code === 'SOURCE_CHANGED_DURING_FREEZE'
        ? 'Источник изменился во время снятия среза; данные нужно перечитать.'
        : attempt.error_code === 'GOOGLE_SHEET_TITLE_CHANGED_REVIEW_CONTRACT'
          ? 'Название источника изменилось без обновления контракта чтения.'
          : null;
    if (safeReason) status += ` ${safeReason}`;
    else if (!attempt.automation_assurance && attempt.blockers?.length) {
      status += ' Причина сохранена в диагностике сопровождения; исправлять отчёт вручную не требуется.';
    }
  }
  if (release && current?.error) status += ` ${current.error}`;

  async function download(kind: Kind) {
    if (kind === 'operational' && !release?.operational_available) return;
    if (!key || !release || saving || downloadController.current && !downloadController.current.signal.aborted) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setPinned({ key, release });
    setTransfer({ key, saving: kind, error: '' });
    try {
      const file = kind === 'main' ? 'main.docx' : kind === 'extra' ? 'supplement.docx' : 'operational.docx';
      const blob = await fetchBlob(`/report-releases/${release.release_id}/${file}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind === 'main' ? 'Отчёт' : kind === 'extra' ? 'Дополнение' : 'Оперативный отчёт'}-${release.report_date}.docx`;
      document.body.append(link);
      try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
      setTransfer({ key, saving: null, error: '' });
    } catch {
      if (!controller.signal.aborted) setTransfer({ key, saving: null, error: 'Не удалось загрузить Word. Нажмите кнопку ещё раз.' });
    } finally {
      controller.abort();
    }
  }
  async function refresh() {
    if (!key || archiveMode || refreshState?.key === key && refreshState.busy) return;
    // A user explicitly requesting new data releases the old download pair pin.
    // Background updates remain pinned until such an explicit action.
    setPinned(null);
    setRefreshState({ key, busy: true, notice: 'Запрашиваем новый срез исходных таблиц…' });
    try {
      const data = await fetchParsed('/report-releases/refresh', ReportRefreshResponseSchema, {
        method: 'POST',
      });
      setRefreshState({ key, busy: false, notice: data.message });
    } catch (error) {
      setRefreshState({ key, busy: false,
        notice: `Запрос обновления не принят. ${wordReadFailure(error)} Последний проверенный Word сохраняется.` });
    }
  }
  const canRefresh = Boolean(key && !archiveMode);
  const refreshing = refreshState?.key === key && refreshState.busy;
  const refreshNotice = refreshState?.key === key ? refreshState.notice : '';

  // Do not mix newer attempts with a pinned Word file. Both sets remain explicitly labelled.
  const assurance = release?.automation_assurance ?? null;
  const failedAttemptAssurance = attemptApplies && attempt?.status === 'NOT_ISSUED'
    ? attempt.automation_assurance ?? null : null;
  return { release, status, saving, downloadError, download, assurance, failedAttemptAssurance,
    canRefresh, refreshing, refreshNotice, refresh };
}
