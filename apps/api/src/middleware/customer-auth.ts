import type { FastifyRequest, FastifyReply } from 'fastify';
import { BusinessService } from '../services/business.service.js';
import type { CustomerAuthTokenPayload } from '@slotwise/types';

declare module 'fastify' {
  interface FastifyRequest {
    authCustomer?: CustomerAuthTokenPayload;
  }
}

function isCustomerPayload(payload: unknown): payload is CustomerAuthTokenPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.typ === 'customer'
    && typeof p.customerId === 'string'
    && typeof p.businessId === 'string';
}

/**
 * Verifies a customer widget access token (typ: 'customer').
 * Rejects merchant dashboard tokens.
 */
export async function requireCustomerAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const payload = request.user;
  if (!isCustomerPayload(payload)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const business = await BusinessService.getById(payload.businessId);
  if (!business) {
    return reply.status(401).send({ error: 'Business not found for token' });
  }

  request.business = business;
  request.authCustomer = payload;
}

/**
 * Optional customer auth for public booking create.
 * If a Bearer token is present and valid as a customer token for the
 * requested business, attaches authCustomer; otherwise leaves guest flow alone.
 * Never fails the request for a missing/invalid token.
 */
export async function optionalCustomerAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;

  try {
    await request.jwtVerify();
  } catch {
    return;
  }

  const payload = request.user;
  if (!isCustomerPayload(payload)) return;

  const business = await BusinessService.getById(payload.businessId);
  if (!business) return;

  request.business = business;
  request.authCustomer = payload;
}
