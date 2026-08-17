/**
 * Двойной адрес строки — «№ п/п» из колонки A (канон п.98б).
 *
 * Доказано зондом 18.08.2026: лист живёт, позиционный номер строки на момент
 * сборки устаревает («Опрессовка» была в строке 534, стала 155; № п/п = 531).
 * Стабильный человекочитаемый ключ — колонка A; замечание обязано нести его
 * ВТОРЫМ адресом рядом с номером строки листа. Стражи держат оба пути
 * рождения замечаний: правило (validateData) и сигнал (detectSignalsToIssues
 * через runPipeline).
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import type { ClassifiedRow, NormalizedMetric, ReportMapEntry, ValidationRule, RuleCheckContext } from '@aemr/shared';
import { validateData } from './validate.js';
import { runPipeline, type PipelineInput } from './orchestrator.js';

const COL = DEPT_COLUMNS;
const EMPTY_METRICS = new Map<string, NormalizedMetric>();
const EMPTY_REPORT_MAP: ReportMapEntry[] = [];

function makeRow(overrides: Partial<ClassifiedRow> & { cells?: Record<string, unknown> } = {}): ClassifiedRow {
  return {
    rowIndex: 155,
    sheet: 'УД',
    classification: 'procurement',
    classificationConfidence: 0.9,
    classificationReasons: ['test'],
    cells: {},
    ...overrides,
  };
}

function makeFailingRule(): ValidationRule {
  return {
    id: 'failing_rule',
    name: 'Failing Rule',
    description: 'A test rule',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    params: {},
    check: (ctx: RuleCheckContext) => ({ passed: false, message: `Failed at row ${ctx.rowIndex}` }),
  };
}

describe('rowSeq — путь правил (validateData)', () => {
  it('замечание несёт «№ п/п» из колонки A', () => {
    const row = makeRow({ cells: { A: 531, G: 'Опрессовка' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.rowSeq).toBe('531');
    expect(issue.row).toBe(155);
  });

  it('пустая колонка A — честное отсутствие rowSeq, а не пустая строка', () => {
    const row = makeRow({ cells: { A: '  ', G: 'Опрессовка' } });
    const [issue] = validateData(EMPTY_METRICS, [row], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.rowSeq).toBeUndefined();
  });

  it('п.98в: rule-замечание листа ГРБС несёт departmentId (latinId, как у сигналов)', () => {
    // Первопричина «Контроль тянет чужие управления»: rule-замечания шли без
    // departmentId и проходили сквозь клиентский фильтр ГРБС.
    const [issue] = validateData(EMPTY_METRICS, [makeRow({ cells: { A: '1' } })], [makeFailingRule()], EMPTY_REPORT_MAP);
    expect(issue.departmentId).toBe('ud');
    // Лист вне ГРБС (СВОД) — управления из имени нет, поле честно пустое.
    const [svodIssue] = validateData(
      EMPTY_METRICS,
      [makeRow({ sheet: 'СВОД ТД-ПМ', cells: { A: '1' } })],
      [makeFailingRule()],
      EMPTY_REPORT_MAP,
    );
    expect(svodIssue.departmentId).toBeUndefined();
  });
});

describe('rowSeq — путь сигналов (runPipeline → detectSignalsToIssues)', () => {
  it('сигнальное замечание (overdue) несёт «№ п/п» из колонки A', () => {
    // Просроченная закупка: плановая дата в прошлом, факта нет → сигнал overdue.
    const row: unknown[] = new Array(32).fill('');
    row[COL.ID] = '531';
    row[COL.TYPE] = 'Текущая деятельность';
    row[COL.SUBJECT] = 'Опрессовка';
    row[COL.FB_PLAN] = 100;
    row[COL.TOTAL_PLAN] = 100;
    row[COL.METHOD] = 'ЭА';
    row[COL.PLAN_DATE] = '15.01.2025';
    row[COL.PLAN_QUARTER] = 1;
    row[COL.PLAN_YEAR] = 2025;

    const input: PipelineInput = {
      batchGetData: [],
      sheetRows: { 'УД': [[], [], [], row] },
      reportMap: [],
      rules: [],
      spreadsheetId: 'test',
      targetYear: 2025,
    };
    const snap = runPipeline(input);
    const overdue = snap.issues.find(i => i.signal === 'overdue');
    expect(overdue).toBeTruthy();
    expect(overdue!.rowSeq).toBe('531');
    expect(overdue!.row).toBe(4);
  });
});
