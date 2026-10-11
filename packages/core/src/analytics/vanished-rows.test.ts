import { describe, expect, it } from 'vitest';
import { diffSnapshots, type SnapshotRow } from './vanished-rows.js';

const row = (o: Partial<SnapshotRow> & { rowSeq: string; sheetRow: number }): SnapshotRow => ({
  subject: 'Опрессовка системы',
  subordinate: 'МБУ ДО СШОР по ЛВС',
  planSum: 40,
  factSum: 40,
  ...o,
});

describe('пропавшие и появившиеся закупки (канон п.105)', () => {
  it('исчезнувшая строка названа с последним содержимым и деньгами', () => {
    const before = [row({ rowSeq: '531', sheetRow: 155 }), row({ rowSeq: '527', sheetRow: 534, planSum: 48 })];
    const after = [row({ rowSeq: '527', sheetRow: 534, planSum: 48 })];
    const d = diffSnapshots(before, after);
    expect(d.vanished).toHaveLength(1);
    expect(d.vanished[0].rowSeq).toBe('531');
    expect(d.vanished[0].wasAtSheetRow).toBe(155);
    expect(d.vanished[0].subject).toBe('Опрессовка системы');
    expect(d.vanishedPlanSum).toBe(40);
    expect(d.note).toContain('удаление строки не записывает');
  });

  it('переезд строки листа — не пропажа: № п/п тот же, номер строки другой', () => {
    // Живой случай п.98б: «Опрессовка» была строкой 534, стала 155.
    const d = diffSnapshots(
      [row({ rowSeq: '531', sheetRow: 534 })],
      [row({ rowSeq: '531', sheetRow: 155 })],
    );
    expect(d.vanished).toEqual([]);
    expect(d.moved).toEqual([
      { rowSeq: '531', fromSheetRow: 534, toSheetRow: 155, subject: 'Опрессовка системы' },
    ]);
  });

  it('новая закупка попадает в появившиеся, а не в пропавшие', () => {
    const d = diffSnapshots([], [row({ rowSeq: '999', sheetRow: 700 })]);
    expect(d.appeared).toHaveLength(1);
    expect(d.vanished).toEqual([]);
  });

  it('пропажи сортируются по деньгам: дорогая закупка первой', () => {
    const before = [
      row({ rowSeq: '1', sheetRow: 10, planSum: 5 }),
      row({ rowSeq: '2', sheetRow: 11, planSum: 5000 }),
      row({ rowSeq: '3', sheetRow: 12, planSum: 500 }),
    ];
    const d = diffSnapshots(before, []);
    expect(d.vanished.map((v) => v.rowSeq)).toEqual(['2', '3', '1']);
    expect(d.vanishedPlanSum).toBe(5505);
  });

  it('строки без № п/п считаются отдельно и объявляются вслух', () => {
    const d = diffSnapshots(
      [row({ rowSeq: '', sheetRow: 20 }), row({ rowSeq: '5', sheetRow: 21 })],
      [row({ rowSeq: '5', sheetRow: 21 })],
    );
    expect(d.unkeyed.before).toBe(1);
    expect(d.vanished).toEqual([]);
    expect(d.note).toContain('без № п/п');
  });

  it('дубль № п/п не роняет сравнение', () => {
    const d = diffSnapshots(
      [row({ rowSeq: '7', sheetRow: 1 }), row({ rowSeq: '7', sheetRow: 2 })],
      [row({ rowSeq: '7', sheetRow: 1 })],
    );
    expect(d.vanished).toEqual([]);
    expect(d.moved).toEqual([]);
  });

  it('ничего не менялось — честная тишина без выдуманных событий', () => {
    const snap = [row({ rowSeq: '531', sheetRow: 155 })];
    const d = diffSnapshots(snap, snap);
    expect(d).toMatchObject({ vanished: [], appeared: [], moved: [], vanishedPlanSum: 0 });
    expect(d.note).toContain('на месте');
  });
});

describe('провенанс номера без догадок об удалении закупки', () => {
  it('уникальное содержимое связывает прежний и новый № только как гипотезу', () => {
    const was = [row({ rowSeq: '12', sheetRow: 20, subject: 'Ремонт кровли', planSum: 400, method: 'ЭА' })];
    const now = [row({ rowSeq: '15', sheetRow: 24, subject: 'Ремонт кровли', planSum: 400, method: 'ЭА' })];
    const result = diffSnapshots(was, now);
    expect(result.vanished.map((r) => r.rowSeq)).toEqual(['12']);
    expect(result.appeared.map((r) => r.rowSeq)).toEqual(['15']);
    expect(result.identityCandidates).toEqual([expect.objectContaining({
      beforeRowSeq: '12', afterRowSeq: '15', beforeSheetRow: 20, afterSheetRow: 24,
      evidence: 'subject+subordinate+plan+method', status: 'needs-review',
    })]);
    expect(result.note).toContain('не доказана');
  });

  it('одинаковые закупки не порождают вымышленную преемственность', () => {
    const was = [
      row({ rowSeq: '12', sheetRow: 20, subject: 'Канцтовары', planSum: 10, method: 'ЕП' }),
      row({ rowSeq: '13', sheetRow: 21, subject: 'Канцтовары', planSum: 10, method: 'ЕП' }),
    ];
    const now = [row({ rowSeq: '15', sheetRow: 22, subject: 'Канцтовары', planSum: 10, method: 'ЕП' })];
    const result = diffSnapshots(was, now);
    expect(result.identityCandidates).toEqual([]);
  });

  it('различия в способе или сумме не считаются подтверждением перенумерации', () => {
    const was = [row({ rowSeq: '12', sheetRow: 20, method: 'ЭА', planSum: 100 })];
    const now = [row({ rowSeq: '13', sheetRow: 21, method: 'ЕП', planSum: 100 })];
    expect(diffSnapshots(was, now).identityCandidates).toEqual([]);
    now[0].method = 'ЭА';
    now[0].planSum = 200;
    expect(diffSnapshots(was, now).identityCandidates).toEqual([]);
  });

  it('повтор № п/п запрещает first-wins, а не скрывает неопределённость', () => {
    const was = [
      row({ rowSeq: '7', sheetRow: 1, subject: 'Первая' }),
      row({ rowSeq: '7', sheetRow: 2, subject: 'Вторая' }),
    ];
    const now = [row({ rowSeq: '7', sheetRow: 2, subject: 'Вторая' })];
    const d = diffSnapshots(was, now);
    expect(d.ambiguousKeys?.before).toEqual(['7']);
    expect(d.vanished).toEqual([]);
    expect(d.moved).toEqual([]);
    expect(d.note).toContain('не сопоставлялись');
  });

  it('переезд строки с неизменным номером не считается новым объектом', () => {
    const d = diffSnapshots(
      [row({ rowSeq: '10', sheetRow: 4, method: 'ЕП' })],
      [row({ rowSeq: '10', sheetRow: 9, method: 'ЕП' })],
    );
    expect(d.vanished).toEqual([]);
    expect(d.identityCandidates).toEqual([]);
  });
});

