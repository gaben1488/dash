import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retentionKeepIds } from './snapshot-retention.js';

/**
 * Retention-канон снимков (пользователь, 24.07.2026): ежедневные за последнюю
 * неделю + еженедельные по срезам-четвергам за всю историю, остальное — под нож.
 * Числа: день 0 эпохи — четверг; 2026-07-23 (четверг) = 20657, 20657 % 7 === 0.
 */

/** Снимок в `day` (календарь продукта UTC+0 в тестах) с часом внутри суток. */
const snap = (id: string, day: number, hour = 10, hasRows = true) => ({
  id,
  createdAt: new Date(day * 86400000 + hour * 3600000).toISOString(),
  hasRows,
});

const THU = 20657; // четверг 2026-07-23

describe('retentionKeepIds — ежедневные (7 дней) + еженедельные (вся история)', () => {
  it('внутри последней недели держится последний снимок КАЖДОГО дня', () => {
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
    expect(keep.has('mon-late')).toBe(true);
    expect(keep.has('mon-early')).toBe(false);
    expect(keep.has('wed')).toBe(true);
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
      [{ id: 'broken', createdAt: 'мусор', hasRows: true }, snap('now', THU)],
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
    expect(keep.has('day-rowful-early')).toBe(true);
    expect(keep.has('day-rowless-late')).toBe(false);
  });

  it('смещение пояса влияет на границу суток: 16:30 UTC среды = четверг Камчатки', () => {
    // THU*86400000 - 7.5h = среда 16:30 UTC; при +12 это четверг 04:30 продукта.
    // Второй снимок — 08:00 UTC четверга (= 20:00 Камчатки, ещё четверг).
    const wedUtc = { id: 'kam-thu', createdAt: new Date(THU * 86400000 - 7.5 * 3600000).toISOString(), hasRows: true };
    const keepKam = retentionKeepIds([wedUtc, snap('later-thu', THU, 8)], THU + 1, 12);
    // При +12 оба — четверг; выживает поздний.
    expect(keepKam.has('later-thu')).toBe(true);
    expect(keepKam.has('kam-thu')).toBe(false);
    // При +0 wedUtc — среда (день THU-1, свой день внутри недели) → хранится как дневной.
    const keepUtc = retentionKeepIds([wedUtc, snap('later-thu', THU, 8)], THU + 1, 0);
    expect(keepUtc.has('kam-thu')).toBe(true);
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

  it('удаляет проигравший снимок каскадом (issue_history → issues → metric_history → procurement_rows → snapshots), чужие данные целы', async () => {
    const { db, schema } = await import('../db/index.js');
    const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');

    const iso = (day: number, hour: number): string => new Date(day * 86400000 + hour * 3600000).toISOString();
    const rowful = JSON.stringify({ rowsByDept: { УЭР: [['r1']] } });
    const oldThu = THU - 7 * 2; // четверг две недели назад — вне дневного окна

    // Понедельник старой недели проигрывает четвергу той же недели среза.
    db.insert(schema.snapshots).values([
      { id: 'drop-mon', spreadsheetId: 't', createdAt: iso(oldThu - 3, 10), data: rowful },
      { id: 'keep-thu', spreadsheetId: 't', createdAt: iso(oldThu, 10), data: rowful },
    ]).run();
    // У ОБОИХ снимков — issue с историей статуса: без каскада по issue_history
    // DELETE issues бросает FOREIGN KEY (foreign_keys=ON) — блокер №2 ревью.
    db.insert(schema.issues).values([
      { id: 'iss-drop', snapshotId: 'drop-mon', severity: 'info', origin: 'calc', category: 'c', title: 't', status: 'open', detectedAt: iso(oldThu - 3, 10) },
      { id: 'iss-keep', snapshotId: 'keep-thu', severity: 'info', origin: 'calc', category: 'c', title: 't', status: 'open', detectedAt: iso(oldThu, 10) },
    ]).run();
    db.insert(schema.issueHistory).values([
      { issueId: 'iss-drop', fromStatus: 'open', toStatus: 'acknowledged', timestamp: iso(oldThu - 3, 11) },
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
});
