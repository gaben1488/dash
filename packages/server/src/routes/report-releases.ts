/** Published reports read their frozen model; the live report endpoint is separate. */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

type View = 'status' | 'dashboard' | 'main' | 'supplement';
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

async function readStoredRelease(view: View, releaseId?: string, context?: Context): Promise<Buffer> {
  const args = ['read-publication', '--state', resolve(process.env.REPORT_STATE_DIR ?? 'data/reports'), '--view', view];
  if (releaseId) args.push('--release-id', releaseId);
  if (context) args.push('--report-date', context.date, '--report-year', String(context.year), '--quarter', String(context.quarter));
  const result = await execute(process.env.REPORT_ENGINE_BIN ?? '/opt/report-env/bin/proc-report', args,
    { encoding: 'buffer', timeout: 30_000, maxBuffer: 32 * 1024 * 1024, shell: false });
  return result.stdout;
}

export async function reportReleaseRoutes(app: FastifyInstance,
  options: { read?: (view: View, releaseId?: string, context?: Context) => Promise<Buffer> } = {}): Promise<void> {
  const read = options.read ?? readStoredRelease;
  for (const [suffix, view] of [['', 'status'], ['/dashboard', 'dashboard'],
    ['/main.docx', 'main'], ['/supplement.docx', 'supplement']] as const) {
    app.get<{ Params: { releaseId?: string } }>(`/api/report-releases${suffix ? '/:releaseId' + suffix : ''}`,
      async (request, reply) => {
        const id = request.params.releaseId;
        reply.header('Cache-Control', 'private, no-store');
        if (view !== 'status' && !/^REL-[a-f0-9]{64}$/.test(id ?? '')) {
          return reply.code(400).send({ code: 'PUBLICATION_ID_INVALID', message: 'Некорректный идентификатор выпуска.' });
        }
        let context: Context | undefined;
        if (Object.keys(request.query as object).length > 0) {
          const parsed = ContextSchema.safeParse(request.query);
          if (view !== 'status' || !parsed.success) {
            return reply.code(400).send({ code: 'PUBLICATION_CONTEXT_INVALID', message: 'Укажите дату среза, год и квартал отчёта.' });
          }
          context = parsed.data;
        }
        try {
          const data = context ? await read(view, id, context) : await read(view, id);
          if (view === 'main' || view === 'supplement') {
            reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            reply.header('Content-Disposition', `attachment; filename="${id}-${view}.docx"`);
            return reply.send(data);
          }
          return reply.type('application/json; charset=utf-8').send(data);
        } catch (error) {
          const missing = error instanceof Error && 'code' in error && error.code === 4;
          return reply.code(missing ? 404 : 503).send({
            code: missing ? 'PUBLICATION_NOT_FOUND' : 'PUBLICATION_UNAVAILABLE',
            message: missing ? 'Такой проверенный выпуск не опубликован.' : 'Проверенный комплект сейчас недоступен.',
          });
        }
      });
  }
}
