// Accesso al DB del manuale D&D (Neon). Solo lettura: ogni query gira in una transazione READ ONLY.
import pg from "pg";

let pool;

/** Toglie i parametri solo-Prisma (pgbouncer, connection_limit, schema...) che libpq/pg non gradiscono. */
export function cleanDatabaseUrl(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (!["sslmode", "channel_binding", "connect_timeout"].includes(key)) {
      u.searchParams.delete(key);
    }
  }
  return u.toString();
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL non configurata");
    }
    pool = new pg.Pool({
      connectionString: cleanDatabaseUrl(process.env.DATABASE_URL),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

/** Esegue una SELECT in una transazione READ ONLY e restituisce le righe. */
export async function readQuery(sql, params = []) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
