/**
 * Strict source capture barrier for official report/export paths.
 *
 * This module is deliberately provider-agnostic and dependency-injected:
 * analytics/live views may tolerate stale caches with warnings, but an official
 * export must prove that every required source has the same Drive revision
 * before and after the complete capture.
 */
import type { FileRevision } from './file-revision.js';

export interface StrictCaptureSource {
  key: string;
  fileId: string;
}

export interface StrictCaptureResult<T> {
  payload: T;
  capturedAt: string;
  revisionsBefore: Record<string, FileRevision>;
  revisionsAfter: Record<string, FileRevision>;
}

export type StrictCaptureErrorCode =
  | 'SOURCE_REVISION_UNAVAILABLE'
  | 'SOURCE_REFRESH_FAILED'
  | 'SOURCE_DRIFT';

export class StrictCaptureError extends Error {
  constructor(
    public readonly code: StrictCaptureErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StrictCaptureError';
  }
}

export type RevisionReader = (fileId: string) => Promise<FileRevision | null>;

function sameRevision(a: FileRevision, b: FileRevision): boolean {
  if (a.version === null && a.modifiedTime === null) return false;
  if (b.version === null && b.modifiedTime === null) return false;
  return a.version === b.version && a.modifiedTime === b.modifiedTime;
}

export async function readStrictRevisionVector(
  sources: readonly StrictCaptureSource[],
  readRevision: RevisionReader,
): Promise<Record<string, FileRevision>> {
  const entries = await Promise.all(
    sources.map(async (source) => {
      const revision = await readRevision(source.fileId);
      if (!revision || (revision.version === null && revision.modifiedTime === null)) {
        throw new StrictCaptureError(
          'SOURCE_REVISION_UNAVAILABLE',
          `Не удалось доказать ревизию обязательного источника «${source.key}».`,
          { sourceKey: source.key, fileId: source.fileId },
        );
      }
      return [source.key, revision] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function revisionDriftKeys(
  before: Readonly<Record<string, FileRevision>>,
  after: Readonly<Record<string, FileRevision>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => {
    const a = before[key];
    const b = after[key];
    return !a || !b || !sameRevision(a, b);
  }).sort();
}

/**
 * Capture one immutable logical report input.
 *
 * Order is part of the contract:
 *   revisions BEFORE -> unconditional source refresh -> payload capture ->
 *   revisions AFTER -> fail closed on any drift.
 *
 * The caller decides what "payload" means (rows, report input, persisted
 * snapshot, etc.). It must be captured only after refresh() resolves.
 */
export async function strictSourceCapture<T>(options: {
  sources: readonly StrictCaptureSource[];
  readRevision: RevisionReader;
  refresh: () => Promise<boolean | void>;
  capture: () => Promise<T> | T;
  now?: () => Date;
}): Promise<StrictCaptureResult<T>> {
  const revisionsBefore = await readStrictRevisionVector(options.sources, options.readRevision);

  const refreshed = await options.refresh();
  if (refreshed === false) {
    throw new StrictCaptureError(
      'SOURCE_REFRESH_FAILED',
      'Принудительная перечитка обязательных источников не выполнена.',
    );
  }

  const payload = await options.capture();
  const revisionsAfter = await readStrictRevisionVector(options.sources, options.readRevision);
  const drift = revisionDriftKeys(revisionsBefore, revisionsAfter);
  if (drift.length > 0) {
    throw new StrictCaptureError(
      'SOURCE_DRIFT',
      `Источники изменились во время сборки: ${drift.join(', ')}.`,
      { drift },
    );
  }

  return {
    payload,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    revisionsBefore,
    revisionsAfter,
  };
}
