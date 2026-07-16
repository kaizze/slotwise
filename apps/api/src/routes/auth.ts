import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/auth.service.js';
import { UserService } from '../services/user.service.js';
import { requireAuth } from '../middleware/auth.js';

const REFRESH_COOKIE_NAME = 'slotwise_refresh';
const REFRESH_COOKIE_MAX_AGE = 30 * 86_400; // 30 days, in seconds — matches RefreshTokenService TTL

const signupSchema = z.object({
  businessName: z.string().min(1),
  businessSlug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and hyphens'),
  businessType: z.enum(['hair_salon', 'nail_salon', 'medical', 'dental', 'beauty', 'fitness', 'other']),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8, 'Password must be at least 8 characters'),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Cookie helper ─────────────────────────────────────────────────────────────

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  };
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  // Must match setCookie attributes or browsers keep the cookie.
  reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

export async function authRoutes(fastify: FastifyInstance) {

  // ── Signup: creates business + first owner user ──────────────────────────
  fastify.post('/signup', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } }, // discourage automated mass signup
    handler: async (request, reply) => {
      const body = signupSchema.parse(request.body);

      try {
        const result = await AuthService.signup(body);
        const accessToken = await reply.jwtSign(result.accessTokenPayload);

        setRefreshCookie(reply, result.refreshToken);

        return reply.status(201).send({
          data: {
            user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
            business: { id: result.business.id, name: result.business.name, slug: result.business.slug },
            accessToken,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Signup failed';
        return reply.status(409).send({ error: message });
      }
    },
  });

  // ── Login ──────────────────────────────────────────────────────────────────
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }, // slow down credential stuffing
    handler: async (request, reply) => {
      const body = loginSchema.parse(request.body);

      const result = await AuthService.login(body.email, body.password);

      if (!result) {
        // Deliberately generic — don't reveal whether the email exists
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const accessToken = await reply.jwtSign(result.accessTokenPayload);
      setRefreshCookie(reply, result.refreshToken);

      return reply.send({
        data: {
          user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
          business: { id: result.business.id, name: result.business.name, slug: result.business.slug },
          accessToken,
        },
      });
    },
  });

  // ── Refresh: exchange refresh cookie for a new access token ──────────────
  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    if (!refreshToken) {
      return reply.status(401).send({ error: 'No refresh token provided' });
    }

    const result = await AuthService.refresh(refreshToken);

    if (!result) {
      clearRefreshCookie(reply);
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const accessToken = await reply.jwtSign(result.accessTokenPayload);
    setRefreshCookie(reply, result.refreshToken); // rotated — old one is now revoked

    return reply.send({ data: { accessToken } });
  });

  // ── Logout: revoke the current refresh token ──────────────────────────────
  fastify.post('/logout', async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    if (refreshToken) {
      await AuthService.logout(refreshToken);
    }

    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  // ── Current user info — used on app boot to restore session display state ──
  fastify.get('/me', {
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const user = await UserService.getById(request.authUser!.userId);
      if (!user) {
        return reply.status(401).send({ error: 'User not found' });
      }

      return reply.send({
        data: {
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
          business: request.business,
        },
      });
    },
  });
}
