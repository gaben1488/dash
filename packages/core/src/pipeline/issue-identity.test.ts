/**
 * Стабильные id замечаний (fidelity-аудит 2026-07-16 §5.1 / §2.5).
 *
 * Проблема: id = nanoid() на каждый прогон → статусы в SQLite орфанятся
 * после каждого пересоздания снапшота (52k строк issues, 0 не-open).
 *
 * Требование: два прогона пайплайна на одинаковых входных данных дают
 * ИДЕНТИЧНЫЕ id замечаний; изменение одной строки меняет id только её
 * замечаний.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { runPipeline, type PipelineInput } from './orchestrator.js';
import { issueIdentity } from './issue-identity.js';

const COL = DEPT_COLUMNS;

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = overrides.id ?? '1';
  row[COL.SUBORDINATE] = overrides.subordinate ?? '';
  row[COL.TYPE] = overrides.type ?? 'Текущая деятельность';
  row[COL.PROGRAM_NAME] = overrides.programName ?? '';
  row[COL.SUBJECT] = overrides.subject ?? 'Закупка';
  row[COL.FB_PLAN] = overrides.fbPlan ?? 100;
  row[COL.KB_PLAN] = overrides.kbPlan ?? 200;
  row[COL.MB_PLAN] = overrides.mbPlan ?? 0;
  row[COL.TOTAL_PLAN] = overrides.totalPlan ?? 300;
  row[COL.METHOD] = overrides.method ?? 'ЭА';
  row[COL.PLAN_DATE] = overrides.planDate ?? '15.01.2025';
  row[COL.PLAN_QUARTER] = overrides.planQuarter ?? 1;
  row[COL.PLAN_YEAR] = overrides.planYear ?? 2025;
  row[COL.FACT_DATE] = overrides.factDate ?? '';
  row[COL.FACT_QUARTER] = overrides.factQuarter ?? '';
  row[COL.DEVIATION_REASON] = overrides.status ?? '';
  row[COL.FB_FACT] = overrides.fbFact ?? 0;
  row[COL.KB_FACT] = overrides.kbFact ?? 0;
  row[COL.MB_FACT] = overrides.mbFact ?? 0;
  row[COL.TOTAL_FACT] = overrides.totalFact ?? 0;
  row[COL.ECONOMY_FB] = overrides.ecoFB ?? 0;
  row[COL.ECONOMY_KB] = overrides.ecoKB ?? 0;
  row[COL.ECONOMY_MB] = overrides.ecoMB ?? 0;
  row[COL.FLAG] = overrides.flag ?? '';
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  const headers = [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
  ];
  return [...headers, ...dataRows];
}

/** Просроченная закупка (plan date в прошлом, факта нет) → сигнал overdue → Issue. */
function makeInput(rows: unknown[][]): PipelineInput {
  return {
    batchGetData: [],
    sheetRows: { 'УЭР': buildSheet(rows) },
    reportMap: [],
    rules: [],
    spreadsheetId: 'test-spreadsheet',
    targetYear: 2025,
  };
}

const baseRows = (): unknown[][] => [
  makeRow({ id: '1', subject: 'Поставка бумаги', totalPlan: 1000, planDate: '15.01.2025' }),
  makeRow({ id: '2', subject: 'Ремонт кровли', totalPlan: 2000, planDate: '20.02.2025' }),
  // факт == план → EXACT_MATCH аномалия для теста dataAnomalyFlags
  makeRow({ id: '3', subject: 'Услуги связи', totalPlan: 300, totalFact: 300, fbFact: 100, kbFact: 200, factDate: '10.03.2025' }),
];

describe('стабильные id замечаний (fidelity §5.1)', () => {
  it('два прогона на одинаковом входе дают идентичные id', () => {
    const a = runPipeline(makeInput(baseRows()));
    const b = runPipeline(makeInput(baseRows()));

    expect(a.issues.length).toBeGreaterThan(0);
    expect(a.issues.map(i => i.id)).toEqual(b.issues.map(i => i.id));
  });

  it('изменение одной строки меняет id только её замечаний', () => {
    const a = runPipeline(makeInput(baseRows()));
    const changed = baseRows();
    (changed[0] as unknown[])[COL.SUBJECT] = 'Поставка картриджей'; // строка листа 4
    const b = runPipeline(makeInput(changed));

    const idsOtherA = a.issues.filter(i => i.row !== 4).map(i => i.id).sort();
    const idsOtherB = b.issues.filter(i => i.row !== 4).map(i => i.id).sort();
    expect(idsOtherA).toEqual(idsOtherB);

    const idsRow4A = a.issues.filter(i => i.row === 4).map(i => i.id).sort();
    const idsRow4B = b.issues.filter(i => i.row === 4).map(i => i.id).sort();
    expect(idsRow4A.length).toBeGreaterThan(0);
    expect(idsRow4A).not.toEqual(idsRow4B);
  });

  it('id уникальны внутри одного снапшота (дубли строк не схлопываются)', () => {
    const rows = [
      makeRow({ id: '1', subject: 'Одинаковая закупка', totalPlan: 500 }),
      makeRow({ id: '1', subject: 'Одинаковая закупка', totalPlan: 500 }), // полный дубль
    ];
    const snap = runPipeline(makeInput(rows));
    const ids = snap.issues.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('issueIdentity (чистая функция)', () => {
  it('детерминирована и даёт 16 hex-символов', () => {
    const h1 = issueIdentity(['signal', 'overdue', 'УЭР', 'МКУ', '1', '', 'Предмет', 1000, 0]);
    const h2 = issueIdentity(['signal', 'overdue', 'УЭР', 'МКУ', '1', '', 'Предмет', 1000, 0]);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('разные части — разный хеш', () => {
    const h1 = issueIdentity(['signal', 'overdue', 'УЭР', '', '1', '', 'Предмет', 1000, 0]);
    const h2 = issueIdentity(['signal', 'overdue', 'УЭР', '', '1', '', 'Предмет', 1000, 1]);
    const h3 = issueIdentity(['signal', 'overdue', 'УЭР', '', '1', '', 'Другой', 1000, 0]);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('устойчива к перестановке границ частей (разделитель, не конкатенация)', () => {
    expect(issueIdentity(['ab', 'c'])).not.toBe(issueIdentity(['a', 'bc']));
  });
});

describe('dataAnomalyFlags переживает JSON-сериализацию (fidelity §2)', () => {
  it('JSON.parse(JSON.stringify(snapshot)) сохраняет флаги аномалий', () => {
    const snap = runPipeline(makeInput(baseRows()));
    const roundTripped = JSON.parse(JSON.stringify(snap)) as typeof snap;
    const flags = roundTripped.datasetAnalyses?.['uer']?.dataAnomalyFlags;
    expect(flags).toBeTruthy();
    // строка «Услуги связи»: факт == план → EXACT_MATCH
    expect(Object.keys(flags as object).length).toBeGreaterThan(0);
  });
});
