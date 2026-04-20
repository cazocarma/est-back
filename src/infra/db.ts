import mssql from 'mssql';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const poolConfig: mssql.config = {
  server: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: {
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
    enableArithAbort: true,
  },
  pool: {
    min: 0,
    max: 20,
    idleTimeoutMillis: 30_000,
  },
};

let pool: mssql.ConnectionPool | null = null;

export async function getPool(): Promise<mssql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new mssql.ConnectionPool(poolConfig).connect();
  pool.on('error', (err) => logger.error({ err }, 'mssql pool error'));
  logger.info({ host: env.DB_HOST, db: env.DB_NAME }, 'mssql pool conectado');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { mssql };
