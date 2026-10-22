/**
 * Current formula score from accepted per-book observations, independent of the
 * historical weekly snapshot. Both nightly and manual reads use the same
 * formula sink, so there is one evidence path and no extra Google request.
 */
import { summarizeCheckCoverage, type TrustCheckCounts } from '@aemr/shared';
import type { BookFormulaVerdict } from './formula-sink.js';
import type { FormulaDeliveryNote } from './source-refresh.js';

export interface FormulaBookAssessment {
  book: string;
  checkedAt: string | null;
  score: number | null;
  checks: TrustCheckCounts | null;
  defects: number | null;
}

export interface FormulaAssessment {
  expectedBooks: number;
  checkedBooks: number;
  checkedAt: string | null;
  score: number | null;
  checks: TrustCheckCounts | null;
  books: FormulaBookAssessment[];
}

/** An old verdict, a newer failed attempt or an incomplete column cannot earn a score. */
export function assessFormulaResults(
  expectedBooks: readonly string[],
  deliveries: readonly FormulaDeliveryNote[],
  verdicts: readonly BookFormulaVerdict[],
): FormulaAssessment {
  const attempts = new Map(deliveries.map(d => [d.book, d]));
  const byBook = new Map(verdicts.map(v => [v.book, v]));
  const books = [...new Set(expectedBooks)].sort((a, b) => a.localeCompare(b, 'ru')).map(book => {
    const attempt = attempts.get(book);
    const verdict = byBook.get(book);
    const checks = verdict?.checks;
    const checked = checks ? summarizeCheckCoverage([checks]) : null;
    const confirmed = attempt?.handled === true && attempt.persisted === true
      && attempt.formulasRead !== false && verdict?.at === attempt.at
      && checked?.score !== null && checked?.score !== undefined
      && checks?.failed === verdict.defects.length;
    return {
      book,
      checkedAt: confirmed ? verdict!.at : null,
      score: confirmed ? checked!.score : null,
      checks: confirmed ? { expected: checks!.expected, checked: checks!.checked, failed: checks!.failed } : null,
      defects: confirmed ? verdict!.defects.length : null,
    } satisfies FormulaBookAssessment;
  });
  const confirmed = books.filter(book => book.score !== null);
  const combined = confirmed.length === books.length && books.length > 0
    ? summarizeCheckCoverage(confirmed.map(book => book.checks!)) : null;
  return {
    expectedBooks: books.length,
    checkedBooks: confirmed.length,
    checkedAt: confirmed.length > 0 ? confirmed.map(book => book.checkedAt!).sort().at(-1)! : null,
    score: combined?.score ?? null,
    checks: combined ? {
      expected: combined.expected, checked: combined.checked, failed: combined.failed,
    } : null,
    books,
  };
}
