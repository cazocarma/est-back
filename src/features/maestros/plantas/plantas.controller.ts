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

const Zona = z.enum(['NORTE', 'SUR']);

const createSchema = z.object({
  codigo: z.string().trim().min(1).max(32),
  nombre: z.string().trim().min(1).max(200),
  direccion: z.string().trim().max(300).optional().nullable(),
  zona: Zona.optional().nullable(),
  esExterna: z.boolean().optional().default(false),
  activa: z.boolean().optional().default(true),
});
const updateSchema = createSchema.partial();

const listQuerySchema = paginationQuery.extend({
  zona: Zona.optional(),
  activa: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  externa: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
type ListQuery = z.infer<typeof listQuerySchema>;

interface PlantaRow {
  Id: number;
  Codigo: string;
  Nombre: string;
  Direccion: string | null;
  Zona: string | null;
  EsExterna: boolean;
  Activa: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

interface PlantaDto {
  id: number;
  codigo: string;
  nombre: string;
  direccion: string | null;
  zona: string | null;
  esExterna: boolean;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(r: PlantaRow): PlantaDto {
  return {
    id: r.Id,
    codigo: r.Codigo,
    nombre: r.Nombre,
    direccion: r.Direccion,
    zona: r.Zona,
    esExterna: r.EsExterna,
    activa: r.Activa,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

export function buildPlantasRouter(): Router {
  const r = Router();
  r.use(authnMiddleware);

  r.get('/', validateQuery(listQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQuery<ListQuery>(req);
      const pool = await getPool();
      const offset = (q.page - 1) * q.page_size;

      const sortCol = (() => {
        if (!q.sort) return 'Nombre';
        const [col] = q.sort.split(':');
        if (col === 'codigo') return 'Codigo';
        if (col === 'nombre') return 'Nombre';
        if (col === 'zona') return 'Zona';
        if (col === 'activa') return 'Activa';
        return 'Nombre';
      })();
      const sortDir = q.sort?.endsWith(':desc') ? 'DESC' : 'ASC';

      const listResult = await pool
        .request()
        .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
        .input('Zona', mssql.NVarChar(20), q.zona ?? null)
        .input('Activa', mssql.Bit, q.activa === undefined ? null : q.activa ? 1 : 0)
        .input('Externa', mssql.Bit, q.externa === undefined ? null : q.externa ? 1 : 0)
        .input('Offset', mssql.Int, offset)
        .input('Limit', mssql.Int, q.page_size).query<PlantaRow>(`
          SELECT PlantaId AS Id, Codigo, Nombre, Direccion, Zona, EsExterna, Activa, CreatedAt, UpdatedAt
          FROM est.Planta
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q OR Direccion LIKE @Q)
            AND (@Zona IS NULL OR Zona = @Zona)
            AND (@Activa IS NULL OR Activa = @Activa)
            AND (@Externa IS NULL OR EsExterna = @Externa)
          ORDER BY ${sortCol} ${sortDir}, Id ASC
          OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
        `);

      const countResult = await pool
        .request()
        .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null)
        .input('Zona', mssql.NVarChar(20), q.zona ?? null)
        .input('Activa', mssql.Bit, q.activa === undefined ? null : q.activa ? 1 : 0)
        .input('Externa', mssql.Bit, q.externa === undefined ? null : q.externa ? 1 : 0)
        .query<{ total: number }>(`
          SELECT COUNT(*) AS total FROM est.Planta
          WHERE (@Q IS NULL OR Codigo LIKE @Q OR Nombre LIKE @Q OR Direccion LIKE @Q)
            AND (@Zona IS NULL OR Zona = @Zona)
            AND (@Activa IS NULL OR Activa = @Activa)
            AND (@Externa IS NULL OR EsExterna = @Externa);
        `);

      const total = countResult.recordset[0]?.total ?? 0;
      res.json(paged(listResult.recordset.map(toDto), total, q));
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', validateParams(idParamSchema), async (req, res, next) => {
    try {
      const { id } = getParams<IdParam>(req);
      const pool = await getPool();
      const result = await pool.request().input('Id', mssql.Int, id).query<PlantaRow>(`
        SELECT PlantaId AS Id, Codigo, Nombre, Direccion, Zona, EsExterna, Activa, CreatedAt, UpdatedAt
        FROM est.Planta WHERE PlantaId = @Id;
      `);
      const row = result.recordset[0];
      if (!row) throw new HttpError(404, 'not_found', 'Planta no encontrada');
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
        .query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM est.Planta WHERE Codigo = @Codigo;`);
      if ((dup.recordset[0]?.cnt ?? 0) > 0) {
        throw new HttpError(409, 'conflict', 'Ya existe una planta con ese codigo');
      }

      const r2 = await pool
        .request()
        .input('Codigo', mssql.NVarChar(32), input.codigo)
        .input('Nombre', mssql.NVarChar(200), input.nombre)
        .input('Direccion', mssql.NVarChar(300), input.direccion ?? null)
        .input('Zona', mssql.NVarChar(20), input.zona ?? null)
        .input('EsExterna', mssql.Bit, input.esExterna ? 1 : 0)
        .input('Activa', mssql.Bit, input.activa ? 1 : 0)
        .input('UserId', mssql.BigInt, req.session.userId!).query<PlantaRow>(`
          INSERT INTO est.Planta (Codigo, Nombre, Direccion, Zona, EsExterna, Activa, CreatedBy, UpdatedBy)
          OUTPUT inserted.PlantaId AS Id, inserted.Codigo, inserted.Nombre, inserted.Direccion, inserted.Zona,
                 inserted.EsExterna, inserted.Activa, inserted.CreatedAt, inserted.UpdatedAt
          VALUES (@Codigo, @Nombre, @Direccion, @Zona, @EsExterna, @Activa, @UserId, @UserId);
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
              `SELECT COUNT(*) AS cnt FROM est.Planta WHERE Codigo = @Codigo AND PlantaId <> @Id;`
            );
          if ((dup.recordset[0]?.cnt ?? 0) > 0) {
            throw new HttpError(409, 'conflict', 'Ya existe otra planta con ese codigo');
          }
        }

        const r2 = await pool
          .request()
          .input('Id', mssql.Int, id)
          .input('Codigo', mssql.NVarChar(32), input.codigo ?? null)
          .input('Nombre', mssql.NVarChar(200), input.nombre ?? null)
          .input('Direccion', mssql.NVarChar(300), input.direccion === undefined ? null : input.direccion)
          .input('Zona', mssql.NVarChar(20), input.zona === undefined ? null : input.zona)
          .input('EsExterna', mssql.Bit, input.esExterna === undefined ? null : input.esExterna ? 1 : 0)
          .input('Activa', mssql.Bit, input.activa === undefined ? null : input.activa ? 1 : 0)
          .input('UpdDireccion', mssql.Bit, input.direccion !== undefined ? 1 : 0)
          .input('UpdZona', mssql.Bit, input.zona !== undefined ? 1 : 0)
          .input('UserId', mssql.BigInt, req.session.userId!).query<PlantaRow>(`
            UPDATE est.Planta
            SET Codigo    = COALESCE(@Codigo, Codigo),
                Nombre    = COALESCE(@Nombre, Nombre),
                Direccion = CASE WHEN @UpdDireccion = 1 THEN @Direccion ELSE Direccion END,
                Zona      = CASE WHEN @UpdZona      = 1 THEN @Zona      ELSE Zona END,
                EsExterna = COALESCE(@EsExterna, EsExterna),
                Activa    = COALESCE(@Activa, Activa),
                UpdatedAt = SYSUTCDATETIME(),
                UpdatedBy = @UserId
            OUTPUT inserted.PlantaId AS Id, inserted.Codigo, inserted.Nombre, inserted.Direccion, inserted.Zona,
                   inserted.EsExterna, inserted.Activa, inserted.CreatedAt, inserted.UpdatedAt
            WHERE PlantaId = @Id;
          `);
        const row = r2.recordset[0];
        if (!row) throw new HttpError(404, 'not_found', 'Planta no encontrada');
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
          UPDATE est.Planta SET Activa = 0, UpdatedAt = SYSUTCDATETIME() WHERE PlantaId = @Id;
        `);
        if ((r2.rowsAffected[0] ?? 0) === 0) throw new HttpError(404, 'not_found', 'Planta no encontrada');
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
