import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';

import { authRoutes } from './routes/auth';
import { bookingRoutes } from './routes/bookings';
import { slotRoutes } from './routes/slots';
import { agentRoutes } from './routes/agent';
import { staffRoutes } from './routes/staff';
import { serviceRoutes } from './routes/services';
import { businessRoutes } from './routes/business';
import { webhookRoutes } from './routes/webhooks';
import { db } from './db/client';
import { startNotificationWorker, stopNotificationWorker } from './queues/notification-worker';

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
// 2. Dashboard/admin endpoints (auth, staff, services, business settings,
//    authenticated booking management) carry the httpOnly refresh-token
//    cookie and must be locked to the known dashboard origin(s) with
//    credentials enabled — open CORS here would let any site ride the
//    cookie on a logged-in owner's behalf.

const dashboardOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'];

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
// Each plugin gets its own CORS registration — encapsulated per Fastify plugin
// scope, so this doesn't leak between route groups.

await server.register(async (instance) => {
  await instance.register(cors, { origin: dashboardOrigins, credentials: true });
  await instance.register(authRoutes,     { prefix: '/api/v1/auth' });
  await instance.register(staffRoutes,    { prefix: '/api/v1/staff' });
  await instance.register(serviceRoutes,  { prefix: '/api/v1/services' });
});

await server.register(async (instance) => {
  // Public: embeddable widget + AI agent run on arbitrary third-party origins.
  // Note: bookingRoutes also contains admin sub-routes (list/by-phone) gated
  // by requireAuth — that's safe under open CORS because the access token is
  // sent as an Authorization header (not a cookie), so there's no ambient
  // credential for a third-party site to ride. A site without the bearer
  // token simply gets a 401, regardless of origin.
  await instance.register(cors, { origin: true, credentials: false });
  await instance.register(businessRoutes, { prefix: '/api/v1/businesses' });
  await instance.register(bookingRoutes,  { prefix: '/api/v1/bookings' });
  await instance.register(slotRoutes,     { prefix: '/api/v1/slots' });
  await instance.register(agentRoutes,    { prefix: '/api/v1/agent' });
});

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
