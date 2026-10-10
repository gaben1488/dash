/**
 * Serializes writes targeting the same source row in one Dash server process.
 * This does NOT lock Google Sheets against people editing it directly. The
 * revision check must run inside the lock immediately before the first write.
 */
const pending = new Map<string, Promise<void>>();

export async function withRowWriteLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const tail = previous.then(() => gate);
  pending.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (pending.get(key) === tail) pending.delete(key);
  }
}
