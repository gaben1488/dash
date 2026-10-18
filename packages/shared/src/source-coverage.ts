import { z } from 'zod';

/** Read coverage, independent of row count; completeness does not assert cross-book atomicity. */
export interface SourceCoverage {
  expectedDepartments: string[];
  readDepartments: string[];
  unreadDepartments: Array<{ department: string; reason: string }>;
  complete: boolean;
}

export const SourceCoverageSchema: z.ZodType<SourceCoverage> = z.object({
  expectedDepartments: z.array(z.string()),
  readDepartments: z.array(z.string()),
  unreadDepartments: z.array(z.object({ department: z.string(), reason: z.string() })),
  complete: z.boolean(),
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
  return { expectedDepartments: [...expectedDepartments], readDepartments: read, unreadDepartments, complete: unreadDepartments.length === 0 };
}

/** Shared wording: a partial subtotal must never be presented as the whole scope. */
export function sourceCoverageNote(coverage: SourceCoverage | undefined): string | null {
  if (!coverage || coverage.complete) return null;
  return `Прочитано книг: ${coverage.readDepartments.length} из ${coverage.expectedDepartments.length}. Не прочитаны: ${coverage.unreadDepartments.map(item => item.department).join(', ')}. Показан только прочитанный состав; общий итог не подтверждён.`;
}
