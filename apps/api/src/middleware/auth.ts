import type { FastifyRequest, FastifyReply } from 'fastify';
import { BusinessService } from '../services/business.service.js';
import type { Business, AuthTokenPayload, CustomerAuthTokenPayload } from '@slotwise/types';

// Extend Fastify request type to carry the resolved business + auth payload
declare module 'fastify' {
  interface FastifyRequest {
    business?: Business;
    authUser?: AuthTokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthTokenPayload | CustomerAuthTokenPayload;
    user: AuthTokenPayload | CustomerAuthTokenPayload;
  }
}

function isMerchantPayload(payload: unknown): payload is AuthTokenPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p.userId === 'string'
    && typeof p.businessId === 'string'
    && typeof p.role === 'string'
    && p.typ !== 'customer';
}

/**
 * Resolves :businessSlug from the route params and attaches the business
 * to the request. Used by public routes (slots, agent chat).
 */
export async function resolveBusinessFromSlug(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { businessSlug } = request.params as { businessSlug?: string };

  if (!businessSlug) {
    return reply.status(400).send({ error: 'Missing business identifier' });
  }

  const business = await BusinessService.getBySlug(businessSlug);

  if (!business) {
    return reply.status(404).send({ error: 'Business not found' });
  }

  request.business = business;
}

/**
 * Verifies the access token JWT and resolves the business it belongs to.
 * Used by admin/dashboard routes (staff management, business settings, etc).
 *
 * Expects JWT payload: { userId, businessId, role }
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const payload = request.user;
  if (!isMerchantPayload(payload)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const business = await BusinessService.getById(payload.businessId);

  if (!business) {
    return reply.status(401).send({ error: 'Business not found for token' });
  }

  request.business = business;
  request.authUser = payload;
}

/**
 * Role-check only — assumes requireAuth has already run (e.g. as a plugin-wide
 * preHandler) and populated request.authUser. Add as an additional preHandler
 * on specific routes that need owner-only access within an already-authed plugin.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.authUser) {
    // Defensive fallback in case requireOwner is used standalone without requireAuth first
    await requireAuth(request, reply);
    if (reply.sent) return;
  }

  if (request.authUser?.role !== 'owner') {
    return reply.status(403).send({ error: 'Owner role required' });
  }
}
