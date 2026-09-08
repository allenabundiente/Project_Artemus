// Applies backend/migrations/*.sql in order to the database at DATABASE_URL.
// Idempotent: each migration runs once (tracked in schema_migrations) and is
// wrapped in a transaction (Supabase Postgres supports transactional DDL), so
// a failed run leaves the DB untouched.
//
// Usage:  npm run migrate        (reads backend/.env via dotenv)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add it to backend/.env (Supabase → Connect → URI).');
  process.exit(1);
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

const pool = new pg.Pool({ connectionString, max: 1 });

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name      text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  await ensureTable();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file} applied`);
      ran++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file} FAILED: ${e.message}`);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }

  if (ran === 0 && process.exitCode !== 1) console.log('Schema is up to date.');
  await pool.end();
}

main().catch((e) => {
  console.error('Migration run failed:', e.message);
  process.exit(1);
});
