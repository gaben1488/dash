import { describe, expect, it } from 'vitest';
import { withRowWriteLock } from './row-write-lock.js';

describe('same-source row write serialization', () => {
  it('does not overlap writes to the same source row', async () => {
    const sequence: string[] = [];
    let releaseFirst!: () => void;
    const pause = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withRowWriteLock('УО:4', async () => {
      sequence.push('a-start');
      await pause;
      sequence.push('a-end');
    });
    const second = withRowWriteLock('УО:4', async () => {
      sequence.push('b-start');
      sequence.push('b-end');
    });
    await Promise.resolve();
    expect(sequence).toEqual(['a-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(sequence).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
  it('releases the row after an error', async () => {
    await expect(withRowWriteLock('УКСиМП:4', async () => {
      throw new Error('write failed');
    })).rejects.toThrow('write failed');
    await expect(withRowWriteLock('УКСиМП:4', async () => 'ok')).resolves.toBe('ok');
  });
});
