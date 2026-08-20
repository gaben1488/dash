/**
 * Настройки соединения с базой — проверка на живой базе, не на константах.
 *
 * Смысл проверки: `busy_timeout` и `synchronous` невидимы, пока всё спокойно,
 * и обнаруживают себя единственным способом — редким SQLITE_BUSY посреди
 * рабочего дня. Тест открывает базу теми же прагмами, что и `db/index.ts`, и
 * спрашивает у SQLite, что она о себе думает.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLITE_PRAGMAS } from './index.js';

const dir = mkdtempSync(join(tmpdir(), 'aemr-pragmas-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openLikeProduction(): InstanceType<typeof Database> {
  const db = new Database(join(dir, 'probe.db'));
  db.pragma('journal_mode = WAL');
  db.pragma(`busy_timeout = ${SQLITE_PRAGMAS.busyTimeoutMs}`);
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('настройки соединения SQLite', () => {
  it('журнал в режиме WAL — чтение не ждёт записи', () => {
    const db = openLikeProduction();
    expect(db.pragma('journal_mode', { simple: true })).toBe(SQLITE_PRAGMAS.journalMode);
    db.close();
  });

  it('занятая база ждёт, а не отказывает мгновенно', () => {
    const db = openLikeProduction();
    expect(db.pragma('busy_timeout', { simple: true })).toBe(SQLITE_PRAGMAS.busyTimeoutMs);
    db.close();
  });

  it('синхронизация NORMAL — режим, рекомендованный для WAL', () => {
    const db = openLikeProduction();
    expect(db.pragma('synchronous', { simple: true })).toBe(SQLITE_PRAGMAS.synchronous);
    db.close();
  });

  it('внешние ключи включены', () => {
    const db = openLikeProduction();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(SQLITE_PRAGMAS.foreignKeys);
    db.close();
  });

  it('второе соединение не падает на записи, пока первое пишет', () => {
    const first = openLikeProduction();
    const second = openLikeProduction();
    first.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, v TEXT)');

    first.prepare('INSERT INTO probe (v) VALUES (?)').run('первый');
    // Прежняя настройка (без ожидания) роняла это обращение с SQLITE_BUSY,
    // если первое соединение держало запись.
    expect(() => second.prepare('INSERT INTO probe (v) VALUES (?)').run('второй')).not.toThrow();
    expect(second.prepare('SELECT COUNT(*) AS n FROM probe').get()).toEqual({ n: 2 });

    first.close();
    second.close();
  });
});
