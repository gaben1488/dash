import { issueIdentity, ruleIssueIdentityParts, nextOccurrence, SEP } from './issue-identity.js';
import type { TrustCheckCoverage, Issue, NormalizedMetric, ValidationRule, ClassifiedRow, ReportMapEntry } from '@aemr/shared';
import { CHECK_REGISTRY, LEGACY_RULE_TO_CHECK, subordinateKey, classifyActivity, classifySheet, SVOD_DASHBOARD_LAST_ROW } from '@aemr/shared';

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
/**
 * The four sum checks only apply to financial data. An entirely blank
 * separator or free-text note is not an unverified purchase: counting it in
 * the denominator creates false "rule_execution_failed" findings.
 */
const BOOK_SUM_RULES = new Set([
  'budget_sum_plan', 'budget_sum_fact', 'dept_fact_sum', 'dept_economy_sum',
]);

export function validateData(
  _metrics: Map<string, NormalizedMetric>,
  rows: ClassifiedRow[],
  rules: ValidationRule[],
  _reportMap: ReportMapEntry[],
  asOf: Date = new Date(),
  coverage?: TrustCheckCoverage[],
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
  // The source sheet's A279:U... is experimental, for Google Sheets alone.
  // Every rule (including scope='both'), header/layout evidence and allRows
  // must exclude it. 1–278 remain live; other GRBS sheets are unaffected.
  const scopedRows = sheetClass.kind === 'svod'
    ? rows.filter(row => row.rowIndex <= SVOD_DASHBOARD_LAST_ROW)
    : rows;
  const execution: TrustCheckCoverage = { sheet: sheetName, component: 'rule_compliance', expected: 0, checked: 0, failed: 0 };
  coverage?.push(execution);
  // Один лист содержит несколько таблиц с разными значениями D:U. Граница
  // определяется шапкой/названием блока, а не номером строки: вставка строк
  // не должна возвращать проверку количества на денежную аналитическую таблицу.
  // Старые фрагменты без шапки сохраняют прежний контракт; их геометрия здесь
  // не переопределяется сведениями из текущей Google-книги.
  const svodRows = new Set<number>();
  const unknownSvodRows: number[] = [];
  const unknownSvodHeaders: number[] = [];
  if (sheetClass.kind === 'svod') {
    let layout: 'primary' | 'analytics' | 'unknown' = 'primary';
    const label = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    for (const row of [...scopedRows].sort((a, b) => a.rowIndex - b.rowIndex)) {
      const a = label(row.cells.A);
      if (['анализ экономии', 'операционная нагрузка', 'дисциплина планирования'].includes(a)) {
        layout = 'analytics';
      } else if (a === 'грбс') {
        if (label(row.cells.B) === 'квартал' && label(row.cells.C) === 'год') layout = 'primary';
        else if (layout !== 'analytics') {
          layout = 'unknown';
          unknownSvodHeaders.push(row.rowIndex);
        }
      }
      if (layout === 'primary') svodRows.add(row.rowIndex);
      else if (layout === 'unknown' && row.classification !== 'header' && row.classification !== 'separator') unknownSvodRows.push(row.rowIndex);
    }
    if (unknownSvodHeaders.length > 0) {
      issues.push({
        id: issueIdentity(['svod-validation-schema-unknown', sheetName]),
        severity: 'warning',
        origin: 'runtime_error',
        category: 'svod_validation_schema_unknown',
        title: `Не распознана схема проверок: лист «${sheetName}»`,
        description: `Неизвестная шапка в строке ${unknownSvodHeaders[0]}; закупочные проверки D:U не применены к ${unknownSvodRows.length} строкам данных неизвестного блока. Финансовые выводы по этому блоку не подтверждены.`,
        sheet: sheetName,
        row: unknownSvodHeaders[0],
        recommendation: 'Сверить заголовки и назначение колонок блока; до подтверждения схемы не считать его прошедшим проверку.',
        status: 'open',
        detectedAt: now,
        detectedBy: 'pipeline:validate',
      });
    }
  }

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

  if (sheetClass.kind === 'unknown' || unknownSvodHeaders.length > 0) execution.expected += 1;

  for (const rule of rules) {
    if (rule.enabled === false) continue;

    // Scope filtering через classifySheet (SSOT): svod-правила только на свод;
    // department-правила только на листах ГРБС (department/subordinates_agg).
    // shdyu_monthly и unknown не получают ни svod-, ни department-правил.
    if (rule.scope === 'svod' && sheetClass.kind !== 'svod') continue;
    if (rule.scope === 'department' && sheetClass.kind !== 'department' && sheetClass.kind !== 'subordinates_agg') continue;

    // A failing rule must not silently turn an incomplete validation into clean data.
    let failedRows = 0;
    let firstFailedRow: number | null = null;
    let uncheckedRows = 0;
    let firstUnchecked: { row: number; message: string } | null = null;
    // Run the rule's check() against each applicable row
    for (const row of scopedRows) {
      if (sheetClass.kind === 'svod' && (rule.scope === 'svod' || rule.id === 'budget_sum_plan') && !svodRows.has(row.rowIndex)) continue;
      // ALWAYS skip header rows (first 3 rows of dept sheets) — they contain column titles, not data
      if (row.classification === 'header') continue;
      // Blank separators and explanatory notes have no arithmetic to verify.
      // Do not count them as checked or claim they lack a financial total.
      if (BOOK_SUM_RULES.has(rule.id)
        && (row.classification === 'separator' || row.classification === 'note')) continue;
      if (rule.rowFilter && !rule.rowFilter.includes(row.classification)) continue;
      execution.expected += 1;
      const ctx: import('@aemr/shared').RuleCheckContext = {
        cells: row.cells,
        rowIndex: row.rowIndex,
        sheet: row.sheet,
        classification: row.classification,
        allRows: scopedRows,
        asOf,
      };
      let result;
      try {
        result = rule.check(ctx);
      } catch (_err) {
        // Continue with other rows, but surface one bounded diagnostic per rule.
        failedRows += 1;
        if (firstFailedRow === null) firstFailedRow = row.rowIndex;
        continue;
      }
      if (result.passed === null) {
        uncheckedRows += 1;
        firstUnchecked ??= { row: row.rowIndex, message: result.message ?? 'Недостаточно исходных значений.' };
        continue;
      }
      execution.checked += 1;
      if (result.passed === false) {
        execution.failed += 1;
        // Enrich with unified class system metadata
        const checkId = LEGACY_RULE_TO_CHECK[rule.id] ?? rule.id;
        // Стабильный id (issue-identity.ts): содержимое-якорь, не номер строки.
        const idBase = ruleIssueIdentityParts(checkId, row.sheet, result.cell ?? '', row.cells);
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
          // «№ п/п» (колонка A) — стабильный второй адрес: строки листа
          // двигаются, позиционный row на момент сборки устаревает (п.98б).
          rowSeq: String(row.cells['A'] ?? '').trim() || undefined,
          // П.98в: rule-замечание обязано нести управление — без departmentId
          // клиентский фильтр ГРБС пропускал его сквозь любой выбор (при
          // фильтре УКСиМП были видны строки УД). Классификация листа его
          // знает (classifySheet → latinId, та же форма, что у сигналов);
          // листы вне ГРБС (СВОД, «ВСЕ», разметка) честно остаются без него.
          departmentId: sheetClass.latinId,
          recommendation: check?.recommendation ?? rule.description,
          activityType: deriveActivityType(row.cells),
          subordinateId: subordinateKey(row.cells['C']),
          status: 'open',
          detectedAt: now,
          detectedBy: `rule:${rule.id}`,
        });
      }
    }
    if (uncheckedRows > 0 && firstUnchecked) {
      issues.push({
        id: issueIdentity(['validation-input-unavailable', rule.id, sheetName]),
        severity: 'info', origin: 'runtime_error', category: 'rule_execution_failed',
        title: `Недостаточно данных для проверки «${rule.name}»`,
        description: `Не проверено ${uncheckedRows} строк листа «${sheetName}». Первая — ${firstUnchecked.row}: ${firstUnchecked.message} Это ограничение проверки, а не установленное расхождение сумм.`,
        sheet: sheetName, row: firstUnchecked.row, departmentId: sheetClass.latinId,
        recommendation: 'Сопровождению: проверить полноту чтения и исходные значения; повторить проверку. Не изменять достоверные суммы ради снятия сообщения.',
        status: 'open', detectedAt: now, detectedBy: `rule:${rule.id}`,
      });
    }
    if (failedRows > 0) {
      issues.push({
        id: issueIdentity(['validation-rule-failed', rule.id, sheetName]),
        severity: 'error',
        origin: 'runtime_error',
        category: 'rule_execution_failed',
        title: `Проверка «${rule.name}» выполнена не полностью`,
        description: `Проверка не смогла обработать ${failedRows} строк листа «${sheetName}» (первая — ${firstFailedRow}). Остальные проверки выполнены, но считать весь лист проверенным нельзя.`,
        sheet: sheetName,
        row: firstFailedRow ?? undefined,
        departmentId: sheetClass.latinId,
        recommendation: 'Передать сопровождению название проверки и лист; повторить проверку после исправления.',
        status: 'open',
        detectedAt: now,
        detectedBy: `rule:${rule.id}`,
      });
    }
  }

  return issues;
}
