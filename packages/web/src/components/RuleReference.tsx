import { useState } from 'react';
import { procurementRuleSections, procurementRulesMarkdown, RULE_REFERENCE_COPY as COPY } from '@aemr/shared';

export function RuleReference() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const sections = procurementRuleSections();
  function markdown() {
    const url = URL.createObjectURL(new Blob([procurementRulesMarkdown()], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pravila-dash.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  async function word() {
    setPending(true); setError(false);
    try {
      const { buildDocument, downloadDocx } = await import('../lib/report/docx/build-docx');
      const blocks = sections.flatMap(section => [
        { kind: 'heading' as const, text: section.title },
        ...section.paragraphs.map(text => ({ kind: 'text' as const, text })),
      ]);
      await downloadDocx(buildDocument(blocks, COPY.title), 'pravila-dash.docx');
    } catch { setError(true); } finally { setPending(false); }
  }
  return <details className="rounded-xl border border-[var(--line-card)] p-4">
    <summary className="cursor-pointer text-sm font-semibold">{COPY.title}</summary>
    <div className="flex flex-wrap gap-4 py-3 text-sm">
      <button type="button" className="underline" onClick={markdown}>{COPY.markdown}</button>
      <button type="button" className="underline" disabled={pending} onClick={() => void word()}>{pending ? COPY.pending : COPY.docx}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{COPY.failure}</p>}
    {sections.map(section => <section key={section.title} className="mt-4 text-sm">
      <h3 className="font-semibold">{section.title}</h3>
      {section.paragraphs.map((paragraph, i) => <p className="mt-2" key={i}>{paragraph}</p>)}
    </section>)}
  </details>;
}
