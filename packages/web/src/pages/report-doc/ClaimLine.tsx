/**
 * ClaimLine — claim-строка документа «Отчёт» (Отчёт++, шаг 2 брифа 01.08).
 *
 * Русская фраза, в которой каждое число — «утверждение с доказательством»:
 * выделено типографски (font-medium, tabular-nums) и является кнопкой с
 * точечным подчёркиванием — задел под «доказательство по клику» (шаг 6,
 * ProofOverlay: фраза → формула → строки-атомы → ячейка листа). Пока клик —
 * noop, кнопка честно подписана aria-label.
 *
 * Форматирование — ТОЛЬКО готовыми форматтерами lib/report/mappers
 * (канон DESIGN.md: toFixed/toLocaleString в страницах запрещены).
 */
import { fmtCount, fmtPct, fmtThousands } from '../../lib/report/mappers';

/** Число внутри фразы: вид определяет форматтер. */
export type ClaimNumber =
  | { kind: 'count'; value: number }
  | { kind: 'thousands'; value: number }
  | { kind: 'pct'; value: number | null };

/** Кусок claim-строки: обычный текст либо число-кнопка. */
export type ClaimPart = string | ClaimNumber;

function formatClaimNumber(n: ClaimNumber): string {
  switch (n.kind) {
    case 'count':
      return fmtCount(n.value);
    case 'thousands':
      return fmtThousands(n.value);
    case 'pct':
      return fmtPct(n.value);
  }
}

/** Заглушка до шага 6 (ProofOverlay): клик пока ничего не раскрывает. */
const noop = (): void => {};

export function ClaimLine({ parts, className }: {
  parts: readonly ClaimPart[];
  className?: string;
}) {
  return (
    <p className={className}>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={noop}
            aria-label="показать доказательство"
            title="Показать доказательство числа (в разработке)"
            className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100 underline decoration-dotted decoration-zinc-400 underline-offset-2 hover:decoration-zinc-700 dark:decoration-zinc-500 dark:hover:decoration-zinc-300"
          >
            {formatClaimNumber(part)}
          </button>
        ),
      )}
    </p>
  );
}
