import { beforeEach, describe, expect, it } from 'vitest';
import { MONITORING_MASTER_HEADERS, MONITORING_MASTER_SHEET } from '@aemr/core';
import { parsedMonitoringBook, resetParsedMonitoringBook } from './monitoring-parsed.js';
import type { MonitoringBookSnapshot } from './monitoring.js';

describe('разбор мониторинга на дату чтения', () => {
  beforeEach(resetParsedMonitoringBook);
  it('при том же содержимом допускает итог только после наступления его даты на Камчатке', () => {
    const r: unknown[] = Array(25).fill('');
    r[0] = 'ЭАС100-26'; r[4] = 'Совместные'; r[5] = 'Синтетический заказчик';
    r[7] = 100; r[11] = '08.10.2026'; r[12] = 80; r[16] = 20;
    r[19] = 'Состоялась'; r[22] = 'Состоялась';
    const book: MonitoringBookSnapshot = {
      sheets: { [MONITORING_MASTER_SHEET]: [[], [...MONITORING_MASTER_HEADERS], r] },
      readAt: '2026-10-07T11:59:00Z', version: 1, failed: {}, changed: [],
    };
    const before = parsedMonitoringBook(book);
    expect(before.registry.procedures[0].factsEligible).toBe(false);
    expect(before.aggregates.awarded.priceTotal).toBe(0);
    expect(parsedMonitoringBook({ ...book, readAt: '2026-10-07T11:59:30Z' })).toBe(before);
    const after = parsedMonitoringBook({ ...book, readAt: '2026-10-07T12:00:00Z' });
    expect(after.registry.procedures[0].factsEligible).toBe(true);
    expect(after.aggregates.awarded.priceTotal).toBe(80);
  });
});
