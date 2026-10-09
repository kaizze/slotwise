import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePlatformAuth } from '../middleware/auth.js';
import { PlatformAuthService } from '../services/platform-auth.service.js';
import { PlatformService } from '../services/platform.service.js';
import { PlatformUserService } from '../services/platform-user.service.js';

const REFRESH_COOKIE = 'platform_refresh_token';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/api/v1/platform',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60,
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function platformRoutes(fastify: FastifyInstance) {
  // ─── Auth ──────────────────────────────────────────────────────────────────

  fastify.post('/auth/login', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const result = await PlatformAuthService.login(body.email, body.password);
      if (!result) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const accessToken = await reply.jwtSign(result.accessPayload, { expiresIn: '8h' });
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);

      return reply.send({
        data: {
          accessToken,
          user: result.user,
        },
      });
    },
  });

  fastify.post('/auth/refresh', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const raw = request.cookies[REFRESH_COOKIE];
      if (!raw) return reply.status(401).send({ error: 'No refresh session' });

      const result = await PlatformAuthService.refresh(raw);
      if (!result) {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/platform' });
        return reply.status(401).send({ error: 'Session expired' });
      }

      const accessToken = await reply.jwtSign(result.accessPayload, { expiresIn: '8h' });
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);

      return reply.send({
        data: {
          accessToken,
          user: result.user,
        },
      });
    },
  });

  fastify.post('/auth/logout', {
    handler: async (request, reply) => {
      const raw = request.cookies[REFRESH_COOKIE];
      if (raw) await PlatformAuthService.logout(raw);
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/platform' });
      return reply.send({ data: { ok: true } });
    },
  });

  fastify.get('/auth/me', {
    preHandler: requirePlatformAuth,
    handler: async (request, reply) => {
      const user = await PlatformUserService.getById(request.platformUser!.userId);
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      return reply.send({ data: { user } });
    },
  });

  // ─── Fleet ─────────────────────────────────────────────────────────────────

  fastify.get('/businesses', {
    preHandler: requirePlatformAuth,
    handler: async (request, reply) => {
      const { q } = request.query as { q?: string };
      const businesses = await PlatformService.listBusinesses(q);
      return reply.send({ data: { businesses } });
    },
  });

  fastify.get('/health', {
    preHandler: requirePlatformAuth,
    handler: async (_request, reply) => {
      const health = await PlatformService.getHealth();
      return reply
        .status(health.status === 'ok' ? 200 : 503)
        .send({ data: health });
    },
  });
}
