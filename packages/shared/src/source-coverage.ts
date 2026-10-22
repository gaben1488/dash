import { z } from 'zod';

/** Presence of a source is independent of its row count or cross-book atomicity. */
export interface SourceCoverage {
  expectedDepartments: string[];
  readDepartments: string[];
  unreadDepartments: Array<{ department: string; reason: string }>;
  complete: boolean;
}

/** Reject contradictory coverage rather than trusting a caller-supplied "complete". */
export const SourceCoverageSchema: z.ZodType<SourceCoverage> = z.object({
  expectedDepartments: z.array(z.string()),
  readDepartments: z.array(z.string()),
  unreadDepartments: z.array(z.object({ department: z.string(), reason: z.string() })),
  complete: z.boolean(),
}).superRefine((coverage, ctx) => {
  const expected = new Set(coverage.expectedDepartments);
  const read = new Set(coverage.readDepartments);
  const unread = new Set(coverage.unreadDepartments.map(item => item.department));
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (expected.size !== coverage.expectedDepartments.length) invalid('Repeated expected department');
  if (read.size !== coverage.readDepartments.length) invalid('Repeated read department');
  if (unread.size !== coverage.unreadDepartments.length) invalid('Repeated unread department');
  for (const department of read) {
    if (!expected.has(department)) invalid('Read department not in expected perimeter');
    if (unread.has(department)) invalid('Department both read and unread');
  }
  for (const department of unread) if (!expected.has(department)) invalid('Unread department not in expected perimeter');
  const actuallyComplete = expected.size > 0
    && expected.size === read.size
    && unread.size === 0
    && [...expected].every(department => read.has(department));
  if (coverage.complete !== actuallyComplete) invalid('Completeness contradicts source evidence');
  if ([...expected].some(department => !read.has(department) && !unread.has(department))) {
    invalid('An expected source has no read or failure result');
  }
});

export function departmentCoverage(
  expectedDepartments: readonly string[],
  readDepartments: readonly string[],
  failures: Readonly<Record<string, string>> = {},
): SourceCoverage {
  const read = expectedDepartments.filter(name => readDepartments.includes(name));
  const unreadDepartments = expectedDepartments.filter(name => !read.includes(name)).map(department => ({
    department,
    reason: failures[department] ?? 'Нет подтверждённого чтения книги в этом наборе данных.',
  }));
  const unique = new Set(expectedDepartments).size === expectedDepartments.length;
  return {
    expectedDepartments: [...expectedDepartments],
    readDepartments: read,
    unreadDepartments,
    complete: expectedDepartments.length > 0 && unique && unreadDepartments.length === 0,
  };
}

/** Unknown provenance is not the same thing as a confirmed complete perimeter. */
export function sourceCoverageNote(coverage: SourceCoverage | undefined): string | null {
  if (!coverage) return 'Нет сведений о полноте чтения источников. Общий итог не подтверждён.';
  if (coverage.expectedDepartments.length === 0) {
    return 'Не задан перечень ожидаемых источников. Общий итог не подтверждён.';
  }
  const read = new Set(coverage.readDepartments);
  const missing = coverage.expectedDepartments.filter(name => !read.has(name));
  if (coverage.complete && missing.length === 0 && coverage.unreadDepartments.length === 0) return null;
  const unread = [...new Set([...missing, ...coverage.unreadDepartments.map(item => item.department)])];
  const remaining = unread.length ? ` Не прочитаны: ${unread.join(', ')}.` : '';
  return `Прочитано книг: ${read.size} из ${coverage.expectedDepartments.length}.${remaining} Показан только подтверждённый состав; общий итог не подтверждён.`;
}
