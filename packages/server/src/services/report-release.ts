import { readRevision, type FileRevision } from './file-revision.js';

export interface RequiredReleaseSource {
  key: string;
  fileId: string;
}

export type SourceRevisionVector = Record<string, FileRevision>;

export type RevisionVectorResult =
  | { ok: true; vector: SourceRevisionVector }
  | { ok: false; missing: string[] };

function usableRevision(revision: FileRevision | null): revision is FileRevision {
  return revision !== null
    && (revision.version !== null || revision.modifiedTime !== null);
}

/**
 * Снимает полный revision-vector обязательных источников.
 *
 * Официальный release fail-closed: если Drive не дал версию/modifiedTime хотя бы
 * для одного источника, это не «можно продолжить без доказательства», а BLOCKED.
 */
export async function readRequiredRevisionVector(
  sources: readonly RequiredReleaseSource[],
  reader: (fileId: string) => Promise<FileRevision | null> = readRevision,
): Promise<RevisionVectorResult> {
  const vector: SourceRevisionVector = {};
  const missing: string[] = [];

  await Promise.all(
    sources.map(async ({ key, fileId }) => {
      const revision = fileId ? await reader(fileId) : null;
      if (!usableRevision(revision)) {
        missing.push(key);
        return;
      }
      vector[key] = revision;
    }),
  );

  if (missing.length > 0) {
    return { ok: false, missing: missing.sort() };
  }

  return { ok: true, vector };
}

/**
 * Сравнение BEFORE/AFTER.
 *
 * Любая смена version/modifiedTime, исчезнувший или появившийся ключ означает,
 * что набор источников не является одним доказанным состоянием.
 */
export function changedRevisionKeys(
  before: SourceRevisionVector,
  after: SourceRevisionVector,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];

  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    if (
      !left
      || !right
      || left.version !== right.version
      || left.modifiedTime !== right.modifiedTime
    ) {
      changed.push(key);
    }
  }

  return changed.sort();
}

export function revisionVectorsMatch(
  before: SourceRevisionVector,
  after: SourceRevisionVector,
): boolean {
  return changedRevisionKeys(before, after).length === 0;
}
