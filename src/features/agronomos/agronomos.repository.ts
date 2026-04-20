import mssql from 'mssql';
import { getPool } from '../../infra/db.js';
import type { Pagination } from '../../shared/pagination.js';
import type {
  AgronomoCreate,
  AgronomoDto,
  AgronomoListQuery,
  AgronomoUpdate,
  AsignacionDto,
} from './agronomos.dto.js';

interface AgronomoRow {
  AgronomoId: number;
  UsuarioId: number;
  Usuario: string;
  Nombre: string;
  Email: string | null;
  PlantaId: number | null;
  PlantaNombre: string | null;
  Activo: boolean;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function mapAgronomo(r: AgronomoRow): AgronomoDto {
  return {
    id: r.AgronomoId,
    usuarioId: r.UsuarioId,
    usuario: r.Usuario,
    nombre: r.Nombre,
    email: r.Email,
    plantaId: r.PlantaId,
    plantaNombre: r.PlantaNombre,
    activo: r.Activo,
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

const SELECT_AGRONOMO = `
  a.AgronomoId, a.UsuarioId, u.Usuario, u.Nombre, u.Email,
  a.PlantaId, p.Nombre AS PlantaNombre,
  a.Activo, a.CreatedAt, a.UpdatedAt
  FROM est.Agronomo a
  INNER JOIN est.Usuario u ON u.UsuarioId = a.UsuarioId
  LEFT JOIN est.Planta  p ON p.PlantaId  = a.PlantaId
`;

export async function listAgronomos(
  q: AgronomoListQuery
): Promise<{ rows: AgronomoDto[]; pagination: Pagination }> {
  const pool = await getPool();
  const where: string[] = ['1 = 1'];
  const listReq = pool.request();
  const countReq = pool.request();

  if (q.plantaId !== undefined) {
    where.push('a.PlantaId = @PlantaId');
    listReq.input('PlantaId', mssql.Int, q.plantaId);
    countReq.input('PlantaId', mssql.Int, q.plantaId);
  }
  if (q.activo !== undefined) {
    where.push('a.Activo = @Activo');
    listReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
    countReq.input('Activo', mssql.Bit, q.activo ? 1 : 0);
  }
  if (q.q) {
    where.push('(u.Nombre LIKE @Q OR u.Usuario LIKE @Q OR u.Email LIKE @Q)');
    listReq.input('Q', mssql.NVarChar, `%${q.q}%`);
    countReq.input('Q', mssql.NVarChar, `%${q.q}%`);
  }
  const offset = (q.page - 1) * q.page_size;
  listReq.input('Offset', mssql.Int, offset);
  listReq.input('Limit', mssql.Int, q.page_size);

  const sortCol = (() => {
    if (!q.sort) return 'u.Nombre';
    const [c] = q.sort.split(':');
    if (c === 'nombre') return 'u.Nombre';
    if (c === 'usuario') return 'u.Usuario';
    if (c === 'planta') return 'p.Nombre';
    if (c === 'activo') return 'a.Activo';
    return 'u.Nombre';
  })();
  const sortDir = q.sort?.endsWith(':desc') ? 'DESC' : 'ASC';

  const list = await listReq.query<AgronomoRow>(`
    SELECT ${SELECT_AGRONOMO}
    WHERE ${where.join(' AND ')}
    ORDER BY ${sortCol} ${sortDir}, a.AgronomoId ASC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
  `);
  const count = await countReq.query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM est.Agronomo a
    INNER JOIN est.Usuario u ON u.UsuarioId = a.UsuarioId
    LEFT JOIN est.Planta  p ON p.PlantaId  = a.PlantaId
    WHERE ${where.join(' AND ')};
  `);
  const total = count.recordset[0]?.total ?? 0;
  return {
    rows: list.recordset.map(mapAgronomo),
    pagination: {
      page: q.page,
      page_size: q.page_size,
      total,
      total_pages: q.page_size > 0 ? Math.max(1, Math.ceil(total / q.page_size)) : 1,
    },
  };
}

export async function getAgronomo(id: number): Promise<AgronomoDto | null> {
  const pool = await getPool();
  const r = await pool.request().input('Id', mssql.Int, id).query<AgronomoRow>(`
    SELECT ${SELECT_AGRONOMO} WHERE a.AgronomoId = @Id;
  `);
  const row = r.recordset[0];
  return row ? mapAgronomo(row) : null;
}

export async function getAgronomoByUsuario(usuarioId: number): Promise<AgronomoDto | null> {
  const pool = await getPool();
  const r = await pool.request().input('Id', mssql.BigInt, usuarioId).query<AgronomoRow>(`
    SELECT ${SELECT_AGRONOMO} WHERE a.UsuarioId = @Id;
  `);
  const row = r.recordset[0];
  return row ? mapAgronomo(row) : null;
}

export async function insertAgronomo(
  input: AgronomoCreate,
  creadorId: number
): Promise<AgronomoDto> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('UsuarioId', mssql.BigInt, input.usuarioId)
    .input('PlantaId', mssql.Int, input.plantaId ?? null)
    .input('Activo', mssql.Bit, input.activo ? 1 : 0)
    .input('Creador', mssql.BigInt, creadorId).query<{ AgronomoId: number }>(`
      INSERT INTO est.Agronomo (UsuarioId, PlantaId, Activo, CreatedBy, UpdatedBy)
      OUTPUT inserted.AgronomoId
      VALUES (@UsuarioId, @PlantaId, @Activo, @Creador, @Creador);
    `);
  const id = r.recordset[0]!.AgronomoId;
  return (await getAgronomo(id))!;
}

export async function updateAgronomo(
  id: number,
  input: AgronomoUpdate,
  editorId: number
): Promise<AgronomoDto | null> {
  const pool = await getPool();
  await pool
    .request()
    .input('Id', mssql.Int, id)
    .input('PlantaId', mssql.Int, input.plantaId === undefined ? null : input.plantaId)
    .input('Activo', mssql.Bit, input.activo === undefined ? null : input.activo ? 1 : 0)
    .input('UpdPlanta', mssql.Bit, input.plantaId !== undefined ? 1 : 0)
    .input('Editor', mssql.BigInt, editorId).query(`
      UPDATE est.Agronomo
      SET PlantaId  = CASE WHEN @UpdPlanta = 1 THEN @PlantaId ELSE PlantaId END,
          Activo    = COALESCE(@Activo, Activo),
          UpdatedBy = @Editor,
          UpdatedAt = SYSUTCDATETIME()
      WHERE AgronomoId = @Id;
    `);
  return getAgronomo(id);
}

export async function deactivateAgronomo(id: number, editorId: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Id', mssql.Int, id)
    .input('Editor', mssql.BigInt, editorId).query(`
      UPDATE est.Agronomo
      SET Activo = 0, UpdatedBy = @Editor, UpdatedAt = SYSUTCDATETIME()
      WHERE AgronomoId = @Id;
    `);
  return (r.rowsAffected[0] ?? 0) > 0;
}

// ---------------- Asignaciones ----------------

interface AsignacionRow {
  AgronomoProductorVariedadId: number;
  AgronomoId: number;
  ProductorVariedadSapId: number;
  ProductorCodigoSap: string | null;
  ProductorNombre: string | null;
  VariedadCodigoSap: string | null;
  VariedadNombre: string | null;
  CuartelCodigo: string | null;
  TemporadaId: number;
  TemporadaAnio: number;
  TemporadaPrefijo: string;
  CreatedAt: Date;
}

function mapAsignacion(r: AsignacionRow): AsignacionDto {
  return {
    id: r.AgronomoProductorVariedadId,
    agronomoId: r.AgronomoId,
    productorVariedadSapId: r.ProductorVariedadSapId,
    productorCodigoSap: r.ProductorCodigoSap,
    productorNombre: r.ProductorNombre,
    variedadCodigoSap: r.VariedadCodigoSap,
    variedadNombre: r.VariedadNombre,
    cuartelCodigo: r.CuartelCodigo,
    temporadaId: r.TemporadaId,
    temporadaAnio: r.TemporadaAnio,
    temporadaPrefijo: r.TemporadaPrefijo,
    createdAt: r.CreatedAt.toISOString(),
  };
}

const SELECT_ASIGNACION = `
  apv.AgronomoProductorVariedadId, apv.AgronomoId, apv.ProductorVariedadSapId,
  p.CodigoSap AS ProductorCodigoSap, p.Nombre AS ProductorNombre,
  v.CodigoSap AS VariedadCodigoSap,  v.Nombre AS VariedadNombre,
  pv.CuartelCodigo,
  apv.TemporadaId, t.Anio AS TemporadaAnio, t.Prefijo AS TemporadaPrefijo,
  apv.CreatedAt
  FROM est.AgronomoProductorVariedad apv
  INNER JOIN sap.ProductorVariedadSap pv ON pv.ProductorVariedadSapId = apv.ProductorVariedadSapId
  INNER JOIN sap.ProductorSap         p  ON p.ProductorSapId          = pv.ProductorSapId
  INNER JOIN sap.VariedadSap          v  ON v.VariedadSapId           = pv.VariedadSapId
  INNER JOIN est.Temporada            t  ON t.TemporadaId             = apv.TemporadaId
`;

export async function listAsignacionesAgronomo(
  agronomoId: number,
  temporadaId: number | null
): Promise<AsignacionDto[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('AgronomoId', mssql.Int, agronomoId)
    .input('TemporadaId', mssql.Int, temporadaId).query<AsignacionRow>(`
      SELECT ${SELECT_ASIGNACION}
      WHERE apv.AgronomoId = @AgronomoId
        AND (@TemporadaId IS NULL OR apv.TemporadaId = @TemporadaId)
      ORDER BY t.Anio DESC, p.Nombre ASC, v.Nombre ASC;
    `);
  return r.recordset.map(mapAsignacion);
}

/**
 * Upsert bulk: inserta las combinaciones que aun no existen para
 * (agronomo, temporada). Retorna la cantidad efectivamente insertada.
 */
export async function bulkAsignar(
  agronomoId: number,
  temporadaId: number,
  productorVariedadIds: readonly number[],
  creadorId: number
): Promise<number> {
  if (productorVariedadIds.length === 0) return 0;
  const pool = await getPool();

  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const tempName = `#stg_apv_${Date.now()}`;
    await new mssql.Request(tx).query(`
      CREATE TABLE ${tempName} (ProductorVariedadSapId BIGINT NOT NULL PRIMARY KEY);
    `);
    const table = new mssql.Table(tempName);
    table.columns.add('ProductorVariedadSapId', mssql.BigInt, { nullable: false });
    for (const id of productorVariedadIds) table.rows.add(id);
    await new mssql.Request(tx).bulk(table);

    const r = await new mssql.Request(tx)
      .input('AgronomoId', mssql.Int, agronomoId)
      .input('TemporadaId', mssql.Int, temporadaId)
      .input('Creador', mssql.BigInt, creadorId).query<{ Inserted: number }>(`
        INSERT INTO est.AgronomoProductorVariedad (AgronomoId, ProductorVariedadSapId, TemporadaId, CreatedBy)
        SELECT @AgronomoId, s.ProductorVariedadSapId, @TemporadaId, @Creador
        FROM ${tempName} s
        WHERE NOT EXISTS (
          SELECT 1 FROM est.AgronomoProductorVariedad t
          WHERE t.AgronomoId = @AgronomoId
            AND t.ProductorVariedadSapId = s.ProductorVariedadSapId
            AND t.TemporadaId = @TemporadaId
        );
        SELECT @@ROWCOUNT AS Inserted;
      `);
    await new mssql.Request(tx).query(`DROP TABLE ${tempName};`);
    await tx.commit();
    return r.recordset[0]?.Inserted ?? 0;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function deleteAsignacion(
  agronomoId: number,
  asignacionId: number
): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('AgronomoId', mssql.Int, agronomoId)
    .input('Id', mssql.BigInt, asignacionId).query(`
      DELETE FROM est.AgronomoProductorVariedad
      WHERE AgronomoId = @AgronomoId AND AgronomoProductorVariedadId = @Id;
    `);
  return (r.rowsAffected[0] ?? 0) > 0;
}
