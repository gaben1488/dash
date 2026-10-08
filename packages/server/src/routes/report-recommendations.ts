/**
 * Editable workspace over the EXISTING procurement report RecommendationLedger.
 * The working JSON stays the sole ledger: a draft is a flagged entry, not a
 * parallel registry. Original official statements are immutable from this UI.
 * The generator excludes drafts before creating any official snapshot.
 */
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ALL_DEPT_IDS } from '@aemr/shared';
import { z } from 'zod';

type Entry = Record<string, unknown>;
type Stage = 'DRAFT' | 'ARCHIVED_DRAFT' | 'ACTIVE' | 'HISTORY';
type EditorialEvent = { at: string; kind: 'created' | 'updated' | 'note'; fields: string[]; previousNote?: string; previousValues?: Record<string, unknown> };
interface Snapshot { entries: Entry[]; bytes: Buffer; revision: string; }

class LedgerProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const token = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().trim().max(2000);
const sourceIds = z.array(z.string().trim().min(1).max(80)).max(64)
  .refine(v => new Set(v).size === v.length, 'Один номер закупки указан несколько раз');
const officialFields = {
  grbs: z.string().trim().min(1),
  text: z.string().trim().min(10).max(6000),
  sourceIds,
  section: z.enum(['ep', 'competitive']).default('ep'),
  note: note.default(''),
};
const CreateSchema = z.object({ expectedRevision: token, ...officialFields }).strict();
const OfficialUpdateSchema = z.object({
  expectedRevision: token, ...officialFields, stage: z.enum(['ACTIVE', 'HISTORY']),
}).strict();
const NoteUpdateSchema = z.object({ expectedRevision: token, note }).strict();

const textOf = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function stageOf(entry: Entry): Stage {
  if (entry.editorial_state === 'DRAFT' || entry.editorial_state === 'ARCHIVED_DRAFT') return entry.editorial_state;
  return entry.active_in_current_slice === true ? 'ACTIVE' : 'HISTORY';
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
    type: textOf(entry.recommendation_type),
    section: textOf(entry.section) || 'ep',
    editable: entry.editorial_state === 'ISSUED' || entry.editorial_state === 'DRAFT'
      || entry.editorial_state === 'ARCHIVED_DRAFT',
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
function event(kind: EditorialEvent['kind'], fields: string[], previousNote?: string,
  previousValues?: Record<string, unknown>): EditorialEvent {
  return { at: new Date().toISOString(), kind, fields,
    ...(previousNote ? { previousNote } : {}),
    ...(previousValues ? { previousValues } : {}) };
}
function kamchatkaDay(timestamp: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kamchatka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp);
  const pick = (kind: string) => parts.find(p => p.type === kind)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function officialEvidence(record: Entry, at: string) {
  return [{
    kind: 'UER_DASH_OFFICIAL_ENTRY_V1',
    recommendation_id: record.recommendation_id,
    grbs: record.grbs,
    issued_by: 'УЭР',
    document_date: kamchatkaDay(new Date(at)),
    recorded_at: at,
    text_sha256: createHash('sha256').update(textOf(record.recommendation_text)).digest('hex'),
  }];
}
function assignTable(rows: Entry[], grbs: string, section: string): number {
  const matching = rows.find(r => r.grbs === grbs && r.section === section
    && typeof r.table_no === 'number' && r.table_no > 0);
  if (matching) return matching.table_no as number;
  const sameDept = rows.find(r => r.grbs === grbs
    && typeof r.table_no === 'number' && r.table_no > 0);
  if (sameDept) return sameDept.table_no as number;
  return Math.max(0, ...rows.map(r => typeof r.table_no === 'number' ? r.table_no : 0)) + 1;
}
function update(entry: Entry, patch: Partial<Entry>, kind: EditorialEvent['kind'], fields: string[],
  previousValues?: Record<string, unknown>): Entry {
  const now = new Date().toISOString();
  return { ...entry, ...patch, editorial_updated_at: now,
    editorial_history: [...editableHistory(entry),
      event(kind, fields, textOf(entry.editor_note), previousValues)] };
}

/** POSIX rename provides an atomic reader-visible switch to the new ledger. */
async function persist(directory: string, old: Snapshot, rows: Entry[]): Promise<string> {
  const versionDir = join(directory, 'ledger-versions');
  await mkdir(versionDir, { recursive: true, mode: 0o700 });
  const backup = join(versionDir, old.revision + '.json');
  try {
    const saved = await open(backup, 'wx', 0o600);
    try { await saved.writeFile(old.bytes); await saved.sync(); }
    finally { await saved.close(); }
    const dir = await open(versionDir, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (digest(await readFile(backup)) !== old.revision) {
      throw new LedgerProblem(503, 'LEDGER_BACKUP_MISMATCH', 'Не совпадает контрольная копия реестра.');
    }
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
async function mutate(stateDir: string, expected: string, change: (rows: Entry[]) => Entry | null) {
  const directory = join(stateDir, 'inputs');
  const lock = join(directory, '.ledger-editor.lock');
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
  } catch {
    throw new LedgerProblem(423, 'LEDGER_BUSY', 'Другой сотрудник сохраняет реестр. Повторите запрос.');
  }
  try {
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
  } finally {
    await handle.close();
    await unlink(lock).catch(() => {});
  }
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
          drafts: records.filter(r => r.stage === 'DRAFT').length,
          archivedDrafts: records.filter(r => r.stage === 'ARCHIVED_DRAFT').length,
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
        const at = new Date().toISOString();
        const date = kamchatkaDay(new Date(at));
        const tableNo = assignTable(rows, parsed.data.grbs, parsed.data.section);
        const number = Math.max(0, ...rows.filter(r => r.table_no === tableNo)
          .map(r => typeof r.row_no === 'number' ? r.row_no : 0)) + 1;
        const first: Entry = {
          recommendation_id: id, grbs: parsed.data.grbs,
          section: parsed.data.section, table_no: tableNo, row_no: number,
          recommendation_text: parsed.data.text,
          recommendation_type: 'OTHER',
          source_procurement_ids: parsed.data.sourceIds,
          active_in_current_slice: true, editorial_state: 'ISSUED',
          issued_by: 'УЭР', issued_at: at, first_seen: date, last_seen: date,
          semantic_status: 'REVIEW_REQUIRED',
          semantic_status_ru: 'Исполнение пока не подтверждено', status_as_of: date,
          status_evidence: 'Официально зарегистрирована УЭР через рабочий реестр Dash.',
          historical_acceptance: null,
          editor_note: parsed.data.note,
          grbs_response_original: '', uer_decision_original: '',
        };
        first.origin_evidence = officialEvidence(first, at);
        const created = update(first, {}, 'created',
          ['grbs', 'recommendation_text', 'source_procurement_ids', 'issued_at']);
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
          if (original.editorial_state === 'ISSUED'
              || original.editorial_state === 'DRAFT'
              || original.editorial_state === 'ARCHIVED_DRAFT') {
            const body = OfficialUpdateSchema.safeParse(request.body);
            if (!body.success) throw new LedgerProblem(400, 'LEDGER_INPUT_INVALID',
              'Проверьте управление, исходный текст, номера закупок и состояние рекомендации.');
            ensureDept(body.data.grbs);
            if (body.data.stage === 'HISTORY' && !body.data.note.trim()) {
              throw new LedgerProblem(400, 'LEDGER_HISTORY_REASON_REQUIRED',
                'При снятии рекомендации с действующих укажите основание в рабочем пояснении.');
            }
            const at = new Date().toISOString();
            const date = kamchatkaDay(new Date(at));
            const prior = {
              grbs: original.grbs, recommendation_text: original.recommendation_text,
              section: original.section, source_procurement_ids: original.source_procurement_ids,
              active_in_current_slice: original.active_in_current_slice,
              origin_evidence: original.origin_evidence,
            };
            const patch: Entry = {
              grbs: body.data.grbs, recommendation_text: body.data.text,
              source_procurement_ids: body.data.sourceIds, section: body.data.section,
              editor_note: body.data.note, active_in_current_slice: body.data.stage === 'ACTIVE',
              editorial_state: 'ISSUED',
              issued_by: 'УЭР', issued_at: original.issued_at || at,
              first_seen: original.first_seen || date, last_seen: date,
              status_as_of: date,
            };
            const item = update(original, patch, 'updated',
              ['grbs', 'recommendation_text', 'source_procurement_ids',
               'section', 'active_in_current_slice'], prior);
            item.origin_evidence = officialEvidence(item, at);
            if (item.section !== original.section || item.grbs !== original.grbs) {
              item.table_no = assignTable(rows.filter(r => r.recommendation_id !== id),
                body.data.grbs, body.data.section);
              item.row_no = Math.max(0, ...rows.filter(r => r.table_no === item.table_no)
                .map(r => typeof r.row_no === 'number' ? r.row_no : 0)) + 1;
            }
            rows[index] = item;
            return item;
          }
          const body = NoteUpdateSchema.safeParse(request.body);
          if (!body.success) throw new LedgerProblem(400, 'LEDGER_HISTORICAL_IMMUTABLE',
            'Исходный текст и статус выпущенной рекомендации не переписываются. Можно добавить рабочее пояснение.');
          if (body.data.note === textOf(original.editor_note)) return null;
          const item = update(original, { editor_note: body.data.note }, 'note', ['editor_note']);
          rows[index] = item;
          return item;
        });
        return reply.send(result);
      } catch (error) { return sendProblem(error, reply); }
    });
}
