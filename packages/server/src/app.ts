import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from './config.js';
import { SVOD_SHEET_NAME } from '@aemr/shared';
import { dashboardRoutes } from './routes/dashboard.js';
import { metricsRoutes } from './routes/metrics.js';
import { auditRoutes } from './routes/audit.js';
import { rowsRoutes } from './routes/rows.js';
import { issuesRoutes } from './routes/issues.js';
import { mappingRoutes } from './routes/mapping.js';
import { journalRoutes } from './routes/journal.js';
import { settingsRoutes } from './routes/settings.js';
import { analyticsRoutes } from './routes/analytics.js';
import { economicMetricsRoutes } from './routes/economic-metrics.js';
import { historyRoutes } from './routes/history.js';
import { reconciliationRoutes } from './routes/reconciliation.js';
import { reportRoutes } from './routes/report.js';
import { changesRoutes } from './routes/changes.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { timelineRoutes } from './routes/timeline.js';
import { provenanceRoutes } from './routes/provenance.js';
import { annotationsRoutes } from './routes/annotations.js';
import { commentAnnotationsRoutes } from './routes/comment-annotations.js';
import { registryBucketsRoutes } from './routes/registry-buckets.js';
import { monitoringRoutes } from './routes/monitoring.js';
import { getSnapshot, setSourceRefresher } from './services/snapshot.js';
import { refreshAllSources, startSourceAutoRefresh } from './services/source-refresh.js';
import { startDriveWatch } from './services/drive-watch.js';
import { startWeeklySnapshotCron } from './services/weekly-snapshot-cron.js';
import { registerAuthHook } from './middleware/auth.js';
import { registerHeavyRouteRateLimit, type HeavyRouteRule } from './plugins/rate-limit.js';
import { installProcessGuards } from './plugins/process-guards.js';

export interface CreateAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Пороги частоты для тяжёлых маршрутов; свои — только в тестах. */
  rateLimitRules?: readonly HeavyRouteRule[];
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

  // Список разрешённых адресов берётся из окружения (AEMR_CORS_ORIGINS).
  // Реестр багов 09.07.2026, п.15: здесь стояли два адреса локальной разработки,
  // вписанные в код, — на боевом сервере продукт открывают по доменному имени,
  // и разрешения для него не было ни одного. Переменная не задана — остаются
  // прежние адреса разработки, поэтому локальный запуск ничего не требует.
  await app.register(cors, {
    origin: config.server.corsOrigins,
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

  installProcessGuards(app.log);

  app.setErrorHandler((error: Error & { statusCode?: number; expose?: boolean }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({ err: error, url: request.url, method: request.method }, 'Request error');

    // Молчащий источник — не поломка продукта. Ошибка, которая сама объявила
    // себя показываемой (expose), несёт русский текст с действием: подменять
    // его на «Internal server error» значит прятать от читателя единственное
    // объяснение, которое у него было. Всё остальное 5xx по-прежнему
    // обезличено — внутренности наружу не выносим.
    const showOwnMessage = error.expose === true || statusCode < 500;

    reply.status(statusCode).send({
      error: error.name ?? 'InternalServerError',
      message: showOwnMessage ? error.message : 'Internal server error',
      statusCode,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
    });
  });

  registerAuthHook(app);
  // После проверки ключа: обращение без ключа отсекается дешевле и не тратит
  // окно частоты, отведённое настоящим читателям.
  registerHeavyRouteRateLimit(app, options.rateLimitRules);

  await app.register(dashboardRoutes);
  await app.register(metricsRoutes);
  await app.register(auditRoutes);
  await app.register(rowsRoutes);
  await app.register(changesRoutes);
  await app.register(issuesRoutes);
  await app.register(mappingRoutes);
  await app.register(journalRoutes);
  await app.register(settingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(economicMetricsRoutes);
  await app.register(historyRoutes);
  await app.register(reconciliationRoutes);
  await app.register(reportRoutes);
  await app.register(healthRoutes);
  await app.register(webhookRoutes);
  await app.register(timelineRoutes);
  await app.register(provenanceRoutes);
  await app.register(annotationsRoutes);
  await app.register(commentAnnotationsRoutes);
  await app.register(registryBucketsRoutes);
  await app.register(monitoringRoutes);

  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/debug/sheets', async () => {
      try {
        const { batchGetCells } = await import('./services/google-sheets.js');
        const result = await batchGetCells([`'${SVOD_SHEET_NAME}'!A1`]);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: String(err), message: (err as Error).message };
      }
    });
  }

  // Четверг-cron еженедельного снимка: в тестах выключен (config-флаг),
  // onClose останавливает таймер — Fastify закрывается без хвостов.
  if (config.weeklySnapshot.enabled) {
    const stopWeeklySnapshotCron = startWeeklySnapshotCron(app.log);
    app.addHook('onClose', async () => {
      stopWeeklySnapshotCron();
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

/**
 * Остановка по сигналу: `docker compose down` и перезапуск шлют SIGTERM, и без
 * обработчика процесс умирает прямо посреди запроса — читатель получает
 * оборванное соединение, а незакрытая база остаётся с открытым дескриптором.
 * Закрываемся штатно, но не бесконечно: если что-то держит закрытие, через
 * названный срок выходим всё равно.
 */
const SHUTDOWN_DEADLINE_MS = 10_000;

function installGracefulShutdown(app: FastifyInstance): void {
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (closing) return;
      closing = true;
      app.log.info(`Получен сигнал ${signal}: закрываем сервер`);
      const forceExit = setTimeout(() => {
        app.log.warn('Закрытие затянулось — выходим принудительно');
        process.exit(0);
      }, SHUTDOWN_DEADLINE_MS);
      forceExit.unref();
      void app
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          app.log.error({ err }, 'Ошибка при закрытии сервера');
          process.exit(0);
        });
    });
  }
}

export async function startServer(app: FastifyInstance, port: number, maxRetries = 3): Promise<void> {
  installGracefulShutdown(app);
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
  // Снимок умеет сам перечитать устаревшие книги перед сборкой — без этого
  // официальные ячейки читались свежими, а строки брались из кэша от старта
  // (канон п.66: обе стороны сверки — из одного момента).
  setSourceRefresher(async () => {
    await refreshAllSources({
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    });
  });

  void (async () => {
    try {
      app.log.info('Loading department spreadsheets...');
      const r = await refreshAllSources({
        info: (m) => app.log.info(m),
        warn: (m) => app.log.warn(m),
      });
      app.log.info(
        `Departments loaded: ${r.loaded.length}${r.failed.length > 0 ? `, failed: ${r.failed.join(', ')}` : ''}`,
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

    // Самообновление источников включается ПОСЛЕ первой полной загрузки:
    // иначе тик мог бы наложиться на старт и читать книги дважды.
    startSourceAutoRefresh({
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    });

    // Push-каналы Drive (п.66/69а): включаются только при WEBHOOK_PUBLIC_URL
    // и WEBHOOK_SECRET; без них — молчаливый опрос, продукт работает как раньше.
    startDriveWatch({
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    });
  })();
}
