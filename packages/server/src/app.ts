import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config, DEPARTMENT_SPREADSHEETS } from './config.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { metricsRoutes } from './routes/metrics.js';
import { auditRoutes } from './routes/audit.js';
import { rowsRoutes } from './routes/rows.js';
import { issuesRoutes } from './routes/issues.js';
import { mappingRoutes } from './routes/mapping.js';
import { journalRoutes } from './routes/journal.js';
import { settingsRoutes } from './routes/settings.js';
import { analyticsRoutes } from './routes/analytics.js';
import { getSnapshot, setDeptSheetCache, setDeptLoadMeta } from './services/snapshot.js';
import { fetchDepartmentSpreadsheets } from './services/google-sheets.js';
import { registerAuthHook } from './middleware/auth.js';

export interface CreateAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.server.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Security-заголовки. CSP подобран под реальный SPA (Vite + Google Fonts) на HTTP-деплое:
  // - script/style 'unsafe-inline' — Vite modulepreload-polyfill + Tailwind inline-стили;
  // - connect-src 'self' — БЛОКИРУЕТ exfil API-ключа из localStorage на чужой домен (главная защита при XSS);
  // - style/font allow fonts.googleapis.com/gstatic.com (index.html их грузит);
  // - useDefaults:false → НЕТ upgrade-insecure-requests (прод по HTTP 193.233.244.217, иначе SPA сломается);
  // - hsts/COEP off — HTTP-деплой + кросс-загрузка Google Fonts.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: false,
    crossOriginEmbedderPolicy: false,
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({ err: error, url: request.url, method: request.method }, 'Request error');
    reply.status(statusCode).send({
      error: error.name ?? 'InternalServerError',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      statusCode,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
    });
  });

  registerAuthHook(app);

  await app.register(dashboardRoutes);
  await app.register(metricsRoutes);
  await app.register(auditRoutes);
  await app.register(rowsRoutes);
  await app.register(issuesRoutes);
  await app.register(mappingRoutes);
  await app.register(journalRoutes);
  await app.register(settingsRoutes);
  await app.register(analyticsRoutes);

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'aemr-server',
  }));

  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/debug/sheets', async () => {
      try {
        const { batchGetCells } = await import('./google-sheets.js');
        const result = await batchGetCells(["'СВОД ТД-ПМ'!A1"]);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err), message: (err as Error).message };
      }
    });
  }

  const publicDir = resolve(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export async function startServer(app: FastifyInstance, port: number, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const actualPort = port + attempt;
      await app.listen({ port: actualPort, host: config.server.host });
      console.log(`
AEMR Platform
http://localhost:${actualPort}
      `);
      if (attempt > 0) {
        app.log.warn(`Port ${port} is busy, started on ${actualPort}`);
      }
      return;
    } catch (err) {
      if ((err as { code?: string }).code === 'EADDRINUSE' && attempt < maxRetries) {
        app.log.warn(`Port ${port + attempt} is busy (EADDRINUSE), trying ${port + attempt + 1}...`);
        continue;
      }
      throw err;
    }
  }
}

export function preloadData(app: FastifyInstance): void {
  void (async () => {
    try {
      app.log.info('Loading department spreadsheets...');
      const { data, errors } = await fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS);
      setDeptSheetCache(data);
      const now = new Date().toISOString();
      const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
      for (const [name, result] of Object.entries(data)) {
        loadMeta[name] = { loadedAt: now, rowCount: result.values.length, sheetName: result.sheetName };
      }
      for (const [name, errMsg] of Object.entries(errors)) {
        loadMeta[name] = { loadedAt: now, rowCount: 0, sheetName: name, error: errMsg };
      }
      setDeptLoadMeta(loadMeta);
      const loaded = Object.keys(data);
      const failed = Object.keys(errors);
      app.log.info(
        `Departments loaded: ${loaded.length}${failed.length > 0 ? `, failed: ${failed.join(', ')}` : ''}`,
      );
    } catch (err) {
      app.log.warn('Department spreadsheets unavailable at startup: %s', (err as Error).message);
    }

    try {
      app.log.info('Loading SVOD snapshot and pipeline...');
      const snapshot = await getSnapshot(true);
      const deltaCount = snapshot.deltas?.length ?? 0;
      const calcCount = Object.keys(snapshot.calculatedMetrics ?? {}).length;
      app.log.info(
        `SVOD loaded: ${Object.keys(snapshot.officialMetrics ?? {}).length} metrics, ${deltaCount} deltas, ${calcCount} calculated, ${snapshot.issues?.length ?? 0} issues`,
      );
    } catch (err) {
      app.log.warn('SVOD unavailable at startup: %s', (err as Error).message);
    }
  })();
}
