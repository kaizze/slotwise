/**
 * Minimal migration runner.
 * Applies .sql files from /migrations in filename order.
 * Tracks applied migrations in a `_migrations` table.
 *
 * Usage:  npx tsx src/db/migrate.ts
 *         npm run db:migrate
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read migration files
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('[migrate] No migrations directory found at', MIGRATIONS_DIR);
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // lexicographic order — use 001_, 002_ prefixes

    if (files.length === 0) {
      console.log('[migrate] No migration files found.');
      return;
    }

    // Get already-applied migrations
    const applied = await client.query<{ filename: string }>(
      'SELECT filename FROM _migrations'
    );
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrate] ✓ ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

      console.log(`[migrate] ↑ Applying ${file}...`);
      await client.query('BEGIN');

      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[migrate] ✓ ${file} applied`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ✗ ${file} failed:`, err);
        process.exit(1);
      }
    }

    if (count === 0) {
      console.log('[migrate] Nothing to apply — database is up to date.');
    } else {
      console.log(`[migrate] Done. ${count} migration(s) applied.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
