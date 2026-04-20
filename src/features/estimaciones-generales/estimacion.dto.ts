import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination.js';

export const estimacionListQuery = paginationQuery.extend({
  temporadaId: z.coerce.number().int().positive().optional(),
  especieId: z.coerce.number().int().positive().optional(),
  controlVersionId: z.coerce.number().int().positive().optional(),
  agronomoId: z.coerce.number().int().positive().optional(),
  productorVariedadId: z.coerce.number().int().positive().optional(),
});
export type EstimacionListQuery = z.infer<typeof estimacionListQuery>;

export const semanaSchema = z.object({
  semana: z.number().int().min(1).max(53),
  kilos: z.number().min(0),
});

export const calibreSchema = z.object({
  calibreSapId: z.number().int().positive(),
  porcentaje: z.number().min(0).max(100),
});

export const tipificacionSchema = z.object({
  especieTipificacionId: z.number().int().positive(),
  valor: z.number(),
});

export const volumenSchema = z.object({
  unidadId: z.number().int().positive(),
  kilos: z.number().min(0),
  porcentajeExportacion: z.number().min(0).max(100).default(0),
  cajasEquivalentes: z.number().min(0).default(0),
});

export const estimacionCreate = z.object({
  controlVersionId: z.number().int().positive(),
  agronomoId: z.number().int().positive(),
  productorVariedadSapId: z.number().int().positive(),
  manejoSapId: z.number().int().positive().optional().nullable(),
  folio: z.string().trim().max(32).optional().nullable(),
  volumen: volumenSchema,
  semanas: z.array(semanaSchema).optional().default([]),
  calibres: z.array(calibreSchema).optional().default([]),
  tipificaciones: z.array(tipificacionSchema).optional().default([]),
});
export type EstimacionCreate = z.infer<typeof estimacionCreate>;

export const estimacionUpdate = z.object({
  manejoSapId: z.number().int().positive().optional().nullable(),
  folio: z.string().trim().max(32).optional().nullable(),
  volumen: volumenSchema.optional(),
  semanas: z.array(semanaSchema).optional(),
  calibres: z.array(calibreSchema).optional(),
  tipificaciones: z.array(tipificacionSchema).optional(),
});
export type EstimacionUpdate = z.infer<typeof estimacionUpdate>;

export const controlVersionCreate = z.object({
  temporadaId: z.number().int().positive(),
  especieSapId: z.number().int().positive(),
  comentario: z.string().trim().max(500).optional().nullable(),
});
export type ControlVersionCreate = z.infer<typeof controlVersionCreate>;

export const controlVersionCerrar = z.object({
  comentario: z.string().trim().max(500).optional().nullable(),
});
export type ControlVersionCerrar = z.infer<typeof controlVersionCerrar>;

export interface ControlVersionDto {
  id: number;
  temporadaId: number;
  temporadaAnio: number;
  temporadaPrefijo: string;
  especieSapId: number;
  especieCodigoSap: string;
  especieNombre: string;
  numeroVersion: number;
  estado: 'Abierta' | 'Cerrada' | 'Anulada';
  fechaApertura: string;
  fechaCierre: string | null;
  comentario: string | null;
  totalEstimaciones: number;
}

export interface EstimacionResumenDto {
  id: number;
  controlVersionId: number;
  numeroVersion: number;
  temporadaAnio: number;
  temporadaPrefijo: string;
  especieNombre: string;
  agronomoId: number;
  agronomoNombre: string;
  productorVariedadSapId: number;
  productorNombre: string;
  variedadNombre: string;
  cuartelCodigo: string | null;
  manejoSapId: number | null;
  manejoNombre: string | null;
  folio: string | null;
  kilosTotales: number;
  createdAt: string;
  updatedAt: string;
}

export interface EstimacionDetalleDto extends EstimacionResumenDto {
  volumen: {
    unidadId: number;
    unidadCodigo: string;
    unidadNombre: string;
    kilos: number;
    porcentajeExportacion: number;
    cajasEquivalentes: number;
  } | null;
  semanas: { semana: number; kilos: number }[];
  calibres: {
    calibreSapId: number;
    calibreCodigo: string;
    calibreTipo: string;
    porcentaje: number;
  }[];
  tipificaciones: {
    especieTipificacionId: number;
    codigo: string;
    nombre: string;
    valor: number;
  }[];
}
