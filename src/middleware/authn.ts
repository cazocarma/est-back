import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { HttpError } from './error.js';
import { logAuditEvent } from '../features/auth/auth.audit.js';
import { refreshIfNeeded } from '../features/auth/auth.service.js';

export const authnMiddleware: RequestHandler = async (req, _res, next) => {
  if (!req.session?.userId) {
    await logAuditEvent(req, 'UNAUTHORIZED', `${req.method} ${req.path}`);
    next(new HttpError(401, 'unauthorized', 'Sesion requerida'));
    return;
  }

  if (req.session.role !== env.OIDC_REQUIRED_ROLE) {
    await logAuditEvent(req, 'FORBIDDEN_ROLE', `role=${req.session.role}`);
    next(new HttpError(403, 'forbidden', 'Usuario sin acceso'));
    return;
  }

  try {
    await refreshIfNeeded(req);
    next();
  } catch (err) {
    await logAuditEvent(req, 'REFRESH_FAIL', (err as Error).message);
    req.session.destroy(() => undefined);
    next(new HttpError(401, 'session_expired', 'Sesion expirada'));
  }
};
