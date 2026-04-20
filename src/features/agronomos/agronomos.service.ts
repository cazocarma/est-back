import mssql from 'mssql';
import { getPool } from '../../infra/db.js';
import { HttpError } from '../../middleware/error.js';
import type {
  AgronomoCreate,
  AgronomoDto,
  AgronomoListQuery,
  AgronomoUpdate,
  AsignacionDto,
} from './agronomos.dto.js';
import type { Pagination } from '../../shared/pagination.js';
import * as repo from './agronomos.repository.js';

export async function listAgronomos(
  q: AgronomoListQuery
): Promise<{ rows: AgronomoDto[]; pagination: Pagination }> {
  return repo.listAgronomos(q);
}

export async function getAgronomo(id: number): Promise<AgronomoDto> {
  const row = await repo.getAgronomo(id);
  if (!row) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  return row;
}

export async function createAgronomo(
  input: AgronomoCreate,
  creadorId: number
): Promise<AgronomoDto> {
  // Validar que el usuario existe y esta activo
  const pool = await getPool();
  const u = await pool
    .request()
    .input('Id', mssql.BigInt, input.usuarioId)
    .query<{ UsuarioId: number; Activo: boolean }>(
      `SELECT UsuarioId, Activo FROM est.Usuario WHERE UsuarioId = @Id;`
    );
  if (u.recordset.length === 0) {
    throw new HttpError(404, 'usuario_not_found', 'Usuario inexistente');
  }
  if (!u.recordset[0]!.Activo) {
    throw new HttpError(422, 'usuario_inactivo', 'El usuario esta suspendido');
  }

  const existente = await repo.getAgronomoByUsuario(input.usuarioId);
  if (existente) {
    throw new HttpError(409, 'conflict', 'El usuario ya es agronomo');
  }

  return repo.insertAgronomo(input, creadorId);
}

export async function updateAgronomo(
  id: number,
  input: AgronomoUpdate,
  editorId: number
): Promise<AgronomoDto> {
  const current = await repo.getAgronomo(id);
  if (!current) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  const updated = await repo.updateAgronomo(id, input, editorId);
  if (!updated) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  return updated;
}

export async function deactivateAgronomo(id: number, editorId: number): Promise<void> {
  const current = await repo.getAgronomo(id);
  if (!current) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  await repo.deactivateAgronomo(id, editorId);
}

export async function listAsignacionesDeAgronomo(
  agronomoId: number,
  temporadaId: number | null
): Promise<AsignacionDto[]> {
  const current = await repo.getAgronomo(agronomoId);
  if (!current) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  return repo.listAsignacionesAgronomo(agronomoId, temporadaId);
}

export async function bulkAsignar(
  agronomoId: number,
  temporadaId: number,
  productorVariedadIds: readonly number[],
  creadorId: number
): Promise<{ inserted: number; total: number }> {
  const current = await repo.getAgronomo(agronomoId);
  if (!current) throw new HttpError(404, 'not_found', 'Agronomo no encontrado');
  if (!current.activo) {
    throw new HttpError(422, 'agronomo_inactivo', 'No se puede asignar a un agronomo inactivo');
  }
  const inserted = await repo.bulkAsignar(
    agronomoId,
    temporadaId,
    productorVariedadIds,
    creadorId
  );
  return { inserted, total: productorVariedadIds.length };
}

export async function deleteAsignacion(
  agronomoId: number,
  asignacionId: number
): Promise<void> {
  const ok = await repo.deleteAsignacion(agronomoId, asignacionId);
  if (!ok) throw new HttpError(404, 'not_found', 'Asignacion no encontrada');
}

export interface UsuarioDisponibleDto {
  id: number;
  usuario: string;
  nombre: string;
  email: string | null;
}

/**
 * Lista usuarios activos que aun NO son agronomos — fuente para el modal de
 * promocion. Admin-only.
 */
export async function listUsuariosDisponibles(
  q: string | undefined,
  limit: number
): Promise<UsuarioDisponibleDto[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('Q', mssql.NVarChar, q ? `%${q}%` : null)
    .input('Limit', mssql.Int, limit).query<{
    UsuarioId: number;
    Usuario: string;
    Nombre: string;
    Email: string | null;
  }>(`
      SELECT TOP (@Limit) u.UsuarioId, u.Usuario, u.Nombre, u.Email
      FROM est.Usuario u
      LEFT JOIN est.Agronomo a ON a.UsuarioId = u.UsuarioId
      WHERE u.Activo = 1 AND a.AgronomoId IS NULL
        AND (@Q IS NULL OR u.Nombre LIKE @Q OR u.Usuario LIKE @Q OR u.Email LIKE @Q)
      ORDER BY u.Nombre ASC;
    `);
  return r.recordset.map((row) => ({
    id: row.UsuarioId,
    usuario: row.Usuario,
    nombre: row.Nombre,
    email: row.Email,
  }));
}

export async function listAsignacionesDelUsuario(
  usuarioId: number,
  temporadaId: number | null
): Promise<{ agronomo: AgronomoDto; asignaciones: AsignacionDto[] } | null> {
  const agronomo = await repo.getAgronomoByUsuario(usuarioId);
  if (!agronomo) return null;
  const asignaciones = await repo.listAsignacionesAgronomo(agronomo.id, temporadaId);
  return { agronomo, asignaciones };
}
