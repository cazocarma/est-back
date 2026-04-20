import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authnMiddleware } from '../../middleware/authn.js';
import { csrfMiddleware } from '../../middleware/csrf.js';
import { requireAdmin } from '../../middleware/requireRole.js';
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
  agronomoCreate,
  agronomoListQuery,
  agronomoUpdate,
  asignacionesBulkUpsert,
  asignacionesListQuery,
  type AgronomoCreate,
  type AgronomoListQuery,
  type AgronomoUpdate,
  type AsignacionesBulkUpsert,
  type AsignacionesListQuery,
} from './agronomos.dto.js';
import * as service from './agronomos.service.js';

const asignacionIdParam = z.object({
  id: z.coerce.number().int().positive(),
  asignacionId: z.coerce.number().int().positive(),
});

const usuariosDisponiblesQuery = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function buildAgronomosRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get(
    '/usuarios-disponibles',
    requireAdmin,
    validateQuery(usuariosDisponiblesQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<z.infer<typeof usuariosDisponiblesQuery>>(req);
        const data = await service.listUsuariosDisponibles(q.q, q.limit);
        res.json({ data });
      } catch (err) {
        next(err);
      }
    }
  );

  r.get(
    '/',
    validateQuery(agronomoListQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<AgronomoListQuery>(req);
        const { rows, pagination } = await service.listAgronomos(q);
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
        res.json(await service.getAgronomo(id));
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/',
    csrfMiddleware,
    requireAdmin,
    validateBody(agronomoCreate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = getBody<AgronomoCreate>(req);
        const created = await service.createAgronomo(input, req.session.userId!);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    }
  );

  r.put(
    '/:id',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    validateBody(agronomoUpdate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const input = getBody<AgronomoUpdate>(req);
        res.json(await service.updateAgronomo(id, input, req.session.userId!));
      } catch (err) {
        next(err);
      }
    }
  );

  r.delete(
    '/:id',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        await service.deactivateAgronomo(id, req.session.userId!);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- Asignaciones ----------------

  r.get(
    '/:id/asignaciones',
    validateParams(idParamSchema),
    validateQuery(asignacionesListQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const q = getQuery<AsignacionesListQuery>(req);
        const data = await service.listAsignacionesDeAgronomo(id, q.temporadaId ?? null);
        res.json({ data });
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/:id/asignaciones',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    validateBody(asignacionesBulkUpsert),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const body = getBody<AsignacionesBulkUpsert>(req);
        const result = await service.bulkAsignar(
          id,
          body.temporadaId,
          body.productorVariedadIds,
          req.session.userId!
        );
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  r.delete(
    '/:id/asignaciones/:asignacionId',
    csrfMiddleware,
    requireAdmin,
    validateParams(asignacionIdParam),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const p = getParams<z.infer<typeof asignacionIdParam>>(req);
        await service.deleteAsignacion(p.id, p.asignacionId);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}

/**
 * Endpoint aparte: /api/v1/mi-perfil/asignaciones
 * Usuario autenticado ve sus propias asignaciones sin exponer /agronomos/:id.
 */
export function buildMiPerfilRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get(
    '/asignaciones',
    validateQuery(asignacionesListQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<AsignacionesListQuery>(req);
        const result = await service.listAsignacionesDelUsuario(
          req.session.userId!,
          q.temporadaId ?? null
        );
        if (!result) {
          // el usuario no es agronomo: respuesta valida pero vacia
          res.json({ agronomo: null, data: [] });
          return;
        }
        res.json({ agronomo: result.agronomo, data: result.asignaciones });
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
