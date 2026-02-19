import { Pool } from '@neondatabase/serverless';

let pool;
let schemaReadyPromise;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing DATABASE_URL environment variable.');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        wallet_json JSONB DEFAULT '{"usdBalance":20000,"btcBalance":0.35,"bonus":185}'::jsonb,
        positions_json JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return schemaReadyPromise;
}

export async function query(text, params = []) {
  await ensureSchema();
  return getPool().query(text, params);
}

export async function withTransaction(callback) {
  await ensureSchema();
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
