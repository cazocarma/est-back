import type { RequestHandler } from 'express';
import { HttpError } from './error.js';
import { logAuditEvent } from '../features/auth/auth.audit.js';
import { getPool, mssql } from '../infra/db.js';

const adminCache = new Map<number, { isAdmin: boolean; expiresAt: number }>();
const TTL_MS = 60_000;

async function isAdmin(userId: number): Promise<boolean> {
  const now = Date.now();
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.isAdmin;

  const pool = await getPool();
  const r = await pool
    .request()
    .input('UsuarioId', mssql.BigInt, userId)
    .query(`
      SELECT 1 AS ok
      FROM est.UsuarioRol ur
      INNER JOIN est.Rol r ON r.RolId = ur.RolId
      WHERE ur.UsuarioId = @UsuarioId AND r.Codigo = N'est-admin' AND r.Activo = 1
    `);
  const value = r.recordset.length > 0;
  adminCache.set(userId, { isAdmin: value, expiresAt: now + TTL_MS });
  return value;
}

/**
 * Requiere rol de administrador (est.Rol con Codigo = 'est-admin').
 * Debe ir despues de `authnMiddleware`.
 */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      next(new HttpError(401, 'unauthorized', 'Sesion requerida'));
      return;
    }
    const admin = await isAdmin(userId);
    if (!admin) {
      await logAuditEvent(req, 'FORBIDDEN_ROLE', `requireAdmin: userId=${userId}`);
      next(new HttpError(403, 'forbidden', 'Accion restringida a administradores'));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};

export function invalidateAdminCache(userId: number): void {
  adminCache.delete(userId);
}
