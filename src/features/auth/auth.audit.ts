import type { Request } from 'express';
import { getPool, mssql } from '../../infra/db.js';
import { logger } from '../../config/logger.js';

export type AuditOperacion =
  | 'LOGIN'
  | 'LOGOUT'
  | 'BACKCHANNEL_LOGOUT'
  | 'REFRESH_FAIL'
  | 'CSRF_FAIL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_SUSPENDED';

export interface AuditContext {
  userId?: number | null;
  sub?: string | null;
  requestId?: string | null;
  ip?: string | null;
}

function truncateSub(sub: string | null | undefined): string | null {
  return sub ? sub.slice(0, 8) + '…' : null;
}

export async function logAuditEvent(
  req: Request,
  operacion: AuditOperacion,
  detalle?: string
): Promise<void> {
  return logAuditEventRaw(
    {
      userId: req.session?.userId ?? null,
      sub: req.session?.sub ?? null,
      requestId: req.requestId ?? null,
      ip: req.ip ?? null,
    },
    operacion,
    detalle
  );
}

/**
 * Variante sin Request, para endpoints como backchannel-logout que no tienen
 * sesión propia ni requestId del middleware estándar.
 */
export async function logAuditEventRaw(
  ctx: AuditContext,
  operacion: AuditOperacion,
  detalle?: string
): Promise<void> {
  const sub = truncateSub(ctx.sub ?? null);
  const ip = (ctx.ip ?? '').slice(0, 60);
  const msg = detalle ? `${sub ?? ''} ${detalle}`.trim() : (sub ?? null);

  try {
    const pool = await getPool();
    await pool
      .request()
      .input('UsuarioId', mssql.BigInt, ctx.userId ?? null)
      .input('Operacion', mssql.NVarChar(80), operacion)
      .input('Origen', mssql.NVarChar(32), 'OIDC')
      .input('Detalle', mssql.NVarChar(mssql.MAX), msg)
      .input('RequestId', mssql.NVarChar(64), ctx.requestId ?? null)
      .input('IpOrigen', mssql.NVarChar(64), ip)
      .query(
        `INSERT INTO est.Auditoria (UsuarioId, Operacion, Origen, Detalle, RequestId, IpOrigen)
         VALUES (@UsuarioId, @Operacion, @Origen, @Detalle, @RequestId, @IpOrigen);`
      );
  } catch (err) {
    logger.warn({ err, operacion, requestId: ctx.requestId }, 'auditoria no persistida');
  }
}
