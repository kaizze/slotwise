/**
 * Dev seed — creates a sample hair salon with staff and services.
 * Usage:  npx tsx src/db/seed.ts
 *         npm run db:seed
 */

import pg from 'pg';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();

  try {
    console.log('[seed] Seeding development data...\n');

    await client.query('BEGIN');

    // ── Business ────────────────────────────────────────────────────────────
    const businessId = randomUUID();
    await client.query(`
      INSERT INTO businesses (id, name, slug, type, timezone, locale, settings, plan)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (slug) DO NOTHING
    `, [
      businessId,
      'Salon Eleni',
      'salon-eleni',
      'hair_salon',
      'Europe/Athens',
      'el',
      JSON.stringify({
        slotDurationMinutes: 30,
        bufferMinutes: 5,
        maxAdvanceDays: 30,
        requiresDeposit: false,
        smsEnabled: false,
        agentEnabled: true,
        noShowThreshold: 0.5,
      }),
      'pro',
    ]);

    console.log('[seed] ✓ Business: Salon Eleni (slug: salon-eleni)');

    // ── Services ────────────────────────────────────────────────────────────
    const services = [
      { name: 'Haircut',          duration: 30, price: 15, color: '#6366f1' },
      { name: 'Colour & Blow Dry', duration: 90, price: 55, color: '#ec4899' },
      { name: 'Blow Dry',         duration: 30, price: 20, color: '#14b8a6' },
      { name: 'Hair Treatment',   duration: 45, price: 35, color: '#f59e0b' },
    ];

    const serviceIds: string[] = [];
    for (const svc of services) {
      const id = randomUUID();
      serviceIds.push(id);
      await client.query(`
        INSERT INTO services (id, business_id, name, duration_minutes, price, currency, color)
        VALUES ($1, $2, $3, $4, $5, 'EUR', $6)
      `, [id, businessId, svc.name, svc.duration, svc.price, svc.color]);
      console.log(`[seed] ✓ Service: ${svc.name} (${svc.duration}min / €${svc.price})`);
    }

    // ── Staff ───────────────────────────────────────────────────────────────
    const workingHours = [1, 2, 3, 4, 5].map((day) => ({  // Mon–Fri
      dayOfWeek: day,
      startTime: '09:00',
      endTime: '18:00',
      breakStart: '13:00',
      breakEnd: '14:00',
    }));

    const staff = [
      { name: 'Eleni Papadaki',  email: 'eleni@saloneleni.gr' },
      { name: 'Maria Stavrakaki', email: 'maria@saloneleni.gr' },
    ];

    for (const s of staff) {
      const staffId = randomUUID();
      await client.query(`
        INSERT INTO staff (id, business_id, name, email, service_ids, working_hours)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        staffId,
        businessId,
        s.name,
        s.email,
        serviceIds,                          // can perform all services
        JSON.stringify(workingHours),
      ]);
      console.log(`[seed] ✓ Staff: ${s.name}`);
    }

    // ── Sample customer ─────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO customers (id, business_id, name, phone, email)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (business_id, phone) DO NOTHING
    `, [randomUUID(), businessId, 'Dimitris Test', '6944000001', 'test@example.com']);

    console.log('[seed] ✓ Sample customer: Dimitris Test (6944000001)');

    // ── Owner login account ──────────────────────────────────────────────────
    const ownerEmail = 'owner@saloneleni.gr';
    const ownerPassword = 'devpassword123';
    const passwordHash = await bcrypt.hash(ownerPassword, 12);

    await client.query(`
      INSERT INTO users (id, business_id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, $5, 'owner')
      ON CONFLICT (email) DO NOTHING
    `, [randomUUID(), businessId, ownerEmail, passwordHash, 'Eleni Papadaki']);

    console.log(`[seed] ✓ Owner login: ${ownerEmail} / ${ownerPassword}`);

    await client.query('COMMIT');

    console.log('\n[seed] Done.');
    console.log('\nLogin:');
    console.log('  POST http://localhost:3001/api/v1/auth/login');
    console.log(`  { "email": "${ownerEmail}", "password": "${ownerPassword}" }`);
    console.log('\nAgent endpoint:');
    console.log('  POST http://localhost:3001/api/v1/agent/salon-eleni/chat');
    console.log('\nPayload:');
    console.log('  { "messages": [{ "role": "user", "content": "I want a haircut on Friday" }] }');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
