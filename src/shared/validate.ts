import type { Request, RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { HttpError } from '../middleware/error.js';

// Cache de los datos validados por request (evita re-validar)
const VALIDATED = Symbol('validated');

interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

function getStore(req: Request): Validated {
  const r = req as unknown as Record<symbol, Validated>;
  if (!r[VALIDATED]) r[VALIDATED] = {};
  return r[VALIDATED];
}

export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    getStore(req).body = result.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    getStore(req).query = result.data;
    next();
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    getStore(req).params = result.data;
    next();
  };
}

export function getBody<T>(req: Request): T {
  const v = getStore(req).body;
  if (v === undefined) throw new HttpError(500, 'validate_missing', 'getBody sin validateBody previo');
  return v as T;
}
export function getQuery<T>(req: Request): T {
  const v = getStore(req).query;
  if (v === undefined) throw new HttpError(500, 'validate_missing', 'getQuery sin validateQuery previo');
  return v as T;
}
export function getParams<T>(req: Request): T {
  const v = getStore(req).params;
  if (v === undefined) throw new HttpError(500, 'validate_missing', 'getParams sin validateParams previo');
  return v as T;
}

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type IdParam = z.infer<typeof idParamSchema>;
