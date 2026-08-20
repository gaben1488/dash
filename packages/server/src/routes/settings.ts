import type { FastifyInstance } from 'fastify';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {

  /** GET /api/settings/status — текущий статус credentials */
  app.get('/api/settings/status', async (_request, reply) => {
    const hasEmail = !!config.google.serviceAccountEmail;
    const hasKey = !!config.google.privateKey;
    const hasSpreadsheet = !!config.google.spreadsheetId;

    return reply.send({
      configured: hasEmail && hasKey && hasSpreadsheet,
      spreadsheetId: config.google.spreadsheetId ?? null,
      serviceAccountEmail: config.google.serviceAccountEmail ?? null,
      hasPrivateKey: hasKey,
      port: config.server.port,
      host: config.server.host,
    });
  });

  /** POST /api/settings/env — перезаписать .env файл */
  //
  // Реестр безопасности 05.06.2026, S-C1 («.env-инъекция»): поля попадали в
  // файл настроек сырьём, а закрытый ключ вдобавок оборачивался в кавычки. Одна
  // кавычка внутри присланного значения закрывала строку раньше времени, и всё,
  // что шло дальше, файл настроек читал как новые собственные строки — включая
  // AEMR_API_KEY, то есть ключ доступа ко всему продукту. Защита стояла только
  // снаружи (режим разработки плюс отдельный заголовок), сама запись не
  // проверяла ничего.
  //
  // Теперь у каждого поля есть форма, и всё, что в неё не укладывается,
  // отклоняется до записи. Однострочным полям кавычки и переводы строк
  // запрещены прямо; закрытый ключ обязан быть настоящим PEM — а значит,
  // кавычке в нём взяться неоткуда.

  /** Опознаватель книги Google: только буквы, цифры, дефис и подчёркивание. */
  const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,120}$/;
  /** Имя или адрес узла: без пробелов, кавычек и переводов строк. */
  const HOST_RE = /^[A-Za-z0-9._-]{1,64}$/;
  /**
   * Закрытый ключ в конверте PEM. Внутри допускаются как настоящие переводы
   * строк, так и их запись двумя знаками (`\n`) — обе формы выдаёт консоль
   * Google, обе умеет прочитать `config.ts`.
   */
  const PRIVATE_KEY_RE =
    /^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----(?:[A-Za-z0-9+/=\s]|\\n)+-----END (?:RSA |EC )?PRIVATE KEY-----\s*$/;

  const EnvUpdateSchema = z.object({
    spreadsheetId: z
      .string()
      .optional()
      .default('')
      .refine((v) => v === '' || SPREADSHEET_ID_RE.test(v), 'Опознаватель книги Google указан неверно'),
    serviceAccountEmail: z.string().email('Некорректный email сервисного аккаунта'),
    privateKey: z
      .string()
      .regex(PRIVATE_KEY_RE, 'Закрытый ключ должен быть цельным PEM: от строки BEGIN до строки END'),
    port: z
      .string()
      .optional()
      .default('3000')
      .refine((v) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535, 'Номер порта вне допустимого диапазона'),
    host: z
      .string()
      .optional()
      .default('0.0.0.0')
      .refine((v) => HOST_RE.test(v), 'Адрес узла содержит недопустимые знаки'),
  });

  app.post('/api/settings/env', async (request, reply) => {
    // Fail-safe guard: разрешаем ТОЛЬКО если явно development. Если NODE_ENV unset —
    // считаем это production-like и блокируем. Дополнительно требуем X-Dev-Token,
    // который сервер читает из env (отсутствует в .env.example — только локально).
    if (process.env.NODE_ENV !== 'development') {
      return reply.status(403).send({ error: 'Изменение .env разрешено только в development' });
    }
    const expectedToken = process.env.DEV_SETTINGS_TOKEN;
    const providedToken = request.headers['x-dev-token'];
    if (!expectedToken || providedToken !== expectedToken) {
      return reply.status(403).send({ error: 'Требуется X-Dev-Token (см. DEV_SETTINGS_TOKEN в локальном .env)' });
    }

    const body = parseBody(EnvUpdateSchema, request, reply);
    if (!body) return;

    // Второй рубеж на случай, если форму полей когда-нибудь ослабят: ни одно
    // значение, уходящее в файл настроек, не имеет права нести кавычку или
    // перевод строки — именно ими и вырывались из своей строки.
    const singleLine = [body.spreadsheetId, body.serviceAccountEmail, body.port, body.host];
    if (singleLine.some((v) => /["\r\n]/.test(v)) || body.privateKey.includes('"')) {
      return reply
        .status(400)
        .send({ error: 'Значение содержит знаки, недопустимые в файле настроек' });
    }

    const envContent = `# Google Sheets API
GOOGLE_SHEETS_SPREADSHEET_ID=${body.spreadsheetId}
GOOGLE_SERVICE_ACCOUNT_EMAIL=${body.serviceAccountEmail}
GOOGLE_PRIVATE_KEY="${body.privateKey}"

# Сервер
PORT=${body.port}
HOST=${body.host}
LOG_LEVEL=info

# База данных (SQLite для разработки)
SQLITE_PATH=./data/aemr.db
# DB_PROVIDER=postgresql
# DATABASE_URL=postgresql://user:pass@localhost:5432/aemr
`;

    // Ищем корень проекта
    const cwd = process.cwd();
    const candidates = [
      resolve(cwd, '.env'),          // если запущено из корня
      resolve(cwd, '../../.env'),    // если из packages/server
    ];
    const targetPath = candidates.find(p => existsSync(p)) ?? candidates[0];

    try {
      writeFileSync(targetPath, envContent, 'utf-8');
      return reply.send({ success: true, path: targetPath });
    } catch (err) {
      return reply.status(500).send({ error: `Не удалось записать .env: ${(err as Error).message}` });
    }
  });
}
