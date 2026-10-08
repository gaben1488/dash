import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BookOpenCheck, Check, ChevronDown, ChevronUp, FileClock, FilePlus2,
  Info, Pencil, RefreshCw, Search, X,
} from 'lucide-react';
import { ALL_DEPT_IDS } from '@aemr/shared';
import { api, humanizeRequestError, type LedgerRecommendation,
  type RecommendationDraftEdit, type RecommendationDraftInput,
  type RecommendationLedgerResponse, type RecommendationStage } from '../../api';

const PAGE_SIZE = 12;
type Scope = 'active' | 'history' | 'drafts' | 'all';
type DraftValues = Omit<RecommendationDraftInput, 'expectedRevision'> & { stage: 'DRAFT' | 'ARCHIVED_DRAFT' };
const INITIAL_DRAFT: DraftValues = { grbs: 'УЭР', text: '', sourceIds: [], note: '', stage: 'DRAFT' };

function stageLabel(stage: RecommendationStage) {
  switch (stage) {
    case 'DRAFT': return 'Черновик';
    case 'ARCHIVED_DRAFT': return 'Черновик отложен';
    case 'ACTIVE': return 'В действующем списке';
    case 'HISTORY': return 'Историческая запись';
  }
}
function statusClass(stage: RecommendationStage) {
  if (stage === 'DRAFT') return 'bg-amber-50 text-amber-800 dark:bg-amber-200/10 dark:text-amber-200';
  if (stage === 'ARCHIVED_DRAFT') return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  if (stage === 'ACTIVE') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300';
  return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
}

interface EditorProps {
  initial: DraftValues;
  busy: boolean;
  saveLabel: string;
  onCancel: () => void;
  onSave: (entry: DraftValues) => void;
}
function DraftEditor({ initial, busy, saveLabel, onCancel, onSave }: EditorProps) {
  const [grbs, setGrbs] = useState(initial.grbs);
  const [text, setText] = useState(initial.text);
  const [numbers, setNumbers] = useState(initial.sourceIds.join(', '));
  const [note, setNote] = useState(initial.note);
  const [stage, setStage] = useState(initial.stage);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceIds = numbers.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean);
    onSave({ grbs, text: text.trim(), sourceIds, note: note.trim(), stage });
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-4 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-transparent dark:bg-zinc-900/60">
      <div className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
        <Info size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
        <span><strong>Черновик не попадёт в официальный Word.</strong> Он сохранится в этом реестре и останется доступен для дальнейшей работы. Официальный выпуск — отдельное установленное действие, которое эта форма не подменяет.</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,230px)_1fr]">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Управление
          <select aria-label="Управление" value={grbs} onChange={e => setGrbs(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-100">
            {ALL_DEPT_IDS.map(d => <option value={d} key={d}>{d}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
          Номера закупочных позиций
          <input value={numbers} onChange={e => setNumbers(e.target.value)}
            aria-label="Номера закупочных позиций (через запятую)"
            placeholder="Например: 42, 43, 105" maxLength={5000}
            className="mt-1.5 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-100" />
          <span className="mt-1 block font-normal text-zinc-500">Через запятую. Можно оставить пустым, если связь ещё не определена.</span>
        </label>
      </div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        Текст рекомендации
        <textarea aria-label="Текст рекомендации" required minLength={10} maxLength={6000}
          value={text} onChange={e => setText(e.target.value)} rows={4}
          placeholder="Что предлагается изменить или проверить?"
          className="mt-1.5 block w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-100" />
      </label>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
        Рабочее пояснение <span className="font-normal text-zinc-400">(не включается в отчёт)</span>
        <textarea aria-label="Рабочее пояснение" maxLength={2000} rows={2}
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="Что нужно уточнить, на какой документ опираемся…"
          className="mt-1.5 block w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-100" />
      </label>
      {initial.stage === 'ARCHIVED_DRAFT' || saveLabel !== 'Сохранить черновик' ? (
        <label className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          Состояние проекта
          <select value={stage} aria-label="Состояние проекта" onChange={e => setStage(e.target.value as DraftValues['stage'])}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-transparent dark:bg-zinc-800">
            <option value="DRAFT">В работе</option>
            <option value="ARCHIVED_DRAFT">Отложен</option>
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-200 dark:hover:bg-amber-100">
          <Check size={16} aria-hidden />{busy ? 'Сохраняем…' : saveLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="rounded-lg px-3 py-2.5 text-sm text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Отмена
        </button>
      </div>
    </form>
  );
}

function RecordDetails({ record, editing, busy, onStartEdit, onStopEdit, onSaveNote, onSaveDraft }: {
  record: LedgerRecommendation;
  editing: boolean;
  busy: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSaveNote: (note: string) => void;
  onSaveDraft: (values: DraftValues) => void;
}) {
  const [note, setNote] = useState(record.note);
  useEffect(() => { setNote(record.note); }, [record.note]);
  const draft = record.stage === 'DRAFT' || record.stage === 'ARCHIVED_DRAFT';
  return (
    <div className="border-t border-zinc-100 px-4 pb-4 pt-4 dark:border-transparent sm:px-5">
      {draft && editing ? (
        <DraftEditor key={record.id} initial={{
          grbs: record.grbs, text: record.text, sourceIds: record.sourceIds,
          note: record.note, stage: record.stage === 'ARCHIVED_DRAFT' ? 'ARCHIVED_DRAFT' : 'DRAFT',
        }} busy={busy} saveLabel="Сохранить изменения" onCancel={onStopEdit} onSave={onSaveDraft} />
      ) : (
        <div className="space-y-3">
          {record.sourceIds.length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Связанные номера закупок</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {record.sourceIds.map(n => <span key={n} className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{n}</span>)}
              </div>
            </div>
          )}
          {!draft && (
            <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Исходный текст и ответы не переписываются — сохраняется история выпущенного документа.
              </p>
              {record.grbsResponse && <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300"><strong>Первоначальный ответ ГРБС:</strong> {record.grbsResponse}</p>}
              {record.uerDecision && <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300"><strong>Первоначальное решение УЭР:</strong> {record.uerDecision}</p>}
              {record.statusLabel && <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Зафиксированное историческое состояние{record.statusAsOf ? ` на ${record.statusAsOf}` : ''}: {record.statusLabel}.
                Это не подтверждение сегодняшнего исполнения.
              </p>}
            </div>
          )}
          {!draft && editing ? (
            <form onSubmit={event => { event.preventDefault(); onSaveNote(note.trim()); }} className="space-y-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-200">
                Рабочее пояснение
                <textarea aria-label="Рабочее пояснение" maxLength={2000} rows={3}
                  value={note} onChange={e => setNote(e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-transparent dark:bg-zinc-900" />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy}
                  className="rounded-lg bg-amber-200 px-3 py-2 text-xs font-semibold text-zinc-900 disabled:opacity-50">
                  {busy ? 'Сохраняем…' : 'Сохранить пояснение'}
                </button>
                <button type="button" onClick={onStopEdit} disabled={busy}
                  className="rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <>
              {record.note && <p className="rounded-lg border border-zinc-200/70 p-3 text-xs leading-relaxed text-zinc-600 dark:border-transparent dark:text-zinc-300"><strong>Рабочее пояснение:</strong> {record.note}</p>}
              <button type="button" onClick={onStartEdit}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-transparent dark:text-zinc-200 dark:hover:bg-zinc-800">
                <Pencil size={13} aria-hidden />
                {draft ? 'Редактировать черновик' : record.note ? 'Изменить рабочее пояснение' : 'Добавить рабочее пояснение'}
              </button>
            </>
          )}
        </div>
      )}
      {record.history.length > 0 && (
        <details className="mt-4 border-t border-zinc-100 pt-3 dark:border-transparent">
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
            История редактирования · {record.history.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {record.history.slice().reverse().map((item, index) => (
              <li key={item.at + index} className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {item.at ? new Date(item.at).toLocaleString('ru-RU') : 'Без даты'} — {
                  item.kind === 'created' ? 'создан черновик' : item.kind === 'note' ? 'обновлено пояснение' : 'изменён черновик'
                }.
                {item.previousNote && <span className="block mt-0.5">Предыдущее пояснение: {item.previousNote}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function RecommendationRegister() {
  const [data, setData] = useState<RecommendationLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<Scope>('active');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getReportRecommendations().then(value => {
      if (!active) return;
      if (!value || !Array.isArray(value.records) || !value.counts
          || typeof value.revision !== 'string') {
        throw new Error('Сервер вернул неполный реестр рекомендаций. Данные не изменены.');
      }
      setData(value); setError(null);
    }).catch(err => {
      if (!active) return;
      setError(humanizeRequestError(err)); setData(null);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru-RU');
    const records = data?.records ?? [];
    return records.filter(record => {
      if (scope === 'active' && record.stage !== 'ACTIVE') return false;
      if (scope === 'history' && record.stage !== 'HISTORY') return false;
      if (scope === 'drafts' && record.stage !== 'DRAFT' && record.stage !== 'ARCHIVED_DRAFT') return false;
      if (dept !== 'all' && record.grbs !== dept) return false;
      if (search && ![record.id, record.grbs, record.text, record.note, ...record.sourceIds]
        .some(value => value.toLocaleLowerCase('ru-RU').includes(search))) return false;
      return true;
    });
  }, [data, scope, dept, query]);

  async function save(request: () => Promise<unknown>, success: string, done: () => void) {
    setBusy(true);
    setSavingError(null);
    try {
      await request();
      done();
      setNotice(success);
      setRetry(prev => prev + 1);
    } catch (err) {
      setSavingError(humanizeRequestError(err));
    } finally {
      setBusy(false);
    }
  }

  const changeScope = (next: Scope) => {
    setScope(next);
    setLimit(PAGE_SIZE);
    setExpanded(null);
    setEditing(null);
  };
  const counts = data?.counts;
  const scopeButtons: { key: Scope; name: string; count: number | null }[] = [
    { key: 'active', name: 'Действующие', count: counts?.active ?? null },
    { key: 'history', name: 'История', count: counts?.historical ?? null },
    { key: 'drafts', name: 'Черновики', count: counts ? counts.drafts + counts.archivedDrafts : null },
    { key: 'all', name: 'Все записи', count: data?.records.length ?? null },
  ];
  return (
    <section id="report-recommendations" aria-label="Реестр рекомендаций"
      className="scroll-mt-4 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-transparent dark:bg-zinc-900/80">
      <div className="border-b border-zinc-100 p-4 dark:border-transparent sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-100 p-2.5 text-amber-800 dark:bg-amber-200/10 dark:text-amber-200">
              <BookOpenCheck size={21} aria-hidden />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Реестр рекомендаций</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Накопительная история УЭР и рабочие черновики. Это один реестр, а не список автоматических замечаний из «Контроля».
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" aria-label="Обновить реестр" title="Перечитать изменения других сотрудников"
              onClick={() => { setSavingError(null); setNotice(''); setRetry(n => n + 1); }}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-200 p-2.5 text-zinc-600 hover:bg-zinc-100 dark:border-transparent dark:text-zinc-300 dark:hover:bg-zinc-800">
              <RefreshCw size={16} aria-hidden />
            </button>
            <button type="button" onClick={() => { setCreating(value => !value); setSavingError(null); }}
              aria-expanded={creating} disabled={!data || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-200 px-3.5 py-2.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-amber-100 disabled:opacity-50">
              {creating ? <X size={15} aria-hidden /> : <FilePlus2 size={15} aria-hidden />}
              {creating ? 'Закрыть форму' : 'Новая рекомендация'}
            </button>
          </div>
        </div>
        {notice && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <Check size={14} aria-hidden /> {notice}
        </p>}
        {savingError && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
          {savingError} <button type="button" onClick={() => setRetry(v => v + 1)}
            className="ml-2 font-semibold underline underline-offset-2">Обновить записи</button>
        </div>}
        {creating && data && (
          <DraftEditor initial={INITIAL_DRAFT} busy={busy} saveLabel="Сохранить черновик"
            onCancel={() => setCreating(false)}
            onSave={entry => { void save(() => api.createReportRecommendation({
              expectedRevision: data.revision, grbs: entry.grbs, text: entry.text,
              sourceIds: entry.sourceIds, note: entry.note,
            }), 'Черновик сохранён. Он не включён в официальный отчёт.', () => {
              setCreating(false); changeScope('drafts');
            }); }} />
        )}
      </div>

      {loading && !data ? (
        <div role="status" className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Загружаем сохранённые рекомендации…
        </div>
      ) : error ? (
        <div className="px-5 py-8 text-center">
          <FileClock size={28} className="mx-auto mb-3 text-zinc-400" aria-hidden />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Рабочий реестр не загрузился
          </p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">{error}</p>
          <button type="button" onClick={() => setRetry(n => n + 1)}
            className="mt-4 rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            Повторить чтение
          </button>
        </div>
      ) : data ? (
        <>
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Состояние рекомендаций">
              {scopeButtons.map(item => (
                <button type="button" key={item.key}
                  aria-pressed={scope === item.key}
                  onClick={() => changeScope(item.key)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${scope === item.key
                    ? 'bg-zinc-900 text-white dark:bg-amber-200 dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}`}>
                  {item.name}{item.count !== null ? ` · ${item.count}` : ''}
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(140px,220px)]">
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
                <input type="search" aria-label="Поиск по рекомендациям"
                  value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
                  placeholder="Номер, текст, управление или рабочая заметка…"
                  className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-100" />
              </label>
              <select aria-label="Фильтр ГРБС" value={dept}
                onChange={e => { setDept(e.target.value); setLimit(PAGE_SIZE); }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-200">
                <option value="all">Все управления</option>
                {ALL_DEPT_IDS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Показано: {Math.min(visible.length, limit)} из {visible.length}. Рабочие пояснения не изменяют опубликованные документы.
            </p>
          </div>
          <div className="border-t border-zinc-100 dark:border-transparent">
            {visible.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Нет записей по выбранным условиям</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Смените фильтр или уточните поиск. Исторические записи не удалены.
                </p>
              </div>
            ) : visible.slice(0, limit).map(record => {
              const opened = expanded === record.id;
              return (
                <article key={record.id} className="border-b border-zinc-100 last:border-b-0 dark:border-transparent">
                  <button type="button" aria-expanded={opened} aria-controls={`rec-details-${record.id}`}
                    onClick={() => { setExpanded(opened ? null : record.id); setEditing(null); setSavingError(null); }}
                    className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 sm:px-5">
                    <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {opened ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{record.grbs}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusClass(record.stage)}`}>{stageLabel(record.stage)}</span>
                        {record.sourceIds.length > 0 && <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">№ {record.sourceIds.slice(0, 3).join(', ')}{record.sourceIds.length > 3 ? ` +${record.sourceIds.length - 3}` : ''}</span>}
                      </span>
                      <span className="block text-sm font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">{record.text}</span>
                      {record.statusLabel && <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                        Историческая оценка{record.statusAsOf ? ` · ${record.statusAsOf}` : ''}: {record.statusLabel}
                      </span>}
                    </span>
                  </button>
                  {opened && (
                    <div id={`rec-details-${record.id}`}>
                      <RecordDetails key={record.id} record={record}
                        editing={editing === record.id} busy={busy}
                        onStartEdit={() => setEditing(record.id)}
                        onStopEdit={() => setEditing(null)}
                        onSaveNote={value => { void save(() => api.updateReportRecommendation(record.id, {
                          expectedRevision: data.revision, note: value,
                        }), 'Рабочее пояснение сохранено.', () => setEditing(null)); }}
                        onSaveDraft={value => { const payload: RecommendationDraftEdit = {
                          expectedRevision: data.revision, grbs: value.grbs, text: value.text,
                          sourceIds: value.sourceIds, note: value.note, stage: value.stage,
                        }; void save(() => api.updateReportRecommendation(record.id, payload),
                          'Черновик обновлён.', () => setEditing(null)); }}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {limit < visible.length && (
            <div className="flex justify-center p-4">
              <button type="button" onClick={() => setLimit(n => n + PAGE_SIZE)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-transparent dark:text-zinc-200 dark:hover:bg-zinc-800">
                Показать ещё {Math.min(PAGE_SIZE, visible.length - limit)}
              </button>
            </div>
          )}
          <div className="border-t border-zinc-100 bg-zinc-50/70 px-4 py-3 text-[11px] leading-relaxed text-zinc-500 dark:border-transparent dark:bg-zinc-900/60 dark:text-zinc-400 sm:px-5">
            <Info size={13} className="mr-1 inline align-[-2px]" aria-hidden />
            Реестр отражает сохранённую рабочую историю. Статусы выполнения в официальных документах проверяются генератором по отдельным доказательствам. Черновик не равен выпущенной рекомендации.
          </div>
        </>
      ) : null}
    </section>
  );
}
