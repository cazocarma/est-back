import { Router, type Request, type Response, type NextFunction } from 'express';
import mssql from 'mssql';
import { z } from 'zod';
import { getPool } from '../../infra/db.js';
import { HttpError } from '../../middleware/error.js';
import { authnMiddleware } from '../../middleware/authn.js';
import { csrfMiddleware } from '../../middleware/csrf.js';
import { requireAdmin } from '../../middleware/requireRole.js';
import { paged, paginationQuery } from '../../shared/pagination.js';
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha YYYY-MM-DD esperada');

const listQuery = paginationQuery.extend({
  temporadaId: z.coerce.number().int().positive().optional(),
  especieId: z.coerce.number().int().positive().optional(),
  activo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
type ListQuery = z.infer<typeof listQuery>;

const createSchema = z.object({
  temporadaId: z.number().int().positive(),
  especieSapId: z.number().int().positive(),
  fechaApertura: isoDate,
  fechaCierre: isoDate,
  activo: z.boolean().optional().default(true),
});
const updateSchema = z.object({
  fechaApertura: isoDate.optional(),
  fechaCierre: isoDate.optional(),
  activo: z.boolean().optional(),
});

interface Row {
  FechaEstimacionGeneralId: number;
  TemporadaId: number;
  TemporadaAnio: number;
  TemporadaPrefijo: string;
  EspecieSapId: number;
  EspecieCodigoSap: string;
  EspecieNombre: string;
  FechaApertura: Date;
  FechaCierre: Date;
  Activo: boolean;
  VentanaAbierta: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function map(r: Row) {
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    id: r.FechaEstimacionGeneralId,
    temporadaId: r.TemporadaId,
    temporadaAnio: r.TemporadaAnio,
    temporadaPrefijo: r.TemporadaPrefijo,
    especieSapId: r.EspecieSapId,
    especieCodigoSap: r.EspecieCodigoSap,
    especieNombre: r.EspecieNombre,
    fechaApertura: toIso(r.FechaApertura),
    fechaCierre: toIso(r.FechaCierre),
    activo: r.Activo,
    ventanaAbierta: r.VentanaAbierta,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

const SELECT_COLS = `
  fg.FechaEstimacionGeneralId,
  fg.TemporadaId, t.Anio AS TemporadaAnio, t.Prefijo AS TemporadaPrefijo,
  fg.EspecieSapId, e.CodigoSap AS EspecieCodigoSap, e.Nombre AS EspecieNombre,
  fg.FechaApertura, fg.FechaCierre, fg.Activo,
  CASE WHEN fg.Activo = 1 AND CAST(SYSUTCDATETIME() AS DATE) BETWEEN fg.FechaApertura AND fg.FechaCierre
       THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS VentanaAbierta,
  fg.CreatedAt, fg.UpdatedAt
  FROM est.FechaEstimacionGeneral fg
  INNER JOIN est.Temporada   t ON t.TemporadaId  = fg.TemporadaId
  INNER JOIN sap.EspecieSap  e ON e.EspecieSapId = fg.EspecieSapId
`;

export function buildCalendarioGeneralRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get('/', validateQuery(listQuery), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQuery<ListQuery>(req);
      const pool = await getPool();
      const where: string[] = ['1 = 1'];
      const listReq = pool.request();
      const countReq = pool.request();
      if (q.temporadaId !== undefined) {
        where.push('fg.TemporadaId = @TemporadaId');
        listReq.input('TemporadaId', mssql.Int, q.temporadaId);
        countReq.input('TemporadaId', mssql.Int, q.temporadaId);
      }
      if (q.especieId !== undefined) {
        where.push('fg.EspecieSapId = @EspecieId');
        listReq.input('EspecieId', mssql.BigInt, q.especieId);
        countReq.input('EspecieId', mssql.BigInt, q.especieId);
      }
      if (q.activo !== undefined) {
        where.push('fg.Activo = @Activo');
        listReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
        countReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
      }
      if (q.q) {
        where.push('(e.Nombre LIKE @Q OR e.CodigoSap LIKE @Q)');
        listReq.input('Q', mssql.NVarChar, `%${q.q}%`);
        countReq.input('Q', mssql.NVarChar, `%${q.q}%`);
      }
      const offset = (q.page - 1) * q.page_size;
      listReq.input('Offset', mssql.Int, offset);
      listReq.input('Limit', mssql.Int, q.page_size);

      const sortCol = (() => {
        if (!q.sort) return 't.Anio';
        const [c] = q.sort.split(':');
        if (c === 'especie') return 'e.Nombre';
        if (c === 'apertura') return 'fg.FechaApertura';
        if (c === 'cierre') return 'fg.FechaCierre';
        return 't.Anio';
      })();
      const sortDir = q.sort?.endsWith(':desc') ? 'DESC' : 'ASC';

      const list = await listReq.query<Row>(`
        SELECT ${SELECT_COLS}
        WHERE ${where.join(' AND ')}
        ORDER BY ${sortCol} ${sortDir}, e.Nombre ASC
        OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
      `);
      const count = await countReq.query<{ total: number }>(`
        SELECT COUNT(*) AS total
        FROM est.FechaEstimacionGeneral fg
        INNER JOIN est.Temporada  t ON t.TemporadaId  = fg.TemporadaId
        INNER JOIN sap.EspecieSap e ON e.EspecieSapId = fg.EspecieSapId
        WHERE ${where.join(' AND ')};
      `);
      const total = count.recordset[0]?.total ?? 0;
      res.json(paged(list.recordset.map(map), total, q));
    } catch (err) {
      next(err);
    }
  });

  r.get(
    '/:id',
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const pool = await getPool();
        const result = await pool.request().input('Id', mssql.Int, id).query<Row>(`
          SELECT ${SELECT_COLS}
          WHERE fg.FechaEstimacionGeneralId = @Id;
        `);
        const row = result.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Ventana no encontrada');
        res.json(map(row));
      } catch (err) {
        next(err);
      }
    }
  );

  r.post(
    '/',
    csrfMiddleware,
    requireAdmin,
    validateBody(createSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = getBody<z.infer<typeof createSchema>>(req);
        if (input.fechaCierre < input.fechaApertura) {
          throw new HttpError(422, 'invalid_date_range', 'fechaCierre no puede ser anterior a fechaApertura');
        }
        const pool = await getPool();

        const dup = await pool
          .request()
          .input('TemporadaId', mssql.Int, input.temporadaId)
          .input('EspecieId', mssql.BigInt, input.especieSapId)
          .query<{ cnt: number }>(
            `SELECT COUNT(*) AS cnt FROM est.FechaEstimacionGeneral WHERE TemporadaId = @TemporadaId AND EspecieSapId = @EspecieId;`
          );
        if ((dup.recordset[0]?.cnt ?? 0) > 0) {
          throw new HttpError(409, 'conflict', 'Ya existe una ventana para esa temporada y especie');
        }

        const insert = await pool
          .request()
          .input('TemporadaId', mssql.Int, input.temporadaId)
          .input('EspecieId', mssql.BigInt, input.especieSapId)
          .input('FechaApertura', mssql.Date, input.fechaApertura)
          .input('FechaCierre', mssql.Date, input.fechaCierre)
          .input('Activo', mssql.Bit, input.activo ? 1 : 0)
          .input('UserId', mssql.BigInt, req.session.userId!)
          .query<{ Id: number }>(`
            INSERT INTO est.FechaEstimacionGeneral
              (TemporadaId, EspecieSapId, FechaApertura, FechaCierre, Activo, CreatedBy, UpdatedBy)
            OUTPUT inserted.FechaEstimacionGeneralId AS Id
            VALUES (@TemporadaId, @EspecieId, @FechaApertura, @FechaCierre, @Activo, @UserId, @UserId);
          `);
        const id = insert.recordset[0]!.Id;
        const created = await pool.request().input('Id', mssql.Int, id).query<Row>(`
          SELECT ${SELECT_COLS} WHERE fg.FechaEstimacionGeneralId = @Id;
        `);
        res.status(201).json(map(created.recordset[0]!));
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
    validateBody(updateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const input = getBody<z.infer<typeof updateSchema>>(req);
        const pool = await getPool();

        const current = await pool
          .request()
          .input('Id', mssql.Int, id)
          .query<{ FechaApertura: Date; FechaCierre: Date }>(
            `SELECT FechaApertura, FechaCierre FROM est.FechaEstimacionGeneral WHERE FechaEstimacionGeneralId = @Id;`
          );
        if (current.recordset.length === 0) {
          throw new HttpError(404, 'not_found', 'Ventana no encontrada');
        }

        const curIni = current.recordset[0]!.FechaApertura.toISOString().slice(0, 10);
        const curFin = current.recordset[0]!.FechaCierre.toISOString().slice(0, 10);
        const ini = input.fechaApertura ?? curIni;
        const fin = input.fechaCierre ?? curFin;
        if (fin < ini) {
          throw new HttpError(422, 'invalid_date_range', 'fechaCierre no puede ser anterior a fechaApertura');
        }

        await pool
          .request()
          .input('Id', mssql.Int, id)
          .input('FechaApertura', mssql.Date, input.fechaApertura ?? null)
          .input('FechaCierre', mssql.Date, input.fechaCierre ?? null)
          .input('Activo', mssql.Bit, input.activo === undefined ? null : input.activo ? 1 : 0)
          .input('UserId', mssql.BigInt, req.session.userId!)
          .query(`
            UPDATE est.FechaEstimacionGeneral
            SET FechaApertura = COALESCE(@FechaApertura, FechaApertura),
                FechaCierre   = COALESCE(@FechaCierre,   FechaCierre),
                Activo        = COALESCE(@Activo,        Activo),
                UpdatedAt     = SYSUTCDATETIME(),
                UpdatedBy     = @UserId
            WHERE FechaEstimacionGeneralId = @Id;
          `);

        const updated = await pool.request().input('Id', mssql.Int, id).query<Row>(`
          SELECT ${SELECT_COLS} WHERE fg.FechaEstimacionGeneralId = @Id;
        `);
        res.json(map(updated.recordset[0]!));
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
        const pool = await getPool();
        const r2 = await pool
          .request()
          .input('Id', mssql.Int, id)
          .query(`DELETE FROM est.FechaEstimacionGeneral WHERE FechaEstimacionGeneralId = @Id;`);
        if ((r2.rowsAffected[0] ?? 0) === 0) {
          throw new HttpError(404, 'not_found', 'Ventana no encontrada');
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
