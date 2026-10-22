import { useEffect, useMemo, useState } from 'react';
import {
  procurementEditableGuidance, procurementRuleSections, procurementRulesMarkdown,
  RULE_REFERENCE_COPY as COPY,
} from '@aemr/shared';
import { api, humanizeRequestError, type EditorialGuidanceEntry, type EditorialGuidanceResponse } from '../api';

const GROUPS: Record<EditorialGuidanceEntry['section'], string> = {
  field: 'Правила заполнения',
  ep: 'Основания ЕП',
  stage: 'Этапы и объяснения',
  seasonal: 'Сезонные ориентиры',
};

/** Never treat an incomplete/old HTTP response as the saved catalog. */
export function checkedGuidanceResponse(data: EditorialGuidanceResponse): EditorialGuidanceEntry[] {
  const baseline = procurementEditableGuidance();
  if (data?.version !== 'C06.03-editorial-v1' || data.calculationRulesChanged !== false ||
      !Array.isArray(data.entries) || data.entries.length !== baseline.length) {
    throw new Error('Сервер не подтвердил полную редакцию справочника');
  }
  const expected = new Map(baseline.map(entry => [entry.key, entry]));
  const unique = new Set<string>();
  for (const item of data.entries) {
    const origin = expected.get(item.key);
    if (!origin || unique.has(item.key) || item.defaultText !== origin.defaultText ||
        item.section !== origin.section || typeof item.text !== 'string' ||
        item.text.trim() === '' || !Number.isSafeInteger(item.revision) || item.revision < 0 ||
        typeof item.overridden !== 'boolean' ||
        (item.updatedAt !== null && typeof item.updatedAt !== 'string')) {
      throw new Error('Редакция справочника несовместима с текущей версией приложения');
    }
    unique.add(item.key);
  }
  return data.entries;
}

export function RuleReference() {
  const [entries, setEntries] = useState<EditorialGuidanceEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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

  const overlays = useMemo(() => Object.fromEntries(
    (entries ?? []).filter(entry => entry.overridden).map(entry => [entry.key, entry.text]),
  ), [entries]);
  const sections = useMemo(() => procurementRuleSections(overlays), [overlays]);

  function markdown() {
    if (entries === null) return;
    const url = URL.createObjectURL(new Blob([procurementRulesMarkdown(overlays)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pravila-dash.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function word() {
    if (entries === null) return;
    setPending(true); setExportError(false);
    try {
      const { buildDocument, downloadDocx } = await import('../lib/report/docx/build-docx');
      const blocks = sections.flatMap(section => [
        { kind: 'heading' as const, text: section.title },
        ...section.paragraphs.map(text => ({ kind: 'text' as const, text })),
      ]);
      await downloadDocx(buildDocument(blocks, COPY.title), 'pravila-dash.docx');
    } catch { setExportError(true); } finally { setPending(false); }
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
      setEntries(received); setEditing(null); setReason('');
      setSaveMessage('Редакция сохранена и повторно прочитана. Расчёты и прошлые отчёты не изменены.');
    } catch (err) {
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
      <button type="button" className="underline disabled:opacity-40" disabled={!entries} onClick={markdown}>{COPY.markdown}</button>
      <button type="button" className="underline disabled:opacity-40" disabled={!entries || pending}
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
