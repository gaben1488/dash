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
