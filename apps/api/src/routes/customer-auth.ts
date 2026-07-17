import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CustomerAuthError, CustomerAuthService } from '../services/customer-auth.service.js';
import { requireCustomerAuth } from '../middleware/customer-auth.js';

const registerSchema = z.object({
  businessSlug: z.string().min(1),
  name: z.string().min(1),
  phone: z
    .string()
    .min(1, 'Phone number is required')
    .refine((value) => (value.match(/\d/g) ?? []).length >= 8, {
      message: 'Enter a valid phone number with at least 8 digits',
    }),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  businessSlug: z.string().min(1),
  // Email or phone
  identifier: z.string().min(1),
  password: z.string().min(1),
});

// Customer tokens are Bearer-only (no refresh cookie) so the embeddable widget
// can call these endpoints under the open CORS policy without credentials.
const CUSTOMER_TOKEN_EXPIRES_IN = '30d';

export async function customerAuthRoutes(fastify: FastifyInstance) {

  fastify.post('/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const body = registerSchema.parse(request.body);

      try {
        const result = await CustomerAuthService.register(body);
        const accessToken = await reply.jwtSign(result.accessTokenPayload, {
          expiresIn: CUSTOMER_TOKEN_EXPIRES_IN,
        });

        return reply.status(201).send({
          data: {
            customer: CustomerAuthService.toPublicCustomer(result.customer),
            accessToken,
          },
        });
      } catch (err) {
        if (err instanceof CustomerAuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Registration failed';
        return reply.status(400).send({ error: message });
      }
    },
  });

  fastify.post('/login', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    handler: async (request, reply) => {
      const body = loginSchema.parse(request.body);

      const result = await CustomerAuthService.login(body);
      if (!result) {
        return reply.status(401).send({ error: 'Invalid email/phone or password' });
      }

      const accessToken = await reply.jwtSign(result.accessTokenPayload, {
        expiresIn: CUSTOMER_TOKEN_EXPIRES_IN,
      });

      return reply.send({
        data: {
          customer: CustomerAuthService.toPublicCustomer(result.customer),
          accessToken,
        },
      });
    },
  });

  fastify.get('/me', {
    preHandler: requireCustomerAuth,
    handler: async (request, reply) => {
      const customer = await CustomerAuthService.getById(request.authCustomer!.customerId);
      if (!customer) {
        return reply.status(401).send({ error: 'Account not found' });
      }

      return reply.send({
        data: {
          customer: CustomerAuthService.toPublicCustomer(customer),
          business: {
            id: request.business!.id,
            name: request.business!.name,
            slug: request.business!.slug,
          },
        },
      });
    },
  });
}
