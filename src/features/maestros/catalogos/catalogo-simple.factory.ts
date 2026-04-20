/**
 * Factory para catalogos pequenos con shape
 * (<Tabla>Id, Codigo, Nombre, Orden, Activo, CreatedAt, UpdatedAt).
 * La columna PK se llama `<Tabla>Id` por convencion; el factory la deriva del
 * nombre de la tabla (e.g. 'est.Condicion' → 'CondicionId').
 *
 * Endpoints:
 *   GET    /        — listado paginado con ?q=&activo=&sort=
 *   GET    /:id
 *   POST   /
 *   PUT    /:id
 *   DELETE /:id     — soft delete (Activo = 0)
 */
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

export interface CatalogoSimpleConfig {
  /** Schema.tabla, ej. 'est.Condicion' (el factory deriva la columna PK como `CondicionId`). */
  table: string;
  codigoMaxLen?: number;
  nombreMaxLen?: number;
}

interface CatalogoRow {
  Id: number;
  Codigo: string;
  Nombre: string;
  Orden: number;
  Activo: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

interface CatalogoDto {
  id: number;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(r: CatalogoRow): CatalogoDto {
  return {
    id: r.Id,
    codigo: r.Codigo,
    nombre: r.Nombre,
    orden: r.Orden,
    activo: r.Activo,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

/** Deriva la columna PK de una referencia 'schema.Tabla' segun la convencion '<Tabla>Id'. */
function derivePkColumn(table: string): string {
  const parts = table.split('.');
  const tableName = parts[parts.length - 1];
  if (!tableName) throw new Error(`table invalido: ${table}`);
  return `${tableName}Id`;
}

export function buildCatalogoSimpleRouter(cfg: CatalogoSimpleConfig): Router {
  const { table } = cfg;
  const pk = derivePkColumn(table);
  const codigoMax = cfg.codigoMaxLen ?? 32;
  const nombreMax = cfg.nombreMaxLen ?? 120;

  const createSchema = z.object({
    codigo: z.string().trim().min(1).max(codigoMax),
    nombre: z.string().trim().min(1).max(nombreMax),
    orden: z.number().int().min(0).max(10_000).optional().default(0),
    activo: z.boolean().optional().default(true),
  });
  const updateSchema = createSchema.partial();

  const listQuerySchema = paginationQuery.extend({
    activo: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  });
  type ListQuery = z.infer<typeof listQuerySchema>;

  // Alias de la PK como `Id` en todos los SELECT/OUTPUT para mantener un row interface comun.
  const pkAsId = `${pk} AS Id`;

  const r = Router();
  r.use(authnMiddleware);

  r.get(
    '/',
    validateQuery(listQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = getQuery<ListQuery>(req);
        const pool = await getPool();
        const offset = (q.page - 1) * q.page_size;

        const sortCol = (() => {
          if (!q.sort) return 'Orden';
          const [col] = q.sort.split(':');
          if (col === 'codigo') return 'Codigo';
          if (col === 'nombre') return 'Nombre';
          if (col === 'orden') return 'Orden';
          if (col === 'activo') return 'Activo';
          if (col === 'createdAt') return 'CreatedAt';
          if (col === 'updatedAt') return 'UpdatedAt';
          return 'Orden';
        })();
        const sortDir = q.sort?.endsWith(':desc') ? 'DESC' : 'ASC';

        const listResult = await pool
          .request()
          .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
          .input('Activo', mssql.Bit, q.activo === undefined ? null : q.activo ? 1 : 0)
          .input('Offset', mssql.Int, offset)
          .input('Limit', mssql.Int, q.page_size).query<CatalogoRow>(`
            SELECT ${pkAsId}, Codigo, Nombre, Orden, Activo, CreatedAt, UpdatedAt
            FROM ${table}
            WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
              AND (@Activo IS NULL OR Activo = @Activo)
            ORDER BY ${sortCol} ${sortDir}, ${pk} ASC
            OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
          `);

        const countResult = await pool
          .request()
          .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
          .input('Activo', mssql.Bit, q.activo === undefined ? null : q.activo ? 1 : 0).query<{
          total: number;
        }>(`
            SELECT COUNT(*) AS total FROM ${table}
            WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q)
              AND (@Activo IS NULL OR Activo = @Activo);
          `);

        const total = countResult.recordset[0]?.total ?? 0;
        res.json(paged(listResult.recordset.map(toDto), total, q));
      } catch (err) {
        next(err);
      }
    }
  );

  r.get(
    '/:id',
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const pool = await getPool();
        const result = await pool
          .request()
          .input('Id', mssql.Int, id).query<CatalogoRow>(`
            SELECT ${pkAsId}, Codigo, Nombre, Orden, Activo, CreatedAt, UpdatedAt
            FROM ${table} WHERE ${pk} = @Id;
          `);
        const row = result.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Registro no encontrado');
        res.json(toDto(row));
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
        const pool = await getPool();

        const dup = await pool
          .request()
          .input('Codigo', mssql.NVarChar(codigoMax), input.codigo).query<{ cnt: number }>(`
            SELECT COUNT(*) AS cnt FROM ${table} WHERE Codigo = @Codigo;
          `);
        if ((dup.recordset[0]?.cnt ?? 0) > 0) {
          throw new HttpError(409, 'conflict', 'Ya existe un registro con ese codigo');
        }

        const r2 = await pool
          .request()
          .input('Codigo', mssql.NVarChar(codigoMax), input.codigo)
          .input('Nombre', mssql.NVarChar(nombreMax), input.nombre)
          .input('Orden', mssql.Int, input.orden ?? 0)
          .input('Activo', mssql.Bit, input.activo ? 1 : 0).query<CatalogoRow>(`
            INSERT INTO ${table} (Codigo, Nombre, Orden, Activo)
            OUTPUT inserted.${pk} AS Id, inserted.Codigo, inserted.Nombre, inserted.Orden,
                   inserted.Activo, inserted.CreatedAt, inserted.UpdatedAt
            VALUES (@Codigo, @Nombre, @Orden, @Activo);
          `);
        res.status(201).json(toDto(r2.recordset[0]!));
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

        if (input.codigo !== undefined) {
          const dup = await pool
            .request()
            .input('Codigo', mssql.NVarChar(codigoMax), input.codigo)
            .input('Id', mssql.Int, id).query<{ cnt: number }>(`
              SELECT COUNT(*) AS cnt FROM ${table} WHERE Codigo = @Codigo AND ${pk} <> @Id;
            `);
          if ((dup.recordset[0]?.cnt ?? 0) > 0) {
            throw new HttpError(409, 'conflict', 'Ya existe otro registro con ese codigo');
          }
        }

        const r2 = await pool
          .request()
          .input('Id', mssql.Int, id)
          .input('Codigo', mssql.NVarChar(codigoMax), input.codigo ?? null)
          .input('Nombre', mssql.NVarChar(nombreMax), input.nombre ?? null)
          .input('Orden', mssql.Int, input.orden ?? null)
          .input('Activo', mssql.Bit, input.activo === undefined ? null : input.activo ? 1 : 0)
          .query<CatalogoRow>(`
            UPDATE ${table}
            SET Codigo = COALESCE(@Codigo, Codigo),
                Nombre = COALESCE(@Nombre, Nombre),
                Orden  = COALESCE(@Orden,  Orden),
                Activo = COALESCE(@Activo, Activo),
                UpdatedAt = SYSUTCDATETIME()
            OUTPUT inserted.${pk} AS Id, inserted.Codigo, inserted.Nombre, inserted.Orden,
                   inserted.Activo, inserted.CreatedAt, inserted.UpdatedAt
            WHERE ${pk} = @Id;
          `);
        const row = r2.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Registro no encontrado');
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
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = getParams<IdParam>(req);
        const pool = await getPool();
        const r2 = await pool.request().input('Id', mssql.Int, id).query(`
          UPDATE ${table} SET Activo = 0, UpdatedAt = SYSUTCDATETIME() WHERE ${pk} = @Id;
        `);
        if ((r2.rowsAffected[0] ?? 0) === 0) {
          throw new HttpError(404, 'not_found', 'Registro no encontrado');
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
