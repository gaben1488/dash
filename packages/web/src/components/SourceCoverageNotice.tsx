import { sourceCoverageNote, type SourceCoverage } from '@aemr/shared';

export function SourceCoverageNotice({ coverage }: { coverage?: SourceCoverage }) {
  const note = sourceCoverageNote(coverage);
  return note ? <p role="status" className="my-2 text-xs text-[var(--data-warn)]">{note}</p> : null;
}
