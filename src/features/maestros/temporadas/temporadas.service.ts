import { HttpError } from '../../../middleware/error.js';
import type { Pagination } from '../../../shared/pagination.js';
import type {
  TemporadaCreate,
  TemporadaDto,
  TemporadaListQuery,
  TemporadaUpdate,
} from './temporadas.dto.js';
import * as repo from './temporadas.repository.js';

export async function listTemporadas(query: TemporadaListQuery): Promise<{
  rows: TemporadaDto[];
  pagination: Pagination;
}> {
  return repo.listTemporadas(query);
}

export async function getTemporada(id: number): Promise<TemporadaDto> {
  const row = await repo.getTemporada(id);
  if (!row) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
  return row;
}

export async function createTemporada(
  input: TemporadaCreate,
  userId: number
): Promise<TemporadaDto> {
  if (await repo.existsTemporadaByAnioPrefijo(input.anio, input.prefijo)) {
    throw new HttpError(409, 'conflict', 'Ya existe una temporada con ese ano y prefijo');
  }
  const created = await repo.insertTemporada(input, userId);
  // Si se crea activa, desactivar el resto (el indice unico filtrado si no, revienta)
  if (created.activa) {
    await repo.activarTemporada(created.id, userId);
    return (await repo.getTemporada(created.id)) ?? created;
  }
  return created;
}

export async function updateTemporada(
  id: number,
  input: TemporadaUpdate,
  userId: number
): Promise<TemporadaDto> {
  const current = await repo.getTemporada(id);
  if (!current) throw new HttpError(404, 'not_found', 'Temporada no encontrada');

  if (input.anio !== undefined && input.prefijo !== undefined) {
    if (await repo.existsTemporadaByAnioPrefijo(input.anio, input.prefijo, id)) {
      throw new HttpError(409, 'conflict', 'Ya existe otra temporada con ese ano y prefijo');
    }
  }

  // Validar coherencia de fechas si ambas vienen
  const start = input.fechaInicio ?? current.fechaInicio;
  const end = input.fechaFin ?? current.fechaFin;
  if (start && end && end < start) {
    throw new HttpError(422, 'invalid_date_range', 'fechaFin no puede ser anterior a fechaInicio');
  }

  // Si se pide activar, usar el flujo transaccional dedicado
  if (input.activa === true) {
    // Primero aplica el resto de cambios sin tocar Activa
    const { activa: _omit, ...rest } = input;
    void _omit;
    if (Object.keys(rest).length > 0) {
      await repo.updateTemporada(id, rest, userId);
    }
    const activated = await repo.activarTemporada(id, userId);
    if (!activated) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
    return activated;
  }

  const updated = await repo.updateTemporada(id, input, userId);
  if (!updated) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
  return updated;
}

export async function activarTemporada(id: number, userId: number): Promise<TemporadaDto> {
  const current = await repo.getTemporada(id);
  if (!current) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
  const result = await repo.activarTemporada(id, userId);
  if (!result) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
  return result;
}

export async function deleteTemporada(id: number): Promise<void> {
  const ok = await repo.deleteTemporada(id);
  if (!ok) throw new HttpError(404, 'not_found', 'Temporada no encontrada');
}
