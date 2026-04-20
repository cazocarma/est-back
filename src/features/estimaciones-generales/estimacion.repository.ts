import mssql from 'mssql';
import { getPool } from '../../infra/db.js';
import type { Pagination } from '../../shared/pagination.js';
import type {
  ControlVersionDto,
  EstimacionCreate,
  EstimacionDetalleDto,
  EstimacionListQuery,
  EstimacionResumenDto,
  EstimacionUpdate,
} from './estimacion.dto.js';

// -------------------- ControlVersion --------------------

interface CvRow {
  Id: number;
  TemporadaId: number;
  TemporadaAnio: number;
  TemporadaPrefijo: string;
  EspecieSapId: number;
  EspecieCodigoSap: string;
  EspecieNombre: string;
  NumeroVersion: number;
  Estado: 'Abierta' | 'Cerrada' | 'Anulada';
  FechaApertura: Date;
  FechaCierre: Date | null;
  Comentario: string | null;
  TotalEstimaciones: number;
}

function mapCv(r: CvRow): ControlVersionDto {
  return {
    id: r.Id,
    temporadaId: r.TemporadaId,
    temporadaAnio: r.TemporadaAnio,
    temporadaPrefijo: r.TemporadaPrefijo,
    especieSapId: r.EspecieSapId,
    especieCodigoSap: r.EspecieCodigoSap,
    especieNombre: r.EspecieNombre,
    numeroVersion: r.NumeroVersion,
    estado: r.Estado,
    fechaApertura: r.FechaApertura.toISOString(),
    fechaCierre: r.FechaCierre ? r.FechaCierre.toISOString() : null,
    comentario: r.Comentario,
    totalEstimaciones: r.TotalEstimaciones,
  };
}

const SELECT_CV = `
  cv.EstimacionControlVersionId AS Id,
  cv.TemporadaId, t.Anio AS TemporadaAnio, t.Prefijo AS TemporadaPrefijo,
  cv.EspecieSapId, e.CodigoSap AS EspecieCodigoSap, e.Nombre AS EspecieNombre,
  cv.NumeroVersion, cv.Estado, cv.FechaApertura, cv.FechaCierre, cv.Comentario,
  (SELECT COUNT(*) FROM est.Estimacion est WHERE est.EstimacionControlVersionId = cv.EstimacionControlVersionId) AS TotalEstimaciones
  FROM est.EstimacionControlVersion cv
  INNER JOIN est.Temporada  t ON t.TemporadaId  = cv.TemporadaId
  INNER JOIN sap.EspecieSap e ON e.EspecieSapId = cv.EspecieSapId
`;

export async function listControlVersions(
  temporadaId: number | null,
  especieId: number | null
): Promise<ControlVersionDto[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('TemporadaId', mssql.Int, temporadaId)
    .input('EspecieId', mssql.BigInt, especieId).query<CvRow>(`
      SELECT ${SELECT_CV}
      WHERE (@TemporadaId IS NULL OR cv.TemporadaId  = @TemporadaId)
        AND (@EspecieId   IS NULL OR cv.EspecieSapId = @EspecieId)
      ORDER BY t.Anio DESC, e.Nombre ASC, cv.NumeroVersion DESC;
    `);
  return r.recordset.map(mapCv);
}

export async function getControlVersion(id: number): Promise<ControlVersionDto | null> {
  const pool = await getPool();
  const r = await pool.request().input('Id', mssql.Int, id).query<CvRow>(`
    SELECT ${SELECT_CV} WHERE cv.EstimacionControlVersionId = @Id;
  `);
  return r.recordset[0] ? mapCv(r.recordset[0]) : null;
}

export async function getControlVersionAbierta(
  temporadaId: number,
  especieSapId: number
): Promise<ControlVersionDto | null> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('TemporadaId', mssql.Int, temporadaId)
    .input('EspecieId', mssql.BigInt, especieSapId).query<CvRow>(`
      SELECT ${SELECT_CV}
      WHERE cv.TemporadaId = @TemporadaId AND cv.EspecieSapId = @EspecieId AND cv.Estado = N'Abierta';
    `);
  return r.recordset[0] ? mapCv(r.recordset[0]) : null;
}

export async function insertControlVersion(
  temporadaId: number,
  especieSapId: number,
  comentario: string | null,
  usuarioId: number
): Promise<ControlVersionDto> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('TemporadaId', mssql.Int, temporadaId)
    .input('EspecieId', mssql.BigInt, especieSapId)
    .input('Comentario', mssql.NVarChar(500), comentario)
    .input('UserId', mssql.BigInt, usuarioId).query<{ Id: number }>(`
      INSERT INTO est.EstimacionControlVersion
        (TemporadaId, EspecieSapId, NumeroVersion, Estado, Comentario, CreatedBy, UpdatedBy)
      OUTPUT inserted.EstimacionControlVersionId AS Id
      VALUES (@TemporadaId, @EspecieId, 1, N'Abierta', @Comentario, @UserId, @UserId);
    `);
  return (await getControlVersion(r.recordset[0]!.Id))!;
}

export async function cerrarControlVersion(
  controlVersionId: number,
  comentario: string | null,
  usuarioId: number
): Promise<{ nuevaVersionId: number }> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('ControlVersionId', mssql.Int, controlVersionId)
    .input('UsuarioId', mssql.BigInt, usuarioId)
    .input('Comentario', mssql.NVarChar(500), comentario)
    .output('NuevaVersionId', mssql.Int)
    .execute('est.sp_CerrarControlVersion');
  const nuevaVersionId = (r.output as { NuevaVersionId: number }).NuevaVersionId;
  return { nuevaVersionId };
}

// -------------------- Estimacion --------------------

interface EstRow {
  Id: number;
  ControlVersionId: number;
  NumeroVersion: number;
  TemporadaAnio: number;
  TemporadaPrefijo: string;
  EspecieNombre: string;
  AgronomoId: number;
  AgronomoNombre: string;
  ProductorVariedadSapId: number;
  ProductorNombre: string;
  VariedadNombre: string;
  CuartelCodigo: string | null;
  ManejoSapId: number | null;
  ManejoNombre: string | null;
  Folio: string | null;
  KilosTotales: number;
  CreatedAt: Date;
  UpdatedAt: Date;
}

function mapEst(r: EstRow): EstimacionResumenDto {
  return {
    id: r.Id,
    controlVersionId: r.ControlVersionId,
    numeroVersion: r.NumeroVersion,
    temporadaAnio: r.TemporadaAnio,
    temporadaPrefijo: r.TemporadaPrefijo,
    especieNombre: r.EspecieNombre,
    agronomoId: r.AgronomoId,
    agronomoNombre: r.AgronomoNombre,
    productorVariedadSapId: r.ProductorVariedadSapId,
    productorNombre: r.ProductorNombre,
    variedadNombre: r.VariedadNombre,
    cuartelCodigo: r.CuartelCodigo,
    manejoSapId: r.ManejoSapId,
    manejoNombre: r.ManejoNombre,
    folio: r.Folio,
    kilosTotales: Number(r.KilosTotales ?? 0),
    createdAt: r.CreatedAt.toISOString(),
    updatedAt: r.UpdatedAt.toISOString(),
  };
}

const SELECT_EST = `
  e.EstimacionId AS Id,
  e.EstimacionControlVersionId AS ControlVersionId,
  cv.NumeroVersion,
  t.Anio AS TemporadaAnio, t.Prefijo AS TemporadaPrefijo,
  esp.Nombre AS EspecieNombre,
  e.AgronomoId, u.Nombre AS AgronomoNombre,
  e.ProductorVariedadSapId, p.Nombre AS ProductorNombre, v.Nombre AS VariedadNombre,
  pv.CuartelCodigo, e.ManejoSapId, m.Nombre AS ManejoNombre, e.Folio,
  COALESCE(vol.Kilos, 0) AS KilosTotales,
  e.CreatedAt, e.UpdatedAt
  FROM est.Estimacion e
  INNER JOIN est.EstimacionControlVersion cv ON cv.EstimacionControlVersionId = e.EstimacionControlVersionId
  INNER JOIN est.Temporada   t  ON t.TemporadaId  = cv.TemporadaId
  INNER JOIN sap.EspecieSap  esp ON esp.EspecieSapId = cv.EspecieSapId
  INNER JOIN est.Agronomo    a  ON a.AgronomoId = e.AgronomoId
  INNER JOIN est.Usuario     u  ON u.UsuarioId  = a.UsuarioId
  INNER JOIN sap.ProductorVariedadSap pv ON pv.ProductorVariedadSapId = e.ProductorVariedadSapId
  INNER JOIN sap.ProductorSap p ON p.ProductorSapId = pv.ProductorSapId
  INNER JOIN sap.VariedadSap  v ON v.VariedadSapId  = pv.VariedadSapId
  LEFT  JOIN sap.ManejoSap    m ON m.ManejoSapId   = e.ManejoSapId
  LEFT  JOIN est.EstimacionVolumen vol ON vol.EstimacionId = e.EstimacionId
`;

export async function listEstimaciones(
  q: EstimacionListQuery
): Promise<{ rows: EstimacionResumenDto[]; pagination: Pagination }> {
  const pool = await getPool();
  const where: string[] = ['1 = 1'];
  const listReq = pool.request();
  const countReq = pool.request();

  if (q.temporadaId !== undefined) {
    where.push('t.TemporadaId = @TemporadaId');
    listReq.input('TemporadaId', mssql.Int, q.temporadaId);
    countReq.input('TemporadaId', mssql.Int, q.temporadaId);
  }
  if (q.especieId !== undefined) {
    where.push('cv.EspecieSapId = @EspecieId');
    listReq.input('EspecieId', mssql.BigInt, q.especieId);
    countReq.input('EspecieId', mssql.BigInt, q.especieId);
  }
  if (q.controlVersionId !== undefined) {
    where.push('e.EstimacionControlVersionId = @CvId');
    listReq.input('CvId', mssql.Int, q.controlVersionId);
    countReq.input('CvId', mssql.Int, q.controlVersionId);
  }
  if (q.agronomoId !== undefined) {
    where.push('e.AgronomoId = @AgronomoId');
    listReq.input('AgronomoId', mssql.Int, q.agronomoId);
    countReq.input('AgronomoId', mssql.Int, q.agronomoId);
  }
  if (q.productorVariedadId !== undefined) {
    where.push('e.ProductorVariedadSapId = @PvId');
    listReq.input('PvId', mssql.BigInt, q.productorVariedadId);
    countReq.input('PvId', mssql.BigInt, q.productorVariedadId);
  }
  if (q.q) {
    where.push('(p.Nombre LIKE @Q OR v.Nombre LIKE @Q OR u.Nombre LIKE @Q OR e.Folio LIKE @Q)');
    listReq.input('Q', mssql.NVarChar, `%${q.q}%`);
    countReq.input('Q', mssql.NVarChar, `%${q.q}%`);
  }
  const offset = (q.page - 1) * q.page_size;
  listReq.input('Offset', mssql.Int, offset);
  listReq.input('Limit', mssql.Int, q.page_size);

  const list = await listReq.query<EstRow>(`
    SELECT ${SELECT_EST}
    WHERE ${where.join(' AND ')}
    ORDER BY e.UpdatedAt DESC
    OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
  `);
  const count = await countReq.query<{ total: number }>(`
    SELECT COUNT(*) AS total
    FROM est.Estimacion e
    INNER JOIN est.EstimacionControlVersion cv ON cv.EstimacionControlVersionId = e.EstimacionControlVersionId
    INNER JOIN est.Temporada   t  ON t.TemporadaId  = cv.TemporadaId
    INNER JOIN est.Agronomo    a  ON a.AgronomoId = e.AgronomoId
    INNER JOIN est.Usuario     u  ON u.UsuarioId  = a.UsuarioId
    INNER JOIN sap.ProductorVariedadSap pv ON pv.ProductorVariedadSapId = e.ProductorVariedadSapId
    INNER JOIN sap.ProductorSap p ON p.ProductorSapId = pv.ProductorSapId
    INNER JOIN sap.VariedadSap  v ON v.VariedadSapId  = pv.VariedadSapId
    WHERE ${where.join(' AND ')};
  `);
  const total = count.recordset[0]?.total ?? 0;
  return {
    rows: list.recordset.map(mapEst),
    pagination: {
      page: q.page,
      page_size: q.page_size,
      total,
      total_pages: q.page_size > 0 ? Math.max(1, Math.ceil(total / q.page_size)) : 1,
    },
  };
}

export async function getEstimacionDetalle(id: number): Promise<EstimacionDetalleDto | null> {
  const pool = await getPool();
  const base = await pool.request().input('Id', mssql.BigInt, id).query<EstRow>(`
    SELECT ${SELECT_EST} WHERE e.EstimacionId = @Id;
  `);
  const row = base.recordset[0];
  if (!row) return null;

  const [volR, semR, calR, tipR] = await Promise.all([
    pool.request().input('Id', mssql.BigInt, id).query<{
      UnidadId: number;
      UnidadCodigo: string;
      UnidadNombre: string;
      Kilos: number;
      PorcentajeExportacion: number;
      CajasEquivalentes: number;
    }>(`
      SELECT vol.UnidadId, un.Codigo AS UnidadCodigo, un.Nombre AS UnidadNombre,
             vol.Kilos, vol.PorcentajeExportacion, vol.CajasEquivalentes
      FROM est.EstimacionVolumen vol
      INNER JOIN est.Unidad un ON un.UnidadId = vol.UnidadId
      WHERE vol.EstimacionId = @Id;
    `),
    pool.request().input('Id', mssql.BigInt, id).query<{ Semana: number; Kilos: number }>(`
      SELECT Semana, Kilos FROM est.EstimacionVolumenSemana WHERE EstimacionId = @Id ORDER BY Semana;
    `),
    pool.request().input('Id', mssql.BigInt, id).query<{
      CalibreSapId: number;
      CalibreCodigo: string;
      CalibreTipo: string;
      Porcentaje: number;
    }>(`
      SELECT c.CalibreSapId, cs.Codigo AS CalibreCodigo, cs.Tipo AS CalibreTipo, c.Porcentaje
      FROM est.EstimacionCalibre c
      INNER JOIN sap.CalibreSap cs ON cs.CalibreSapId = c.CalibreSapId
      WHERE c.EstimacionId = @Id ORDER BY cs.Orden;
    `),
    pool.request().input('Id', mssql.BigInt, id).query<{
      EspecieTipificacionId: number;
      Codigo: string;
      Nombre: string;
      Valor: number;
    }>(`
      SELECT t.EspecieTipificacionId, et.Codigo, et.Nombre, t.Valor
      FROM est.EstimacionTipificacion t
      INNER JOIN est.EspecieTipificacion et ON et.EspecieTipificacionId = t.EspecieTipificacionId
      WHERE t.EstimacionId = @Id ORDER BY et.Orden;
    `),
  ]);

  const vol = volR.recordset[0];
  return {
    ...mapEst(row),
    volumen: vol
      ? {
          unidadId: vol.UnidadId,
          unidadCodigo: vol.UnidadCodigo,
          unidadNombre: vol.UnidadNombre,
          kilos: Number(vol.Kilos),
          porcentajeExportacion: Number(vol.PorcentajeExportacion),
          cajasEquivalentes: Number(vol.CajasEquivalentes),
        }
      : null,
    semanas: semR.recordset.map((r) => ({ semana: r.Semana, kilos: Number(r.Kilos) })),
    calibres: calR.recordset.map((r) => ({
      calibreSapId: r.CalibreSapId,
      calibreCodigo: r.CalibreCodigo,
      calibreTipo: r.CalibreTipo,
      porcentaje: Number(r.Porcentaje),
    })),
    tipificaciones: tipR.recordset.map((r) => ({
      especieTipificacionId: r.EspecieTipificacionId,
      codigo: r.Codigo,
      nombre: r.Nombre,
      valor: Number(r.Valor),
    })),
  };
}

export async function insertEstimacionCompleta(
  input: EstimacionCreate,
  usuarioId: number
): Promise<number> {
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const insert = await new mssql.Request(tx)
      .input('Cv', mssql.Int, input.controlVersionId)
      .input('Ag', mssql.Int, input.agronomoId)
      .input('Pv', mssql.BigInt, input.productorVariedadSapId)
      .input('Manejo', mssql.BigInt, input.manejoSapId ?? null)
      .input('Folio', mssql.NVarChar(32), input.folio ?? null)
      .input('User', mssql.BigInt, usuarioId).query<{ Id: number }>(`
        INSERT INTO est.Estimacion
          (EstimacionControlVersionId, AgronomoId, ProductorVariedadSapId, ManejoSapId, Folio,
           CreatedBy, UpdatedBy)
        OUTPUT inserted.EstimacionId AS Id
        VALUES (@Cv, @Ag, @Pv, @Manejo, @Folio, @User, @User);
      `);
    const estimacionId = insert.recordset[0]!.Id;

    await new mssql.Request(tx)
      .input('Est', mssql.BigInt, estimacionId)
      .input('UnidadId', mssql.Int, input.volumen.unidadId)
      .input('Kilos', mssql.Decimal(14, 2), input.volumen.kilos)
      .input('PctExp', mssql.Decimal(9, 4), input.volumen.porcentajeExportacion)
      .input('Cajas', mssql.Decimal(14, 4), input.volumen.cajasEquivalentes).query(`
        INSERT INTO est.EstimacionVolumen
          (EstimacionId, UnidadId, Kilos, PorcentajeExportacion, CajasEquivalentes)
        VALUES (@Est, @UnidadId, @Kilos, @PctExp, @Cajas);
      `);

    for (const s of input.semanas) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .input('Semana', mssql.Int, s.semana)
        .input('Kilos', mssql.Decimal(14, 2), s.kilos).query(`
          INSERT INTO est.EstimacionVolumenSemana (EstimacionId, Semana, Kilos)
          VALUES (@Est, @Semana, @Kilos);
        `);
    }
    for (const c of input.calibres) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .input('Cal', mssql.BigInt, c.calibreSapId)
        .input('Pct', mssql.Decimal(9, 4), c.porcentaje).query(`
          INSERT INTO est.EstimacionCalibre (EstimacionId, CalibreSapId, Porcentaje)
          VALUES (@Est, @Cal, @Pct);
        `);
    }
    for (const t of input.tipificaciones) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .input('Tip', mssql.Int, t.especieTipificacionId)
        .input('Val', mssql.Decimal(14, 4), t.valor).query(`
          INSERT INTO est.EstimacionTipificacion (EstimacionId, EspecieTipificacionId, Valor)
          VALUES (@Est, @Tip, @Val);
        `);
    }

    await tx.commit();
    return estimacionId;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function updateEstimacionCompleta(
  estimacionId: number,
  input: EstimacionUpdate,
  usuarioId: number
): Promise<void> {
  const pool = await getPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    if (input.folio !== undefined || input.manejoSapId !== undefined) {
      await new mssql.Request(tx)
        .input('Id', mssql.BigInt, estimacionId)
        .input('Folio', mssql.NVarChar(32), input.folio === undefined ? null : input.folio)
        .input('Manejo', mssql.BigInt, input.manejoSapId === undefined ? null : input.manejoSapId)
        .input('UpdFolio', mssql.Bit, input.folio !== undefined ? 1 : 0)
        .input('UpdManejo', mssql.Bit, input.manejoSapId !== undefined ? 1 : 0)
        .input('User', mssql.BigInt, usuarioId).query(`
          UPDATE est.Estimacion
          SET Folio       = CASE WHEN @UpdFolio = 1 THEN @Folio ELSE Folio END,
              ManejoSapId = CASE WHEN @UpdManejo = 1 THEN @Manejo ELSE ManejoSapId END,
              UpdatedBy   = @User,
              UpdatedAt   = SYSUTCDATETIME()
          WHERE EstimacionId = @Id;
        `);
    }

    if (input.volumen !== undefined) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .input('UnidadId', mssql.Int, input.volumen.unidadId)
        .input('Kilos', mssql.Decimal(14, 2), input.volumen.kilos)
        .input('PctExp', mssql.Decimal(9, 4), input.volumen.porcentajeExportacion)
        .input('Cajas', mssql.Decimal(14, 4), input.volumen.cajasEquivalentes).query(`
          MERGE est.EstimacionVolumen AS t
          USING (SELECT @Est AS EstimacionId, @UnidadId AS UnidadId, @Kilos AS Kilos,
                        @PctExp AS PctExp, @Cajas AS Cajas) AS s
          ON t.EstimacionId = s.EstimacionId
          WHEN MATCHED THEN UPDATE SET
            UnidadId              = s.UnidadId,
            Kilos                 = s.Kilos,
            PorcentajeExportacion = s.PctExp,
            CajasEquivalentes     = s.Cajas,
            UpdatedAt             = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT
            (EstimacionId, UnidadId, Kilos, PorcentajeExportacion, CajasEquivalentes)
            VALUES (s.EstimacionId, s.UnidadId, s.Kilos, s.PctExp, s.Cajas);
        `);
    }

    if (input.semanas !== undefined) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .query(`DELETE FROM est.EstimacionVolumenSemana WHERE EstimacionId = @Est;`);
      for (const s of input.semanas) {
        await new mssql.Request(tx)
          .input('Est', mssql.BigInt, estimacionId)
          .input('Semana', mssql.Int, s.semana)
          .input('Kilos', mssql.Decimal(14, 2), s.kilos).query(`
            INSERT INTO est.EstimacionVolumenSemana (EstimacionId, Semana, Kilos)
            VALUES (@Est, @Semana, @Kilos);
          `);
      }
    }

    if (input.calibres !== undefined) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .query(`DELETE FROM est.EstimacionCalibre WHERE EstimacionId = @Est;`);
      for (const c of input.calibres) {
        await new mssql.Request(tx)
          .input('Est', mssql.BigInt, estimacionId)
          .input('Cal', mssql.BigInt, c.calibreSapId)
          .input('Pct', mssql.Decimal(9, 4), c.porcentaje).query(`
            INSERT INTO est.EstimacionCalibre (EstimacionId, CalibreSapId, Porcentaje)
            VALUES (@Est, @Cal, @Pct);
          `);
      }
    }

    if (input.tipificaciones !== undefined) {
      await new mssql.Request(tx)
        .input('Est', mssql.BigInt, estimacionId)
        .query(`DELETE FROM est.EstimacionTipificacion WHERE EstimacionId = @Est;`);
      for (const t of input.tipificaciones) {
        await new mssql.Request(tx)
          .input('Est', mssql.BigInt, estimacionId)
          .input('Tip', mssql.Int, t.especieTipificacionId)
          .input('Val', mssql.Decimal(14, 4), t.valor).query(`
            INSERT INTO est.EstimacionTipificacion (EstimacionId, EspecieTipificacionId, Valor)
            VALUES (@Est, @Tip, @Val);
          `);
      }
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function deleteEstimacion(estimacionId: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Id', mssql.BigInt, estimacionId)
    .query(`DELETE FROM est.Estimacion WHERE EstimacionId = @Id;`);
  return (r.rowsAffected[0] ?? 0) > 0;
}

export interface EstimacionContext {
  controlVersionId: number;
  estadoVersion: 'Abierta' | 'Cerrada' | 'Anulada';
  temporadaId: number;
  especieSapId: number;
  agronomoId: number;
  agronomoUsuarioId: number;
}

export async function getEstimacionContext(
  estimacionId: number
): Promise<EstimacionContext | null> {
  const pool = await getPool();
  const r = await pool.request().input('Id', mssql.BigInt, estimacionId).query<{
    ControlVersionId: number;
    EstadoVersion: 'Abierta' | 'Cerrada' | 'Anulada';
    TemporadaId: number;
    EspecieSapId: number;
    AgronomoId: number;
    AgronomoUsuarioId: number;
  }>(`
    SELECT e.EstimacionControlVersionId AS ControlVersionId,
           cv.Estado AS EstadoVersion,
           cv.TemporadaId, cv.EspecieSapId,
           e.AgronomoId, a.UsuarioId AS AgronomoUsuarioId
    FROM est.Estimacion e
    INNER JOIN est.EstimacionControlVersion cv ON cv.EstimacionControlVersionId = e.EstimacionControlVersionId
    INNER JOIN est.Agronomo a ON a.AgronomoId = e.AgronomoId
    WHERE e.EstimacionId = @Id;
  `);
  const row = r.recordset[0];
  return row
    ? {
        controlVersionId: row.ControlVersionId,
        estadoVersion: row.EstadoVersion,
        temporadaId: row.TemporadaId,
        especieSapId: row.EspecieSapId,
        agronomoId: row.AgronomoId,
        agronomoUsuarioId: row.AgronomoUsuarioId,
      }
    : null;
}

export async function ventanaAbierta(
  temporadaId: number,
  especieSapId: number
): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('TemporadaId', mssql.Int, temporadaId)
    .input('EspecieId', mssql.BigInt, especieSapId).query<{ Abierta: boolean }>(`
      SELECT est.fn_VentanaGeneralAbierta(@TemporadaId, @EspecieId, NULL) AS Abierta;
    `);
  return Boolean(r.recordset[0]?.Abierta);
}

export async function agronomoAsignadoAPV(
  agronomoId: number,
  productorVariedadSapId: number,
  temporadaId: number
): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('AgronomoId', mssql.Int, agronomoId)
    .input('PvId', mssql.BigInt, productorVariedadSapId)
    .input('TemporadaId', mssql.Int, temporadaId).query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM est.AgronomoProductorVariedad
      WHERE AgronomoId = @AgronomoId
        AND ProductorVariedadSapId = @PvId
        AND TemporadaId = @TemporadaId;
    `);
  return (r.recordset[0]?.cnt ?? 0) > 0;
}
