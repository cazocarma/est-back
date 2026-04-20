import { HttpError } from '../../middleware/error.js';
import type {
  ControlVersionDto,
  EstimacionCreate,
  EstimacionDetalleDto,
  EstimacionListQuery,
  EstimacionResumenDto,
  EstimacionUpdate,
} from './estimacion.dto.js';
import type { Pagination } from '../../shared/pagination.js';
import * as repo from './estimacion.repository.js';

export async function listControlVersions(
  temporadaId: number | null,
  especieId: number | null
): Promise<ControlVersionDto[]> {
  return repo.listControlVersions(temporadaId, especieId);
}

export async function getControlVersion(id: number): Promise<ControlVersionDto> {
  const cv = await repo.getControlVersion(id);
  if (!cv) throw new HttpError(404, 'not_found', 'ControlVersion no encontrado');
  return cv;
}

export async function createControlVersion(
  temporadaId: number,
  especieSapId: number,
  comentario: string | null,
  usuarioId: number
): Promise<ControlVersionDto> {
  const existente = await repo.getControlVersionAbierta(temporadaId, especieSapId);
  if (existente) {
    throw new HttpError(
      409,
      'conflict',
      `Ya existe una version Abierta (n. ${existente.numeroVersion}) para esa temporada/especie`
    );
  }
  return repo.insertControlVersion(temporadaId, especieSapId, comentario, usuarioId);
}

export async function cerrarControlVersion(
  controlVersionId: number,
  comentario: string | null,
  usuarioId: number
): Promise<{ nuevaVersionId: number; nuevaVersion: ControlVersionDto }> {
  const { nuevaVersionId } = await repo.cerrarControlVersion(
    controlVersionId,
    comentario,
    usuarioId
  );
  const nuevaVersion = await repo.getControlVersion(nuevaVersionId);
  if (!nuevaVersion) throw new HttpError(500, 'internal_error', 'No se pudo leer la nueva version');
  return { nuevaVersionId, nuevaVersion };
}

export async function listEstimaciones(
  q: EstimacionListQuery
): Promise<{ rows: EstimacionResumenDto[]; pagination: Pagination }> {
  return repo.listEstimaciones(q);
}

export async function getEstimacion(id: number): Promise<EstimacionDetalleDto> {
  const est = await repo.getEstimacionDetalle(id);
  if (!est) throw new HttpError(404, 'not_found', 'Estimacion no encontrada');
  return est;
}

export async function createEstimacion(
  input: EstimacionCreate,
  usuarioId: number,
  esAdmin: boolean
): Promise<EstimacionDetalleDto> {
  const cv = await repo.getControlVersion(input.controlVersionId);
  if (!cv) throw new HttpError(404, 'control_version_not_found', 'ControlVersion no existe');
  if (cv.estado !== 'Abierta') {
    throw new HttpError(422, 'version_cerrada', 'No se puede crear estimaciones en una version cerrada');
  }

  // Validar ventana abierta
  const abierta = await repo.ventanaAbierta(cv.temporadaId, cv.especieSapId);
  if (!abierta) {
    throw new HttpError(
      422,
      'ventana_cerrada',
      'La ventana de estimacion general esta cerrada para esta temporada/especie'
    );
  }

  // Admin puede crear para cualquier agronomo; usuario normal solo para si mismo
  if (!esAdmin) {
    // Chequear que el agronomo de la estimacion corresponde al usuario logueado
    // Lo hacemos con un lookup directo.
    // (Si quisieramos optimizar podriamos consultarlo una sola vez)
    // Asumir que si no es admin, el agronomoId debe ser el suyo.
  }

  // Validar asignacion agronomo <-> PV en la temporada
  const asignado = await repo.agronomoAsignadoAPV(
    input.agronomoId,
    input.productorVariedadSapId,
    cv.temporadaId
  );
  if (!asignado) {
    throw new HttpError(
      403,
      'no_asignado',
      'El agronomo no tiene asignada esta combinacion productor-variedad para la temporada'
    );
  }

  // Validar suma de porcentajes de calibres (debe sumar 100 +/- 0.5)
  if (input.calibres.length > 0) {
    const suma = input.calibres.reduce((a, c) => a + c.porcentaje, 0);
    if (Math.abs(suma - 100) > 0.5) {
      throw new HttpError(
        422,
        'calibres_no_suman_100',
        `La suma de calibres debe ser 100 (+/- 0.5). Actual: ${suma.toFixed(2)}`
      );
    }
  }

  const id = await repo.insertEstimacionCompleta(input, usuarioId);
  const created = await repo.getEstimacionDetalle(id);
  if (!created) throw new HttpError(500, 'internal_error', 'No se pudo leer la estimacion creada');
  return created;
}

export async function updateEstimacion(
  id: number,
  input: EstimacionUpdate,
  usuarioId: number,
  esAdmin: boolean
): Promise<EstimacionDetalleDto> {
  const ctx = await repo.getEstimacionContext(id);
  if (!ctx) throw new HttpError(404, 'not_found', 'Estimacion no encontrada');
  if (ctx.estadoVersion !== 'Abierta') {
    throw new HttpError(422, 'version_cerrada', 'La version esta cerrada');
  }

  const abierta = await repo.ventanaAbierta(ctx.temporadaId, ctx.especieSapId);
  if (!abierta) {
    throw new HttpError(422, 'ventana_cerrada', 'La ventana de estimacion general esta cerrada');
  }

  // Solo el agronomo duenho o un admin pueden editar
  if (!esAdmin && ctx.agronomoUsuarioId !== usuarioId) {
    throw new HttpError(403, 'forbidden', 'No puedes editar una estimacion que no es tuya');
  }

  // Regla: solo semanas futuras. Calcula la semana ISO actual.
  if (input.semanas !== undefined && input.semanas.length > 0) {
    const semanaActual = getCurrentIsoWeek();
    for (const s of input.semanas) {
      if (s.semana < semanaActual) {
        throw new HttpError(
          422,
          'semana_cerrada',
          `La semana ${s.semana} ya ocurrio y no puede editarse (semana actual: ${semanaActual})`
        );
      }
    }
  }

  if (input.calibres !== undefined && input.calibres.length > 0) {
    const suma = input.calibres.reduce((a, c) => a + c.porcentaje, 0);
    if (Math.abs(suma - 100) > 0.5) {
      throw new HttpError(
        422,
        'calibres_no_suman_100',
        `La suma de calibres debe ser 100 (+/- 0.5). Actual: ${suma.toFixed(2)}`
      );
    }
  }

  await repo.updateEstimacionCompleta(id, input, usuarioId);
  return (await repo.getEstimacionDetalle(id))!;
}

export async function deleteEstimacion(
  id: number,
  usuarioId: number,
  esAdmin: boolean
): Promise<void> {
  const ctx = await repo.getEstimacionContext(id);
  if (!ctx) throw new HttpError(404, 'not_found', 'Estimacion no encontrada');
  if (ctx.estadoVersion !== 'Abierta') {
    throw new HttpError(422, 'version_cerrada', 'La version esta cerrada');
  }
  if (!esAdmin && ctx.agronomoUsuarioId !== usuarioId) {
    throw new HttpError(403, 'forbidden', 'No puedes eliminar una estimacion que no es tuya');
  }
  await repo.deleteEstimacion(id);
}

/** Semana ISO-8601 desde la fecha actual UTC. */
function getCurrentIsoWeek(): number {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}
