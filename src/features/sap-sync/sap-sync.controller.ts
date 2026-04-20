import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authnMiddleware } from '../../middleware/authn.js';
import { csrfMiddleware } from '../../middleware/csrf.js';
import { requireAdmin } from '../../middleware/requireRole.js';
import { isSapEtlConfigured } from '../../infra/sap-etl.client.js';
import { HttpError } from '../../middleware/error.js';
import { getBody, getQuery, validateBody, validateQuery } from '../../shared/validate.js';
import { runSync } from './sap-sync.service.js';
import { listSyncEstado, listSyncLogs } from './sap-sync.repository.js';
import { ENTIDADES_ORDEN, type EntidadSap } from './sap-sync.types.js';

const entidadSchema = z.enum([
  'especie',
  'grupo-variedad',
  'variedad',
  'productor',
  'envase',
  'manejo',
  'centro',
  'tipo-frio',
  'programa',
]);

const runSchema = z.object({
  entidades: z.array(entidadSchema).optional(),
  rowCount: z.number().int().min(0).max(1_000_000).optional(),
});

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export function buildSapSyncRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get('/estado', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await listSyncEstado();
      res.json({
        configurado: isSapEtlConfigured(),
        entidadesSoportadas: ENTIDADES_ORDEN,
        estado: rows,
      });
    } catch (err) {
      next(err);
    }
  });

  r.get(
    '/logs',
    validateQuery(logsQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<z.infer<typeof logsQuerySchema>>(req);
        const rows = await listSyncLogs(q.limit);
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/run',
    csrfMiddleware,
    requireAdmin,
    validateBody(runSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!isSapEtlConfigured()) {
          throw new HttpError(
            503,
            'sap_etl_not_configured',
            'SAP_ETL_BASE_URL y SAP_ETL_TOKEN no configurados en el entorno'
          );
        }
        const body = getBody<z.infer<typeof runSchema>>(req);
        const results = await runSync(body.entidades as readonly EntidadSap[] | undefined, {
          usuarioId: req.session.userId!,
          origen: 'manual',
          rowCount: body.rowCount,
        });
        res.json({ results });
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
