/** Published reports read their frozen model; the live report endpoint is separate. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ReportCommandSchema } from '@aemr/shared';
import { requestStage } from '../plugins/request-timing.js';

type View = 'history' | 'status' | 'dashboard' | 'main' | 'supplement' | 'operational';
const execute = promisify(execFile);
const ContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
  year: z.coerce.number().int().min(1900).max(9999),
  quarter: z.coerce.number().int().min(1).max(4),
}).strict();
type Context = z.infer<typeof ContextSchema>;
const PreparationSchema = ContextSchema.extend({
  year: z.number().int().min(1900).max(9999), quarter: z.number().int().min(1).max(4),
});

/** Rollout bootstrap before createApp/listen, including a worker-disabled old DB. */
export async function initializePublicationReaders(
  run: (file: string, args: string[], options: { timeout: number; maxBuffer: number; shell: false }) => Promise<unknown> = execute,
): Promise<void> {
  const state = resolve(process.env.REPORT_STATE_DIR ?? 'data/reports');
  // Fresh development without a report catalog keeps its existing startup flow.
  // A future native writer creates the lease before the first catalog is exposed.
  if (!existsSync(resolve(state, 'published/publications.sqlite'))) return;
  try {
    await run(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report',
      ['initialize-publication-readers', '--state', state],
      { timeout: 30_000, maxBuffer: 1024, shell: false });
  } catch {
    throw new Error('PUBLICATION_READER_BOOTSTRAP_FAILED');
  }
}

async function readStoredRelease(view: View, releaseId?: string, context?: Context, signal?: AbortSignal): Promise<Buffer> {
  const args = ['read-publication', '--state', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports'), '--view', view];
  if (releaseId) args.push('--release-id', releaseId);
  if (context) args.push('--report-date', context.date, '--report-year', String(context.year), '--quarter', String(context.quarter));
  const result = await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report', args,
    { encoding: 'buffer', timeout: 30_000, maxBuffer: 32 * 1024 * 1024, shell: false, signal });
  return result.stdout;
}

async function prepareStoredArchive(context: Context): Promise<Buffer> {
  const result = await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report', [
    'run-archive', '--state', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports'),
    '--legacy-db', resolve(process.env.SQLITE_PATH ?? 'data/aemr.db'), '--report-date', context.date,
    '--report-year', String(context.year), '--quarter', String(context.quarter),
  ], { encoding: 'buffer', timeout: 600_000, maxBuffer: 32 * 1024 * 1024, shell: false, killSignal: 'SIGKILL' });
  return result.stdout;
}

function reportInputArguments(): string[] {
  return [
    '--registry', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports', 'inputs/registry.json'),
    '--ledger', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports', 'inputs/ledger.json'),
    '--state', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports'),
  ];
}

async function refreshStoredReport(): Promise<unknown> {
  const result = await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report',
    ['enqueue-report', ...reportInputArguments()],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024, shell: false });
  return JSON.parse(result.stdout);
}

async function wakeStoredReports(): Promise<void> {
  await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report',
    ['worker', '--queued-only', ...reportInputArguments()],
    { encoding: 'buffer', timeout: 600_000, maxBuffer: 64 * 1024, shell: false, killSignal: 'SIGKILL' });
}

async function readStoredCommand(id: string): Promise<unknown> {
  const result = await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report',
    ['read-report-command', '--state', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports'), '--attempt-id', id],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024, shell: false });
  return JSON.parse(result.stdout);
}

export async function reportReleaseRoutes(app: FastifyInstance,
  options: { read?: (view: View, releaseId?: string, context?: Context, signal?: AbortSignal) => Promise<Buffer>;
    prepare?: (context: Context) => Promise<Buffer>; refresh?: () => Promise<unknown>;
    wake?: () => Promise<void>; command?: (id: string) => Promise<unknown> } = {}): Promise<void> {
  const read = options.read ?? readStoredRelease;
  const prepare = options.prepare ?? prepareStoredArchive;
  const refresh = options.refresh ?? refreshStoredReport;
  const readCommand = options.command ?? readStoredCommand;
  // This bounds child processes only. Acceptance/results live in the engine;
  // onListen resumes them after process loss. A late wake cannot be dropped.
  let executor: Promise<void> | null = null;
  let wakeAgain = false;
  const wake = () => {
    wakeAgain = true;
    if (executor) return;
    executor = Promise.resolve().then(async () => {
      do {
        wakeAgain = false;
        await (options.wake ?? wakeStoredReports)();
      } while (wakeAgain);
    }).catch(() => {
      app.log.warn('Report executor wake failed; accepted commands remain in durable state');
    }).finally(() => {
      executor = null;
      if (wakeAgain) wake();
    });
  };
  app.addHook('onListen', async () => {
    if (existsSync(resolve(process.env.REPORT_STATE_DIR ?? 'data/reports', 'commands'))) wake();
  });
  app.post('/api/report-releases/refresh', { bodyLimit: 256 }, async (request, reply) => {
    if (Object.keys(request.query as object).length ||
        request.body != null && (typeof request.body !== 'object' || Object.keys(request.body).length > 0)) {
      return reply.code(400).send({ code: 'REPORT_REFRESH_CONTEXT_INVALID',
        message: 'Для обновления отчёта дополнительные параметры не требуются.' });
    }
    reply.header('Cache-Control', 'private, no-store');
    try {
      const command = ReportCommandSchema.parse(await refresh());
      if (command.status !== 'QUEUED') throw new Error('REPORT_COMMAND_ADMISSION_INVALID');
      wake();
      return reply.code(202).send({ ...command, status: 'STARTED',
        message: 'Запрос на новый отчёт сохранён. Успешный выпуск пока не подтверждён; результат появится после проверки источников.' });
    } catch {
      return reply.code(503).send({ code: 'REPORT_REFRESH_UNAVAILABLE',
        message: 'Не удалось подтвердить сохранение команды. Повторите запрос; последний проверенный отчёт сохранён.' });
    }
  });
  app.get<{ Params: { attemptId: string } }>('/api/report-releases/commands/:attemptId', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!/^[a-f0-9]{32}$/.test(request.params.attemptId) || Object.keys(request.query as object).length) {
      return reply.code(400).send({ code: 'REPORT_COMMAND_ID_INVALID', message: 'Некорректный идентификатор команды.' });
    }
    try {
      const command = ReportCommandSchema.parse(await readCommand(request.params.attemptId));
      if (command.attempt_id !== request.params.attemptId) throw new Error('REPORT_COMMAND_ID_MISMATCH');
      return reply.send(command);
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 4;
      return reply.code(missing ? 404 : 503).send({ code: missing ? 'REPORT_COMMAND_NOT_FOUND' : 'REPORT_COMMAND_UNAVAILABLE',
        message: missing ? 'Команда не найдена.' : 'Состояние сохранённой команды сейчас недоступно.' });
    }
  });
  // One expensive archive build per server. Repeated requests for the same
  // context share its result; another context retries via the existing polling.
  let running: { key: string; task: Promise<Buffer> } | null = null;
  async function prepareOnce(context: Context): Promise<Buffer> {
    const key = JSON.stringify(context);
    if (running) {
      if (running.key === key) return running.task;
      return Buffer.from(JSON.stringify({ selected: null, attempt: null, archive: {
        status: 'RUNNING', code: 'ARCHIVE_BUSY',
        message: 'Выполняется другой архивный расчёт. Повторим запрос автоматически.',
      } }));
    }
    const task = prepare(context);
    running = { key, task };
    try { return await task; } finally { if (running?.task === task) running = null; }
  }
  // The existing authenticated route group owns this action; GET never creates a release.
  app.post('/api/report-releases/prepare', { bodyLimit: 1024 }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const parsed = PreparationSchema.safeParse(request.body);
    if (!parsed.success || Object.keys(request.query as object).length > 0) {
      return reply.code(400).send({ code: 'PUBLICATION_CONTEXT_INVALID', message: 'Укажите дату среза, год и квартал отчёта.' });
    }
    try {
      return reply.type('application/json; charset=utf-8').send(await prepareOnce(parsed.data));
    } catch {
      return reply.code(503).send({ code: 'PUBLICATION_UNAVAILABLE',
        message: 'Архивный комплект сейчас не сформирован. Это задача сопровождения; текущие данные вместо архива не использованы.' });
    }
  });
  for (const [suffix, view] of [['', 'status'], ['/status', 'status'], ['/history', 'history'], ['/dashboard', 'dashboard'],
    ['/main.docx', 'main'], ['/supplement.docx', 'supplement'], ['/operational.docx', 'operational']] as const) {
    app.get<{ Params: { releaseId?: string } }>(`/api/report-releases${view === 'history' ? '/history' : suffix ? '/:releaseId' + suffix : ''}`,
      async (request, reply) => {
        const history = view === 'history' ? z.object({ before: z.string().regex(/^REL-[a-f0-9]{64}$/).optional() }).strict().safeParse(request.query) : null;
        if (history && !history.success) return reply.code(400).send({ code: 'PUBLICATION_CONTEXT_INVALID', message: 'Некорректный курсор истории.' });
        const id = history?.success ? history.data.before : request.params.releaseId;
        reply.header('Cache-Control', 'private, no-store');
        if ((view !== 'status' || id !== undefined) && view !== 'history' && !/^REL-[a-f0-9]{64}$/.test(id ?? '')) {
          return reply.code(400).send({ code: 'PUBLICATION_ID_INVALID', message: 'Некорректный идентификатор выпуска.' });
        }
        let context: Context | undefined;
        if (view !== 'history' && Object.keys(request.query as object).length > 0) {
          const parsed = ContextSchema.safeParse(request.query);
          if (view !== 'status' || id !== undefined || !parsed.success) {
            return reply.code(400).send({ code: 'PUBLICATION_CONTEXT_INVALID', message: 'Укажите дату среза, год и квартал отчёта.' });
          }
          context = parsed.data;
        }
        const controller = new AbortController();
        const abortRead = () => controller.abort();
        const responseClosed = () => {
          if (!reply.raw.writableEnded) abortRead();
        };
        request.raw.once('aborted', abortRead);
        reply.raw.once('close', responseClosed);
        if (request.raw.aborted || reply.raw.destroyed) abortRead();
        try {
          const data = await requestStage(request, 'reader', () => read(view, id, context, controller.signal));
          if (view === 'main' || view === 'supplement' || view === 'operational') {
            reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            reply.header('Content-Disposition', `attachment; filename="${id}-${view}.docx"`);
            return reply.send(data);
          }
          return reply.type('application/json; charset=utf-8').send(data);
        } catch (error) {
          if (controller.signal.aborted) return reply;
          const missing = error instanceof Error && 'code' in error && error.code === 4;
          return reply.code(missing ? 404 : 503).send({
            code: missing ? 'PUBLICATION_NOT_FOUND' : 'PUBLICATION_UNAVAILABLE',
            message: missing ? 'Такой проверенный выпуск не опубликован.' : 'Проверенный комплект сейчас недоступен.',
          });
        } finally {
          request.raw.removeListener('aborted', abortRead);
          reply.raw.removeListener('close', responseClosed);
        }
      });
  }
}
