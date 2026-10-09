import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { reportRecommendationRoutes, withLedgerLock } from './report-recommendations.js';

const folders: string[] = [];
const historical = {
  recommendation_id: 'REC-ORIGINAL',
  grbs: 'УО',
  recommendation_text: 'Предложение из исторического документа',
  source_procurement_ids: ['42'],
  first_seen: '25.09.2026',
  active_in_current_slice: true,
  grbs_response_original: 'Согласны',
  uer_decision_original: 'Принято к сведению',
  semantic_status_ru: 'Исторический статус',
  status_as_of: '25.09.2026',
};
async function fixture(entries: Record<string, unknown>[] = [historical]) {
  const stateDir = await mkdtemp(join(tmpdir(), 'report-ledger-ui-'));
  folders.push(stateDir);
  await mkdir(join(stateDir, 'inputs'));
  await writeFile(join(stateDir, 'inputs', 'ledger.json'), JSON.stringify(entries));
  const app = Fastify();
  await app.register(reportRecommendationRoutes, { stateDir });
  return { app, stateDir };
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true })));
  delete process.env.AEMR_PUBLIC_READONLY;
});

it('shows the real historical ledger, not a generated list of dashboard issues', async () => {
  const { app } = await fixture();
  const reply = await app.inject('/api/report-recommendations');
  expect(reply.statusCode).toBe(200);
  expect(reply.headers['cache-control']).toBe('private, no-store');
  expect(reply.json()).toMatchObject({
    counts: { active: 1, historical: 0, uerAuthored: 0 },
    records: [{ id: 'REC-ORIGINAL', grbs: 'УО', text: historical.recommendation_text,
      statusLabel: 'Исторический статус', statusAsOf: '25.09.2026' }],
  });
  expect(reply.json().revision).toMatch(/^[a-f0-9]{64}$/);
  await app.close();
});

it('saves an official УЭР recommendation into the SAME ledger at one click', async () => {
  const { app, stateDir } = await fixture();
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const reply = await app.inject({
    method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: revision, grbs: 'УО',
      text: 'Рассмотреть объединение позиций', sourceIds: ['42', '43'], note: 'Нужно сверить предмет' },
  });
  expect(reply.statusCode).toBe(201);
  const result = reply.json();
  expect(result.record).toMatchObject({
    grbs: 'УО', text: 'Рассмотреть объединение позиций', stage: 'ACTIVE', editable: true,
    sourceIds: ['42', '43'], note: 'Нужно сверить предмет',
  });
  expect(result.record.id).toMatch(/^REC-UER-[A-F0-9]{16}$/);
  const saved = JSON.parse(await readFile(join(stateDir, 'inputs', 'ledger.json'), 'utf8'));
  expect(saved).toHaveLength(2);
  expect(saved[0]).toEqual(historical);
  expect(saved[1].editorial_state).toBe('ISSUED');
  expect(saved[1].origin_evidence[0]).toMatchObject({
    kind: 'UER_REPORT_REGISTER_ENTRY_V1', grbs: 'УО', recommendation_id: result.record.id,
  });
  expect(saved[1].table_no).toBe(9);
  expect(saved[1].active_in_current_slice).toBe(true);
  expect(saved[1].editorial_history).toHaveLength(1);
  const directory = await import('node:fs/promises').then(fs => fs.readdir(join(stateDir, 'inputs', 'ledger-versions')));
  expect(directory).toHaveLength(1);
  await app.close();
});

it('revisions an issued recommendation without overwriting its original or concurrent edits', async () => {
  const { app } = await fixture();
  let revision = (await app.inject('/api/report-recommendations')).json().revision;
  const created = (await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: revision, grbs: 'УЭР', text: 'Предложение', sourceIds: [] } })).json();
  const id = created.record.id;
  const stale = revision;
  revision = created.revision;
  const changed = await app.inject({ method: 'PUT', url: `/api/report-recommendations/${id}`,
    payload: { expectedRevision: revision, grbs: 'УО',
      text: 'Уточнённое предложение', sourceIds: ['55'], note: 'После проверки' } });
  expect(changed.statusCode).toBe(200);
  expect(changed.json().record).toMatchObject({
    id, grbs: 'УО', stage: 'ACTIVE', sourceIds: ['55'], editable: true,
  });
  const conflict = await app.inject({ method: 'PUT', url: `/api/report-recommendations/${id}`,
    payload: { expectedRevision: stale, grbs: 'УО', text: 'Перезаписать',
      sourceIds: [], note: '' } });
  expect(conflict.statusCode).toBe(409);
  // The old wording survives in the revision log; the new one is the effective source.
  expect(changed.json().record.history.find((e: { previous?: { text: string } }) => e.previous)?.previous.text)
    .toBe('Предложение');
  expect((await app.inject('/api/report-recommendations')).json().records.find((r: { id: string }) => r.id === id)
    .text).toBe('Уточнённое предложение');
  await app.close();
});

it('preserves historical source fields; edits only working notes with an audit trail', async () => {
  const { app, stateDir } = await fixture();
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const original = await app.inject({ method: 'PUT',
    url: '/api/report-recommendations/REC-ORIGINAL',
    payload: { expectedRevision: revision, note: 'Уточнить связь по документу' } });
  expect(original.statusCode).toBe(200);
  const bad = await app.inject({ method: 'PUT',
    url: '/api/report-recommendations/REC-ORIGINAL',
    payload: { expectedRevision: original.json().revision, text: 'Изменённый официальный текст',
      note: 'Нельзя подменять оригинал' } });
  expect(bad.statusCode).toBe(400);
  const saved = JSON.parse(await readFile(join(stateDir, 'inputs', 'ledger.json'), 'utf8'));
  expect(saved[0].recommendation_text).toBe(historical.recommendation_text);
  expect(saved[0].editor_note).toBe('Уточнить связь по документу');
  expect(saved[0].editorial_history).toHaveLength(1);
  await app.close();
});

it('rejects invalid records, missing ledger and public read-only access instead of pretending zero', async () => {
  const { app, stateDir } = await fixture();
  const version = (await app.inject('/api/report-recommendations')).json().revision;
  const invalid = await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: version, grbs: 'НЕИЗВЕСТНО', text: 'Нельзя',
      sourceIds: ['1'] } });
  expect(invalid.statusCode).toBe(400);
  process.env.AEMR_PUBLIC_READONLY = 'true';
  expect((await app.inject('/api/report-recommendations')).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: version, grbs: 'УО', text: 'Нельзя', sourceIds: [] } })).statusCode).toBe(403);
  delete process.env.AEMR_PUBLIC_READONLY;
  await rm(join(stateDir, 'inputs', 'ledger.json'));
  expect((await app.inject('/api/report-recommendations')).statusCode).toBe(503);
  await app.close();
});


it('does not strand the working register when a previous process left a lock filename', async () => {
  const { app, stateDir } = await fixture();
  const lock = join(stateDir, 'inputs', '.ledger-editor.lock');
  await writeFile(lock, 'old-instance-crashed');
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const result = await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: revision, grbs: 'УО',
      text: 'Документированная новая рекомендация УЭР', sourceIds: ['42'] } });
  expect(result.statusCode).toBe(201);
  expect((await readFile(lock, 'utf8'))).toBe('old-instance-crashed');
  await app.close();
});

it('serializes a live competing server with the operating-system flock, then recovers', async () => {
  const { app, stateDir } = await fixture();
  const lock = join(stateDir, 'inputs', '.ledger-editor.lock');
  const helper = spawn('flock', ['--exclusive', '--no-fork', lock, 'sh', '-c',
    'printf READY; exec sleep 8'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The competing lock was not acquired')), 4000);
      helper.stdout!.once('data', buffer => {
        clearTimeout(timer);
        if (buffer.toString().includes('READY')) resolve();
        else reject(new Error('Unexpected lock helper output'));
      });
      helper.once('error', error => { clearTimeout(timer); reject(error); });
      helper.once('close', () => { clearTimeout(timer); reject(new Error('Lock helper exited')); });
    });
    const { revision } = (await app.inject('/api/report-recommendations')).json();
    const blocked = await app.inject({ method: 'POST', url: '/api/report-recommendations',
      payload: { expectedRevision: revision, grbs: 'УО',
        text: 'Нельзя сохранять во время другой записи', sourceIds: [] } });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().code).toBe('LEDGER_BUSY');
  } finally {
    helper.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (helper.exitCode !== null) resolve();
      else helper.once('close', () => resolve());
    });
  }
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const accepted = await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: revision, grbs: 'УО',
      text: 'После освобождения блокировки сохранение работает', sourceIds: [] } });
  expect(accepted.statusCode).toBe(201);
  await app.close();
});

it('rejects a mismatched previously recorded backup and never overwrites source history', async () => {
  const { app, stateDir } = await fixture();
  const path = join(stateDir, 'inputs', 'ledger.json');
  const original = await readFile(path);
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const versionDir = join(stateDir, 'inputs', 'ledger-versions');
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, revision + '.json'), 'incomplete-backup-from-old-process');
  const result = await app.inject({ method: 'POST', url: '/api/report-recommendations',
    payload: { expectedRevision: revision, grbs: 'УО',
      text: 'Недопустимо сохранять при повреждённой истории', sourceIds: [] } });
  expect(result.statusCode).toBe(503);
  expect(result.json().code).toBe('LEDGER_BACKUP_MISMATCH');
  expect(await readFile(path)).toEqual(original);
  await app.close();
});

it('does not lose an authorized recommendation when concurrent saves race', async () => {
  const { app, stateDir } = await fixture();
  const { revision } = (await app.inject('/api/report-recommendations')).json();
  const response = await Promise.all([
    app.inject({ method: 'POST', url: '/api/report-recommendations',
      payload: { expectedRevision: revision, grbs: 'УО',
        text: 'Предложение о проверке текущих закупочных позиций', sourceIds: ['41'] } }),
    app.inject({ method: 'POST', url: '/api/report-recommendations',
      payload: { expectedRevision: revision, grbs: 'УД',
        text: 'Предложение о проверке закупки на предмет объединения', sourceIds: ['57'] } }),
  ]);
  expect(response.filter(result => result.statusCode === 201)).toHaveLength(1);
  expect(response.filter(result => result.statusCode === 409 || result.statusCode === 423)).toHaveLength(1);
  const saved = JSON.parse(await readFile(join(stateDir, 'inputs', 'ledger.json'), 'utf8'));
  expect(saved).toHaveLength(2);
  expect(saved[0]).toEqual(historical);
  expect(saved[1].editorial_state).toBe('ISSUED');
  await app.close();
});


it('the Node-held file descriptor keeps the kernel lock after the helper exits', async () => {
  const { app, stateDir } = await fixture();
  const dir = join(stateDir, 'inputs');
  const lock = join(dir, '.ledger-editor.lock');
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const worker = withLedgerLock(dir, async () => {
    enter();
    await held;
  });
  try {
    await entered;
    // The short-lived flock helper has already exited. The parent Node
    // descriptor MUST still hold the kernel lock during this awaited action.
    expect(spawnSync('flock', ['--exclusive', '--nonblock', lock, 'true']).status).toBe(1);
  } finally {
    release();
    await worker;
  }
  expect(spawnSync('flock', ['--exclusive', '--nonblock', lock, 'true']).status).toBe(0);
  await app.close();
});
