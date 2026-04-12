import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Public routes that skip auth */
const PUBLIC_PATHS = new Set(['/api/health']);

/**
 * Register API key authentication hook.
 * - If AEMR_API_KEY is not set → auth disabled (dev mode), logs warning.
 * - If set → all /api/* routes require `Authorization: Bearer <key>`.
 * - /api/health is always public.
 */
export function registerAuthHook(app: FastifyInstance): void {
  const apiKey = config.auth.apiKey;

  if (!apiKey) {
    app.log.warn('⚠ AEMR_API_KEY not set — API authentication DISABLED (dev mode)');
    return;
  }

  app.log.info('API key authentication enabled');

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]; // strip query params

    // Skip auth for public routes and non-API routes
    if (PUBLIC_PATHS.has(url) || !url.startsWith('/api/')) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // strip "Bearer "
    if (!safeCompare(token, apiKey)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key' });
    }
  });
}
