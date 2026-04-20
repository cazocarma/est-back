/**
 * Contratos compartidos para sync de maestros SAP.
 */

export type EntidadSap =
  | 'especie'
  | 'grupo-variedad'
  | 'variedad'
  | 'productor'
  | 'envase'
  | 'manejo'
  | 'centro'
  | 'tipo-frio'
  | 'programa';

/** Orden de ejecucion por defecto (respeta FKs: especie -> grupo -> variedad, y productor antes que productor-variedad que vendra despues). */
export const ENTIDADES_ORDEN: readonly EntidadSap[] = [
  'especie',
  'grupo-variedad',
  'variedad',
  'productor',
  'envase',
  'manejo',
  'centro',
  'tipo-frio',
  'programa',
];

export interface SyncResult {
  entidad: EntidadSap;
  syncLogId: number;
  estado: 'ok' | 'fallo';
  filasLeidas: number;
  filasInsertadas: number;
  filasActualizadas: number;
  duracionMs: number;
  error?: string;
}

export interface SyncHandler {
  entidad: EntidadSap;
  /** Lee de SAP y MERGE en la tabla espejo. Retorna contadores. */
  run(ctx: SyncContext): Promise<{ leidas: number; insertadas: number; actualizadas: number }>;
}

export interface SyncContext {
  /** Si es null o undefined se usa el default del adapter (`PRD`). */
  destination?: string;
  /** Limite de filas a leer por llamada (0 = sin limite, default del adapter). */
  rowCount?: number;
}
