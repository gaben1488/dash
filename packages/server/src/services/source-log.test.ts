/**
 * Стражи журнала обращений к источникам.
 *
 * Охраняются четыре обещания:
 *   1. Успешное чтение называет ДВА числа — сколько строк и за сколько; без них
 *      «в отчёте 661 закупка» остаётся утверждением без происхождения.
 *   2. Отказ называется причиной ПО-РУССКИ, а не пересказом ответа Google.
 *   3. Ключ доступа, закрытый ключ и почта в журнал не попадают — ни в полях,
 *      ни в тексте сообщения.
 *   4. До подмены приёмника журнал пишется в консоль: чтения случаются и до
 *      старта приложения, терять их нельзя.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REDACTED,
  logSourceFailure,
  logSourceRead,
  logSourceRetry,
  redactFieldValue,
  setSourceLogger,
  type SourceLogger,
} from './source-log.js';

interface Entry {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  msg: string;
}

function collector(): { entries: Entry[]; logger: SourceLogger } {
  const entries: Entry[] = [];
  const push = (level: Entry['level']) => (fields: Record<string, unknown>, msg: string) => {
    entries.push({ level, fields, msg });
  };
  return { entries, logger: { info: push('info'), warn: push('warn'), error: push('error') } };
}

afterEach(() => {
  setSourceLogger(null);
  vi.restoreAllMocks();
});

describe('успешное чтение', () => {
  it('называет и число строк, и время', () => {
    const { entries, logger } = collector();
    setSourceLogger(logger);

    logSourceRead('чтение листа «ВСЕ»', { rows: 673, ms: 812 });

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].fields).toMatchObject({ what: 'чтение листа «ВСЕ»', rows: 673, ms: 812 });
    expect(entries[0].msg).toContain('строк 673');
    expect(entries[0].msg).toContain('812 мс');
  });

  it('чтение без строк (состав книги) время всё равно называет', () => {
    const { entries, logger } = collector();
    setSourceLogger(logger);

    logSourceRead('чтение состава книги', { ms: 120 });

    expect(entries[0].msg).toContain('120 мс');
    expect(entries[0].msg).not.toContain('строк');
  });
});

describe('отказ', () => {
  it('произносит причину по-русски, а не ответ Google', () => {
    const { entries, logger } = collector();
    setSourceLogger(logger);

    logSourceFailure('чтение листа «ВСЕ»', { ms: 20_000, reason: 'нет доступа к книге' });

    expect(entries[0].level).toBe('warn');
    expect(entries[0].msg).toContain('нет доступа к книге');
    expect(entries[0].fields).toMatchObject({ reason: 'нет доступа к книге' });
  });

  it('повтор виден: тихая пауза иначе неотличима от зависания', () => {
    const { entries, logger } = collector();
    setSourceLogger(logger);

    logSourceRetry('чтение листа «ВСЕ»', {
      attempt: 1,
      delayMs: 500,
      reason: 'источник ограничил частоту обращений',
    });

    expect(entries[0].level).toBe('warn');
    expect(entries[0].msg).toContain('повтор 1 через 500 мс');
  });
});

describe('секреты и персональные данные', () => {
  it('закрытый ключ, ключ доступа и почта заменяются', () => {
    expect(redactFieldValue('-----BEGIN PRIVATE KEY-----MIIEvg')).toBe(REDACTED);
    expect(redactFieldValue('AIzaSyD-0123456789abcdefghij')).toBe(REDACTED);
    expect(redactFieldValue('ya29.a0AfH6SMB-token')).toBe(REDACTED);
    expect(redactFieldValue('aemr-reader@aemr-project.iam.gserviceaccount.com')).toBe(REDACTED);
    expect(redactFieldValue('оператор@aemr.ru')).toBe(REDACTED);
  });

  it('числа и обычные фразы не трогает', () => {
    expect(redactFieldValue(673)).toBe(673);
    expect(redactFieldValue('чтение листа «ВСЕ»')).toBe('чтение листа «ВСЕ»');
  });

  it('поле с почтой не доходит до приёмника', () => {
    const { entries, logger } = collector();
    setSourceLogger(logger);

    logSourceFailure('чтение листа «ВСЕ»', {
      ms: 10,
      reason: 'нет доступа к книге',
    });
    logSourceRead('чтение книги aemr-reader@aemr-project.iam.gserviceaccount.com', { ms: 1 });

    expect(entries[1].fields.what).toBe(REDACTED);
  });
});

describe('приёмник по умолчанию', () => {
  it('до подмены пишет в консоль — чтения до старта приложения не теряются', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logSourceRead('чтение листа «ВСЕ»', { rows: 1, ms: 2 });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
