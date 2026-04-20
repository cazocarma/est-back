/**
 * Listado de combinaciones productor-variedad (sap.ProductorVariedadSap) con
 * joins a productor y variedad para su uso en el UI de asignaciones.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getPool, mssql } from '../../infra/db.js';
import { authnMiddleware } from '../../middleware/authn.js';
import { paged, paginationQuery } from '../../shared/pagination.js';
import { getQuery, validateQuery } from '../../shared/validate.js';

const listQuerySchema = paginationQuery.extend({
  temporadaId: z.coerce.number().int().positive().optional(),
  productorId: z.coerce.number().int().positive().optional(),
  variedadId: z.coerce.number().int().positive().optional(),
  activo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

interface PvRow {
  ProductorVariedadSapId: number;
  ProductorSapId: number;
  ProductorCodigoSap: string;
  ProductorNombre: string;
  VariedadSapId: number;
  VariedadCodigoSap: string;
  VariedadNombre: string;
  CuartelCodigo: string | null;
  TemporadaId: number | null;
  Activo: boolean;
}

export function buildSapProductorVariedadRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get('/', validateQuery(listQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQuery<ListQuery>(req);
      const pool = await getPool();
      const listReq = pool.request();
      const countReq = pool.request();

      const where: string[] = ['1 = 1'];
      if (q.temporadaId !== undefined) {
        where.push('(pv.TemporadaId = @TemporadaId OR pv.TemporadaId IS NULL)');
        listReq.input('TemporadaId', mssql.Int, q.temporadaId);
        countReq.input('TemporadaId', mssql.Int, q.temporadaId);
      }
      if (q.productorId !== undefined) {
        where.push('pv.ProductorSapId = @ProductorId');
        listReq.input('ProductorId', mssql.BigInt, q.productorId);
        countReq.input('ProductorId', mssql.BigInt, q.productorId);
      }
      if (q.variedadId !== undefined) {
        where.push('pv.VariedadSapId = @VariedadId');
        listReq.input('VariedadId', mssql.BigInt, q.variedadId);
        countReq.input('VariedadId', mssql.BigInt, q.variedadId);
      }
      if (q.activo !== undefined) {
        where.push('pv.Activo = @Activo');
        listReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
        countReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
      }
      if (q.q) {
        where.push(
          '(p.CodigoSap LIKE @Q OR p.Nombre LIKE @Q OR v.CodigoSap LIKE @Q OR v.Nombre LIKE @Q OR pv.CuartelCodigo LIKE @Q)'
        );
        listReq.input('Q', mssql.NVarChar, `%${q.q}%`);
        countReq.input('Q', mssql.NVarChar, `%${q.q}%`);
      }

      const offset = (q.page - 1) * q.page_size;
      listReq.input('Offset', mssql.Int, offset);
      listReq.input('Limit', mssql.Int, q.page_size);

      const listResult = await listReq.query<PvRow>(`
        SELECT pv.ProductorVariedadSapId, pv.ProductorSapId, pv.VariedadSapId,
               pv.TemporadaId, pv.CuartelCodigo, pv.Activo,
               p.CodigoSap AS ProductorCodigoSap, p.Nombre AS ProductorNombre,
               v.CodigoSap AS VariedadCodigoSap,  v.Nombre AS VariedadNombre
        FROM sap.ProductorVariedadSap pv
        INNER JOIN sap.ProductorSap p ON p.ProductorSapId = pv.ProductorSapId
        INNER JOIN sap.VariedadSap  v ON v.VariedadSapId  = pv.VariedadSapId
        WHERE ${where.join(' AND ')}
        ORDER BY p.Nombre ASC, v.Nombre ASC, pv.CuartelCodigo ASC
        OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
      `);

      const countResult = await countReq.query<{ total: number }>(`
        SELECT COUNT(*) AS total
        FROM sap.ProductorVariedadSap pv
        INNER JOIN sap.ProductorSap p ON p.ProductorSapId = pv.ProductorSapId
        INNER JOIN sap.VariedadSap  v ON v.VariedadSapId  = pv.VariedadSapId
        WHERE ${where.join(' AND ')};
      `);

      const total = countResult.recordset[0]?.total ?? 0;
      const data = listResult.recordset.map((row) => ({
        id: row.ProductorVariedadSapId,
        productorId: row.ProductorSapId,
        productorCodigoSap: row.ProductorCodigoSap,
        productorNombre: row.ProductorNombre,
        variedadId: row.VariedadSapId,
        variedadCodigoSap: row.VariedadCodigoSap,
        variedadNombre: row.VariedadNombre,
        cuartelCodigo: row.CuartelCodigo,
        temporadaId: row.TemporadaId,
        activo: row.Activo,
      }));
      res.json(paged(data, total, q));
    } catch (err) {
      next(err);
    }
  });

  return r;
}
