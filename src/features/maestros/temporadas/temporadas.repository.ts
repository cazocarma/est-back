import { getPool, mssql } from '../../../infra/db.js';
import type { Pagination } from '../../../shared/pagination.js';
import type {
  TemporadaCreate,
  TemporadaDto,
  TemporadaListQuery,
  TemporadaUpdate,
} from './temporadas.dto.js';

interface TemporadaRow {
  TemporadaId: number;
  Anio: number;
  Prefijo: string;
  Descripcion: string | null;
  FechaInicio: Date | null;
  FechaFin: Date | null;
  Activa: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function map(r: TemporadaRow): TemporadaDto {
  return {
    id: r.TemporadaId,
    anio: r.Anio,
    prefijo: r.Prefijo,
    descripcion: r.Descripcion,
    fechaInicio: toIsoDate(r.FechaInicio),
    fechaFin: toIsoDate(r.FechaFin),
    activa: r.Activa,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

const SORT_ALLOWED = ['anio', 'prefijo', 'activa', 'createdAt', 'updatedAt'] as const;
const SORT_COL_MAP: Record<(typeof SORT_ALLOWED)[number], string> = {
  anio: 'Anio',
  prefijo: 'Prefijo',
  activa: 'Activa',
  createdAt: 'CreatedAt',
  updatedAt: 'UpdatedAt',
};

const SELECT_COLS =
  'TemporadaId, Anio, Prefijo, Descripcion, FechaInicio, FechaFin, Activa, CreatedAt, UpdatedAt';

export async function listTemporadas(
  q: TemporadaListQuery
): Promise<{ rows: TemporadaDto[]; pagination: Pagination }> {
  const pool = await getPool();
  const request = pool.request();

  const conds: string[] = ['1 = 1'];
  if (q.anio !== undefined) {
    conds.push('Anio = @Anio');
    request.input('Anio', mssql.SmallInt, q.anio);
  }
  if (q.activa !== undefined) {
    conds.push('Activa = @Activa');
    request.input('Activa', mssql.Bit, q.activa ? 1 : 0);
  }
  if (q.q) {
    conds.push('(Prefijo LIKE @Q OR Descripcion LIKE @Q)');
    request.input('Q', mssql.NVarChar, `%${q.q}%`);
  }

  const where = conds.join(' AND ');

  let sortColKey: (typeof SORT_ALLOWED)[number] = 'anio';
  let sortDir: 'ASC' | 'DESC' = 'DESC';
  if (q.sort) {
    const [col, dir] = q.sort.split(':') as [string, string | undefined];
    if ((SORT_ALLOWED as readonly string[]).includes(col)) {
      sortColKey = col as (typeof SORT_ALLOWED)[number];
      sortDir = (dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    }
  }
  const sortCol = SORT_COL_MAP[sortColKey];

  const offset = (q.page - 1) * q.page_size;
  request.input('Offset', mssql.Int, offset);
  request.input('Limit', mssql.Int, q.page_size);

  const listResult = await request.query<TemporadaRow>(`
    SELECT ${SELECT_COLS}
    FROM est.Temporada
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}, TemporadaId ${sortDir}
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
  `);

  const countResult = await pool
    .request()
    .input('Anio', mssql.SmallInt, q.anio ?? null)
    .input('Activa', mssql.Bit, q.activa === undefined ? null : q.activa ? 1 : 0)
    .input('Q', mssql.NVarChar, q.q ? `%${q.q}%` : null).query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM est.Temporada
      WHERE (@Anio   IS NULL OR Anio    = @Anio)
        AND (@Activa IS NULL OR Activa  = @Activa)
        AND (@Q      IS NULL OR Prefijo LIKE @Q OR Descripcion LIKE @Q);
    `);

  const total = countResult.recordset[0]?.total ?? 0;
  const total_pages = q.page_size > 0 ? Math.max(1, Math.ceil(total / q.page_size)) : 1;

  return {
    rows: listResult.recordset.map(map),
    pagination: {
      page: q.page,
      page_size: q.page_size,
      total,
      total_pages,
    },
  };
}

export async function getTemporada(id: number): Promise<TemporadaDto | null> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Id', mssql.Int, id)
    .query<TemporadaRow>(`
      SELECT ${SELECT_COLS}
      FROM est.Temporada WHERE TemporadaId = @Id;
    `);
  const row = r.recordset[0];
  return row ? map(row) : null;
}

export async function existsTemporadaByAnioPrefijo(
  anio: number,
  prefijo: string,
  excludeId?: number
): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Anio', mssql.SmallInt, anio)
    .input('Prefijo', mssql.NVarChar(10), prefijo)
    .input('ExcludeId', mssql.Int, excludeId ?? null).query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM est.Temporada
      WHERE Anio = @Anio AND Prefijo = @Prefijo
        AND (@ExcludeId IS NULL OR TemporadaId <> @ExcludeId);
    `);
  return (r.recordset[0]?.cnt ?? 0) > 0;
}

export async function insertTemporada(
  input: TemporadaCreate,
  userId: number
): Promise<TemporadaDto> {
  const pool = await getPool();
  const request = pool
    .request()
    .input('Anio', mssql.SmallInt, input.anio)
    .input('Prefijo', mssql.NVarChar(10), input.prefijo)
    .input('Descripcion', mssql.NVarChar(200), input.descripcion ?? null)
    .input('FechaInicio', mssql.Date, input.fechaInicio ?? null)
    .input('FechaFin', mssql.Date, input.fechaFin ?? null)
    .input('Activa', mssql.Bit, input.activa ? 1 : 0)
    .input('UserId', mssql.BigInt, userId);

  const r = await request.query<TemporadaRow>(`
    INSERT INTO est.Temporada (Anio, Prefijo, Descripcion, FechaInicio, FechaFin, Activa, CreatedBy, UpdatedBy)
    OUTPUT inserted.TemporadaId, inserted.Anio, inserted.Prefijo, inserted.Descripcion,
           inserted.FechaInicio, inserted.FechaFin, inserted.Activa,
           inserted.CreatedAt, inserted.UpdatedAt
    VALUES (@Anio, @Prefijo, @Descripcion, @FechaInicio, @FechaFin, @Activa, @UserId, @UserId);
  `);
  return map(r.recordset[0]!);
}

export async function updateTemporada(
  id: number,
  input: TemporadaUpdate,
  userId: number
): Promise<TemporadaDto | null> {
  const pool = await getPool();
  const request = pool
    .request()
    .input('Id', mssql.Int, id)
    .input('Anio', mssql.SmallInt, input.anio ?? null)
    .input('Prefijo', mssql.NVarChar(10), input.prefijo ?? null)
    .input('Descripcion', mssql.NVarChar(200), input.descripcion === undefined ? null : input.descripcion)
    .input('FechaInicio', mssql.Date, input.fechaInicio === undefined ? null : input.fechaInicio)
    .input('FechaFin', mssql.Date, input.fechaFin === undefined ? null : input.fechaFin)
    .input('Activa', mssql.Bit, input.activa === undefined ? null : input.activa ? 1 : 0)
    .input('UserId', mssql.BigInt, userId);

  const r = await request
    .input('UpdDescripcion', mssql.Bit, input.descripcion !== undefined ? 1 : 0)
    .input('UpdFechaInicio', mssql.Bit, input.fechaInicio !== undefined ? 1 : 0)
    .input('UpdFechaFin', mssql.Bit, input.fechaFin !== undefined ? 1 : 0)
    .query<TemporadaRow>(`
      UPDATE est.Temporada
      SET Anio        = COALESCE(@Anio, Anio),
          Prefijo     = COALESCE(@Prefijo, Prefijo),
          Descripcion = CASE WHEN @UpdDescripcion = 1 THEN @Descripcion ELSE Descripcion END,
          FechaInicio = CASE WHEN @UpdFechaInicio = 1 THEN @FechaInicio ELSE FechaInicio END,
          FechaFin    = CASE WHEN @UpdFechaFin    = 1 THEN @FechaFin    ELSE FechaFin END,
          Activa      = COALESCE(@Activa, Activa),
          UpdatedAt   = SYSUTCDATETIME(),
          UpdatedBy   = @UserId
      OUTPUT inserted.TemporadaId, inserted.Anio, inserted.Prefijo, inserted.Descripcion,
             inserted.FechaInicio, inserted.FechaFin, inserted.Activa,
             inserted.CreatedAt, inserted.UpdatedAt
      WHERE TemporadaId = @Id;
    `);
  const row = r.recordset[0];
  return row ? map(row) : null;
}

export async function deleteTemporada(id: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request().input('Id', mssql.Int, id).query(`
    DELETE FROM est.Temporada WHERE TemporadaId = @Id;
  `);
  return (r.rowsAffected[0] ?? 0) > 0;
}

/**
 * Activa la temporada indicada y desactiva las demas, en una transaccion.
 * El indice filtrado unico UX_est_Temporada_Activa garantiza una sola activa.
 */
export async function activarTemporada(id: number, userId: number): Promise<TemporadaDto | null> {
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await new mssql.Request(tx)
      .input('Id', mssql.Int, id)
      .input('UserId', mssql.BigInt, userId).query(`
        UPDATE est.Temporada
        SET Activa = 0, UpdatedBy = @UserId
        WHERE Activa = 1 AND TemporadaId <> @Id;
      `);
    const r = await new mssql.Request(tx)
      .input('Id', mssql.Int, id)
      .input('UserId', mssql.BigInt, userId).query<TemporadaRow>(`
        UPDATE est.Temporada
        SET Activa = 1, UpdatedBy = @UserId, UpdatedAt = SYSUTCDATETIME()
        OUTPUT inserted.TemporadaId, inserted.Anio, inserted.Prefijo, inserted.Descripcion,
               inserted.FechaInicio, inserted.FechaFin, inserted.Activa,
               inserted.CreatedAt, inserted.UpdatedAt
        WHERE TemporadaId = @Id;
      `);
    await tx.commit();
    const row = r.recordset[0];
    return row ? map(row) : null;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
