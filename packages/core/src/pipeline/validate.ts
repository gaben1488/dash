import { issueIdentity, nextOccurrence, SEP } from './issue-identity.js';
import type { Issue, NormalizedMetric, ValidationRule, ClassifiedRow, ReportMapEntry } from '@aemr/shared';
import { CHECK_REGISTRY, LEGACY_RULE_TO_CHECK, subordinateKey, classifyActivity, classifySheet } from '@aemr/shared';

/**
 * Вид деятельности строки — канон classifyActivity (@aemr/shared): F +
 * графа программы D. Прежняя локальная копия читала ПОДПРОГРАММУ (E)
 * вместо D — 91 живая ТД-строка носила неверный activityType, — а мусор
 * в F произвольно зачисляла в current_program; теперь нераспознанный
 * вид — честное отсутствие поля.
 */
function deriveActivityType(cells: Record<string, unknown>): Issue['activityType'] {
  return classifyActivity(cells?.F, cells?.D) ?? undefined;
}

/**
 * Округляет «голые» float'ы в тексте замечания до копеек (2 знака).
 *
 * П.3 интервью 14.08.2026: текст «O237 (факт) = 7138.1467200000025» путал
 * исполнителей — хвост двоичной арифметики смысла не несёт, суммы книг
 * ведутся в 2 знака. Правило класса: ЛЮБОЙ текст правила проходит через эту
 * одну дверь (validateData — единственное место, где result.message
 * становится issue.description), поэтому длинный float не может просочиться
 * ни из одного правила RULE_BOOK, нынешнего или будущего.
 *
 * Даты не искажаются: слева от совпадения не должно быть точки/цифры
 * (у «09.2025» внутри «03.09.2025» слева стоит точка), справа — ещё одного
 * числового сегмента («.цифра»); точка конца предложения не мешает.
 */
export function roundMoneyInText(text: string): string {
  return text.replace(/(?<![\d.,])\d+\.\d{3,}(?!\.?\d)/g, (m) => Number(m).toFixed(2));
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
  // SSOT: classifySheet решает scope. ШДЮ «СВОД с месяцами» = shdyu_monthly (иная
  // раскладка) → НЕ department, НЕ svod → generic-правила его не трогают (фикс
  // ложных падений валидации ШДЮ; УКСиМП/УАГЗО корректно идут как department).
  const sheetName = rows.length > 0 ? rows[0].sheet : '';
  const idOccurrence = new Map<string, number>();
  const sheetClass = classifySheet(sheetName);

  // Тихие провалы запрещены (AGENTS.md carve-out): нераспознанный лист молча
  // теряет ВСЕ svod- и department-scoped правила ниже (scope='both' по-прежнему
  // выполняется) — раньше это было полностью бесшумно. Один сигнал на лист.
  if (sheetClass.kind === 'unknown' && rows.length > 0) {
    issues.push({
      id: issueIdentity(['sheet', sheetName]),
      severity: 'warning',
      origin: 'runtime_error',
      category: 'unclassified_sheet',
      title: `Лист не распознан: ${sheetName || '(без имени)'}`,
      description: 'classifySheet() вернул unknown — svod- и department-scoped правила пропущены для всех строк этого листа (правила scope="both" по-прежнему выполняются).',
      sheet: sheetName,
      recommendation: 'Проверить имя листа: опечатка, новый ГРБС ещё не добавлен в department-registry, либо лист действительно не относится к данным закупок.',
      status: 'open',
      detectedAt: now,
      detectedBy: 'pipeline:validate',
    });
  }

  for (const rule of rules) {
    if (rule.enabled === false) continue;

    // Scope filtering через classifySheet (SSOT): svod-правила только на свод;
    // department-правила только на листах ГРБС (department/subordinates_agg).
    // shdyu_monthly и unknown не получают ни svod-, ни department-правил.
    if (rule.scope === 'svod' && sheetClass.kind !== 'svod') continue;
    if (rule.scope === 'department' && sheetClass.kind !== 'department' && sheetClass.kind !== 'subordinates_agg') continue;

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
      let result;
      try {
        result = rule.check(ctx);
      } catch (_err) {
        // Skip broken rule, don't crash entire validation
        continue;
      }
      if (!result.passed) {
        // Enrich with unified class system metadata
        const checkId = LEGACY_RULE_TO_CHECK[rule.id] ?? rule.id;
        // Стабильный id (issue-identity.ts): содержимое-якорь, не номер строки.
        const idBase = ['rule', checkId, row.sheet, result.cell ?? '', String(row.cells['A'] ?? ''), String(row.cells['B'] ?? ''), String(row.cells['G'] ?? '')] as const;
        const occ = nextOccurrence(idOccurrence, idBase.join(SEP));
        const check = CHECK_REGISTRY.find(c => c.id === checkId);

        // Use CHECK_REGISTRY severity (5-level: critical/error/significant/warning/info)
        // instead of rule.severity (3-level: error/warning/info) for proper trust scoring
        const effectiveSeverity = check?.severity ?? rule.severity;

        issues.push({
          id: issueIdentity([...idBase, occ]),
          severity: effectiveSeverity,
          origin: rule.origin,
          category: rule.id,
          group: check?.group,
          checkId,
          kbHint: check?.kbHint,
          // П.3 интервью 14.08.2026: каждый текст проверки несёт имя листа —
          // «O237 (факт) = …» без книги исполнителю не найти. Номер строки —
          // номер строки ЛИСТА (rowIndex 1-based от начала листа со шляпкой,
          // как видит человек в Google Sheets) — пп.28/29: единая нумерация.
          title: `${rule.name}: лист «${row.sheet}», строка ${row.rowIndex}`,
          description: roundMoneyInText(result.message ?? rule.description),
          sheet: row.sheet,
          cell: result.cell,
          row: row.rowIndex,
          recommendation: check?.recommendation ?? rule.description,
          activityType: deriveActivityType(row.cells),
          subordinateId: subordinateKey(row.cells['C']),
          status: 'open',
          detectedAt: now,
          detectedBy: `rule:${rule.id}`,
        });
      }
    }
  }

  return issues;
}
