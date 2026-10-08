import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { reportRecommendationRoutes } from './report-recommendations.js';

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
