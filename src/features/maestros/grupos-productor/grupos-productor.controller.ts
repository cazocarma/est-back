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
  activo: z.boolean().optional().default(true),
});
const updateSchema = createSchema.partial();

const listQuerySchema = paginationQuery.extend({
  activo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

interface Row {
  Id: number;
  Codigo: string;
  Nombre: string;
  Activo: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

const toDto = (r: Row) => ({
  id: r.Id,
  codigo: r.Codigo,
  nombre: r.Nombre,
  activo: r.Activo,
  createdAt: r.CreatedAt.toISOString(),
  updatedAt: r.UpdatedAt.toISOString(),
});

export function buildGruposProductorRouter(): Router {
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
        .input('Activo', mssql.Bit, q.activo === undefined ? null : q.activo ? 1 : 0)
        .input('Offset', mssql.Int, offset)
        .input('Limit', mssql.Int, q.page_size).query<Row>(`
          SELECT GrupoProductorId AS Id, Codigo, Nombre, Activo, CreatedAt, UpdatedAt
          FROM est.GrupoProductor
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
            AND (@Activo IS NULL OR Activo = @Activo)
          ORDER BY ${sortCol} ${sortDir}, Id ASC
          OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
        `);

      const count = await pool
        .request()
        .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
        .input('Activo', mssql.Bit, q.activo === undefined ? null : q.activo ? 1 : 0)
        .query<{ total: number }>(`
          SELECT COUNT(*) AS total FROM est.GrupoProductor
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
            AND (@Activo IS NULL OR Activo = @Activo);
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
        SELECT GrupoProductorId AS Id, Codigo, Nombre, Activo, CreatedAt, UpdatedAt
        FROM est.GrupoProductor WHERE GrupoProductorId = @Id;
      `);
      const row = result.recordset[0];
      if (!row) throw new HttpError(404, 'not_found', 'Grupo no encontrado');
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
        .query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM est.GrupoProductor WHERE Codigo = @Codigo;`
        );
      if ((dup.recordset[0]?.cnt ?? 0) > 0)
        throw new HttpError(409, 'conflict', 'Ya existe un grupo con ese codigo');

      const r2 = await pool
        .request()
        .input('Codigo', mssql.NVarChar(32), input.codigo)
        .input('Nombre', mssql.NVarChar(200), input.nombre)
        .input('Activo', mssql.Bit, input.activo ? 1 : 0)
        .input('UserId', mssql.BigInt, req.session.userId!).query<Row>(`
          INSERT INTO est.GrupoProductor (Codigo, Nombre, Activo, CreatedBy, UpdatedBy)
          OUTPUT inserted.GrupoProductorId AS Id, inserted.Codigo, inserted.Nombre, inserted.Activo, inserted.CreatedAt, inserted.UpdatedAt
          VALUES (@Codigo, @Nombre, @Activo, @UserId, @UserId);
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
              `SELECT COUNT(*) AS cnt FROM est.GrupoProductor WHERE Codigo = @Codigo AND GrupoProductorId <> @Id;`
            );
          if ((dup.recordset[0]?.cnt ?? 0) > 0)
            throw new HttpError(409, 'conflict', 'Ya existe otro grupo con ese codigo');
        }

        const r2 = await pool
          .request()
          .input('Id', mssql.Int, id)
          .input('Codigo', mssql.NVarChar(32), input.codigo ?? null)
          .input('Nombre', mssql.NVarChar(200), input.nombre ?? null)
          .input('Activo', mssql.Bit, input.activo === undefined ? null : input.activo ? 1 : 0)
          .input('UserId', mssql.BigInt, req.session.userId!).query<Row>(`
            UPDATE est.GrupoProductor
            SET Codigo = COALESCE(@Codigo, Codigo),
                Nombre = COALESCE(@Nombre, Nombre),
                Activo = COALESCE(@Activo, Activo),
                UpdatedAt = SYSUTCDATETIME(),
                UpdatedBy = @UserId
            OUTPUT inserted.GrupoProductorId AS Id, inserted.Codigo, inserted.Nombre, inserted.Activo, inserted.CreatedAt, inserted.UpdatedAt
            WHERE GrupoProductorId = @Id;
          `);
        const row = r2.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Grupo no encontrado');
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
          UPDATE est.GrupoProductor SET Activo = 0, UpdatedAt = SYSUTCDATETIME() WHERE GrupoProductorId = @Id;
        `);
        if ((r2.rowsAffected[0] ?? 0) === 0)
          throw new HttpError(404, 'not_found', 'Grupo no encontrado');
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
