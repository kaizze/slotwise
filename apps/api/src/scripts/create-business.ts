/**
 * SlotWise — Business Onboarding Script
 *
 * Creates a new business with owner login, staff, and services.
 *
 * Usage (run from repo root):
 *   npm run create-business --workspace=apps/api
 *
 * Or with a JSON config file to skip the prompts:
 *   npm run create-business --workspace=apps/api -- config.json
 */

import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import pg from 'pg';
import * as readline from 'readline';
import * as fs from 'fs';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SERVICE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4'];
let colorIndex = 0;
function nextColor(): string {
  const color = SERVICE_COLORS[colorIndex % SERVICE_COLORS.length] ?? '#6366f1';
  colorIndex++;
  return color;
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function promptWithDefault(rl: readline.Interface, question: string, defaultValue: string): Promise<string> {
  const answer = await prompt(rl, `${question} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

// ─── Config types ─────────────────────────────────────────────────────────────

interface ServiceConfig {
  name: string;
  durationMinutes: number;
  price: number;
  color?: string;
}

interface StaffConfig {
  name: string;
  email?: string;
  phone?: string;
  workDays: number[]; // 0=Sun, 1=Mon ... 6=Sat
  startTime: string;  // "09:00"
  endTime: string;    // "18:00"
}

interface BusinessConfig {
  businessName: string;
  businessSlug: string;
  businessType: string;
  timezone: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  services: ServiceConfig[];
  staff: StaffConfig[];
}

// ─── Interactive prompts ───────────────────────────────────────────────────────

async function promptInteractive(): Promise<BusinessConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   SlotWise — New Business Setup      ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('── Business ─────────────────────────────\n');
  const businessName = await prompt(rl, 'Business name: ');
  const suggestedSlug = slugify(businessName);
  const businessSlug = await promptWithDefault(rl, 'URL slug', suggestedSlug);
  const businessType = await promptWithDefault(rl, 'Type (hair_salon / beauty_salon / clinic / spa)', 'hair_salon');
  const timezone = await promptWithDefault(rl, 'Timezone', 'Europe/Athens');

  // Validate timezone — try constructing an Intl.DateTimeFormat with it, which
  // throws a RangeError if the IANA timezone name is invalid (e.g. "Y").
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    console.error(`\n✗ Invalid timezone: "${timezone}". Use an IANA name like "Europe/Athens" or "UTC".\n`);
    rl.close();
    process.exit(1);
  }

  console.log('\n── Owner login ──────────────────────────\n');
  const ownerName     = await prompt(rl, 'Owner name: ');
  const ownerEmail    = await prompt(rl, 'Owner email: ');
  const ownerPassword = await promptWithDefault(rl, 'Password', 'changeme123');

  console.log('\n── Services (press Enter with no name to finish) ────────\n');
  const services: ServiceConfig[] = [];

  while (true) {
    const name = await prompt(rl, 'Service name: ');
    if (!name.trim()) break;

    const durationStr = await promptWithDefault(rl, '  Duration (minutes)', '30');
    const priceStr    = await promptWithDefault(rl, '  Price (€)', '0');

    services.push({
      name: name.trim(),
      durationMinutes: parseInt(durationStr, 10),
      price: parseFloat(priceStr),
      color: nextColor(),
    });

    console.log(`  ✓ Added\n`);
  }

  console.log('\n── Staff (press Enter with no name to finish) ───────────\n');
  const staff: StaffConfig[] = [];

  while (true) {
    const name = await prompt(rl, 'Staff name: ');
    if (!name.trim()) break;

    const phone     = await prompt(rl, '  Phone (optional): ');
    const email     = await prompt(rl, '  Email (optional): ');
    const startTime = await promptWithDefault(rl, '  Work start time', '09:00');
    const endTime   = await promptWithDefault(rl, '  Work end time',   '18:00');
    const daysStr   = await promptWithDefault(rl, '  Work days (Mon=1..Sun=0, comma-separated)', '1,2,3,4,5');

    const workDays = daysStr
      .split(',')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d));

    staff.push({
      name:      name.trim(),
      email:     email.trim()  || undefined,
      phone:     phone.trim()  || undefined,
      workDays,
      startTime,
      endTime,
    });

    console.log(`  ✓ Added\n`);
  }

  rl.close();

  return { businessName, businessSlug, businessType, timezone, ownerName, ownerEmail, ownerPassword, services, staff };
}

// ─── Database writes ──────────────────────────────────────────────────────────

async function createBusiness(config: BusinessConfig): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Business
    const businessId = randomUUID();
    const defaultSettings = {
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      maxAdvanceDays: 30,
        requiresDeposit: false,
        smsEnabled: false,
        emailEnabled: true,
        agentEnabled: true,
      noShowThreshold: 0.5,
    };

    await client.query(`
      INSERT INTO businesses (id, name, slug, type, timezone, locale, settings)
      VALUES ($1, $2, $3, $4, $5, 'el', $6)
    `, [businessId, config.businessName, config.businessSlug, config.businessType, config.timezone, JSON.stringify(defaultSettings)]);

    console.log(`\n[create] ✓ Business: ${config.businessName} (${config.businessSlug})`);

    // Owner user
    const passwordHash = await bcrypt.hash(config.ownerPassword, 12);
    await client.query(`
      INSERT INTO users (id, business_id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, $5, 'owner')
    `, [randomUUID(), businessId, config.ownerEmail, passwordHash, config.ownerName]);

    console.log(`[create] ✓ Owner login: ${config.ownerEmail}`);

    // Services
    const serviceIds: string[] = [];

    for (const svc of config.services) {
      const serviceId = randomUUID();
      serviceIds.push(serviceId);

      await client.query(`
        INSERT INTO services (id, business_id, name, duration_minutes, price, currency, color, is_active)
        VALUES ($1, $2, $3, $4, $5, 'EUR', $6, TRUE)
      `, [serviceId, businessId, svc.name, svc.durationMinutes, svc.price, svc.color ?? nextColor()]);

      console.log(`[create] ✓ Service: ${svc.name} (${svc.durationMinutes}min / €${svc.price})`);
    }

    // Staff
    for (const member of config.staff) {
      const workingHours = member.workDays.map((day) => ({
        dayOfWeek: day,
        startTime: member.startTime,
        endTime:   member.endTime,
      }));

      await client.query(`
        INSERT INTO staff (id, business_id, name, email, phone, service_ids, working_hours, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      `, [
        randomUUID(),
        businessId,
        member.name,
        member.email   ?? null,
        member.phone   ?? null,
        JSON.stringify(serviceIds),
        JSON.stringify(workingHours),
      ]);

      console.log(`[create] ✓ Staff: ${member.name}`);
    }

    await client.query('COMMIT');

    const pad = (s: string, n: number) => s.padEnd(n);
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Done! Here is what was created:                             ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Dashboard:   https://app.coloredkidz.gr                    ║`);
    console.log(`║  Login:       ${pad(config.ownerEmail, 47)}║`);
    console.log(`║  Password:    ${pad(config.ownerPassword, 47)}║`);
    console.log(`║  Agent slug:  ${pad(config.businessSlug, 47)}║`);
    console.log(`║  Widget tag:  ${pad(`data-business="${config.businessSlug}"`, 47)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log('Remind the owner to change their password after first login.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const configFile = process.argv[2];

  let config: BusinessConfig;

  if (configFile) {
    console.log(`\nLoading config from ${configFile}...\n`);
    const raw = fs.readFileSync(configFile, 'utf-8');
    config = JSON.parse(raw) as BusinessConfig;
  } else {
    config = await promptInteractive();
  }

  // Guard against duplicate slugs
  const existing = await pool.query('SELECT id FROM businesses WHERE slug = $1', [config.businessSlug]);
  if ((existing.rowCount ?? 0) > 0) {
    console.error(`\n✗ Slug "${config.businessSlug}" is already taken. Choose a different one.\n`);
    process.exit(1);
  }

  await createBusiness(config);
  await pool.end();
}

main().catch((err) => {
  console.error('\n✗ Error:', (err as Error).message);
  process.exit(1);
});
