import { z } from 'zod';
import { paginationQuery } from '../../../shared/pagination.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha esperada en formato YYYY-MM-DD');

export const temporadaListQuery = paginationQuery.extend({
  anio: z.coerce.number().int().min(1900).max(2100).optional(),
  activa: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type TemporadaListQuery = z.infer<typeof temporadaListQuery>;

export const temporadaCreate = z.object({
  anio: z.number().int().min(1900).max(2100),
  prefijo: z.string().trim().min(1).max(10),
  descripcion: z.string().trim().max(200).optional().nullable(),
  fechaInicio: isoDate.optional().nullable(),
  fechaFin: isoDate.optional().nullable(),
  activa: z.boolean().optional().default(false),
});
export type TemporadaCreate = z.infer<typeof temporadaCreate>;

export const temporadaUpdate = temporadaCreate.partial();
export type TemporadaUpdate = z.infer<typeof temporadaUpdate>;

export interface TemporadaDto {
  id: number;
  anio: number;
  prefijo: string;
  descripcion: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
}
