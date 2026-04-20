/**
 * Endpoints READ-ONLY para las tablas espejo sap.*.
 * Cualquier usuario con sesion puede listarlas. No se permite mutacion
 * desde este router (las tablas se modifican solo via sap-sync).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getPool, mssql } from '../../infra/db.js';
import { HttpError } from '../../middleware/error.js';
import { authnMiddleware } from '../../middleware/authn.js';
import { paged, paginationQuery, type PaginationQuery } from '../../shared/pagination.js';
import {
  getParams,
  getQuery,
  idParamSchema,
  validateParams,
  validateQuery,
  type IdParam,
} from '../../shared/validate.js';

interface Config {
  table: string;
  pk: string;
  searchCols: readonly string[];
  /** Filtros adicionales permitidos (key del query string -> columna SQL). */
  filters?: Readonly<Record<string, { column: string; type: 'int' | 'bigint' | 'string' | 'bit' }>>;
  /** Columnas SELECT (localName AS alias para derivar "id" desde la PK). */
  selectCols: string;
  /** Mapper row -> DTO camelCase. */
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>;
}

function buildReadRouter(cfg: Config): Router {
  const r = Router();
  r.use(authnMiddleware);

  const listQuerySchema = paginationQuery.extend({
    ...(cfg.filters
      ? Object.fromEntries(
          Object.entries(cfg.filters).map(([k, f]) => {
            if (f.type === 'int') return [k, z.coerce.number().int().optional()];
            if (f.type === 'bigint') return [k, z.coerce.number().int().optional()];
            if (f.type === 'bit')
              return [k, z.enum(['true', 'false']).transform((v) => v === 'true').optional()];
            return [k, z.string().trim().max(200).optional()];
          })
        )
      : {}),
  });
  type ListQuery = z.infer<typeof listQuerySchema>;

  r.get('/', validateQuery(listQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQuery<ListQuery>(req);
      const pool = await getPool();
      const request = pool.request();

      const where: string[] = ['1 = 1'];
      if (q.q) {
        const likes = cfg.searchCols.map((c) => `${c} LIKE @Q`).join(' OR ');
        where.push(`(${likes})`);
        request.input('Q', mssql.NVarChar, `%${q.q}%`);
      }
      if (cfg.filters) {
        for (const [key, f] of Object.entries(cfg.filters)) {
          const value = (q as unknown as Record<string, unknown>)[key];
          if (value === undefined) continue;
          where.push(`${f.column} = @${key}`);
          if (f.type === 'int') request.input(key, mssql.Int, value as number);
          else if (f.type === 'bigint') request.input(key, mssql.BigInt, value as number);
          else if (f.type === 'bit') request.input(key, mssql.Bit, value ? 1 : 0);
          else request.input(key, mssql.NVarChar, value as string);
        }
      }

      const offset = (q.page - 1) * q.page_size;
      request.input('Offset', mssql.Int, offset);
      request.input('Limit', mssql.Int, q.page_size);

      const listResult = await request.query<Record<string, unknown>>(`
        SELECT ${cfg.selectCols}
        FROM ${cfg.table}
        WHERE ${where.join(' AND ')}
        ORDER BY ${cfg.pk} ASC
        OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
      `);

      // Conteo: duplicar el request (los parametros no se pueden reusar)
      const countReq = pool.request();
      if (q.q) countReq.input('Q', mssql.NVarChar, `%${q.q}%`);
      if (cfg.filters) {
        for (const [key, f] of Object.entries(cfg.filters)) {
          const value = (q as unknown as Record<string, unknown>)[key];
          if (value === undefined) continue;
          if (f.type === 'int') countReq.input(key, mssql.Int, value as number);
          else if (f.type === 'bigint') countReq.input(key, mssql.BigInt, value as number);
          else if (f.type === 'bit') countReq.input(key, mssql.Bit, value ? 1 : 0);
          else countReq.input(key, mssql.NVarChar, value as string);
        }
      }
      const countResult = await countReq.query<{ total: number }>(`
        SELECT COUNT(*) AS total FROM ${cfg.table}
        WHERE ${where.join(' AND ')};
      `);
      const total = countResult.recordset[0]?.total ?? 0;

      res.json(paged(listResult.recordset.map(cfg.mapRow), total, q as PaginationQuery));
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id', validateParams(idParamSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = getParams<IdParam>(req);
      const pool = await getPool();
      const result = await pool.request().input('Id', mssql.BigInt, id).query<Record<string, unknown>>(`
        SELECT ${cfg.selectCols}
        FROM ${cfg.table}
        WHERE ${cfg.pk} = @Id;
      `);
      const row = result.recordset[0];
      if (!row) throw new HttpError(404, 'not_found', 'Registro no encontrado');
      res.json(cfg.mapRow(row));
    } catch (err) {
      next(err);
    }
  });

  return r;
}

const isoDate = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
};
const asBool = (v: unknown): boolean => Boolean(v);
const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------------
// Routers concretos por entidad SAP
// ---------------------------------------------------------------------------
export function buildSapEspecieRouter() {
  return buildReadRouter({
    table: 'sap.EspecieSap',
    pk: 'EspecieSapId',
    searchCols: ['CodigoSap', 'Nombre'],
    filters: { activo: { column: 'Activo', type: 'bit' } },
    selectCols: 'EspecieSapId, CodigoSap, Nombre, Activo, SyncedAt',
    mapRow: (r) => ({
      id: Number(r['EspecieSapId']),
      codigoSap: asStr(r['CodigoSap']),
      nombre: asStr(r['Nombre']),
      activo: asBool(r['Activo']),
      syncedAt: isoDate(r['SyncedAt']),
    }),
  });
}

export function buildSapGrupoVariedadRouter() {
  return buildReadRouter({
    table: 'sap.GrupoVariedadSap',
    pk: 'GrupoVariedadSapId',
    searchCols: ['CodigoSap', 'Nombre'],
    filters: {
      especieId: { column: 'EspecieSapId', type: 'bigint' },
      activo: { column: 'Activo', type: 'bit' },
    },
    selectCols: 'GrupoVariedadSapId, CodigoSap, EspecieSapId, Nombre, Activo, SyncedAt',
    mapRow: (r) => ({
      id: Number(r['GrupoVariedadSapId']),
      codigoSap: asStr(r['CodigoSap']),
      especieId: r['EspecieSapId'] === null ? null : Number(r['EspecieSapId']),
      nombre: asStr(r['Nombre']),
      activo: asBool(r['Activo']),
      syncedAt: isoDate(r['SyncedAt']),
    }),
  });
}

export function buildSapVariedadRouter() {
  return buildReadRouter({
    table: 'sap.VariedadSap',
    pk: 'VariedadSapId',
    searchCols: ['CodigoSap', 'Nombre'],
    filters: {
      especieId: { column: 'EspecieSapId', type: 'bigint' },
      grupoId: { column: 'GrupoVariedadSapId', type: 'bigint' },
      activo: { column: 'Activo', type: 'bit' },
    },
    selectCols:
      'VariedadSapId, CodigoSap, EspecieSapId, GrupoVariedadSapId, Nombre, Activo, SyncedAt',
    mapRow: (r) => ({
      id: Number(r['VariedadSapId']),
      codigoSap: asStr(r['CodigoSap']),
      especieId: r['EspecieSapId'] === null ? null : Number(r['EspecieSapId']),
      grupoId: r['GrupoVariedadSapId'] === null ? null : Number(r['GrupoVariedadSapId']),
      nombre: asStr(r['Nombre']),
      activo: asBool(r['Activo']),
      syncedAt: isoDate(r['SyncedAt']),
    }),
  });
}

export function buildSapProductorRouter() {
  return buildReadRouter({
    table: 'sap.ProductorSap',
    pk: 'ProductorSapId',
    searchCols: ['CodigoSap', 'Nombre', 'Rut'],
    filters: {
      grupoId: { column: 'GrupoProductorId', type: 'int' },
      activo: { column: 'Activo', type: 'bit' },
    },
    selectCols:
      'ProductorSapId, CodigoSap, Rut, Dv, Nombre, Email, GrupoProductorId, CodigoSag, Activo, SyncedAt',
    mapRow: (r) => ({
      id: Number(r['ProductorSapId']),
      codigoSap: asStr(r['CodigoSap']),
      rut: asStr(r['Rut']),
      dv: asStr(r['Dv']),
      nombre: asStr(r['Nombre']),
      email: asStr(r['Email']),
      grupoId: r['GrupoProductorId'] === null ? null : Number(r['GrupoProductorId']),
      codigoSag: asStr(r['CodigoSag']),
      activo: asBool(r['Activo']),
      syncedAt: isoDate(r['SyncedAt']),
    }),
  });
}

function simpleLookupRouter(table: string, pk: string) {
  return buildReadRouter({
    table,
    pk,
    searchCols: ['CodigoSap', 'Nombre'],
    filters: { activo: { column: 'Activo', type: 'bit' } },
    selectCols: `${pk}, CodigoSap, Nombre, Activo, SyncedAt`,
    mapRow: (r) => ({
      id: Number(r[pk]),
      codigoSap: asStr(r['CodigoSap']),
      nombre: asStr(r['Nombre']),
      activo: asBool(r['Activo']),
      syncedAt: isoDate(r['SyncedAt']),
    }),
  });
}

export const buildSapEnvaseRouter    = () => simpleLookupRouter('sap.EnvaseSap',    'EnvaseSapId');
export const buildSapManejoRouter    = () => simpleLookupRouter('sap.ManejoSap',    'ManejoSapId');
export const buildSapCentroRouter    = () => simpleLookupRouter('sap.CentroSap',    'CentroSapId');
export const buildSapTipoFrioRouter  = () => simpleLookupRouter('sap.TipoFrioSap',  'TipoFrioSapId');
export const buildSapProgramaRouter  = () => simpleLookupRouter('sap.ProgramaSap',  'ProgramaSapId');
