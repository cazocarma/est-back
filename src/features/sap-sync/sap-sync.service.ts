import mssql from 'mssql';
import { getPool } from '../../infra/db.js';
import { logger } from '../../config/logger.js';
import { getDefaultDestination, rfcQuery } from '../../infra/sap-etl.client.js';
import { HttpError } from '../../middleware/error.js';
import {
  ENTIDADES_ORDEN,
  type EntidadSap,
  type SyncResult,
} from './sap-sync.types.js';
import { MAPPINGS, type SapSyncMapping } from './sap-sync.mapping.js';
import { finishSyncLog, startSyncLog } from './sap-sync.repository.js';

interface MergeCounters {
  leidas: number;
  insertadas: number;
  actualizadas: number;
}

async function fetchFromSap(
  mapping: SapSyncMapping,
  destination: string,
  rowCount: number
): Promise<Record<string, string>[]> {
  const result = await rfcQuery({
    destination,
    table: mapping.sapTable,
    fields: mapping.sapFields,
    where: mapping.sapWhere,
    rowCount,
  });
  return result.records;
}

/**
 * MERGE simple (lookups sin FKs a otras tablas sap).
 * Aplica para: especie, productor, envase, manejo, centro, tipo-frio, programa.
 */
async function mergeSimpleLookup(
  mapping: SapSyncMapping,
  rows: readonly Record<string, string>[]
): Promise<MergeCounters> {
  if (rows.length === 0) return { leidas: 0, insertadas: 0, actualizadas: 0 };

  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const tempName = `#stg_${mapping.entidad.replace('-', '_')}_${Date.now()}`;
    const req = new mssql.Request(tx);

    // Crear tabla temporal con las columnas mapeadas (todas NVARCHAR de longitud razonable).
    const localCols = Object.keys(mapping.columnMap);
    const createCols = localCols
      .map((c) => `[${c}] NVARCHAR(300) NULL`)
      .join(', ');
    await req.query(`CREATE TABLE ${tempName} (${createCols});`);

    // Insert bulk via Table-Valued Parameter style (usando pool.request().bulk)
    const table = new mssql.Table(tempName);
    for (const col of localCols) {
      table.columns.add(col, mssql.NVarChar(300), { nullable: true });
    }
    for (const row of rows) {
      const r: (string | null)[] = localCols.map((local) => {
        const sapField = mapping.columnMap[local]!;
        const raw = row[sapField];
        return raw === undefined || raw === null ? null : String(raw).trim();
      });
      table.rows.add(...r);
    }
    await new mssql.Request(tx).bulk(table);

    // MERGE desde la tabla temporal al destino.
    // Para columnas booleanas (Activo), convertimos X/1/TRUE -> 1.
    const setClauses: string[] = [];
    const insertCols: string[] = [mapping.matchColumn];
    const insertVals: string[] = [`s.[${mapping.matchColumn}]`];
    for (const local of localCols) {
      if (local === mapping.matchColumn) continue;
      if (local.toLowerCase() === 'activo') {
        setClauses.push(`t.[${local}] = CASE WHEN UPPER(LTRIM(RTRIM(s.[${local}]))) IN (N'1', N'X', N'TRUE', N'Y', N'S', N'SI', N'YES') THEN 1 ELSE 0 END`);
        insertCols.push(local);
        insertVals.push(`CASE WHEN UPPER(LTRIM(RTRIM(s.[${local}]))) IN (N'1', N'X', N'TRUE', N'Y', N'S', N'SI', N'YES') THEN 1 ELSE 0 END`);
      } else {
        setClauses.push(`t.[${local}] = s.[${local}]`);
        insertCols.push(local);
        insertVals.push(`s.[${local}]`);
      }
    }
    setClauses.push(`t.SyncedAt = SYSUTCDATETIME()`);
    insertCols.push('SyncedAt');
    insertVals.push('SYSUTCDATETIME()');

    const mergeSql = `
      MERGE ${mapping.targetTable} AS t
      USING ${tempName} AS s
      ON t.[${mapping.matchColumn}] = s.[${mapping.matchColumn}]
      WHEN MATCHED THEN UPDATE SET ${setClauses.join(', ')}
      WHEN NOT MATCHED THEN INSERT (${insertCols.map((c) => `[${c}]`).join(', ')})
        VALUES (${insertVals.join(', ')})
      OUTPUT $action AS Action;
    `;
    const mergeResult = await new mssql.Request(tx).query<{ Action: string }>(mergeSql);

    let insertadas = 0;
    let actualizadas = 0;
    for (const r of mergeResult.recordset) {
      if (r.Action === 'INSERT') insertadas++;
      else if (r.Action === 'UPDATE') actualizadas++;
    }

    await new mssql.Request(tx).query(`DROP TABLE ${tempName};`);
    await tx.commit();

    return { leidas: rows.length, insertadas, actualizadas };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * MERGE para grupo-variedad: resuelve EspecieCodigoSap -> EspecieSapId via JOIN.
 */
async function mergeGrupoVariedad(
  mapping: SapSyncMapping,
  rows: readonly Record<string, string>[]
): Promise<MergeCounters> {
  if (rows.length === 0) return { leidas: 0, insertadas: 0, actualizadas: 0 };
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const tempName = `#stg_gv_${Date.now()}`;
    await new mssql.Request(tx).query(`
      CREATE TABLE ${tempName} (
        CodigoSap NVARCHAR(32) NOT NULL,
        EspecieCodigoSap NVARCHAR(32) NULL,
        Nombre NVARCHAR(200) NOT NULL,
        Activo NVARCHAR(10) NULL
      );
    `);
    const table = new mssql.Table(tempName);
    table.columns.add('CodigoSap', mssql.NVarChar(32), { nullable: false });
    table.columns.add('EspecieCodigoSap', mssql.NVarChar(32), { nullable: true });
    table.columns.add('Nombre', mssql.NVarChar(200), { nullable: false });
    table.columns.add('Activo', mssql.NVarChar(10), { nullable: true });
    for (const row of rows) {
      const cm = mapping.columnMap;
      const codigo = String(row[cm['CodigoSap']!] ?? '').trim();
      const especie = row[cm['EspecieCodigoSap']!];
      const nombre = String(row[cm['Nombre']!] ?? '').trim();
      const activo = row[cm['Activo']!];
      if (!codigo || !nombre) continue;
      table.rows.add(codigo, especie ? String(especie).trim() : null, nombre, activo ?? null);
    }
    await new mssql.Request(tx).bulk(table);

    const mergeResult = await new mssql.Request(tx).query<{ Action: string }>(`
      MERGE sap.GrupoVariedadSap AS t
      USING (
        SELECT s.CodigoSap, s.Nombre,
               CASE WHEN UPPER(LTRIM(RTRIM(s.Activo))) IN (N'1', N'X', N'TRUE', N'Y', N'S', N'SI', N'YES') THEN 1 ELSE 0 END AS Activo,
               e.EspecieSapId
        FROM ${tempName} s
        LEFT JOIN sap.EspecieSap e ON e.CodigoSap = s.EspecieCodigoSap
      ) AS s
      ON t.CodigoSap = s.CodigoSap
      WHEN MATCHED THEN UPDATE SET
        EspecieSapId = s.EspecieSapId,
        Nombre       = s.Nombre,
        Activo       = s.Activo,
        SyncedAt     = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (CodigoSap, EspecieSapId, Nombre, Activo, SyncedAt)
        VALUES (s.CodigoSap, s.EspecieSapId, s.Nombre, s.Activo, SYSUTCDATETIME())
      OUTPUT $action AS Action;
    `);

    let insertadas = 0;
    let actualizadas = 0;
    for (const r of mergeResult.recordset) {
      if (r.Action === 'INSERT') insertadas++;
      else if (r.Action === 'UPDATE') actualizadas++;
    }
    await new mssql.Request(tx).query(`DROP TABLE ${tempName};`);
    await tx.commit();
    return { leidas: rows.length, insertadas, actualizadas };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * MERGE para variedad: resuelve EspecieCodigoSap y GrupoVariedadCodigoSap.
 */
async function mergeVariedad(
  mapping: SapSyncMapping,
  rows: readonly Record<string, string>[]
): Promise<MergeCounters> {
  if (rows.length === 0) return { leidas: 0, insertadas: 0, actualizadas: 0 };
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const tempName = `#stg_v_${Date.now()}`;
    await new mssql.Request(tx).query(`
      CREATE TABLE ${tempName} (
        CodigoSap              NVARCHAR(32)  NOT NULL,
        EspecieCodigoSap       NVARCHAR(32)  NULL,
        GrupoVariedadCodigoSap NVARCHAR(32)  NULL,
        Nombre                 NVARCHAR(200) NOT NULL,
        Activo                 NVARCHAR(10)  NULL
      );
    `);
    const table = new mssql.Table(tempName);
    table.columns.add('CodigoSap', mssql.NVarChar(32), { nullable: false });
    table.columns.add('EspecieCodigoSap', mssql.NVarChar(32), { nullable: true });
    table.columns.add('GrupoVariedadCodigoSap', mssql.NVarChar(32), { nullable: true });
    table.columns.add('Nombre', mssql.NVarChar(200), { nullable: false });
    table.columns.add('Activo', mssql.NVarChar(10), { nullable: true });
    for (const row of rows) {
      const cm = mapping.columnMap;
      const codigo = String(row[cm['CodigoSap']!] ?? '').trim();
      const especie = row[cm['EspecieCodigoSap']!];
      const grupo = row[cm['GrupoVariedadCodigoSap']!];
      const nombre = String(row[cm['Nombre']!] ?? '').trim();
      const activo = row[cm['Activo']!];
      if (!codigo || !nombre) continue;
      table.rows.add(
        codigo,
        especie ? String(especie).trim() : null,
        grupo ? String(grupo).trim() : null,
        nombre,
        activo ?? null
      );
    }
    await new mssql.Request(tx).bulk(table);

    const mergeResult = await new mssql.Request(tx).query<{ Action: string }>(`
      MERGE sap.VariedadSap AS t
      USING (
        SELECT s.CodigoSap, s.Nombre,
               CASE WHEN UPPER(LTRIM(RTRIM(s.Activo))) IN (N'1', N'X', N'TRUE', N'Y', N'S', N'SI', N'YES') THEN 1 ELSE 0 END AS Activo,
               e.EspecieSapId, g.GrupoVariedadSapId
        FROM ${tempName} s
        LEFT JOIN sap.EspecieSap       e ON e.CodigoSap = s.EspecieCodigoSap
        LEFT JOIN sap.GrupoVariedadSap g ON g.CodigoSap = s.GrupoVariedadCodigoSap
      ) AS s
      ON t.CodigoSap = s.CodigoSap
      WHEN MATCHED THEN UPDATE SET
        EspecieSapId       = s.EspecieSapId,
        GrupoVariedadSapId = s.GrupoVariedadSapId,
        Nombre             = s.Nombre,
        Activo             = s.Activo,
        SyncedAt           = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (CodigoSap, EspecieSapId, GrupoVariedadSapId, Nombre, Activo, SyncedAt)
        VALUES (s.CodigoSap, s.EspecieSapId, s.GrupoVariedadSapId, s.Nombre, s.Activo, SYSUTCDATETIME())
      OUTPUT $action AS Action;
    `);

    let insertadas = 0;
    let actualizadas = 0;
    for (const r of mergeResult.recordset) {
      if (r.Action === 'INSERT') insertadas++;
      else if (r.Action === 'UPDATE') actualizadas++;
    }
    await new mssql.Request(tx).query(`DROP TABLE ${tempName};`);
    await tx.commit();
    return { leidas: rows.length, insertadas, actualizadas };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function syncEntidad(
  entidad: EntidadSap,
  usuarioId: number | null,
  origen: 'manual' | 'cron',
  destination: string,
  rowCount: number
): Promise<SyncResult> {
  const mapping = MAPPINGS[entidad];
  if (!mapping) {
    throw new HttpError(400, 'unknown_entity', `Entidad SAP desconocida: ${entidad}`);
  }

  const started = Date.now();
  const syncLogId = await startSyncLog({ entidad, origen, usuarioId });

  try {
    const rows = await fetchFromSap(mapping, destination, rowCount);
    logger.info({ entidad, filas: rows.length }, 'sap-sync: filas leidas');

    let counters: MergeCounters;
    if (entidad === 'grupo-variedad') counters = await mergeGrupoVariedad(mapping, rows);
    else if (entidad === 'variedad') counters = await mergeVariedad(mapping, rows);
    else counters = await mergeSimpleLookup(mapping, rows);

    await finishSyncLog(
      syncLogId,
      'ok',
      counters.leidas,
      counters.insertadas,
      counters.actualizadas
    );

    return {
      entidad,
      syncLogId,
      estado: 'ok',
      filasLeidas: counters.leidas,
      filasInsertadas: counters.insertadas,
      filasActualizadas: counters.actualizadas,
      duracionMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ entidad, err: message }, 'sap-sync: fallo');
    await finishSyncLog(syncLogId, 'fallo', 0, 0, 0, message);
    return {
      entidad,
      syncLogId,
      estado: 'fallo',
      filasLeidas: 0,
      filasInsertadas: 0,
      filasActualizadas: 0,
      duracionMs: Date.now() - started,
      error: message,
    };
  }
}

/**
 * Ejecuta sync para una lista de entidades respetando el orden de dependencias.
 * Si una falla, las siguientes igual se intentan (la orquestacion no aborta en cascada).
 */
export async function runSync(
  entidades: readonly EntidadSap[] | undefined,
  options: { usuarioId: number | null; origen: 'manual' | 'cron'; rowCount?: number }
): Promise<SyncResult[]> {
  const target = entidades && entidades.length > 0 ? entidades : ENTIDADES_ORDEN;

  // Reordenar segun ENTIDADES_ORDEN (especie antes que grupo antes que variedad).
  const ordenMap = new Map<EntidadSap, number>();
  ENTIDADES_ORDEN.forEach((e, i) => ordenMap.set(e, i));
  const sorted = [...target].sort((a, b) => (ordenMap.get(a) ?? 99) - (ordenMap.get(b) ?? 99));

  const destination = getDefaultDestination();
  const rowCount = options.rowCount ?? 0;

  const results: SyncResult[] = [];
  for (const entidad of sorted) {
    const r = await syncEntidad(entidad, options.usuarioId, options.origen, destination, rowCount);
    results.push(r);
  }
  return results;
}
