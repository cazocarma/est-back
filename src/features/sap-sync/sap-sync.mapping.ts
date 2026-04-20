import type { EntidadSap } from './sap-sync.types.js';

/**
 * Mapeo declarativo SAP -> tabla espejo local.
 * El DBA/SAP analyst ajusta `sapTable`, `sapFields` y `columnMap` aqui sin
 * tocar logica. Los valores actuales son placeholders razonables que deberan
 * confirmarse contra el destino SAP real (PRD) antes del primer sync en
 * produccion.
 *
 * Convencion de `columnMap`: { <columna_local>: '<campo_SAP>' }.
 */

export interface SapSyncMapping {
  entidad: EntidadSap;
  sapTable: string;
  sapFields: readonly string[];
  targetTable: string;
  /** Columna de match para MERGE. */
  matchColumn: string;
  /** Mapeo local <- SAP field. Incluye matchColumn. */
  columnMap: Readonly<Record<string, string>>;
  /** Filtro WHERE opcional contra SAP (syntax ABAP). */
  sapWhere?: string;
  /** Opcional: transformacion adicional de una fila (sanitizacion, defaults). */
  transform?: (row: Record<string, string>) => Record<string, string | number | boolean | null>;
}

/**
 * Mapping actual. Los nombres de tabla/campos SAP son PROPUESTOS y se deben
 * validar contra el cliente SAP real antes de ejecutar el primer sync en
 * produccion. Se pueden ajustar sin recompilar — este archivo queda como la
 * unica fuente de verdad del contrato entre EST y SAP.
 */
export const MAPPINGS: Readonly<Record<EntidadSap, SapSyncMapping>> = {
  especie: {
    entidad: 'especie',
    sapTable: 'ZEST_ESPECIE',
    sapFields: ['ESPECIE', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.EspecieSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'ESPECIE', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },

  'grupo-variedad': {
    entidad: 'grupo-variedad',
    sapTable: 'ZEST_GRUPO_VARIEDAD',
    sapFields: ['GRUPO', 'ESPECIE', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.GrupoVariedadSap',
    matchColumn: 'CodigoSap',
    columnMap: {
      CodigoSap: 'GRUPO',
      EspecieCodigoSap: 'ESPECIE', // resuelto a EspecieSapId por JOIN durante MERGE
      Nombre: 'NOMBRE',
      Activo: 'ACTIVO',
    },
  },

  variedad: {
    entidad: 'variedad',
    sapTable: 'ZEST_VARIEDAD',
    sapFields: ['VARIEDAD', 'ESPECIE', 'GRUPO', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.VariedadSap',
    matchColumn: 'CodigoSap',
    columnMap: {
      CodigoSap: 'VARIEDAD',
      EspecieCodigoSap: 'ESPECIE',
      GrupoVariedadCodigoSap: 'GRUPO',
      Nombre: 'NOMBRE',
      Activo: 'ACTIVO',
    },
  },

  productor: {
    entidad: 'productor',
    sapTable: 'ZEST_PRODUCTOR',
    sapFields: ['PRODUCTOR', 'RUT', 'DV', 'NOMBRE', 'EMAIL', 'CODIGO_SAG', 'ACTIVO'],
    targetTable: 'sap.ProductorSap',
    matchColumn: 'CodigoSap',
    columnMap: {
      CodigoSap: 'PRODUCTOR',
      Rut: 'RUT',
      Dv: 'DV',
      Nombre: 'NOMBRE',
      Email: 'EMAIL',
      CodigoSag: 'CODIGO_SAG',
      Activo: 'ACTIVO',
    },
  },

  envase: {
    entidad: 'envase',
    sapTable: 'ZEST_ENVASE',
    sapFields: ['ENVASE', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.EnvaseSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'ENVASE', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },

  manejo: {
    entidad: 'manejo',
    sapTable: 'ZEST_MANEJO',
    sapFields: ['MANEJO', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.ManejoSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'MANEJO', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },

  centro: {
    entidad: 'centro',
    sapTable: 'ZEST_CENTRO',
    sapFields: ['CENTRO', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.CentroSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'CENTRO', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },

  'tipo-frio': {
    entidad: 'tipo-frio',
    sapTable: 'ZEST_TIPO_FRIO',
    sapFields: ['TIPO_FRIO', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.TipoFrioSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'TIPO_FRIO', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },

  programa: {
    entidad: 'programa',
    sapTable: 'ZEST_PROGRAMA',
    sapFields: ['PROGRAMA', 'NOMBRE', 'ACTIVO'],
    targetTable: 'sap.ProgramaSap',
    matchColumn: 'CodigoSap',
    columnMap: { CodigoSap: 'PROGRAMA', Nombre: 'NOMBRE', Activo: 'ACTIVO' },
  },
};
