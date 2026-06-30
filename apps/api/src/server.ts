import Fastify, { type FastifyRequest } from 'fastify';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';

import { authRoutes } from './routes/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { slotRoutes } from './routes/slots.js';
import { agentRoutes } from './routes/agent.js';
import { staffRoutes } from './routes/staff.js';
import { serviceRoutes } from './routes/services.js';
import { businessRoutes } from './routes/business.js';
import { webhookRoutes } from './routes/webhooks.js';
import { db } from './db/client.js';
import { startNotificationWorker, stopNotificationWorker } from './queues/notification-worker.js';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

// Two distinct CORS policies are needed here:
//
// 1. Public widget endpoints (slots, public business info, booking creation)
//    are embedded on arbitrary third-party client sites — the origin isn't
//    known at deploy time, so these allow any origin. No cookies are involved,
//    so this is safe: there's nothing ambient to steal cross-origin.
//
// 2. Dashboard/admin endpoints (auth, staff, services) carry the httpOnly
//    refresh-token cookie and must be locked to the known dashboard
//    origin(s) with credentials enabled — open CORS here would let any site
//    ride the cookie on a logged-in owner's behalf.
//
// IMPORTANT: @fastify/cors registers a single global `OPTIONS *` preflight
// route with no prefix. Registering the plugin more than once anywhere in
// the same Fastify instance collides on that route with FST_ERR_DUPLICATED_ROUTE
// — Fastify's plugin encapsulation does NOT protect against this, since the
// wildcard route is deliberately unprefixed so it can catch preflight
// requests for any path. (Confirmed against fastify-cors's own usage docs
// and a matching real-world report: fastify/fastify-http-proxy#309.) So CORS
// is registered exactly once, at the top level, with origin decided
// per-request via the documented callback form — not once per route group.

const dashboardOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'];

// Paths that carry the httpOnly refresh cookie and must be locked to the
// dashboard's known origin(s). Everything else (widget, agent, webhooks) is
// open — see rationale above.
const CREDENTIALED_PATH_PREFIXES = ['/api/v1/auth', '/api/v1/staff', '/api/v1/services'];

function isCredentialedPath(url: string): boolean {
  return CREDENTIALED_PATH_PREFIXES.some((prefix) => url.startsWith(prefix));
}

await server.register(cors, (instance) => {
  return (req: FastifyRequest, callback: (error: Error | null, corsOptions?: FastifyCorsOptions) => void) => {
    if (isCredentialedPath(req.url)) {
      callback(null, { origin: dashboardOrigins, credentials: true });
    } else {
      callback(null, { origin: true, credentials: false });
    }
  };
});

await server.register(cookie);

await server.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'change-me-in-production',
  sign: { expiresIn: '15m' }, // short-lived access token; refresh token covers longevity
});

await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  // Agent endpoint gets its own tighter limit (see route)
});

// Twilio sends webhook payloads as application/x-www-form-urlencoded
await server.register(formbody);

// ─── Routes ───────────────────────────────────────────────────────────────────

await server.register(authRoutes,     { prefix: '/api/v1/auth' });
await server.register(staffRoutes,    { prefix: '/api/v1/staff' });
await server.register(serviceRoutes,  { prefix: '/api/v1/services' });

// bookingRoutes also contains admin sub-routes (list/by-phone) gated by
// requireAuth — safe under the open CORS policy above because the access
// token is sent as an Authorization header (not a cookie), so there's no
// ambient credential for a third-party site to ride. A site without the
// bearer token simply gets a 401, regardless of origin.
await server.register(businessRoutes, { prefix: '/api/v1/businesses' });
await server.register(bookingRoutes,  { prefix: '/api/v1/bookings' });
await server.register(slotRoutes,     { prefix: '/api/v1/slots' });
await server.register(agentRoutes,    { prefix: '/api/v1/agent' });

// Webhooks (Twilio) are server-to-server — no browser CORS involved at all.
await server.register(webhookRoutes, { prefix: '/webhooks' });

// ─── Health check ─────────────────────────────────────────────────────────────

server.get('/health', async (_req, reply) => {
  const dbHealth = await db.healthCheck();
  const status = dbHealth.healthy ? 'ok' : 'degraded';
  return reply
    .status(dbHealth.healthy ? 200 : 503)
    .send({ status, ts: new Date().toISOString(), db: dbHealth });
});

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  const port = parseInt(process.env.PORT ?? '3001');
  await server.listen({ port, host: '0.0.0.0' });
  server.log.info(`SlotWise API running on port ${port}`);

  // Background worker — dispatches queued SMS/email/WhatsApp notifications.
  // Runs in-process for now; split into a separate worker process once volume
  // grows enough that it competes with the API for resources.
  startNotificationWorker();
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  server.log.info(`Received ${signal}, shutting down...`);
  stopNotificationWorker();
  await server.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
