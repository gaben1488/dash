import type { FastifyRequest, FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Validate request body against a Zod schema.
 * Returns parsed data on success, sends 400 on failure.
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  request: FastifyRequest,
  reply: FastifyReply,
): z.infer<T> | null {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    reply.status(400).send({
      error: 'Ошибка валидации',
      details: formatZodError(result.error),
    });
    return null;
  }
  return result.data;
}

/**
 * Validate request query against a Zod schema.
 * Returns parsed data on success, sends 400 on failure.
 *
 * Потребителей на 18.08.2026 нет (проверено по всему серверу): роуты читают
 * строку запроса вручную через `request.query as Record<string, string>`.
 * SIMPLIFY_REGISTER_2026-06-05 §S5 предписывал принять эту дверь, и функция
 * оставлена именно под это — она парная к живому parseBody и держит тот же
 * русский отказ. Принимать её нужно роут за роутом с inject-тестом: сегодня
 * кривой параметр молча берёт значение по умолчанию, а через parseQuery
 * получит 400 — это видимое снаружи изменение поведения, и делать его
 * походя, «заодно с уборкой», нельзя.
 */
export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  request: FastifyRequest,
  reply: FastifyReply,
): z.infer<T> | null {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    reply.status(400).send({
      error: 'Ошибка валидации параметров',
      details: formatZodError(result.error),
    });
    return null;
  }
  return result.data;
}

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue: { path: (string | number)[]; message: string }) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
