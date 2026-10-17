import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retentionKeepIds } from './snapshot-retention.js';

/**
 * Последняя инструкция владельца: недельная история и текущие головы областей;
 * отдельного пула ежедневных версий больше нет.
 * Числа: день 0 эпохи — четверг; 2026-07-23 (четверг) = 20657, 20657 % 7 === 0.
 */

/** Снимок в `day` (календарь продукта UTC+0 в тестах) с часом внутри суток. */
const snap = (id: string, day: number, hour = 10, hasRows = true, hasWeeklyContext = false) => ({
  id,
  createdAt: new Date(day * 86400000 + hour * 3600000).toISOString(),
  hasRows,
  hasWeeklyContext,
  spreadsheetId: 'fixture',
  targetYear: null,
});

const THU = 20657; // четверг 2026-07-23

describe('retentionKeepIds — недельная история и текущие головы', () => {
  it('внутри последней недели не остаются проигравшие ежедневные версии', () => {
    const keep = retentionKeepIds(
      [
        snap('mon-early', THU - 3, 9),
        snap('mon-late', THU - 3, 18),
        snap('wed', THU - 1),
        snap('thu', THU),
      ],
      THU + 1, // «сегодня» — пятница
      0,
    );
    expect(keep.has('mon-late')).toBe(false);
    expect(keep.has('mon-early')).toBe(false);
    expect(keep.has('wed')).toBe(false);
    expect(keep.has('thu')).toBe(true);
  });

  it('старше недели выживает только недельный срез: последний снимок к каждому четвергу', () => {
    const oldThu = THU - 7 * 5; // четверг 5 недель назад
    const keep = retentionKeepIds(
      [
        snap('old-mon', oldThu - 3),   // будни той недели — под нож
        snap('old-wed', oldThu - 1),   // ближе к четвергу, но не последний ≤ четверга
        snap('old-thu', oldThu),       // срез недели — хранится
        snap('now', THU),
      ],
      THU + 1,
      0,
    );
    expect(keep.has('old-thu')).toBe(true);
    expect(keep.has('old-wed')).toBe(false);
    expect(keep.has('old-mon')).toBe(false);
  });

  it('недели без снимка ровно в четверг: срезом становится последний снимок ≤ четверга', () => {
    const oldThu = THU - 7 * 3;
    const keep = retentionKeepIds(
      [snap('old-tue', oldThu - 2), snap('now', THU)],
      THU + 1,
      0,
    );
    // Вторник — единственный кандидат своей недели → он и есть её срез.
    expect(keep.has('old-tue')).toBe(true);
  });

  it('пятничный снимок принадлежит СЛЕДУЮЩЕМУ четвергу (неделя среза ещё впереди)', () => {
    const oldThu = THU - 7 * 4;
    const keep = retentionKeepIds(
      [
        snap('fri-after', oldThu + 1),  // пятница после oldThu → кандидат недели oldThu+7
        snap('next-thu', oldThu + 7),   // сам следующий четверг — он и побеждает
        snap('now', THU),
      ],
      THU + 1,
      0,
    );
    expect(keep.has('next-thu')).toBe(true);
    expect(keep.has('fri-after')).toBe(false);
  });

  it('битый createdAt не роняет решение и не удаляется молча (страховка: keep)', () => {
    const keep = retentionKeepIds(
      [{ id: 'broken', createdAt: 'мусор', hasRows: true, hasWeeklyContext: false }, snap('now', THU)],
      THU + 1,
      0,
    );
    expect(keep.has('broken')).toBe(true);
  });

  it('строконосный снимок побеждает бесстрочный, даже более поздний (день и неделя)', () => {
    const oldThu = THU - 7 * 2;
    const keep = retentionKeepIds(
      [
        // Неделя в истории: бесстрочный ПОЗДНИЙ не должен вытеснять строконосный.
        snap('week-rowful-early', oldThu, 8),
        snap('week-rowless-late', oldThu, 18, false),
        // День внутри последней недели: тот же приоритет для дневного победителя.
        snap('day-rowful-early', THU - 2, 9),
        snap('day-rowless-late', THU - 2, 20, false),
        snap('now', THU),
      ],
      THU + 1,
      0,
    );
    expect(keep.has('week-rowful-early')).toBe(true);
    expect(keep.has('week-rowless-late')).toBe(false);
    expect(keep.has('day-rowful-early')).toBe(false);
    expect(keep.has('day-rowless-late')).toBe(false);
  });

  it('полный weekly context побеждает более поздний rows-only snapshot той же недели', () => {
    const oldThu = THU - 7 * 2;
    const keep = retentionKeepIds(
      [
        snap('sealed-early', oldThu, 8, true, true),
        snap('rows-only-late', oldThu, 20, true, false),
        snap('now', THU),
      ],
      THU + 1,
      0,
    );
    expect(keep.has('sealed-early')).toBe(true);
    expect(keep.has('rows-only-late')).toBe(false);
  });

  it('Камчатка определяет переход четверг/пятница между недельными областями', () => {
    const early = { ...snap('utc-thursday', THU, 16.5) };
    const later = snap('utc-friday', THU + 1, 8);
    expect([...retentionKeepIds([early, later], THU + 2, 12)]).toEqual(['utc-friday']);
    expect([...retentionKeepIds([early, later], THU + 2, 0)].sort())
      .toEqual(['utc-friday', 'utc-thursday']);
  });
});

describe('C07 — отдельные области, текущие головы и только недельная история', () => {
  it('не даёт одной книге или году вытеснить недельную историю другой области', () => {
    const rows = [
      { ...snap('all-years', THU - 14, 9), spreadsheetId: 'book-a', targetYear: null },
      { ...snap('year-2026', THU - 14, 10), spreadsheetId: 'book-a', targetYear: 2026 },
      { ...snap('book-b', THU - 14, 11), spreadsheetId: 'book-b', targetYear: null },
      { ...snap('latest', THU, 12), spreadsheetId: 'book-a', targetYear: null },
    ];
    expect([...retentionKeepIds(rows, THU + 1, 0)].sort()).toEqual(rows.map(r => r.id).sort());
  });

  it('сохраняет текущую голову независимо от более полного старого контроля и чужого года', () => {
    const rows = [
      { ...snap('weekly', THU, 8, true, true), spreadsheetId: 'book-a', targetYear: null },
      { ...snap('current-all', THU, 10, false), spreadsheetId: 'book-a', targetYear: null },
      { ...snap('current-year', THU, 11, true, true), spreadsheetId: 'book-a', targetYear: 2026 },
    ];
    expect([...retentionKeepIds(rows, THU + 1, 0)].sort()).toEqual(rows.map(r => r.id).sort());
  });

  it('не удаляет legacy/missing/невалидные области по угаданному общему пулу', () => {
    const rows = [
      { ...snap('missing-one', THU - 14, 8), targetYear: undefined },
      { ...snap('missing-two', THU - 14, 9), targetYear: undefined },
      { ...snap('bad-year', THU - 14, 10), targetYear: '2026' },
      { ...snap('known-all', THU - 14, 11), targetYear: null },
    ];
    expect([...retentionKeepIds(rows, THU + 1, 0)].sort()).toEqual(rows.map(r => r.id).sort());
  });

  it.each([-1, 0, 2019, 2101, 999999])('не принимает вне-нормализатора год %s за доказанную область', year => {
    const rows = [
      { ...snap('older', THU - 14, 8), targetYear: year },
      { ...snap('later', THU - 14, 9), targetYear: year },
    ];
    expect([...retentionKeepIds(rows, THU + 1, 0)].sort()).toEqual(['later', 'older']);
  });

  it('не хранит проигравшие ежедневные версии даже внутри последних семи дней', () => {
    expect([...retentionKeepIds([
      snap('monday', THU - 3), snap('wednesday', THU - 1), snap('thursday', THU),
    ], THU + 1, 0)]).toEqual(['thursday']);
  });
});

describe('pruneSnapshotsByRetention — живой in-memory SQLite: каскад FK в транзакции', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      // Продукт = UTC: числа теста читаются без пересчёта смещения.
      PRODUCT_TZ_OFFSET_HOURS: '0',
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it.each([true, false])('does not scan protected JSON to select retention metadata (indexed=%s)', async indexed => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const payload = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {}, weeklyTableContext: {}, padding: 'x'.repeat(65536) });
    for (let week = 0; week < 15; week++) db.insert(schema.snapshots).values({
      id: `protected-${week}`, spreadsheetId: 'book',
      createdAt: new Date((THU - week * 7) * 86400000).toISOString(), data: payload,
    }).run();
    for (const [id, data] of [['malformed', '{'], ['unknown-scope', '{}'],
      ['text-year', '{"metadata":{"targetYear":"2026"}}']]) db.insert(schema.snapshots).values({
      id, spreadsheetId: 'book', createdAt: new Date(THU * 86400000).toISOString(), data,
    }).run();
    // SQLite's historical TEXT PRIMARY KEY permits NULL; the index must not hide it.
    db.$client.prepare('INSERT INTO snapshots(id,spreadsheet_id,created_at,data) VALUES(NULL,?,?,?)')
      .run('book', new Date(THU * 86400000).toISOString(), '{}');
    const before = db.select().from(schema.snapshots).all();
    if (!indexed) db.$client.exec('DROP INDEX IF EXISTS idx_snapshots_retention_metadata');
    const inspectPayload = vi.fn((text: string, needle: string) => text.indexOf(needle) + 1);
    db.$client.function('instr', { deterministic: true }, inspectPayload);
    if (indexed) expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(0);
    else db.$client.prepare(`SELECT instr(data, '"rowsByDept"'), instr(data, '"weeklyTableContext"') FROM snapshots NOT INDEXED`).all();
    if (indexed) expect(inspectPayload).not.toHaveBeenCalled();
    else expect(inspectPayload).toHaveBeenCalled();
    expect(db.select().from(schema.snapshots).all()).toEqual(before);
  });

  it('preserves the prior retention winner when two snapshots have the same timestamp', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    for (const id of ['z-first', 'a-second']) db.insert(schema.snapshots).values({
      id, spreadsheetId: 'book', createdAt: new Date(THU * 86400000).toISOString(),
      data: '{"metadata":{"targetYear":null},"rowsByDept":{},"weeklyTableContext":{}}',
    }).run();
    expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(1);
    expect(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all()).toEqual([{ id: 'z-first' }]);
  });

  it('keeps the old unhinted reader in its original order on a database with the new index', async () => {
    const { db, schema } = await import('../db/index.js');
    for (const id of ['z-first', 'a-second']) db.insert(schema.snapshots).values({
      id, spreadsheetId: 'book', createdAt: new Date(THU * 86400000).toISOString(),
      data: '{"metadata":{"targetYear":null},"rowsByDept":{},"weeklyTableContext":{}}',
    }).run();
    // Frozen pre-index query: rollback must not change its tie winner either.
    const legacy = `SELECT id,created_at,spreadsheet_id,
      CASE WHEN json_valid(data) THEN json_type(data, '$.metadata.targetYear') END,
      CASE WHEN json_valid(data) THEN json_extract(data, '$.metadata.targetYear') END,
      instr(data, '"rowsByDept"') > 0,instr(data, '"weeklyTableContext"') > 0 FROM snapshots`;
    expect(db.$client.prepare(legacy + ' NOT INDEXED').all().map(row => (row as { id: string }).id))
      .toEqual(['z-first', 'a-second']);
    expect(db.$client.prepare(legacy).all()).toEqual(db.$client.prepare(legacy + ' NOT INDEXED').all());
  });

  it('does not rescan case history when every snapshot is already retained', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const cases = Array.from({ length: 17 }, (_, i) => ({ id: `reviewed-${i}` }));
    const payload = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {}, issues: cases });
    for (let week = 0; week < 15; week++) db.insert(schema.snapshots).values({
      id: `week-${week}`, spreadsheetId: 'book',
      createdAt: new Date((THU - week * 7) * 86400000).toISOString(), data: payload,
    }).run();
    for (const entry of cases) db.insert(schema.issues).values({ ...entry,
      snapshotId: 'week-0', severity: 'info', origin: 'calc', category: 'fixture',
      title: 'Reviewed', status: 'false_positive', detectedAt: new Date(THU * 86400000).toISOString(),
    }).run();
    const prepare = vi.spyOn(db.$client, 'prepare');
    try {
      expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(0);
      const historyScans = prepare.mock.calls.filter(([query]) => query.includes('instr(')
        && query.includes('"snapshots"."data"') && !query.includes('json_valid'));
      expect(historyScans).toHaveLength(0);
      const caseReads = prepare.mock.calls.filter(([query]) => /\bfrom\s+"issues"/i.test(query));
      expect(caseReads).toHaveLength(0);
    } finally {
      prepare.mockRestore();
    }
    expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(Array(15).fill(payload));
    expect(db.select().from(schema.issues).all().every(row => row.status === 'false_positive')).toBe(true);
  });

  it('reads case evidence only in deletion candidates, preserving all protected snapshots', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const cases = Array.from({ length: 17 }, (_, i) => ({ id: `reviewed-${i}` }));
    const payload = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {}, issues: cases });
    const candidate = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {}, issues: [] });
    for (let week = 0; week < 15; week++) db.insert(schema.snapshots).values({
      id: `week-${week}`, spreadsheetId: 'book',
      createdAt: new Date((THU - week * 7) * 86400000).toISOString(), data: payload,
    }).run();
    db.insert(schema.snapshots).values({ id: 'loser', spreadsheetId: 'book',
      createdAt: new Date((THU - 1) * 86400000).toISOString(), data: candidate }).run();
    for (const entry of cases) db.insert(schema.issues).values({ ...entry,
      snapshotId: 'week-0', severity: 'info', origin: 'calc', category: 'fixture',
      title: 'Reviewed', status: 'false_positive', detectedAt: new Date(THU * 86400000).toISOString(),
    }).run();
    let payloadReads = 0;
    db.$client.function('instr', { deterministic: true }, (raw: string, needle: string) => {
      if (needle.startsWith('"reviewed-')) payloadReads++;
      const position = raw.indexOf(needle);
      return position < 0 ? 0 : [...raw.slice(0, position)].length + 1;
    });
    expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(1);
    expect(payloadReads).toBe(17);
    expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(Array(15).fill(payload));
    expect(db.select().from(schema.issues).all().every(row => row.status === 'false_positive')).toBe(true);
  });

  it('preserves case evidence beyond a SQLite parameter batch', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const payload = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {}, issues: [{ id: 'case' }] });
    const headAt = new Date(THU * 86400000).toISOString();
    db.insert(schema.snapshots).values({ id: 'head', spreadsheetId: 'book', createdAt: headAt, data: payload }).run();
    for (let index = 0; index < 1005; index++) db.insert(schema.snapshots).values({
      id: `daily-${index}`, spreadsheetId: 'book', data: payload,
      createdAt: new Date((THU - 1) * 86400000 + index).toISOString(),
    }).run();
    db.insert(schema.issues).values({ id: 'case', snapshotId: 'head', severity: 'info',
      origin: 'calc', category: 'fixture', title: 'Reviewed', status: 'false_positive', detectedAt: headAt }).run();
    const prepare = vi.spyOn(db.$client, 'prepare');
    try {
      expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(0);
      expect(Math.max(...prepare.mock.calls.map(([query]) => (query.match(/\?/g) ?? []).length))).toBeLessThanOrEqual(999);
    } finally {
      prepare.mockRestore();
    }
    expect(db.select().from(schema.snapshots).all().map(row => row.data)).toEqual(Array(1006).fill(payload));
  });

  it('SQLite сохраняет доказанные all-year/year/book области и голову, удаляя только проигравший daily', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const entries = [
      { id: 'sealed-all', spreadsheetId: 'a', year: null, hour: 8, weekly: true },
      { id: 'current-all', spreadsheetId: 'a', year: null, hour: 10, weekly: false },
      { id: 'current-year', spreadsheetId: 'a', year: 2026, hour: 11, weekly: true },
      { id: 'other-book', spreadsheetId: 'b', year: null, hour: 12, weekly: true },
    ];
    for (const e of entries) db.insert(schema.snapshots).values({ id: e.id, spreadsheetId: e.spreadsheetId,
      createdAt: new Date((THU * 24 + e.hour) * 3600000).toISOString(),
      data: JSON.stringify({ metadata: { targetYear: e.year }, rowsByDept: {}, ...(e.weekly ? { weeklyTableContext: {} } : {}) }),
    }).run();
    db.insert(schema.snapshots).values({ id: 'daily-loser', spreadsheetId: 'a',
      createdAt: new Date((THU - 1) * 86400000).toISOString(),
      data: JSON.stringify({ metadata: { targetYear: null }, rowsByDept: {} }) }).run();
    expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(1);
    expect(db.select({ id: schema.snapshots.id }).from(schema.snapshots).all().map(r => r.id).sort())
      .toEqual(entries.map(e => e.id).sort());
  });

  it('SQLite не угадывает область missing/null data/invalid JSON/строкового года и сохраняет исходные bytes', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const payloads = [null, '{broken', '{}', '{"metadata":{}}',
      '{"metadata":{"targetYear":"2026"}}', '{"metadata":{"targetYear":true}}', '{"metadata":{"targetYear":-1}}',
      '{"metadata":{"targetYear":-1}}', '{"metadata":{"targetYear":999999}}',
      '{"metadata":{"targetYear":999999}}'];
    for (const [index, data] of payloads.entries()) db.insert(schema.snapshots).values({
      id: 'unknown-' + index, spreadsheetId: 'a', data,
      createdAt: new Date((THU - 14) * 86400000 + index * 3600000).toISOString(),
    }).run();
    expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(0);
    expect(db.select({ data: schema.snapshots.data }).from(schema.snapshots).all().map(r => r.data))
      .toEqual(payloads);
  });

  it('удаляет проигравший снимок каскадом (issue_history → issues → metric_history → procurement_rows → snapshots), чужие данные целы', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');

    const iso = (day: number, hour: number): string => new Date(day * 86400000 + hour * 3600000).toISOString();
    const rowful = JSON.stringify({ metadata: { targetYear: null }, rowsByDept: { УЭР: [['r1']] } });
    const oldThu = THU - 7 * 2; // четверг две недели назад — вне дневного окна

    // Понедельник старой недели проигрывает четвергу той же недели среза.
    db.insert(schema.snapshots).values([
      { id: 'drop-mon', spreadsheetId: 't', createdAt: iso(oldThu - 3, 10), data: rowful },
      { id: 'keep-thu', spreadsheetId: 't', createdAt: iso(oldThu, 10), data: rowful },
    ]).run();
    // У проигравшего снимка нет пользовательского решения;
    // история решения другого снимка должна сохраниться.
    db.insert(schema.issues).values([
      { id: 'iss-drop', snapshotId: 'drop-mon', severity: 'info', origin: 'calc', category: 'c', title: 't', status: 'open', detectedAt: iso(oldThu - 3, 10) },
      { id: 'iss-keep', snapshotId: 'keep-thu', severity: 'info', origin: 'calc', category: 'c', title: 't', status: 'open', detectedAt: iso(oldThu, 10) },
    ]).run();
    db.insert(schema.issueHistory).values([
      { issueId: 'iss-keep', fromStatus: 'open', toStatus: 'acknowledged', timestamp: iso(oldThu, 11) },
    ]).run();
    db.insert(schema.metricHistory).values(
      { snapshotId: 'drop-mon', metricKey: 'm1', createdAt: iso(oldThu - 3, 10) },
    ).run();
    db.insert(schema.procurementRows).values(
      { snapshotId: 'drop-mon', departmentId: 'УЭР', rowIndex: 1, cellsJson: '{}', createdAt: iso(oldThu - 3, 10) },
    ).run();

    const removed = pruneSnapshotsByRetention(new Date((THU + 1) * 86400000));
    expect(removed).toBe(1); // FK-бросок съелся бы catch-ем и вернул 0 — тест бы это поймал

    const ids = db.select({ id: schema.snapshots.id }).from(schema.snapshots).all().map((r) => r.id);
    expect(ids).toEqual(['keep-thu']);
    const issueIds = db.select({ id: schema.issues.id }).from(schema.issues).all().map((r) => r.id);
    expect(issueIds).toEqual(['iss-keep']);
    // Чужая история статусов цела; история дроп-снапшота удалена.
    const historyIssueIds = db.select({ issueId: schema.issueHistory.issueId }).from(schema.issueHistory).all().map((r) => r.issueId);
    expect(historyIssueIds).toEqual(['iss-keep']);
    expect(db.select().from(schema.metricHistory).all()).toEqual([]);
    expect(db.select().from(schema.procurementRows).all()).toEqual([]);
  });
  it.each(['history', 'status', 'comment', 'comment_audit'])('preserves the raw snapshot needed by a saved %s, but prunes ordinary unreviewed snapshots', async kind => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
    const oldThu = THU - 14;
    const iso = (day: number) => new Date(day * 86400000 + 36000000).toISOString();
    for (const [id, day] of [['older-proof', oldThu - 4], ['protected', oldThu - 3], ['ordinary', oldThu - 2], ['winner', oldThu]] as const) {
      db.insert(schema.snapshots).values({ id, spreadsheetId: 'x', createdAt: iso(day), data: JSON.stringify({ metadata: { targetYear: null }, rowsByDept: { 'УКСиМП': [['immutable source']] }, issues: id === 'protected' || id === 'older-proof' ? [{ id: 'case' }] : [] }) }).run();
    }
    db.insert(schema.issues).values({ id: 'case', snapshotId: 'protected', severity: 'critical', origin: 'spreadsheet_rule', category: 'budget_sum_plan', title: 'Budget', detectedAt: iso(oldThu - 3), status: kind === 'status' ? 'false_positive' : 'open', comment: kind === 'comment' ? 'Пояснение' : null }).run();
    if (kind === 'comment_audit') db.insert(schema.auditLog).values({ action: 'issue_comment', entity: 'issue', entityId: 'case', details: 'История пояснения', timestamp: iso(oldThu - 3) }).run();
    if (kind === 'history') db.insert(schema.issueHistory).values({ issueId: 'case', fromStatus: 'false_positive', toStatus: 'open', timestamp: iso(oldThu - 3) }).run();
    expect(pruneSnapshotsByRetention(new Date((THU + 1) * 86400000))).toBe(1);
    expect(db.select().from(schema.snapshots).all().map(s => s.id).sort()).toEqual(['older-proof', 'protected', 'winner']);
    expect(db.select().from(schema.issues).all()[0].id).toBe('case');
    expect(db.select().from(schema.issueHistory).all()).toHaveLength(kind === 'history' ? 1 : 0);
  });

});
