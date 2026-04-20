import { Router, type Request, type Response, type NextFunction } from 'express';
import client from 'prom-client';

/**
 * /metrics endpoint — PLATFORM_INTEGRATION_SPEC §12.2.
 *
 * Expone metricas Prometheus (default + http_*). Scrape ser hace desde
 * Prometheus del stack `platform` via la red `greenvic-est-<env>_default`.
 * No se protege con sesion (consumo intra-cluster); el router de platform
 * NO expone /metrics hacia el exterior.
 */

const registry = new client.Registry();
registry.setDefaultLabels({ service: 'est-back' });
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requests HTTP procesados',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duracion de requests HTTP en segundos',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * Middleware que contabiliza cada request contra los contadores/histogramas.
 * Se monta en app.ts antes de las rutas de dominio.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ?? req.baseUrl + (req.route?.path ?? req.path);
    const labels = {
      method: req.method,
      route: typeof route === 'string' ? route : req.path,
      status: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    const elapsedNs = Number(process.hrtime.bigint() - start);
    httpRequestDurationSeconds.observe(labels, elapsedNs / 1e9);
  });
  next();
}

export function buildMetricsRouter(): Router {
  const r = Router();
  r.get('/metrics', async (_req, res, next) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      next(err);
    }
  });
  return r;
}
