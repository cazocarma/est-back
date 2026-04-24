import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error.js';
import { csrfMiddleware } from '../../middleware/csrf.js';
import {
  buildAuthorizationUrl,
  buildEndSessionUrl,
  generateCsrfToken,
  handleCallback,
  refreshIfNeeded,
} from './auth.service.js';
import { logAuditEvent } from './auth.audit.js';

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 30 });
const callbackLimiter = rateLimit({ windowMs: 60_000, limit: 60 });

// AUTH_STANDARD.md §2.1 — rutas internas: empiezan con '/' pero NO con '//' (protocol-relative).
const SAFE_RETURN_TO = /^\/[^\s]*$/;
function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  if (raw.startsWith('//')) return '/';
  return SAFE_RETURN_TO.test(raw) ? raw : '/';
}

export function buildAuthRouter(): Router {
  const r = Router();

  r.get('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const returnTo = sanitizeReturnTo(req.query.returnTo);
      const url = await buildAuthorizationUrl(req, returnTo);
      res.redirect(302, url);
    } catch (err) {
      next(err);
    }
  });

  r.get('/callback', callbackLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handleCallback(req);
      const { tokenSet, usuarioId, returnTo, role, kcSid } = result;

      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      const claims = tokenSet.claims();
      req.session.userId = usuarioId;
      req.session.sub = claims.sub;
      if (kcSid) req.session.kcSid = kcSid;
      req.session.usuario =
        (claims.preferred_username as string | undefined) ??
        (claims.email as string | undefined) ??
        claims.sub;
      req.session.nombre =
        (claims.name as string | undefined) ?? req.session.usuario ?? '';
      req.session.email = (claims.email as string | undefined) ?? null;
      req.session.role = role;
      req.session.accessToken = tokenSet.access_token;
      req.session.refreshToken = tokenSet.refresh_token;
      req.session.idToken = tokenSet.id_token;
      req.session.accessTokenExpiresAt = tokenSet.expires_at
        ? tokenSet.expires_at * 1000
        : Date.now() + 300_000;
      req.session.csrfToken = generateCsrfToken();
      req.session.preAuth = undefined;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      await logAuditEvent(req, 'LOGIN');
      res.redirect(302, returnTo || '/');
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        const op = err.code === 'user_suspended' ? 'FORBIDDEN_SUSPENDED' : 'FORBIDDEN_ROLE';
        await logAuditEvent(req, op, err.message);
      }
      next(err);
    }
  });

  r.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.session?.userId) {
        res.status(401).json({ error: { code: 'unauthorized', message: 'Sesion requerida' } });
        return;
      }
      await refreshIfNeeded(req);
      res.json({
        user: {
          id: req.session.userId,
          usuario: req.session.usuario,
          nombre: req.session.nombre,
          email: req.session.email,
          role: req.session.role,
        },
        csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      req.session.destroy(() => undefined);
      next(err);
    }
  });

  r.post('/logout', csrfMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = req.session?.idToken;
      await logAuditEvent(req, 'LOGOUT');

      if (idToken) {
        try {
          const url = await buildEndSessionUrl(idToken);
          // back-channel fire-and-forget — no bloqueamos la respuesta al usuario
          void fetch(url, { redirect: 'manual' }).catch((err) =>
            logger.warn({ err: (err as Error).message }, 'end_session_endpoint fallo')
          );
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'buildEndSessionUrl fallo');
        }
      }

      await new Promise<void>((resolve) => {
        req.session.destroy(() => resolve());
      });
      res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
