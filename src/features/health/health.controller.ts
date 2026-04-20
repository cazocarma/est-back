import { Router } from 'express';
import { getPool } from '../../infra/db.js';
import { getRedis } from '../../infra/redis.js';
import { logger } from '../../config/logger.js';

/**
 * Health endpoints siguiendo PLATFORM_INTEGRATION_SPEC §11.
 *
 *  - GET /health          → liveness basico (docker healthcheck). 200 siempre
 *                           que el proceso este vivo.
 *  - GET /health/ready    → readiness extendido (DB + Redis). 200 solo cuando
 *                           las dependencias estan operativas; 503 si alguna
 *                           esta degradada.
 *  - GET /api/health      → passthrough publico via router. Mismo payload
 *                           que /health pero expuesto en el vhost de la app.
 */
export function buildHealthRouter(): Router {
  const r = Router();

  const liveness = (_req: unknown, res: import('express').Response): void => {
    res.status(200).json({ status: 'ok', service: 'est-back', time: new Date().toISOString() });
  };

  r.get('/health', liveness);
  r.get('/api/health', liveness);

  r.get('/health/ready', async (_req, res) => {
    const result: Record<string, 'ok' | 'fail'> = {};
    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      result.db = 'ok';
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'db health fail');
      result.db = 'fail';
    }
    try {
      const pong = await getRedis().ping();
      result.redis = pong === 'PONG' ? 'ok' : 'fail';
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'redis health fail');
      result.redis = 'fail';
    }
    const ok = Object.values(result).every((v) => v === 'ok');
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks: result });
  });

  return r;
}
