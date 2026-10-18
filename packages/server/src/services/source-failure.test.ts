import { expect, it } from 'vitest';
import { classifySourceFailure, isTransientSourceFailure } from './source-failure.js';
it('only retries evidenced transient failures and keeps permission/schema failures terminal', () => {
  for (const error of [new Error('ETIMEDOUT'), 'network unavailable', 'HTTP 429 quota', { response: { status: 503 } }]) {
    expect(isTransientSourceFailure(error)).toBe(true);
  }
  for (const error of ['SOURCE_SCHEMA_MISMATCH: timeout column', '403 permission denied after timeout',
    { response: { status: 403 }, message: 'network timeout' }, 'unknown failure', '404 not found']) {
    expect(isTransientSourceFailure(error)).toBe(false);
  }
});

it('keeps calculation failure separate from an unread source and transport retry', () => {
  for (const code of ['FAILED', 'BUSY', 'TIMED_OUT', 'TERMINATION_FAILED', 'EXITED_WITHOUT_RESULT']) {
    const failure = `SNAPSHOT_CALCULATION_${code}`;
    expect(classifySourceFailure(failure)).toBe('расчёт снимка не завершён');
    expect(isTransientSourceFailure(new Error(failure))).toBe(false);
  }
});
