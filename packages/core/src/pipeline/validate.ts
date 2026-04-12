import { nanoid } from 'nanoid';
import type { Issue, NormalizedMetric, ValidationRule, ClassifiedRow, ReportMapEntry } from '@aemr/shared';
import { CHECK_REGISTRY, LEGACY_RULE_TO_CHECK } from '@aemr/shared';

/** Check if program name is meaningful (not empty/"X"/"x"/"Х"/"х") */
function hasProgramName(val: unknown): boolean {
  const s = String(val ?? '').trim();
  if (!s) return false;
  if (/^[XxХх]$/u.test(s)) return false;
  return true;
}

/** Derive activity type from column F (TYPE) + column D/E (program name) */
function deriveActivityType(cells: Record<string, unknown>): Issue['activityType'] {
  const typeText = String(cells?.F ?? '').trim().toLowerCase();
  if (!typeText) return undefined;
  if (typeText.includes('программное мероприятие')) return 'program';
  if (typeText.includes('текущая')) {
    // ТД в рамках ПМ = реальный текст ПМ, ТД вне ПМ = X/x/Х/х/пусто
    return hasProgramName(cells?.E) ? 'current_program' : 'current_non_program';
  }
  return 'current_program';
}

/**
 * Выполняет валидацию данных по правилам RuleBook.
 *
 * Each rule in the RULE_BOOK has a `check()` method that is called per-row.
 * Rules are scoped (svod / department / both) and filtered accordingly.
 */
export function validateData(
  _metrics: Map<string, NormalizedMetric>,
  rows: ClassifiedRow[],
  rules: ValidationRule[],
  _reportMap: ReportMapEntry[],
): Issue[] {
  const issues: Issue[] = [];
  const now = new Date().toISOString();

  // Determine sheet type from first row (all rows in one call are from the same sheet)
  const sheetName = rows.length > 0 ? rows[0].sheet : '';
  const isSvod = sheetName === 'СВОД ТД-ПМ';

  for (const rule of rules) {
    if (rule.enabled === false) continue;

    // Scope filtering: prevent SVOD-specific rules from running on dept sheets and vice versa
    if (rule.scope === 'svod' && !isSvod) continue;
    if (rule.scope === 'department' && isSvod) continue;

    // Run the rule's check() against each applicable row
    for (const row of rows) {
      // ALWAYS skip header rows (first 3 rows of dept sheets) — they contain column titles, not data
      if (row.classification === 'header') continue;
      if (rule.rowFilter && !rule.rowFilter.includes(row.classification)) continue;
      const ctx: import('@aemr/shared').RuleCheckContext = {
        cells: row.cells,
        rowIndex: row.rowIndex,
        sheet: row.sheet,
        classification: row.classification,
        allRows: rows,
      };
      const result = rule.check(ctx);
      if (!result.passed) {
        // Enrich with unified class system metadata
        const checkId = LEGACY_RULE_TO_CHECK[rule.id] ?? rule.id;
        const check = CHECK_REGISTRY.find(c => c.id === checkId);

        // Use CHECK_REGISTRY severity (5-level: critical/error/significant/warning/info)
        // instead of rule.severity (3-level: error/warning/info) for proper trust scoring
        const effectiveSeverity = check?.severity ?? rule.severity;

        issues.push({
          id: nanoid(),
          severity: effectiveSeverity,
          origin: rule.origin,
          category: rule.id,
          group: check?.group,
          checkId,
          kbHint: check?.kbHint,
          title: `${rule.name}: строка ${row.rowIndex}`,
          description: result.message ?? rule.description,
          sheet: row.sheet,
          cell: result.cell,
          row: row.rowIndex,
          recommendation: check?.recommendation ?? rule.description,
          activityType: deriveActivityType(row.cells),
          subordinateId: String(row.cells['C'] ?? '').trim() || '_org_itself',
          status: 'open',
          detectedAt: now,
          detectedBy: `rule:${rule.id}`,
        });
      }
    }
  }

  return issues;
}
