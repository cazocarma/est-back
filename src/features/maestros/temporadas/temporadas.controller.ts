import { Router, type Request, type Response, type NextFunction } from 'express';
import { authnMiddleware } from '../../../middleware/authn.js';
import { csrfMiddleware } from '../../../middleware/csrf.js';
import { requireAdmin } from '../../../middleware/requireRole.js';
import {
  getBody,
  getParams,
  getQuery,
  idParamSchema,
  validateBody,
  validateParams,
  validateQuery,
  type IdParam,
} from '../../../shared/validate.js';
import { paged } from '../../../shared/pagination.js';
import {
  temporadaCreate,
  temporadaListQuery,
  temporadaUpdate,
  type TemporadaCreate,
  type TemporadaListQuery,
  type TemporadaUpdate,
} from './temporadas.dto.js';
import * as service from './temporadas.service.js';

export function buildTemporadasRouter(): Router {
  const r = Router();

  // Lectura: cualquier usuario autenticado con rol est-user
  r.use(authnMiddleware);

  r.get(
    '/',
    validateQuery(temporadaListQuery),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = getQuery<TemporadaListQuery>(req);
        const { rows, pagination } = await service.listTemporadas(query);
        res.json(paged(rows, pagination.total, query));
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
        res.json(await service.getTemporada(id));
      } catch (err) {
        next(err);
      }
    }
  );

  // Mutacion: requiere rol est-admin + CSRF
  r.post(
    '/',
    csrfMiddleware,
    requireAdmin,
    validateBody(temporadaCreate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = getBody<TemporadaCreate>(req);
        const created = await service.createTemporada(input, req.session.userId!);
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
    validateBody(temporadaUpdate),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const input = getBody<TemporadaUpdate>(req);
        res.json(await service.updateTemporada(id, input, req.session.userId!));
      } catch (err) {
        next(err);
      }
    }
  );

  r.patch(
    '/:id/activar',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        res.json(await service.activarTemporada(id, req.session.userId!));
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
        await service.deleteTemporada(id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
