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
import { workloadRoutes } from './routes/workload.js';
import { anomaliesRoutes } from './routes/anomalies.js';
import { integrityRoutes } from './routes/integrity.js';
import { textHygieneRoutes } from './routes/text-hygiene.js';
import { eventsRoutes } from './routes/events.js';
import { getSnapshot, setSourceRefresher } from './services/snapshot.js';
import { refreshAllSources, startSourceAutoRefresh } from './services/source-refresh.js';
import { setSourceLogger } from './services/source-log.js';
import { startDriveWatch } from './services/drive-watch.js';
import { setChangeAuthorResolver } from './services/live-diff.js';
import { findChangeAuthor } from './services/changelog-authors.js';
import { startWeeklySnapshotCron } from './services/weekly-snapshot-cron.js';
import { registerAuthHook } from './middleware/auth.js';
import { registerHeavyRouteRateLimit, type HeavyRouteRule } from './plugins/rate-limit.js';
import { installProcessGuards } from './plugins/process-guards.js';
import { registerDemoMarker } from './plugins/demo-marker.js';
import { registerErrorShape, sendNotFound } from './plugins/error-shape.js';
import { registerHttpCache } from './plugins/http-cache.js';
import { registerCompression } from './plugins/compression.js';
import {
  installGracefulShutdown,
  registerShutdownGuard,
  type ShutdownGuard,
} from './plugins/graceful-shutdown.js';

/**
 * Потолок тела запроса, один мегабайт. Величина выбрана как заведомо больший
 * запас над самым тяжёлым честным обращением продукта (пакетная правка строк и
 * загрузка соответствия колонок) и одновременно как граница, за которой тело
 * перестаёт быть правкой человека и становится наливом.
 */
export const BODY_LIMIT_BYTES = 1_048_576;

/**
 * Среда, названная своим именем.
 *
 * Реестр безопасности 05.06.2026, S-H2 («утечка внутренностей»), продолжение:
 * и подсказка со стеком в ответе, и отладочный маршрут решались условием
 * «NODE_ENV не равен production». Незаданная переменная означала для этого
 * условия «показывать всё», а запуск без NODE_ENV — обычное дело: `node
 * dist/index.js` на голой машине, юнит systemd, чужой контейнер. Такой запуск
 * молча выносил наружу внутренности продукта.
 *
 * Правило перевёрнуто в ту же сторону, в какую его уже развернула запись файла
 * настроек (`routes/settings.ts`): послабления действуют только там, где среда
 * названа явно, всё остальное — включая незаданную переменную — считается
 * боевым.
 */
export function isDeclaredDevRuntime(): boolean {
  const mode = process.env.NODE_ENV;
  return mode === 'development' || mode === 'test';
}

/**
 * Заслон прощания каждого приложения. Слабые ссылки: приложение закрылось —
 * запись уходит сама, держать закрытые экземпляры незачем. Нужен затем, что
 * заслон ставится при сборке приложения (он нужен и прогонам), а подписка на
 * сигналы процесса — только при настоящем запуске, в `startServer`.
 */
const shutdownGuards = new WeakMap<FastifyInstance, ShutdownGuard>();

export interface CreateAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Пороги частоты для тяжёлых маршрутов; свои — только в тестах. */
  rateLimitRules?: readonly HeavyRouteRule[];
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Потолок тела запроса назван явно (реестр безопасности 05.06.2026, S-M2:
    // «нет bodyLimit»). Раньше он держался на умолчании библиотеки, то есть на
    // чужом решении, которое могло измениться при обновлении и которое никто не
    // проверял. Теперь величина записана здесь, за ней следит страж
    // `app-body-limit.test.ts`, и поднять её можно только осознанно.
    // Остаток того же пункта — счёт правок в пакетной записи `body.rows[]`
    // (`routes/rows.ts:442` принимает список любой длины): один мегабайт тела
    // всё ещё разворачивается в тысячи обращений к Google-таблицам.
    bodyLimit: BODY_LIMIT_BYTES,
    logger: options.logger ?? {
      level: config.server.logLevel,
      // Журнал не должен становиться вторым местом утечки ключа. Pino пишет
      // объект запроса при каждой ошибке, а в заголовках лежит `Authorization:
      // Bearer <ключ>` — ровно тот ключ, ради которого заведена проверка
      // доступа. Файл журнала переживает и грепается легче, чем память
      // процесса, поэтому названные заголовки затираются на месте.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'headers.authorization',
        ],
        censor: '[скрыто]',
      },
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

  // Журнал обращений к таблицам-источникам — в журнал приложения.
  //
  // Приёмник в services/source-log.ts заведён именно затем, чтобы чтения книг
  // писались через pino, а не через console: у строки должны быть уровень,
  // время и поля, иначе её нельзя ни отфильтровать, ни сопоставить с запросом.
  // Подмена приёмника была описана в самом модуле как «одна строка при старте»
  // — и этой строки нигде не было: весь журнал источников (сколько строк,
  // откуда, за сколько, почему отказ) сыпался в консоль мимо pino. Ставится
  // рядом с процессными стражами, до регистрации маршрутов: чтения начинаются
  // с первого же запроса.
  setSourceLogger(app.log);
  // При закрытии приёмник возвращается к консоли: держать ссылку на журнал
  // закрытого приложения незачем, а чтения бывают и после (разовые скрипты).
  app.addHook('onClose', async () => {
    setSourceLogger(null);
  });

  // Общий вид отказа: `{error, message, statusCode}` как прежде, плюс `code`
  // (устойчивое слово для ветвления) и `requestId` (строка журнала без
  // пересказа её содержимого). Стек — только в явно названной среде разработки:
  // при незаданной NODE_ENV он раньше уходил читателю вместе с путями файлов.
  registerErrorShape(app, { exposeStack: isDeclaredDevRuntime() });

  // Заслон прощания — САМЫМ ПЕРВЫМ хуком запроса: закрывающийся сервер не
  // должен ни проверять ключ, ни тратить окно частоты, ни считать отпечаток.
  const shutdownGuard = registerShutdownGuard(app);
  shutdownGuards.set(app, shutdownGuard);

  registerAuthHook(app);
  // После проверки ключа: обращение без ключа отсекается дешевле и не тратит
  // окно частоты, отведённое настоящим читателям.
  registerHeavyRouteRateLimit(app, options.rateLimitRules);
  // Признак показательных данных во всех ответах сразу (реестр 09.07.2026, п.8).
  registerDemoMarker(app);

  // Порядок этих двух — не вкусовщина. Хуки отправки выполняются в порядке
  // регистрации (Fastify, Reference/Hooks.md): отпечаток обязан считаться с
  // ИСХОДНОГО тела, иначе два читателя с разной поддержкой сжатия получат
  // разные подписи одного и того же содержимого. Сжатие идёт следом и дописывает
  // к подписи название кодировки — так же, как это делает nginx.
  registerHttpCache(app);
  registerCompression(app);

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
  await app.register(workloadRoutes);
  await app.register(anomaliesRoutes);
  await app.register(integrityRoutes);
  await app.register(textHygieneRoutes);
  await app.register(eventsRoutes);

  // Отладочное чтение книги регистрируется только в явно названной среде
  // разработки (прежде — при любой, кроме production, включая незаданную).
  if (isDeclaredDevRuntime()) {
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
  const hasStatic = existsSync(publicDir);
  if (hasStatic) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
    });
  }

  // Обработчик «нет такого адреса» ставится ВСЕГДА, а не только при собранной
  // странице. Без него ответ собирал Fastify по умолчанию и пересказывал
  // клиенту разобранный маршрут («Route GET:/api/… not found»), да ещё в форме,
  // не совпадающей ни с одним другим отказом сервера. Теперь форма общая
  // (plugins/error-shape.ts), а обращения не к /api при собранной странице
  // по-прежнему получают саму страницу — маршрутизацию внутри неё ведёт
  // приложение в браузере.
  app.setNotFoundHandler(async (request, reply) => {
    if (!hasStatic || request.url.startsWith('/api/')) {
      return sendNotFound(request, reply);
    }
    return reply.sendFile('index.html');
  });

  return app;
}

export async function startServer(app: FastifyInstance, port: number, maxRetries = 3): Promise<void> {
  // Механика прощания живёт в plugins/graceful-shutdown.ts; здесь только
  // подписка на сигналы — она нужна настоящему запуску, а не прогонам.
  // Заслон (503 на новые обращения, пока идёт закрытие) уже стоит с createApp.
  const guard = shutdownGuards.get(app) ?? registerShutdownGuard(app);
  installGracefulShutdown(app, guard);
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
  // Подпись автора под живым событием «строка изменилась» — из журнала правок,
  // уже осевшего в базе. Резолвер задаётся здесь, а не внутри сравнения книг:
  // модуль сравнения не должен тянуть за собой базу.
  setChangeAuthorResolver((book, cell) => findChangeAuthor(book, cell));

  setSourceRefresher(async () => {
    await refreshAllSources({
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    }, 'request');
  });

  void (async () => {
    try {
      app.log.info('Loading department spreadsheets...');
      const r = await refreshAllSources({
        info: (m) => app.log.info(m),
        warn: (m) => app.log.warn(m),
      }, 'startup');
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
