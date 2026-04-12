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
  const EnvUpdateSchema = z.object({
    spreadsheetId: z.string().optional().default(''),
    serviceAccountEmail: z.string().email('Некорректный email сервисного аккаунта'),
    privateKey: z.string().min(10, 'Private key слишком короткий'),
    port: z.string().optional().default('3000'),
    host: z.string().optional().default('0.0.0.0'),
  });

  app.post('/api/settings/env', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Изменение .env запрещено в production' });
    }

    const body = parseBody(EnvUpdateSchema, request, reply);
    if (!body) return;

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
