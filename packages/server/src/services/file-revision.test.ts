/**
 * Стражи дешёвой проверки версии файла.
 *
 * Поведение, которое здесь закрепляется:
 *  - совпала отметка Drive — вердикт «не менялся», и книгу читать не надо
 *    (требование владельца 21.08: событие без изменений не вызывает перечитку);
 *  - Drive молчит — вердикт «не знаю», и это ОБЯЗАНО означать «читай»;
 *  - молчание не становится базой сравнения: после «не знаю» следующая
 *    проверка не имеет права сказать «не менялся».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const filesGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({ files: { get: filesGet } })),
    auth: {
      GoogleAuth: vi.fn(function GoogleAuth() {
        return {};
      }),
    },
  },
}));

vi.mock('../config.js', () => ({
  config: {
    google: { serviceAccountEmail: 'bot@example.com', privateKey: 'key' },
  },
}));

const FILE = 'book-1';

async function subject() {
  return import('./file-revision.js');
}

beforeEach(async () => {
  filesGet.mockReset();
  const { resetRevisionMemory } = await subject();
  resetRevisionMemory();
});

describe('checkFileChanged', () => {
  it('первый вопрос за жизнь процесса — «менялся»: сравнивать не с чем', async () => {
    filesGet.mockResolvedValue({ data: { version: '10', modifiedTime: '2026-08-21T01:00:00.000Z' } });
    const { checkFileChanged } = await subject();
    await expect(checkFileChanged(FILE)).resolves.toBe('changed');
  });

  it('та же отметка — «не менялся»: книгу читать нечего', async () => {
    filesGet.mockResolvedValue({ data: { version: '10', modifiedTime: '2026-08-21T01:00:00.000Z' } });
    const { checkFileChanged } = await subject();
    await checkFileChanged(FILE);
    await expect(checkFileChanged(FILE)).resolves.toBe('same');
  });

  it('версия сдвинулась — «менялся», даже если время правки то же', async () => {
    const { checkFileChanged } = await subject();
    filesGet.mockResolvedValue({ data: { version: '10', modifiedTime: '2026-08-21T01:00:00.000Z' } });
    await checkFileChanged(FILE);
    filesGet.mockResolvedValue({ data: { version: '11', modifiedTime: '2026-08-21T01:00:00.000Z' } });
    await expect(checkFileChanged(FILE)).resolves.toBe('changed');
  });

  it('Drive не ответил — «не знаю», а не «не менялся»', async () => {
    filesGet.mockRejectedValue(new Error('403'));
    const { checkFileChanged } = await subject();
    await expect(checkFileChanged(FILE)).resolves.toBe('unknown');
  });

  it('молчание не становится базой сравнения', async () => {
    const { checkFileChanged, lastKnownRevision } = await subject();
    filesGet.mockResolvedValue({ data: { version: '10', modifiedTime: '2026-08-21T01:00:00.000Z' } });
    await checkFileChanged(FILE);
    filesGet.mockRejectedValue(new Error('сеть'));
    await expect(checkFileChanged(FILE)).resolves.toBe('unknown');
    // Отметка осталась прежней — неудачный вопрос ничего не запомнил.
    expect(lastKnownRevision(FILE)).toEqual({ version: '10', modifiedTime: '2026-08-21T01:00:00.000Z' });
  });

  it('пустой ответ Drive не выдаётся за совпадение', async () => {
    filesGet.mockResolvedValue({ data: {} });
    const { checkFileChanged } = await subject();
    await checkFileChanged(FILE);
    await expect(checkFileChanged(FILE)).resolves.toBe('changed');
  });

  it('маска полей просит только версию и время правки — не грид', async () => {
    filesGet.mockResolvedValue({ data: { version: '1', modifiedTime: 'x' } });
    const { checkFileChanged } = await subject();
    await checkFileChanged(FILE);
    expect(filesGet).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE, fields: 'version,modifiedTime' }),
      expect.anything(),
    );
  });
});

describe('noteRevisionRead', () => {
  it('запоминает отметку после самостоятельного чтения книги', async () => {
    filesGet.mockResolvedValue({ data: { version: '7', modifiedTime: '2026-08-21T02:00:00.000Z' } });
    const { noteRevisionRead, checkFileChanged } = await subject();
    await noteRevisionRead(FILE);
    await expect(checkFileChanged(FILE)).resolves.toBe('same');
  });
});
