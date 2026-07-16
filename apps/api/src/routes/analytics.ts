import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { requireAuth } from '../middleware/auth.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { OverviewService } from '../services/overview.service.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', requireAuth);

  // GET /api/v1/analytics/today — home overview metrics + timeline
  fastify.get('/today', async (request, reply) => {
    const business = request.business!;
    const overview = await OverviewService.getToday(business.id);
    return reply.send({ data: overview });
  });

  // GET /api/v1/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
  fastify.get('/', async (request, reply) => {
    const business = request.business!;
    const query = querySchema.parse(request.query);
    const tz = business.timezone || 'UTC';

    const toDay = query.to
      ? dayjs.tz(query.to, tz)
      : dayjs().tz(tz);
    const fromDay = query.from
      ? dayjs.tz(query.from, tz)
      : toDay.subtract(29, 'day');

    if (!fromDay.isValid() || !toDay.isValid()) {
      return reply.status(400).send({ error: 'Invalid from/to date' });
    }
    if (toDay.isBefore(fromDay, 'day')) {
      return reply.status(400).send({ error: '`to` must be on or after `from`' });
    }
    if (toDay.diff(fromDay, 'day') > 366) {
      return reply.status(400).send({ error: 'Date range cannot exceed 366 days' });
    }

    // Inclusive calendar days in business TZ → [start, nextDay) UTC bounds
    const from = fromDay.startOf('day').toDate();
    const to = toDay.add(1, 'day').startOf('day').toDate();

    const report = await AnalyticsService.getReport({
      businessId: business.id,
      from,
      to,
    });

    return reply.send({ data: report });
  });
}
