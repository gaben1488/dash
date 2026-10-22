import { useEffect, useMemo, useState } from 'react';
import {
  checkedProcurementGuidanceResponse, procurementRuleSections, procurementRulesMarkdown,
  RULE_REFERENCE_COPY as COPY,
} from '@aemr/shared';
import { api, humanizeRequestError, type EditorialGuidanceEntry } from '../api';

const GROUPS: Record<EditorialGuidanceEntry['section'], string> = {
  field: 'Правила заполнения',
  ep: 'Основания ЕП',
  stage: 'Этапы и объяснения',
  seasonal: 'Сезонные ориентиры',
};

/** The editor and the reference view share one runtime validation contract. */
export const checkedGuidanceResponse = checkedProcurementGuidanceResponse;

export function RuleReference() {
  const [entries, setEntries] = useState<EditorialGuidanceEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getEditorialGuidance().then(result => {
      if (mounted) setEntries(checkedGuidanceResponse(result));
    }).catch(err => {
      if (mounted) setLoadError(humanizeRequestError(err));
    });
    return () => { mounted = false; };
  }, []);

  async function reloadEditorialCatalog() {
    if (reloading || saving) return;
    setReloading(true); setLoadError(null);
    try {
      const refreshed = checkedGuidanceResponse(await api.getEditorialGuidance());
      setEntries(refreshed); setEditing(null); setSaveMessage(null);
    } catch (err) {
      // Not even the previous response may be advertised as the latest revision.
      setEntries(null); setLoadError(humanizeRequestError(err));
    } finally {
      setReloading(false);
    }
  }

  const overlays = useMemo(() => Object.fromEntries(
    (entries ?? []).filter(entry => entry.overridden).map(entry => [entry.key, entry.text]),
  ), [entries]);
  const sections = useMemo(() => procurementRuleSections(overlays), [overlays]);

  // Refresh for EACH export: another operator may have edited the catalog since
  // this page opened. Never label an older screen revision as the current guide.
  async function freshGuidanceForExport() {
    const latest = checkedGuidanceResponse(await api.getEditorialGuidance());
    const latestOverrides = Object.fromEntries(
      latest.filter(entry => entry.overridden).map(entry => [entry.key, entry.text]),
    );
    setEntries(latest); setLoadError(null);
    return { sections: procurementRuleSections(latestOverrides), markdown: procurementRulesMarkdown(latestOverrides) };
  }

  function invalidateUnverifiedCatalog(err: unknown) {
    setEntries(null);
    setLoadError(humanizeRequestError(err));
    setExportError(true);
  }

  async function markdown() {
    if (!entries || pending || saving || reloading) return;
    setPending(true); setExportError(false);
    try {
      const latest = await freshGuidanceForExport();
      const url = URL.createObjectURL(new Blob([latest.markdown], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'pravila-dash.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) { invalidateUnverifiedCatalog(err); }
    finally { setPending(false); }
  }
  async function word() {
    if (!entries || pending || saving || reloading) return;
    setPending(true); setExportError(false);
    try {
      const latest = await freshGuidanceForExport();
      try {
        const { buildDocument, downloadDocx } = await import('../lib/report/docx/build-docx');
        const blocks = latest.sections.flatMap(section => [
          { kind: 'heading' as const, text: section.title },
          ...section.paragraphs.map(text => ({ kind: 'text' as const, text })),
        ]);
        await downloadDocx(buildDocument(blocks, COPY.title), 'pravila-dash.docx');
      } catch { setExportError(true); }
    } catch (err) { invalidateUnverifiedCatalog(err); }
    finally { setPending(false); }
  }

  async function saveEntry() {
    const existing = entries?.find(item => item.key === editing);
    if (!existing || saving || text.trim().length === 0 || reason.trim().length < 8) return;
    setSaving(true); setSaveMessage(null);
    try {
      const response = await api.updateEditorialGuidance(existing.key, text.trim(), reason.trim(), existing.revision);
      // Successful write alone is not acceptance: read back the same revision and text.
      const received = checkedGuidanceResponse(await api.getEditorialGuidance());
      const verified = received.find(item => item.key === existing.key);
      if (!verified || verified.revision !== response.revision || verified.text !== response.text ||
          verified.overridden !== response.overridden) {
        throw new Error('Сервер не подтвердил сохранённую редакцию. Перечитайте справочник.');
      }
      setEntries(received); setEditing(null); setReason(''); setLoadError(null);
      setSaveMessage('Редакция сохранена и повторно прочитана. Расчёты и прошлые отчёты не изменены.');
    } catch (err) {
      // The write may have succeeded even if its readback failed. The old
      // entries are no longer safe to export or edit until a new GET succeeds.
      setEntries(null);
      setLoadError('Состояние записи не подтверждено. Перечитайте справочник.');
      setSaveMessage(humanizeRequestError(err));
    } finally {
      setSaving(false);
    }
  }

  return <details className="rounded-xl border border-[var(--line-card)] p-4">
    <summary className="cursor-pointer text-sm font-semibold">{COPY.title}</summary>
    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
      Справочник пояснений — не источник правовых норм. Изменения описаний не меняют проверки,
      даты N/Q, пороги, первичные строки Google и уже опубликованные отчёты.
    </p>
    {loadError && <p role="alert" className="mt-2 text-sm text-red-700">
      Сохранённая редакция не прочитана: {loadError}. Ни правки, ни экспорт непроверенной редакции не разрешены.
    </p>}
    {!loadError && !entries && <p role="status" className="mt-2 text-sm">Читаем сохранённую редакцию справочника…</p>}
    <div className="flex flex-wrap gap-4 py-3 text-sm">
      <button type="button" className="underline disabled:opacity-40" disabled={reloading || saving}
        onClick={() => void reloadEditorialCatalog()}>{reloading ? 'Читаем редакцию…' : 'Перечитать справочник'}</button>
      <button type="button" className="underline disabled:opacity-40" disabled={!entries || pending || saving || reloading}
        onClick={() => void markdown()}>{COPY.markdown}</button>
      <button type="button" className="underline disabled:opacity-40" disabled={!entries || pending || saving || reloading}
        onClick={() => void word()}>{pending ? COPY.pending : COPY.docx}</button>
    </div>
    {exportError && <p role="alert" className="text-sm text-red-700">{COPY.failure}</p>}
    {sections.map(section => <section key={section.title} className="mt-4 text-sm">
      <h3 className="font-semibold">{section.title}</h3>
      {section.paragraphs.map((paragraph, i) => <p className="mt-2" key={i}>{paragraph}</p>)}
    </section>)}
    {entries && <details className="mt-5 border-t border-[var(--line-card)] pt-3">
      <summary className="cursor-pointer text-sm font-medium">
        Редактировать пояснения ({entries.filter(item => item.overridden).length} изменено)
      </summary>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Правка сохраняется на сервере с причиной и номером редакции; снятие правки
        возвращает исходный текст. Синонимы и критерии автоматической классификации здесь не меняются.
      </p>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
        {entries.map(item => <div key={item.key} className="border-b border-[var(--line-card)] pb-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium">{GROUPS[item.section]} · {item.key} · редакция {item.revision}</span>
            <button type="button" className="underline disabled:opacity-40" disabled={saving}
              onClick={() => {
                setEditing(item.key); setText(item.text); setReason(''); setSaveMessage(null);
              }}>Изменить</button>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{item.text}</p>
          {editing === item.key && <div className="mt-2 space-y-2">
            <label className="block text-xs">Редакция пояснения
              <textarea className="mt-1 w-full rounded border p-2 text-sm text-zinc-900"
                rows={3} maxLength={600} value={text} onChange={event => setText(event.target.value)} />
            </label>
            <label className="block text-xs">Причина изменения (не менее 8 знаков)
              <input className="mt-1 w-full rounded border p-2 text-sm text-zinc-900"
                maxLength={600} value={reason} onChange={event => setReason(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
              <button className="underline disabled:opacity-40" type="button"
                disabled={saving || !text.trim() || reason.trim().length < 8}
                onClick={() => void saveEntry()}>{saving ? 'Сохранение…' : 'Сохранить и проверить'}</button>
              <button type="button" className="underline" disabled={saving}
                onClick={() => setText(item.defaultText)}>Вернуть исходный текст</button>
              <button type="button" className="underline" disabled={saving} onClick={() => setEditing(null)}>Отмена</button>
            </div>
          </div>}
        </div>)}
      </div>
    </details>}
    {saveMessage && <p role="status" className="mt-3 text-xs">{saveMessage}</p>}
  </details>;
}
