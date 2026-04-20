import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './error.js';
import { logAuditEvent } from '../features/auth/auth.audit.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfMiddleware: RequestHandler = async (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const sessionToken = req.session?.csrfToken;
  const headerToken = req.header('x-csrf-token');

  if (!sessionToken || !headerToken) {
    await logAuditEvent(req, 'CSRF_FAIL', `Falta token (session=${!!sessionToken}, header=${!!headerToken})`);
    next(new HttpError(403, 'csrf_invalid', 'CSRF token invalido'));
    return;
  }

  const a = Buffer.from(sessionToken, 'hex');
  const b = Buffer.from(headerToken, 'hex');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await logAuditEvent(req, 'CSRF_FAIL', 'Token mismatch');
    next(new HttpError(403, 'csrf_invalid', 'CSRF token invalido'));
    return;
  }

  next();
};
