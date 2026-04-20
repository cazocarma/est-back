import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination.js';

export const agronomoListQuery = paginationQuery.extend({
  plantaId: z.coerce.number().int().optional(),
  activo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type AgronomoListQuery = z.infer<typeof agronomoListQuery>;

export const agronomoCreate = z.object({
  usuarioId: z.number().int().positive(),
  plantaId: z.number().int().positive().optional().nullable(),
  activo: z.boolean().optional().default(true),
});
export type AgronomoCreate = z.infer<typeof agronomoCreate>;

export const agronomoUpdate = z.object({
  plantaId: z.number().int().positive().optional().nullable(),
  activo: z.boolean().optional(),
});
export type AgronomoUpdate = z.infer<typeof agronomoUpdate>;

export interface AgronomoDto {
  id: number;
  usuarioId: number;
  usuario: string;
  nombre: string;
  email: string | null;
  plantaId: number | null;
  plantaNombre: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

// -------- Asignaciones --------

export const asignacionesListQuery = z.object({
  temporadaId: z.coerce.number().int().positive().optional(),
});
export type AsignacionesListQuery = z.infer<typeof asignacionesListQuery>;

export const asignacionesBulkUpsert = z.object({
  temporadaId: z.number().int().positive(),
  productorVariedadIds: z.array(z.number().int().positive()).min(1).max(2000),
});
export type AsignacionesBulkUpsert = z.infer<typeof asignacionesBulkUpsert>;

export interface AsignacionDto {
  id: number;
  agronomoId: number;
  productorVariedadSapId: number;
  productorCodigoSap: string | null;
  productorNombre: string | null;
  variedadCodigoSap: string | null;
  variedadNombre: string | null;
  cuartelCodigo: string | null;
  temporadaId: number;
  temporadaAnio: number;
  temporadaPrefijo: string;
  createdAt: string;
}
