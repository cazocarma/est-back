import type { Request } from 'express';
import { getPool, mssql } from '../../infra/db.js';
import { logger } from '../../config/logger.js';

export type AuditOperacion =
  | 'LOGIN'
  | 'LOGOUT'
  | 'REFRESH_FAIL'
  | 'CSRF_FAIL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_ROLE';

export async function logAuditEvent(
  req: Request,
  operacion: AuditOperacion,
  detalle?: string
): Promise<void> {
  const userId = req.session?.userId ?? null;
  const sub = req.session?.sub ? req.session.sub.slice(0, 8) + '…' : null;
  const requestId = req.requestId;
  const ip = (req.ip ?? '').slice(0, 60);
  const msg = detalle ? `${sub ?? ''} ${detalle}`.trim() : (sub ?? null);

  try {
    const pool = await getPool();
    await pool
      .request()
      .input('UsuarioId', mssql.BigInt, userId)
      .input('Operacion', mssql.NVarChar(80), operacion)
      .input('Origen', mssql.NVarChar(32), 'OIDC')
      .input('Detalle', mssql.NVarChar(mssql.MAX), msg)
      .input('RequestId', mssql.NVarChar(64), requestId)
      .input('IpOrigen', mssql.NVarChar(64), ip)
      .query(
        `INSERT INTO est.Auditoria (UsuarioId, Operacion, Origen, Detalle, RequestId, IpOrigen)
         VALUES (@UsuarioId, @Operacion, @Origen, @Detalle, @RequestId, @IpOrigen);`
      );
  } catch (err) {
    // No bloqueamos la request por fallo de auditoria
    logger.warn({ err, operacion, requestId }, 'auditoria no persistida');
  }
}
