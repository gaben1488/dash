/**
 * Стражи адресной перечитки.
 *
 * Обещание: правка в одной книге не стоит чтения остальных. Обратное
 * обещание не менее важно: файл, которого нет в списке источников, читается
 * ПОЛНОСТЬЮ — молча пропустить изменение хуже, чем прочитать лишнее.
 */
import { describe, expect, it } from 'vitest';
import { config, DEPARTMENT_SPREADSHEETS } from '../config.js';
import { MONITORING_SPREADSHEET_ID } from './monitoring.js';
import { describePlan, isEmptyPlan, mergePlans, planForFile } from './refresh-targets.js';

const [firstBook, firstBookId] = Object.entries(DEPARTMENT_SPREADSHEETS)[0];
const [secondBook, secondBookId] = Object.entries(DEPARTMENT_SPREADSHEETS)[1];

describe('цель одного уведомления', () => {
  it('книга ГРБС — только эта книга, без СВОДа и мониторинга', () => {
    expect(planForFile(firstBookId)).toEqual({
      books: [firstBook],
      svod: false,
      monitoring: false,
      full: false,
    });
  });

  it('книга мониторинга — только она, книги ГРБС не трогаются', () => {
    const plan = planForFile(MONITORING_SPREADSHEET_ID);
    expect(plan.monitoring).toBe(true);
    expect(plan.books).toEqual([]);
    expect(plan.svod).toBe(false);
  });

  it('основная книга — лист СВОД', () => {
    const plan = planForFile(config.google.spreadsheetId);
    expect(plan.svod).toBe(true);
    expect(plan.books).toEqual([]);
    expect(plan.monitoring).toBe(false);
  });

  it('неизвестный файл читается полностью — пропустить правку хуже, чем прочитать лишнее', () => {
    expect(planForFile('файл-которого-нет-в-настройке').full).toBe(true);
  });

  it('уведомление без идентификатора файла читается полностью', () => {
    expect(planForFile(null).full).toBe(true);
    expect(planForFile('').full).toBe(true);
  });
});

describe('склейка серии уведомлений', () => {
  it('две книги за одну склейку дают один цикл на две книги', () => {
    const merged = mergePlans([planForFile(firstBookId), planForFile(secondBookId)]);
    expect(merged.books.sort()).toEqual([firstBook, secondBook].sort());
    expect(merged.full).toBe(false);
    expect(merged.svod).toBe(false);
  });

  it('повтор по одной книге не удваивает работу', () => {
    const merged = mergePlans([planForFile(firstBookId), planForFile(firstBookId)]);
    expect(merged.books).toEqual([firstBook]);
  });

  it('один неопознанный файл в серии делает всю серию полной', () => {
    const merged = mergePlans([planForFile(firstBookId), planForFile('чужой-файл')]);
    expect(merged.full).toBe(true);
  });

  it('книга ГРБС и мониторинг складываются, не подменяя друг друга', () => {
    const merged = mergePlans([planForFile(firstBookId), planForFile(MONITORING_SPREADSHEET_ID)]);
    expect(merged.books).toEqual([firstBook]);
    expect(merged.monitoring).toBe(true);
    expect(merged.full).toBe(false);
  });

  it('пустая серия — пустой план', () => {
    expect(isEmptyPlan(mergePlans([]))).toBe(true);
  });
});

describe('описание плана для журнала', () => {
  it('называет книги и стороны, а не «источники обновлены»', () => {
    const merged = mergePlans([planForFile(firstBookId), planForFile(MONITORING_SPREADSHEET_ID)]);
    const text = describePlan(merged);
    expect(text).toContain(firstBook);
    expect(text).toContain('книга мониторинга');
  });

  it('полную перечитку называет полной', () => {
    expect(describePlan(planForFile('чужой-файл'))).toBe('все источники');
  });
});
