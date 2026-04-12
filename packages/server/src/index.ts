import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { metricsRoutes } from './routes/metrics.js';
import { auditRoutes } from './routes/audit.js';
import { rowsRoutes } from './routes/rows.js';
import { issuesRoutes } from './routes/issues.js';
import { mappingRoutes } from './routes/mapping.js';
import { journalRoutes } from './routes/journal.js';
import { settingsRoutes } from './routes/settings.js';
import { analyticsRoutes } from './routes/analytics.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getSnapshot, setDeptSheetCache, setDeptLoadMeta, invalidateCache } from './services/snapshot.js';
import { fetchDepartmentSpreadsheets } from './services/google-sheets.js';
import { DEPARTMENT_SPREADSHEETS } from './config.js';
import { registerAuthHook } from './middleware/auth.js';

const app = Fastify({
  logger: {
    level: config.server.logLevel,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
});

// CORS for development
await app.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Global error handler — structured JSON errors, no silent swallowing
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

// Auth middleware (before routes — checks Bearer token on /api/*)
registerAuthHook(app);

// API routes
await app.register(dashboardRoutes);
await app.register(metricsRoutes);
await app.register(auditRoutes);
await app.register(rowsRoutes);
await app.register(issuesRoutes);
await app.register(mappingRoutes);
await app.register(journalRoutes);
await app.register(settingsRoutes);
await app.register(analyticsRoutes);

// Health check
app.get('/api/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  spreadsheetId: config.google.spreadsheetId,
  hasServiceAccount: !!(config.google.serviceAccountEmail && config.google.privateKey),
  hasApiKey: !!config.google.apiKey,
  serviceAccountEmail: config.google.serviceAccountEmail ?? null,
}));

// Debug: test Google Sheets connection
app.get('/api/debug/sheets', async () => {
  try {
    const { batchGetCells } = await import('./google-sheets.js');
    const result = await batchGetCells(["'СВОД ТД-ПМ'!A1"]);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err), message: (err as Error).message };
  }
});

// Serve static frontend in production
const publicDir = resolve(process.cwd(), 'public');
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

// ── Graceful port handling ──────────────────────────────────────
async function startServer(port: number, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const actualPort = port + attempt;
      await app.listen({ port: actualPort, host: config.server.host });
      console.log(`
  ╔══════════════════════════════════════════╗
  ║   AEMR Platform — Аналитика закупок     ║
  ║   http://localhost:${actualPort}                 ║
  ╚══════════════════════════════════════════╝
      `);
      if (attempt > 0) {
        app.log.warn(`⚠️ Порт ${port} занят, запущен на ${actualPort}`);
      }
      return; // success
    } catch (err: any) {
      if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
        app.log.warn(`⚠️ Порт ${port + attempt} занят (EADDRINUSE), пробую ${port + attempt + 1}...`);
        continue;
      }
      throw err;
    }
  }
}

// Start
try {
  await startServer(config.server.port);

  // ── Auto-load data in background (non-blocking) ──
  (async () => {
    // 1. Load department spreadsheets first (they feed into pipeline recalculation)
    try {
      app.log.info('⏳ Загрузка таблиц управлений...');
      const { data, errors } = await fetchDepartmentSpreadsheets(DEPARTMENT_SPREADSHEETS);
      setDeptSheetCache(data);
      const now = new Date().toISOString();
      const loadMeta: Record<string, { loadedAt: string; rowCount: number; sheetName: string; error?: string }> = {};
      for (const [name, rows] of Object.entries(data)) {
        loadMeta[name] = { loadedAt: now, rowCount: rows.length, sheetName: name };
      }
      for (const [name, errMsg] of Object.entries(errors)) {
        loadMeta[name] = { loadedAt: now, rowCount: 0, sheetName: name, error: errMsg };
      }
      setDeptLoadMeta(loadMeta);
      const loaded = Object.keys(data);
      const failed = Object.keys(errors);
      app.log.info(`✅ Управления: ${loaded.length} загружено${failed.length > 0 ? `, ${failed.length} ошибок (${failed.join(', ')})` : ''}`);
    } catch (err) {
      app.log.warn('⚠️ Таблицы управлений недоступны: %s', (err as Error).message);
    }

    // 2. Now load СВОД (pipeline will use cached dept data for recalculation + deltas)
    try {
      app.log.info('⏳ Автозагрузка СВОД + пайплайн...');
      const snapshot = await getSnapshot(true);
      const deltaCount = snapshot.deltas?.length ?? 0;
      const calcCount = Object.keys(snapshot.calculatedMetrics ?? {}).length;
      app.log.info(`✅ СВОД загружен: ${Object.keys(snapshot.officialMetrics ?? {}).length} метрик, ${deltaCount} дельт, ${calcCount} расчётных, ${snapshot.issues?.length ?? 0} замечаний`);
    } catch (err) {
      app.log.warn('⚠️ СВОД недоступен при старте: %s', (err as Error).message);
    }
  })();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
