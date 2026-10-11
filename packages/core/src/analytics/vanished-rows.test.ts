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

describe('повторное использование номера — не скрывать за совпавшим A', () => {
  const purchase = (seq: string, row: number, subject: string): SnapshotRow => ({
    rowSeq: seq, sheetRow: row, subject,
    subordinate: 'Школа № 1', planSum: 100, method: 'ЕП',
  });

  it('обмен номерами двух закупок виден без ложных удалений строк', () => {
    const before = [
      purchase('10', 5, 'Кровля'),
      purchase('20', 6, 'Мебель'),
    ];
    const after = [
      purchase('10', 5, 'Мебель'),
      purchase('20', 6, 'Кровля'),
    ];
    const diff = diffSnapshots(before, after);
    expect(diff.vanished).toEqual([]);
    expect(diff.appeared).toEqual([]);
    expect(diff.identityCandidates).toEqual([
      expect.objectContaining({ beforeRowSeq: '10', afterRowSeq: '20', status: 'needs-review' }),
      expect.objectContaining({ beforeRowSeq: '20', afterRowSeq: '10', status: 'needs-review' }),
    ]);
  });

  it('обычная правка предмета при том же № не выдаётся за перенумерацию', () => {
    const diff = diffSnapshots(
      [purchase('10', 5, 'Кровля')],
      [purchase('10', 5, 'Кровельный ремонт')],
    );
    expect(diff.vanished).toEqual([]);
    expect(diff.identityCandidates).toEqual([]);
  });

  it('совпадение предмета без учреждения, плана или способа не позволяет связывать номера', () => {
    const old = purchase('10', 5, 'Одинаковый предмет');
    const next = purchase('20', 6, 'Одинаковый предмет');
    next.method = '';
    expect(diffSnapshots([old], [next]).identityCandidates).toEqual([]);
    next.method = 'ЕП';
    next.subordinate = 'Другая организация';
    expect(diffSnapshots([old], [next]).identityCandidates).toEqual([]);
  });
});

describe('сохранённый номер не означает сохранённый предмет закупки', () => {
  it('выделяет смену предмета при прежнем №, даже если исчезновения номеров нет', () => {
    const diff = diffSnapshots(
      [row({ rowSeq: '10', sheetRow: 6, subject: 'Ремонт кровли', subordinate: 'Школа № 1', planSum: 100, method: 'ЕП' })],
      [row({ rowSeq: '10', sheetRow: 6, subject: 'Канцелярские товары', subordinate: 'Школа № 1', planSum: 100, method: 'ЕП' })],
    );
    expect(diff.vanished).toEqual([]);
    expect(diff.appeared).toEqual([]);
    expect(diff.identityCandidates).toEqual([]);
    expect(diff.contextChanged).toEqual([expect.objectContaining({
      rowSeq: '10', beforeSubject: 'Ремонт кровли', afterSubject: 'Канцелярские товары',
      status: 'needs-review',
    })]);
    expect(diff.note).toContain('Это может быть редакторская правка');
  });

  it('смена учреждения при одинаковом предмете требует проверки', () => {
    const diff = diffSnapshots(
      [row({ rowSeq: '42', sheetRow: 9, subordinate: 'МБОУ СОШ № 1' })],
      [row({ rowSeq: '42', sheetRow: 9, subordinate: 'МБОУ СОШ № 2' })],
    );
    expect(diff.contextChanged?.[0]).toMatchObject({
      rowSeq: '42', beforeSubordinate: 'МБОУ СОШ № 1', afterSubordinate: 'МБОУ СОШ № 2',
    });
  });

  it('правка плана и способа без перемены предмета не шумит об идентичности', () => {
    const diff = diffSnapshots(
      [row({ rowSeq: '50', sheetRow: 9, subject: 'Ремонт', planSum: 100, method: 'ЕП' })],
      [row({ rowSeq: '50', sheetRow: 9, subject: 'Ремонт', planSum: 200, method: 'ЭА' })],
    );
    expect(diff.contextChanged).toEqual([]);
  });

  it('дубли номера не становятся ложными изменениями контекста', () => {
    const diff = diffSnapshots(
      [row({ rowSeq: '70', sheetRow: 9, subject: 'А' }), row({ rowSeq: '70', sheetRow: 10, subject: 'Б' })],
      [row({ rowSeq: '70', sheetRow: 9, subject: 'В' })],
    );
    expect(diff.contextChanged).toEqual([]);
    expect(diff.ambiguousKeys?.before).toContain('70');
  });
});

