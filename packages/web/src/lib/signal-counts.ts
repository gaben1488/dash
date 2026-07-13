type WithSignals = { signalCounts?: Record<string, number> };

/** Складывает per-dept signalCounts по отфильтрованному списку депов.
 *  Если ни у одного депа нет per-dept счётчиков (старый снапшот) — фолбэк на серверный
 *  полный счёт (fallback), чтобы виджет не обнулялся. */
export function aggregateSignalCounts(depts: WithSignals[], fallback: Record<string, number>): Record<string, number> {
  const hasPerDept = depts.some(d => d.signalCounts && Object.keys(d.signalCounts).length > 0);
  if (!hasPerDept) return { ...fallback };
  const acc: Record<string, number> = {};
  for (const d of depts) {
    for (const [k, v] of Object.entries(d.signalCounts ?? {})) acc[k] = (acc[k] ?? 0) + v;
  }
  return acc;
}
