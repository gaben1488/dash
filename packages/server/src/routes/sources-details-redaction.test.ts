/**
 * sources-details-redaction.test.ts — страж: техническая подсказка о причине
 * отказа источника не выносит наружу почту служебной учётной записи или ключ.
 *
 * ЗАЧЕМ. /api/sources и /api/sources/:name/validate отдают исходный текст
 * ошибки Google подсказкой (`statusDetails` / `details`). Текст 403 от Google
 * иногда называет почту служебной учётной записи дословно — а это и
 * персональные данные, и половина реквизитов доступа. Журнал сервера такие
 * строки уже вычищает (source-log.ts, redactFieldValue); ответ API обязан
 * жить по тому же правилу, а не по второму. Здесь закреплено:
 *   • строка со следом почты/ключа наружу не уходит — заменяется «[скрыто]»;
 *   • обычная техническая строка проходит дословно — подсказка полезна
 *     ровно тем, что она дословная.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { REDACTED } from '../services/source-log.js';

// Импорт маршрута тянет базу и конфиг — база обязана быть в памяти, а не
// файлом на диске тестовой машины (тот же приём, что journal-stats.test.ts).
let safeSourceDetails: (raw: string) => string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_PATH = ':memory:';
  process.env.LOG_LEVEL = 'silent';
  ({ safeSourceDetails } = await import('./journal.js'));
}, 60_000);

describe('safeSourceDetails — подсказка о причине отказа источника', () => {
  it('строка с почтой служебной учётной записи наружу не уходит', () => {
    expect(
      safeSourceDetails(
        'The caller does not have permission: share the sheet with aemr-reader@project-123.iam.gserviceaccount.com',
      ),
    ).toBe(REDACTED);
  });

  it('строка со следом ключа доступа наружу не уходит', () => {
    expect(safeSourceDetails('auth failed for key AIzaSyD1234567890abcdefgh')).toBe(REDACTED);
  });

  it('обычная техническая строка проходит дословно — подсказка должна оставаться подсказкой', () => {
    const raw = "Unable to parse range: 'УАГЗО'!A:ZZ";
    expect(safeSourceDetails(raw)).toBe(raw);
    expect(safeSourceDetails('Request failed with status code 429')).toBe(
      'Request failed with status code 429',
    );
  });
});
