import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { buildApp } from './app.js';
import { getPool, closePool } from './infra/db.js';
import { getRedis, closeRedis } from './infra/redis.js';

async function main(): Promise<void> {
  // Warm-up: detecta fallos de conectividad temprano
  try {
    await getPool();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'DB no disponible al arrancar — el servicio seguira intentando');
  }
  try {
    getRedis();
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Redis no disponible');
    process.exit(1);
  }

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'est-back escuchando');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'apagando...');
    server.close();
    await Promise.allSettled([closePool(), closeRedis()]);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

void main();
