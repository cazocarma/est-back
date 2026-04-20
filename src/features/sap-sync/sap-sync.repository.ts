import mssql from 'mssql';
import { getPool } from '../../infra/db.js';
import type { EntidadSap } from './sap-sync.types.js';

export interface SyncLogStart {
  entidad: EntidadSap;
  origen: 'manual' | 'cron';
  usuarioId: number | null;
}

export interface SyncLogRow {
  SyncLogId: number;
  Entidad: string;
  FechaInicio: Date;
  FechaFin: Date | null;
  Estado: string;
  FilasLeidas: number;
  FilasInsertadas: number;
  FilasActualizadas: number;
  Error: string | null;
  DisparadoPorUsuarioId: number | null;
  Origen: string;
}

export interface SyncLogDto {
  id: number;
  entidad: string;
  fechaInicio: string;
  fechaFin: string | null;
  estado: string;
  filasLeidas: number;
  filasInsertadas: number;
  filasActualizadas: number;
  error: string | null;
  origen: string;
  usuarioId: number | null;
}

export function mapSyncLog(r: SyncLogRow): SyncLogDto {
  return {
    id: r.SyncLogId,
    entidad: r.Entidad,
    fechaInicio: r.FechaInicio.toISOString(),
    fechaFin: r.FechaFin ? r.FechaFin.toISOString() : null,
    estado: r.Estado,
    filasLeidas: r.FilasLeidas,
    filasInsertadas: r.FilasInsertadas,
    filasActualizadas: r.FilasActualizadas,
    error: r.Error,
    origen: r.Origen,
    usuarioId: r.DisparadoPorUsuarioId,
  };
}

export async function startSyncLog(input: SyncLogStart): Promise<number> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Entidad', mssql.NVarChar(64), input.entidad)
    .input('Origen', mssql.NVarChar(16), input.origen)
    .input('UsuarioId', mssql.BigInt, input.usuarioId).query<{ SyncLogId: number }>(`
      INSERT INTO sap.SyncLog (Entidad, Origen, DisparadoPorUsuarioId, Estado)
      OUTPUT inserted.SyncLogId
      VALUES (@Entidad, @Origen, @UsuarioId, N'corriendo');
    `);
  return r.recordset[0]!.SyncLogId;
}

export async function finishSyncLog(
  syncLogId: number,
  estado: 'ok' | 'fallo' | 'cancelado',
  filasLeidas: number,
  filasInsertadas: number,
  filasActualizadas: number,
  errorMsg?: string
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('Id', mssql.BigInt, syncLogId)
    .input('Estado', mssql.NVarChar(16), estado)
    .input('Leidas', mssql.Int, filasLeidas)
    .input('Insertadas', mssql.Int, filasInsertadas)
    .input('Actualizadas', mssql.Int, filasActualizadas)
    .input('Error', mssql.NVarChar(mssql.MAX), errorMsg ?? null).query(`
      UPDATE sap.SyncLog
      SET Estado            = @Estado,
          FechaFin          = SYSUTCDATETIME(),
          FilasLeidas       = @Leidas,
          FilasInsertadas   = @Insertadas,
          FilasActualizadas = @Actualizadas,
          Error             = @Error
      WHERE SyncLogId = @Id;
    `);
}

export interface SyncEstadoRow {
  entidad: string;
  ultimaSync: string | null;
  ultimoEstado: string | null;
  totalFilas: number;
}

/**
 * Resumen por entidad: ultima ejecucion + total de filas vigentes.
 */
export async function listSyncEstado(): Promise<SyncEstadoRow[]> {
  const pool = await getPool();
  const r = await pool.request().query<{
    Entidad: string;
    UltimaSync: Date | null;
    UltimoEstado: string | null;
    TotalFilas: number;
  }>(`
    WITH UltimoLog AS (
      SELECT Entidad, Estado, FechaFin,
             ROW_NUMBER() OVER (PARTITION BY Entidad ORDER BY FechaInicio DESC) AS rn
      FROM sap.SyncLog
    )
    SELECT e.Entidad,
           ul.FechaFin  AS UltimaSync,
           ul.Estado    AS UltimoEstado,
           e.Total      AS TotalFilas
    FROM (
      SELECT N'especie'         AS Entidad, COUNT(*) AS Total FROM sap.EspecieSap
      UNION ALL SELECT N'grupo-variedad', COUNT(*) FROM sap.GrupoVariedadSap
      UNION ALL SELECT N'variedad',       COUNT(*) FROM sap.VariedadSap
      UNION ALL SELECT N'productor',      COUNT(*) FROM sap.ProductorSap
      UNION ALL SELECT N'envase',         COUNT(*) FROM sap.EnvaseSap
      UNION ALL SELECT N'manejo',         COUNT(*) FROM sap.ManejoSap
      UNION ALL SELECT N'centro',         COUNT(*) FROM sap.CentroSap
      UNION ALL SELECT N'tipo-frio',      COUNT(*) FROM sap.TipoFrioSap
      UNION ALL SELECT N'programa',       COUNT(*) FROM sap.ProgramaSap
    ) e
    LEFT JOIN UltimoLog ul ON ul.Entidad = e.Entidad AND ul.rn = 1
    ORDER BY e.Entidad;
  `);
  return r.recordset.map((row) => ({
    entidad: row.Entidad,
    ultimaSync: row.UltimaSync ? row.UltimaSync.toISOString() : null,
    ultimoEstado: row.UltimoEstado,
    totalFilas: row.TotalFilas,
  }));
}

export async function listSyncLogs(limit: number): Promise<SyncLogDto[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Limit', mssql.Int, limit).query<SyncLogRow>(`
      SELECT TOP (@Limit) SyncLogId, Entidad, FechaInicio, FechaFin, Estado,
             FilasLeidas, FilasInsertadas, FilasActualizadas, Error,
             DisparadoPorUsuarioId, Origen
      FROM sap.SyncLog
      ORDER BY FechaInicio DESC;
    `);
  return r.recordset.map(mapSyncLog);
}
