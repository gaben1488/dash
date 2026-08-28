/**
 * Страж схемы базы: пустая база обязана получить ВСЁ, что объявлено моделью.
 *
 * Цена дефекта, ради которого страж заведён: таблица `changelog_entries`
 * (журнал правок книг ГРБС — кто, когда и что поменял) была объявлена в
 * `schema.ts` и НИ РАЗУ не создавалась. Вставка падала, роут `/api/changes`
 * ловил отказ своей страховкой и отвечал живым чтением книг — снаружи всё
 * выглядело работающим, а история правок не переживала ни один рестарт, ради
 * чего таблицу и заводили. Расхождение модели и схемы не видно ни в типах, ни
 * в ответах: его видно только здесь.
 *
 * Проверка идёт на ВРЕМЕННОЙ базе через `SCHEMA_DDL`, а не на рабочей: импорт
 * `db/index.ts` открыл бы настоящий файл базы, а на уже заведённой базе
 * недостающая таблица могла бы отыскаться от прежних запусков и страж соврал бы.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SCHEMA_DDL, COLUMN_MIGRATIONS, POST_MIGRATION_DDL } from './ddl.js';
import * as schema from './schema.js';

const dir = mkdtempSync(join(tmpdir(), 'aemr-ddl-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Пустая база, доведённая до боевого состояния тем же порядком, что и `db/index.ts`. */
function freshDatabase(name: string): InstanceType<typeof Database> {
  const db = new Database(join(dir, `${name}.db`));
  db.exec(SCHEMA_DDL);
  for (const statement of COLUMN_MIGRATIONS) {
    try {
      db.exec(statement);
    } catch (e) {
      if (!(e as Error).message?.includes('duplicate column')) throw e;
    }
  }
  db.exec(POST_MIGRATION_DDL);
  return db;
}

/** Имена таблиц, объявленных моделью (`schema.ts`), — источник ожиданий. */
function declaredTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema) as unknown[]) {
    // `is` — проверка времени выполнения из drizzle; сузить объединение всех
    // объявленных таблиц к общему `SQLiteTable` предикатом типов нельзя, а
    // имя таблицы читается у любой из них одинаково.
    if (is(value, SQLiteTable)) names.push(getTableName(value as SQLiteTable));
  }
  return names.sort();
}

function existingTables(db: InstanceType<typeof Database>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_'))
    .sort();
}

function existingIndexes(db: InstanceType<typeof Database>): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
      .map((r) => r.name),
  );
}

describe('схема базы на пустом месте', () => {
  it('каждая таблица модели действительно создаётся', () => {
    const db = freshDatabase('tables');
    const missing = declaredTables().filter((t) => !existingTables(db).includes(t));
    db.close();
    // Пусто — значит объявить таблицу и забыть её создать больше нельзя.
    expect(missing).toEqual([]);
  });

  it('журнал правок книг получает свою таблицу и колонки', () => {
    // Отдельно от общей проверки: это тот самый случай, с которого страж начался.
    const db = freshDatabase('changelog');
    const columns = (db.prepare('PRAGMA table_info(changelog_entries)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    db.close();
    expect(columns).toEqual(
      ['at_ms', 'attribute', 'author', 'cell', 'dept', 'id', 'new_value', 'old_value', 'recorded_at', 'sheet'],
    );
  });

  it('вставка в журнал правок проходит, а повтор того же адреса не плодит дубль', () => {
    const db = freshDatabase('changelog-write');
    const insert = db.prepare(
      `INSERT INTO changelog_entries (id, dept, sheet, cell, attribute, old_value, new_value, at_ms, author, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    const row = ['УО|ВСЕ|L178|1750000000000', 'УО', 'ВСЕ', 'L178', 'Дата НМЦК', '', '01.08.2026', 1_750_000_000_000, '', '2026-08-19T00:00:00.000Z'];
    insert.run(...row);
    insert.run(...row);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM changelog_entries').get() as { n: number }).n;
    db.close();
    expect(count).toBe(1);
  });

  it('окна по времени опираются на индексы, а не на перебор таблицы', () => {
    // Три запроса продукта, каждый из которых до этого читал таблицу целиком:
    // «последний целый снимок», «последние записи журнала», «правки с даты».
    const db = freshDatabase('indexes');
    const indexes = existingIndexes(db);
    db.close();
    for (const name of [
      'idx_snapshots_created',
      'idx_audit_log_timestamp',
      'idx_issue_history_timestamp',
      'idx_changelog_entries_at',
      'idx_changelog_entries_dept',
    ]) {
      expect(indexes.has(name), `нет индекса ${name}`).toBe(true);
    }
  });

  it('снимок «на день среза или раньше» идёт по индексу, а не перебором', () => {
    // Проверяем не наличие имени, а ПЛАН запроса: индекс, который планировщик
    // не выбрал, не ускоряет ничего. Запрос — тот же, что в getSnapshotAtOrBefore.
    const db = freshDatabase('plan');
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT data FROM snapshots WHERE created_at < ? ORDER BY created_at DESC LIMIT 50')
      .all('2026-08-19T00:00:00.000Z') as Array<{ detail: string }>;
    db.close();
    const detail = plan.map((p) => p.detail).join(' ');
    expect(detail).toContain('idx_snapshots_created');
    expect(detail).not.toContain('SCAN snapshots');
  });

  it('честный пропуск журнала не пишется дважды — уникальный индекс приводит NULL к пустой строке', () => {
    // Без уникального индекса ON CONFLICT DO NOTHING в noteHonestGap не
    // срабатывал бы никогда и дубли пропусков росли бы молча; а без ifnull
    // два NULL для SQLite не равны — пропуск без отметки плодился бы вечно.
    const db = freshDatabase('journal-gaps');
    expect(existingIndexes(db).has('idx_journal_gaps_unique')).toBe(true);

    const insert = db.prepare(
      'INSERT INTO journal_gaps (book, file_modified_time, noted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    );
    insert.run('УО', '2026-08-29T01:00:00.000Z', '2026-08-29T02:00:00.000Z');
    insert.run('УО', '2026-08-29T01:00:00.000Z', '2026-08-29T03:00:00.000Z'); // дубль
    insert.run('УО', null, '2026-08-29T02:00:00.000Z');
    insert.run('УО', null, '2026-08-29T03:00:00.000Z'); // дубль без отметки — тоже дубль

    const n = (db.prepare('SELECT COUNT(*) AS n FROM journal_gaps').get() as { n: number }).n;
    db.close();
    expect(n).toBe(2);
  });

  it('повторное применение схемы ничего не ломает', () => {
    // Команда выполняется на каждом запуске сервера, а не один раз при установке.
    const db = freshDatabase('idempotent');
    expect(() => db.exec(SCHEMA_DDL)).not.toThrow();
    expect(() => db.exec(POST_MIGRATION_DDL)).not.toThrow();
    db.close();
  });
});
