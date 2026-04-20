import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getPool, mssql } from '../../../infra/db.js';
import { HttpError } from '../../../middleware/error.js';
import { authnMiddleware } from '../../../middleware/authn.js';
import { csrfMiddleware } from '../../../middleware/csrf.js';
import { requireAdmin } from '../../../middleware/requireRole.js';
import { paged, paginationQuery } from '../../../shared/pagination.js';
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

const createSchema = z.object({
  codigo: z.string().trim().min(1).max(32),
  nombre: z.string().trim().min(1).max(200),
  descripcion: z.string().trim().max(300).optional().nullable(),
  activa: z.boolean().optional().default(true),
});
const updateSchema = createSchema.partial();

const listQuerySchema = paginationQuery.extend({
  activa: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

interface Row {
  Id: number;
  Codigo: string;
  Nombre: string;
  Descripcion: string | null;
  Activa: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function toDto(r: Row) {
  return {
    id: r.Id,
    codigo: r.Codigo,
    nombre: r.Nombre,
    descripcion: r.Descripcion,
    activa: r.Activa,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

export function buildUnidadesRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get('/', validateQuery(listQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQuery<ListQuery>(req);
      const pool = await getPool();
      const offset = (q.page - 1) * q.page_size;
      const sortCol = q.sort?.startsWith('codigo') ? 'Codigo' : 'Nombre';
      const sortDir = q.sort?.endsWith(':desc') ? 'DESC' : 'ASC';

      const list = await pool
        .request()
        .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
        .input('Activa', mssql.Bit, q.activa === undefined ? null : q.activa ? 1 : 0)
        .input('Offset', mssql.Int, offset)
        .input('Limit', mssql.Int, q.page_size).query<Row>(`
          SELECT UnidadId AS Id, Codigo, Nombre, Descripcion, Activa, CreatedAt, UpdatedAt
          FROM est.Unidad
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
            AND (@Activa IS NULL OR Activa = @Activa)
          ORDER BY ${sortCol} ${sortDir}, Id ASC
          OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
        `);

      const count = await pool
        .request()
        .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
        .input('Activa', mssql.Bit, q.activa === undefined ? null : q.activa ? 1 : 0)
        .query<{ total: number }>(`
          SELECT COUNT(*) AS total FROM est.Unidad
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
            AND (@Activa IS NULL OR Activa = @Activa);
        `);

      const total = count.recordset[0]?.total ?? 0;
      res.json(paged(list.recordset.map(toDto), total, q));
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', validateParams(idParamSchema), async (req, res, next) => {
    try {
      const { id } = getParams<IdParam>(req);
      const pool = await getPool();
      const result = await pool.request().input('Id', mssql.Int, id).query<Row>(`
        SELECT UnidadId AS Id, Codigo, Nombre, Descripcion, Activa, CreatedAt, UpdatedAt
        FROM est.Unidad WHERE UnidadId = @Id;
      `);
      const row = result.recordset[0];
      if (!row) throw new HttpError(404, 'not_found', 'Unidad no encontrada');
      res.json(toDto(row));
    } catch (err) {
      next(err);
    }
  });

  r.post('/', csrfMiddleware, requireAdmin, validateBody(createSchema), async (req, res, next) => {
    try {
      const input = getBody<z.infer<typeof createSchema>>(req);
      const pool = await getPool();

      const dup = await pool
        .request()
        .input('Codigo', mssql.NVarChar(32), input.codigo)
        .query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM est.Unidad WHERE Codigo = @Codigo;`);
      if ((dup.recordset[0]?.cnt ?? 0) > 0) {
        throw new HttpError(409, 'conflict', 'Ya existe una unidad con ese codigo');
      }

      const r2 = await pool
        .request()
        .input('Codigo', mssql.NVarChar(32), input.codigo)
        .input('Nombre', mssql.NVarChar(200), input.nombre)
        .input('Descripcion', mssql.NVarChar(300), input.descripcion ?? null)
        .input('Activa', mssql.Bit, input.activa ? 1 : 0)
        .input('UserId', mssql.BigInt, req.session.userId!).query<Row>(`
          INSERT INTO est.Unidad (Codigo, Nombre, Descripcion, Activa, CreatedBy, UpdatedBy)
          OUTPUT inserted.UnidadId AS Id, inserted.Codigo, inserted.Nombre, inserted.Descripcion,
                 inserted.Activa, inserted.CreatedAt, inserted.UpdatedAt
          VALUES (@Codigo, @Nombre, @Descripcion, @Activa, @UserId, @UserId);
        `);
      res.status(201).json(toDto(r2.recordset[0]!));
    } catch (err) {
      next(err);
    }
  });

  r.put(
    '/:id',
    csrfMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    validateBody(updateSchema),
    async (req, res, next) => {
      try {
        const { id } = getParams<IdParam>(req);
        const input = getBody<z.infer<typeof updateSchema>>(req);
        const pool = await getPool();

        if (input.codigo !== undefined) {
          const dup = await pool
            .request()
            .input('Codigo', mssql.NVarChar(32), input.codigo)
            .input('Id', mssql.Int, id)
            .query<{ cnt: number }>(
              `SELECT COUNT(*) AS cnt FROM est.Unidad WHERE Codigo = @Codigo AND UnidadId <> @Id;`
            );
          if ((dup.recordset[0]?.cnt ?? 0) > 0) {
            throw new HttpError(409, 'conflict', 'Ya existe otra unidad con ese codigo');
          }
        }

        const r2 = await pool
          .request()
          .input('Id', mssql.Int, id)
          .input('Codigo', mssql.NVarChar(32), input.codigo ?? null)
          .input('Nombre', mssql.NVarChar(200), input.nombre ?? null)
          .input('Descripcion', mssql.NVarChar(300), input.descripcion === undefined ? null : input.descripcion)
          .input('Activa', mssql.Bit, input.activa === undefined ? null : input.activa ? 1 : 0)
          .input('UpdDescripcion', mssql.Bit, input.descripcion !== undefined ? 1 : 0)
          .input('UserId', mssql.BigInt, req.session.userId!).query<Row>(`
            UPDATE est.Unidad
            SET Codigo = COALESCE(@Codigo, Codigo),
                Nombre = COALESCE(@Nombre, Nombre),
                Descripcion = CASE WHEN @UpdDescripcion = 1 THEN @Descripcion ELSE Descripcion END,
                Activa = COALESCE(@Activa, Activa),
                UpdatedAt = SYSUTCDATETIME(),
                UpdatedBy = @UserId
            OUTPUT inserted.UnidadId AS Id, inserted.Codigo, inserted.Nombre, inserted.Descripcion,
                   inserted.Activa, inserted.CreatedAt, inserted.UpdatedAt
            WHERE UnidadId = @Id;
          `);
        const row = r2.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Unidad no encontrada');
        res.json(toDto(row));
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
    async (req, res, next) => {
      try {
        const { id } = getParams<IdParam>(req);
        const pool = await getPool();
        const r2 = await pool.request().input('Id', mssql.Int, id).query(`
          UPDATE est.Unidad SET Activa = 0, UpdatedAt = SYSUTCDATETIME() WHERE UnidadId = @Id;
        `);
        if ((r2.rowsAffected[0] ?? 0) === 0) throw new HttpError(404, 'not_found', 'Unidad no encontrada');
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
