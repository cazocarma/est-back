import { Router, type Request, type Response, type NextFunction } from 'express';
import mssql from 'mssql';
import { authnMiddleware } from '../../middleware/authn.js';
import { csrfMiddleware } from '../../middleware/csrf.js';
import { requireAdmin } from '../../middleware/requireRole.js';
import { getPool } from '../../infra/db.js';
import { paged } from '../../shared/pagination.js';
import {
  getBody,
  getParams,
  getQuery,
  idParamSchema,
  validateBody,
  validateParams,
  validateQuery,
  type IdParam,
} from '../../shared/validate.js';
import {
  controlVersionCerrar,
  controlVersionCreate,
  estimacionCreate,
  estimacionListQuery,
  estimacionUpdate,
  type ControlVersionCerrar,
  type ControlVersionCreate,
  type EstimacionCreate,
  type EstimacionListQuery,
  type EstimacionUpdate,
} from './estimacion.dto.js';
import * as service from './estimacion.service.js';

async function isUserAdmin(userId: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request().input('UsuarioId', mssql.BigInt, userId).query(`
    SELECT 1 AS ok FROM est.UsuarioRol ur
    INNER JOIN est.Rol r ON r.RolId = ur.RolId
    WHERE ur.UsuarioId = @UsuarioId AND r.Codigo = N'est-admin' AND r.Activo = 1;
  `);
  return r.recordset.length > 0;
}

export function buildEstimacionesGeneralesRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  // ---------- ControlVersion ----------

  r.get('/control-versiones', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const temporadaId = req.query['temporadaId'] ? Number(req.query['temporadaId']) : null;
      const especieId = req.query['especieId'] ? Number(req.query['especieId']) : null;
      const data = await service.listControlVersions(temporadaId, especieId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  r.get(
    '/control-versiones/:id',
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        res.json(await service.getControlVersion(id));
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/control-versiones',
    csrfMiddleware,
    requireAdmin,
    validateBody(controlVersionCreate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = getBody<ControlVersionCreate>(req);
        const cv = await service.createControlVersion(
          body.temporadaId,
          body.especieSapId,
          body.comentario ?? null,
          req.session.userId!
        );
        res.status(201).json(cv);
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/control-versiones/:id/cerrar',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    validateBody(controlVersionCerrar),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const body = getBody<ControlVersionCerrar>(req);
        const result = await service.cerrarControlVersion(
          id,
          body.comentario ?? null,
          req.session.userId!
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------- Estimaciones ----------

  r.get(
    '/',
    validateQuery(estimacionListQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<EstimacionListQuery>(req);
        const { rows, pagination } = await service.listEstimaciones(q);
        res.json(paged(rows, pagination.total, q));
      } catch (err) {
        next(err);
      }
    }
  );

  r.get(
    '/:id',
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        res.json(await service.getEstimacion(id));
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/',
    csrfMiddleware,
    validateBody(estimacionCreate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = getBody<EstimacionCreate>(req);
        const esAdmin = await isUserAdmin(req.session.userId!);
        const created = await service.createEstimacion(body, req.session.userId!, esAdmin);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  r.put(
    '/:id',
    csrfMiddleware,
    validateParams(idParamSchema),
    validateBody(estimacionUpdate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const body = getBody<EstimacionUpdate>(req);
        const esAdmin = await isUserAdmin(req.session.userId!);
        res.json(await service.updateEstimacion(id, body, req.session.userId!, esAdmin));
      } catch (err) {
        next(err);
      }
    }
  );

  r.delete(
    '/:id',
    csrfMiddleware,
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const esAdmin = await isUserAdmin(req.session.userId!);
        await service.deleteEstimacion(id, req.session.userId!, esAdmin);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
