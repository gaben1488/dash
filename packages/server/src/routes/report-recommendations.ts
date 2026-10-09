/**
 * Editable workspace over the EXISTING procurement report RecommendationLedger.
 * The existing JSON stays the sole source; an authenticated УЭР save immediately issues an
 * official recommendation. Previous historical statements remain immutable.
 * The generator reads UЭР entries in its next official snapshot.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ALL_DEPT_IDS } from '@aemr/shared';
import { z } from 'zod';

type Entry = Record<string, unknown>;
type Stage = 'ACTIVE' | 'HISTORY';
type EditorialEvent = { at: string; kind: 'created' | 'updated' | 'note'; fields: string[];
  previousNote?: string; previous?: { grbs: string; text: string; sourceIds: string[] } };
interface Snapshot { entries: Entry[]; bytes: Buffer; revision: string; }

class LedgerProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const token = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().trim().max(2000);
const sourceIds = z.array(z.string().trim().min(1).max(80)).max(64)
  .refine(v => new Set(v).size === v.length, 'Один номер закупки указан несколько раз');
const editableFields = {
  grbs: z.string().trim().min(1),
  text: z.string().trim().min(10).max(6000),
  sourceIds,
  note: note.default(''),
};
const CreateSchema = z.object({ expectedRevision: token, ...editableFields }).strict();
const IssuedUpdateSchema = z.object({ expectedRevision: token, ...editableFields }).strict();
const NoteUpdateSchema = z.object({ expectedRevision: token, note }).strict();

const textOf = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function stageOf(entry: Entry): Stage {
  return entry.active_in_current_slice === true ? 'ACTIVE' : 'HISTORY';
}
function isUerIssued(entry: Entry): boolean {
  return entry.editorial_state === 'ISSUED' && textOf(entry.recommendation_id).startsWith('REC-UER-');
}
function kamchatkaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kamchatka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const take = (name: string) => parts.find(part => part.type === name)?.value ?? '';
  return `${take('day')}.${take('month')}.${take('year')}`;
}
function issuanceProof(entry: Entry, at: Date) {
  return {
    kind: 'UER_REPORT_REGISTER_ENTRY_V1',
    recommendation_id: entry.recommendation_id, grbs: entry.grbs,
    document_date: kamchatkaDate(at), registered_at: at.toISOString(),
    text_sha256: createHash('sha256').update(textOf(entry.recommendation_text), 'utf8').digest('hex'),
    source_ids_sha256: createHash('sha256').update(JSON.stringify(entry.source_procurement_ids), 'utf8').digest('hex'),
  };
}
function editableHistory(entry: Entry): EditorialEvent[] {
  if (entry.editorial_history === undefined) return [];
  if (!Array.isArray(entry.editorial_history)) throw new LedgerProblem(503, 'LEDGER_HISTORY_INVALID',
    'История правок повреждена — запись приостановлена, обратитесь к сопровождению.');
  return entry.editorial_history as EditorialEvent[];
}
function view(entry: Entry) {
  const history = editableHistory(entry);
  return {
    id: entry.recommendation_id,
    grbs: textOf(entry.grbs),
    text: textOf(entry.recommendation_text),
    sourceIds: Array.isArray(entry.source_procurement_ids)
      ? entry.source_procurement_ids.filter((x): x is string => typeof x === 'string') : [],
    stage: stageOf(entry),
    editable: isUerIssued(entry),
    type: textOf(entry.recommendation_type),
    firstSeen: textOf(entry.first_seen),
    lastSeen: textOf(entry.last_seen),
    statusLabel: textOf(entry.semantic_status_ru),
    statusAsOf: textOf(entry.status_as_of),
    grbsResponse: textOf(entry.grbs_response_original),
    uerDecision: textOf(entry.uer_decision_original),
    note: textOf(entry.editor_note),
    updatedAt: textOf(entry.editorial_updated_at),
    history,
  };
}
function uniqueEntries(data: unknown): Entry[] {
  if (!Array.isArray(data) || data.length > 10_000) {
    throw new LedgerProblem(503, 'LEDGER_INVALID', 'Реестр рекомендаций имеет неверную структуру.');
  }
  const ids = new Set<string>();
  for (const row of data) {
    if (!row || Array.isArray(row) || typeof row !== 'object') {
      throw new LedgerProblem(503, 'LEDGER_INVALID', 'В реестре встретилась некорректная запись.');
    }
    const id = (row as Entry).recommendation_id;
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new LedgerProblem(503, 'LEDGER_DUPLICATE', 'Есть повторяющийся или пустой ID рекомендации.');
    }
    ids.add(id);
  }
  return data as Entry[];
}
async function snapshot(path: string): Promise<Snapshot> {
  try {
    const meta = await lstat(path);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 16 * 1024 * 1024) {
      throw new LedgerProblem(503, 'LEDGER_UNSAFE', 'Рабочий реестр нельзя безопасно открыть.');
    }
    const bytes = await readFile(path);
    const entries = uniqueEntries(JSON.parse(bytes.toString('utf8')) as unknown);
    return { entries, bytes, revision: digest(bytes) };
  } catch (error) {
    if (error instanceof LedgerProblem) throw error;
    throw new LedgerProblem(503, 'LEDGER_UNAVAILABLE',
      'Рабочий реестр недоступен — данные не показаны как пустые. Обратитесь к сопровождению.');
  }
}
function ensureDept(value: string) {
  if (!(ALL_DEPT_IDS as readonly string[]).includes(value)) {
    throw new LedgerProblem(400, 'LEDGER_DEPT_INVALID', 'Выберите управление из списка восьми ГРБС.');
  }
}
function event(kind: EditorialEvent['kind'], fields: string[], previous?: Entry): EditorialEvent {
  const before = previous && kind === 'updated' ? {
    grbs: textOf(previous.grbs), text: textOf(previous.recommendation_text),
    sourceIds: Array.isArray(previous.source_procurement_ids)
      ? previous.source_procurement_ids.filter((x): x is string => typeof x === 'string') : [],
  } : undefined;
  return { at: new Date().toISOString(), kind, fields,
    ...(previous && textOf(previous.editor_note) ? { previousNote: textOf(previous.editor_note) } : {}),
    ...(before ? { previous: before } : {}) };
}
function update(entry: Entry, patch: Partial<Entry>, kind: EditorialEvent['kind'], fields: string[]): Entry {
  const now = new Date().toISOString();
  return { ...entry, ...patch, editorial_updated_at: now,
    editorial_history: [...editableHistory(entry), event(kind, fields, entry)] };
}

/** POSIX rename provides an atomic reader-visible switch to the new ledger. */
async function persist(directory: string, old: Snapshot, rows: Entry[]): Promise<string> {
  const versionDir = join(directory, 'ledger-versions');
  await mkdir(versionDir, { recursive: true, mode: 0o700 });
  const backup = join(versionDir, old.revision + '.json');
  // Write + fsync a private staging file, then atomically hard-link it into
  // place. A killed process may leave an ignored staging file, never a truncated
  // authoritative version. EEXIST is trusted only after verifying the SHA.
  const stage = join(versionDir, '.backup-' + randomBytes(12).toString('hex') + '.tmp');
  try {
    const file = await open(stage, 'wx', 0o600);
    try { await file.writeFile(old.bytes); await file.sync(); }
    finally { await file.close(); }
    try {
      await link(stage, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (digest(await readFile(backup)) !== old.revision) {
        throw new LedgerProblem(503, 'LEDGER_BACKUP_MISMATCH',
          'Не совпадает контрольная копия реестра.');
      }
    }
    const dir = await open(versionDir, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } finally {
    await unlink(stage).catch(() => {});
  }
  const next = Buffer.from(JSON.stringify(rows, null, 2) + '\n', 'utf8');
  if (next.length > 16 * 1024 * 1024) {
    throw new LedgerProblem(413, 'LEDGER_TOO_LARGE', 'Объём записей превысил безопасный предел.');
  }
  const temporary = join(directory, '.ledger-' + randomBytes(12).toString('hex') + '.tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(next); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(directory, 'ledger.json'));
    const folder = await open(directory, 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return digest(next);
}
/**
 * Kernel-backed file lock. Unlike O_EXCL lock-file existence, flock releases
 * automatically when the owning Node process dies (even on SIGKILL).
 *
 * The short-lived flock child acquires a lock on fd 3, which is the SAME open
 * file description as the descriptor held by Node. Once the helper exits,
 * Node retains the descriptor and thus the lock through the whole mutation.
 * Closing that descriptor in finally releases it. No stale .lock cleanup.
 */
async function withLedgerLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  let handle;
  try {
    handle = await open(join(directory, '.ledger-editor.lock'),
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  } catch {
    throw new LedgerProblem(503, 'LEDGER_LOCK_UNAVAILABLE',
      'Не удалось открыть блокировку реестра. Изменения не выполнялись.');
  }
  try {
    const fd = handle.fd;
    await new Promise<void>((resolve, reject) => {
      const child = spawn('flock', ['--exclusive', '--nonblock', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', fd] });
      child.once('error', () => reject(new LedgerProblem(503, 'LEDGER_LOCK_UNAVAILABLE',
        'Системная блокировка недоступна. Изменения не выполнялись.')));
      child.once('close', (status) => {
        if (status === 0) resolve();
        else if (status === 1) reject(new LedgerProblem(423, 'LEDGER_BUSY',
          'Другой сотрудник сохраняет реестр. Повторите запрос.'));
        else reject(new LedgerProblem(503, 'LEDGER_LOCK_UNAVAILABLE',
          'Не удалось получить блокировку реестра. Изменения не выполнялись.'));
      });
    });
    return await action();
  } finally {
    await handle.close();
  }
}
async function mutate(stateDir: string, expected: string, change: (rows: Entry[]) => Entry | null) {
  const directory = join(stateDir, 'inputs');
  return withLedgerLock(directory, async () => {
    const current = await snapshot(join(directory, 'ledger.json'));
    if (current.revision !== expected) {
      throw new LedgerProblem(409, 'LEDGER_CHANGED',
        'Реестр уже изменился. Обновите список, чтобы не перезаписать чужие правки.');
    }
    const rows = structuredClone(current.entries);
    const entry = change(rows);
    if (!entry) return { revision: current.revision, record: null };
    const revision = await persist(directory, current, rows);
    return { revision, record: view(entry) };
  });
}

function sendProblem(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof LedgerProblem) return reply.code(error.status).send({ code: error.code, message: error.message });
  return reply.code(503).send({ code: 'LEDGER_WRITE_FAILED',
    message: 'Изменения не подтверждены сервером. Перечитайте реестр перед повторным сохранением.' });
}
function privateWorkspace(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (process.env.AEMR_PUBLIC_READONLY !== 'true') return false;
  reply.code(403).send({ code: 'LEDGER_PRIVATE',
    message: 'Редактируемый реестр доступен только в рабочем, защищённом режиме Dash.' });
  return true;
}

export async function reportRecommendationRoutes(app: FastifyInstance,
  options: { stateDir?: string } = {}): Promise<void> {
  const stateDir = options.stateDir ?? resolve(process.env.REPORT_STATE_DIR ?? 'data/reports');
  app.get('/api/report-recommendations', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (privateWorkspace(reply)) return;
    try {
      const data = await snapshot(join(stateDir, 'inputs', 'ledger.json'));
      const records = data.entries.map(view);
      return { revision: data.revision, records,
        counts: {
          active: records.filter(r => r.stage === 'ACTIVE').length,
          historical: records.filter(r => r.stage === 'HISTORY').length,
          uerAuthored: records.filter(r => r.editable).length,
        } };
    } catch (error) { return sendProblem(error, reply); }
  });

  app.post('/api/report-recommendations', { bodyLimit: 12 * 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (privateWorkspace(reply)) return;
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({
      code: 'LEDGER_INPUT_INVALID', message: 'Проверьте управление, текст, номера позиций и рабочее пояснение.' });
    try {
      ensureDept(parsed.data.grbs);
      const result = await mutate(stateDir, parsed.data.expectedRevision, rows => {
        let id: string;
        do { id = 'REC-UER-' + randomBytes(8).toString('hex').toUpperCase(); }
        while (rows.some(r => r.recommendation_id === id));
        const now = new Date();
        const seen = kamchatkaDate(now);
        const rowNumber = 1 + Math.max(0, ...rows.filter(r => r.table_no === 9)
          .map(r => Number(r.row_no) || 0));
        const base: Entry = {
          recommendation_id: id, grbs: parsed.data.grbs,
          recommendation_text: parsed.data.text, source_procurement_ids: parsed.data.sourceIds,
          section: 'uer', table_no: 9, row_no: rowNumber,
          first_seen: seen, last_seen: seen, status_as_of: seen,
          recommendation_type: 'UER_ENTRY', semantic_status: 'REVIEW_REQUIRED',
          semantic_status_ru: 'Текущее исполнение ещё не проверено',
          historical_acceptance: null,
          active_in_current_slice: true, editorial_state: 'ISSUED',
          editor_note: parsed.data.note,
          grbs_response_original: '', uer_decision_original: '',
        };
        const created = update({ ...base, origin_evidence: [issuanceProof(base, now)] },
          {}, 'created', ['grbs', 'recommendation_text', 'source_procurement_ids']);
        rows.push(created);
        return created;
      });
      return reply.code(201).send(result);
    } catch (error) { return sendProblem(error, reply); }
  });

  app.put<{ Params: { id: string } }>('/api/report-recommendations/:id',
    { bodyLimit: 12 * 1024 }, async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (privateWorkspace(reply)) return;
      const id = request.params.id;
      if (!id || id.length > 128) return reply.code(400).send({
        code: 'LEDGER_ID_INVALID', message: 'Некорректный идентификатор рекомендации.' });
      const rev = (request.body as { expectedRevision?: unknown } | null)?.expectedRevision;
      if (!token.safeParse(rev).success) return reply.code(400).send({
        code: 'LEDGER_INPUT_INVALID', message: 'Обновите реестр перед сохранением.' });
      try {
        const result = await mutate(stateDir, rev as string, rows => {
          const index = rows.findIndex(r => r.recommendation_id === id);
          if (index < 0) throw new LedgerProblem(404, 'LEDGER_NOT_FOUND',
            'Рекомендация не найдена в текущем реестре.');
          const original = rows[index];
          if (isUerIssued(original)) {
            const body = IssuedUpdateSchema.safeParse(request.body);
            if (!body.success) throw new LedgerProblem(400, 'LEDGER_INPUT_INVALID',
              'Проверьте управление, текст, номера закупок и пояснение.');
            ensureDept(body.data.grbs);
            const patch: Partial<Entry> = {
              grbs: body.data.grbs, recommendation_text: body.data.text,
              source_procurement_ids: body.data.sourceIds, editor_note: body.data.note,
            };
            if (['grbs', 'recommendation_text', 'source_procurement_ids'].every(
              field => JSON.stringify(patch[field]) === JSON.stringify(original[field]))) {
              if (body.data.note === textOf(original.editor_note)) return null;
              const noted = update(original, { editor_note: body.data.note }, 'note', ['editor_note']);
              rows[index] = noted;
              return noted;
            }
            const now = new Date();
            const enriched = { ...original, ...patch, last_seen: kamchatkaDate(now),
              origin_evidence: [...(Array.isArray(original.origin_evidence) ? original.origin_evidence : []),
                issuanceProof({ ...original, ...patch }, now)] };
            const fields = ['grbs', 'recommendation_text', 'source_procurement_ids', 'editor_note'];
            const item = update(original, enriched, 'updated', fields);
            rows[index] = item;
            return item;
          }
          const body = NoteUpdateSchema.safeParse(request.body);
          if (!body.success) throw new LedgerProblem(400, 'LEDGER_HISTORICAL_IMMUTABLE',
            'Ранее выпущенный текст и статус не переписываются. Можно добавить рабочее пояснение.');
          if (body.data.note === textOf(original.editor_note)) return null;
          const item = update(original, { editor_note: body.data.note }, 'note', ['editor_note']);
          rows[index] = item;
          return item;
        });
        return reply.send(result);
      } catch (error) { return sendProblem(error, reply); }
    });
}
