import { describe, expect, it } from 'vitest';
import { RULE_BOOK } from '@aemr/shared';
import { runPipeline } from './orchestrator';
const rule = RULE_BOOK.find(r => r.id === 'status_on_data_rows')!;
function input(asOf: Date) {
  const row: unknown[] = Array(34).fill('');
  row[0] = '999'; row[6] = 'Synthetic closed position'; row[10] = 100;
  row[11] = 'ЭА'; row[16] = '15.06.2026'; row[24] = 80;
  return { spreadsheetId: 'test', batchGetData: [], sheetRows: { УЭР: [[], [], [], row] },
    rules: [rule], reportMap: [], asOf };
}
describe('one explicit snapshot clock for economy rules and row signals', () => {
  it('does not re-evaluate a historical future Q against current wall time', () => {
    const asOf = new Date(2026, 0, 10);
    const snapshot = runPipeline(input(asOf));
    expect(snapshot.createdAt).toBe(asOf.toISOString());
    expect(snapshot.issues.filter(i => i.checkId === 'status_on_data_rows')).toEqual([]);
    // A separate real temporal signal proves the row-signal path received this same clock.
    expect(snapshot.issues.some(i => i.signal === 'futureFactDate')).toBe(true);
  });
  it('detects the existing economy mark case on the exact closing day', () => {
    const snapshot = runPipeline(input(new Date(2026, 5, 15)));
    expect(snapshot.issues.some(i => i.checkId === 'status_on_data_rows')).toBe(true);
  });
  it.each([null, '2026-01-10', 0, new Date(NaN)])('rejects invalid explicit clock %s without falling back to today', value => {
    expect(() => runPipeline(input(value as unknown as Date))).toThrow('INVALID_SNAPSHOT_AS_OF');
  });
});
