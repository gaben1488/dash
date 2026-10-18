import { expect, it } from 'vitest';
import { isTransientSourceFailure } from './source-failure.js';
it('only retries evidenced transient failures and keeps permission/schema failures terminal', () => {
  for (const error of [new Error('ETIMEDOUT'), 'network unavailable', 'HTTP 429 quota', { response: { status: 503 } }]) {
    expect(isTransientSourceFailure(error)).toBe(true);
  }
  for (const error of ['SOURCE_SCHEMA_MISMATCH: timeout column', '403 permission denied after timeout',
    { response: { status: 403 }, message: 'network timeout' }, 'unknown failure', '404 not found']) {
    expect(isTransientSourceFailure(error)).toBe(false);
  }
});
