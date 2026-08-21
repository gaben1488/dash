/**
 * Стражи консолидации сигналов на пути ЗАМЕЧАНИЙ — решения владельца п.137
 * от 21.08.2026.
 *
 * Отдельно от `signals.test.ts` потому, что здесь проверяется не предикат, а
 * его судьба: родилось ли по признаку замечание, с какой строгостью и лёг ли
 * ключ в снимок. Ровно на этом стыке продукт и нажил спор родов — признак
 * называл строку законной стадией, а конвейер тут же заводил по ней претензию.
 *
 * Прогон идёт через runPipeline целиком: подавление, записанное только в
 * @aemr/shared, обязано доехать до готового снимка, иначе оно ничего не значит.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { runPipeline, type PipelineInput } from './orchestrator.js';

const COL = DEPT_COLUMNS;

/** Строка листа ГРБС: пустая канва плюс заданные графы. */
function sheetRow(cells: Partial<Record<keyof typeof DEPT_COLUMNS, unknown>>): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  for (const [key, value] of Object.entries(cells)) {
    row[COL[key as keyof typeof DEPT_COLUMNS]] = value;
  }
  return row;
}

/** Снимок по одному листу «УД» с тремя пустыми строками шапки. */
function snapshotOf(rows: unknown[][]) {
  const input: PipelineInput = {
    batchGetData: [],
    sheetRows: { 'УД': [[], [], [], ...rows] },
    reportMap: [],
    rules: [],
    spreadsheetId: 'test',
    targetYear: 2026,
  };
  return runPipeline(input);
}

describe('п.137(1): «в течение года» больше не рождает замечания', () => {
  it('суммы факта без даты заключения — признак есть, претензии нет', () => {
    // Решение владельца дословно: «закупка в течение года — ТОЛЬКО СТАДИЯ».
    // Ключ signal:factWithoutDate продолжает вычисляться и ложиться в снимок
    // (железное правило: ключи снимков не меняются), но ни замечания, ни дела
    // на Дисциплине, ни строки в Отчёте по нему больше нет.
    const snap = snapshotOf([sheetRow({
      ID: '531', TYPE: 'Текущая деятельность', SUBJECT: 'Питание по мере необходимости',
      FB_PLAN: 100, TOTAL_PLAN: 100, METHOD: 'ЕП',
      PLAN_DATE: '15.01.2026', PLAN_QUARTER: 1, PLAN_YEAR: 2026,
      TOTAL_FACT: 60, FB_FACT: 60,
    })]);
    expect(snap.issues.find((i) => i.signal === 'factWithoutDate')).toBeUndefined();
  });
});

describe('п.137(3): инициативная заявка не идёт в риск-списки', () => {
  const unfundedRow = (comment: string) => sheetRow({
    ID: '77', TYPE: 'Текущая деятельность', SUBJECT: 'Ремонт кровли',
    FB_PLAN: 900, TOTAL_PLAN: 900, METHOD: 'ЭА',
    PLAN_DATE: '', PLAN_QUARTER: '', PLAN_YEAR: '',
    COMMENT_GRBS: comment,
  });

  it('маркер «хотелки» гасит замечание о необеспеченности финансированием', () => {
    // Обещание бейджа «план виден, но в риск-списки не шумит» стояло с самого
    // его появления, а код его не исполнял: все 88 таких строк несли
    // замечание, дело на Дисциплине и строку в отчёте руководству.
    const snap = snapshotOf([unfundedRow('хотелки')]);
    expect(snap.issues.find((i) => i.signal === 'planYearMissing')).toBeUndefined();
  });

  it('без маркера замечание рождается как прежде — гасится претензия, а не класс', () => {
    const snap = snapshotOf([unfundedRow('')]);
    expect(snap.issues.find((i) => i.signal === 'planYearMissing')).toBeTruthy();
  });
});

describe('п.137(2): строгость ЕП-риска — свойство строки', () => {
  const epRow = (reason: string) => sheetRow({
    ID: '9', TYPE: 'Текущая деятельность', SUBJECT: 'Теплоснабжение',
    FB_PLAN: 2_000, TOTAL_PLAN: 2_000, METHOD: 'ЕП', EP_REASON: reason,
    PLAN_DATE: '15.03.2026', PLAN_QUARTER: 1, PLAN_YEAR: 2026,
  });

  it('безальтернативность по закону — замечание информационное', () => {
    // Живой текст из книг (спека консолидации, вопрос владельца №5): статья 93
    // названа прямо, но пункт 11 не входит в четвёрку, которую знает гейт
    // законных оснований самого признака, — поэтому признак горит. Справочник
    // оснований ту же строку читает как безальтернативную по закону, и
    // строгость падает до справки. Ровно об этих строках и был довод развилки:
    // у 60 из 76 красных чипов соседняя вкладка держала наготове оправдание.
    const snap = snapshotOf([epRow('п. 11 ч. 1 ст. 93 (заключение контракта с УФСИН)')]);
    const issue = snap.issues.find((i) => i.signal === 'epRisk');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('info');
  });

  it('решение заказчика — замечание критическое', () => {
    const snap = snapshotOf([epRow('Проведение аукциона нецелесообразно')]);
    const issue = snap.issues.find((i) => i.signal === 'epRisk');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('critical');
  });

  it('пустое обоснование судится строго — судить не о чем', () => {
    const snap = snapshotOf([epRow('')]);
    const issue = snap.issues.find((i) => i.signal === 'epRisk');
    expect(issue!.severity).toBe('critical');
  });
});
