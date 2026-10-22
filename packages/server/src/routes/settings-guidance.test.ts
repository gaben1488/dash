/** C06.03: real Fastify/SQLite lifecycle, with no source-network or production writes. */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

describe('C06.03 edited explanations /api/settings/guidance', () => {
  let app: FastifyInstance;
  let sqlite: import('better-sqlite3').Database;
  const key = 'field:planDate';
  const endpoint = `/api/settings/guidance/${encodeURIComponent(key)}`;
  const newText = 'Проверьте плановую дату в первичном документе, без подстановок.';

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      AEMR_PUBLIC_READONLY: 'false',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    const { db } = await import('../db/index.js');
    sqlite = db.$client;
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('returns a complete catalog with canonical text and no phantom edit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/guidance' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.version).toBe('C06.03-editorial-v1');
    expect(data.calculationRulesChanged).toBe(false);
    expect(data.entries.length).toBeGreaterThan(20);
    expect(data.entries.find((item: { key: string }) => item.key === key)).toMatchObject({
      section: 'field', overridden: false, revision: 0, updatedAt: null,
    });
    expect(data.entries.map((item: { key: string }) => item.key).length)
      .toBe(new Set(data.entries.map((item: { key: string }) => item.key)).size);
  });

  it('saves an editorial change atomically with audit and readback', async () => {
    const res = await app.inject({
      method: 'PUT', url: endpoint,
      payload: { text: newText, comment: 'Исправлена редакция для оператора', expectedRevision: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key, text: newText, revision: 1, overridden: true });
    const after = (await app.inject({ method: 'GET', url: '/api/settings/guidance' })).json();
    expect(after.entries.find((item: { key: string }) => item.key === key)).toMatchObject({
      text: newText, revision: 1, overridden: true,
    });
    const audit = sqlite.prepare(
      "SELECT old_value,new_value,details FROM audit_log WHERE action='domain_guidance_edit' AND entity_id=?",
    ).all(key) as Array<{ old_value: string; new_value: string; details: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].new_value).toBe(newText);
    expect(JSON.parse(audit[0].details).revision).toBe(1);
  });

  it('rejects lost update using revision CAS', async () => {
    const res = await app.inject({
      method: 'PUT', url: endpoint,
      payload: { text: 'Не должно сохраниться', comment: 'Проверка конфликтующей редакции', expectedRevision: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().revision).toBe(1);
    const row = sqlite.prepare('SELECT editorial_text,revision FROM domain_guidance_edits WHERE key=?')
      .get(key) as { editorial_text: string; revision: number };
    expect(row).toEqual({ editorial_text: newText, revision: 1 });
  });

  it('a failed audit insert rolls back the data change', async () => {
    sqlite.exec(`CREATE TRIGGER deny_guidance_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'domain_guidance_edit'
      BEGIN SELECT RAISE(ABORT, 'simulated audit outage'); END;`);
    try {
      const res = await app.inject({
        method: 'PUT', url: endpoint,
        payload: { text: 'Запись с несохранённым аудитом', comment: 'Воспроизведение отказа журнала', expectedRevision: 1 },
      });
      expect(res.statusCode).toBe(503);
      const record = sqlite.prepare('SELECT editorial_text,revision FROM domain_guidance_edits WHERE key=?')
        .get(key) as { editorial_text: string; revision: number };
      expect(record).toEqual({ editorial_text: newText, revision: 1 });
    } finally {
      sqlite.exec('DROP TRIGGER IF EXISTS deny_guidance_audit');
    }
  });

  it('reset to original wording increments revision rather than erasing the history', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/settings/guidance' })).json();
    const original = before.entries.find((item: { key: string }) => item.key === key).defaultText;
    const res = await app.inject({
      method: 'PUT', url: endpoint,
      payload: { text: original, comment: 'Возврат редакции к каноническому тексту', expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ text: original, overridden: false, revision: 2 });
    const stored = sqlite.prepare('SELECT editorial_text,revision FROM domain_guidance_edits WHERE key=?')
      .get(key) as { editorial_text: string | null; revision: number };
    expect(stored).toEqual({ editorial_text: null, revision: 2 });
    const auditCount = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action='domain_guidance_edit' AND entity_id=?",
    ).get(key) as { n: number };
    expect(auditCount.n).toBe(2);
  });

  it('rejects unknown keys and invalid, unreasoned or oversized content', async () => {
    const unknown = await app.inject({
      method: 'PUT', url: '/api/settings/guidance/ep%3AUNKNOWN',
      payload: { text: 'Новый закон', comment: 'Невалидный ключ справочника', expectedRevision: 0 },
    });
    expect(unknown.statusCode).toBe(404);
    for (const payload of [
      { text: ' ', comment: 'Пустое пояснение', expectedRevision: 2 },
      { text: 'Новый текст', comment: 'нет', expectedRevision: 2 },
      { text: 'Обновить правила', comment: 'Тест лишнего поля', expectedRevision: 2, legalThreshold: 12 },
      { text: 'А'.repeat(601), comment: 'Слишком длинный текст', expectedRevision: 2 },
    ]) {
      const res = await app.inject({ method: 'PUT', url: endpoint, payload });
      expect(res.statusCode).toBe(400);
    }
  });
});
