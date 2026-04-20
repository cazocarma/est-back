import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../middleware/error.js';

/**
 * Cliente HTTP del adapter SAP ETL.
 * Documentacion: est-infra/docs/SAP_ETL_AGENT_GUIDE.md.
 *
 * Modo A (on-demand, sin persistencia) — util para pulls directos de tablas SAP.
 * Usamos `POST /api/v1/sap/rfc/query` para la mayoria de maestros.
 */

export interface RfcQueryRequest {
  destination: string;
  table: string;
  fields: readonly string[];
  where?: string;
  rowCount?: number;
}

interface SapEtlEnvelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { requestId?: string; timestampUtc?: string };
}

interface RfcQueryResult {
  records: Record<string, string>[];
  rowCount?: number;
  totalCount?: number;
}

export interface SapEtlConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  defaultDestination: string;
}

function getConfig(): SapEtlConfig {
  if (!env.SAP_ETL_BASE_URL || !env.SAP_ETL_TOKEN) {
    throw new HttpError(
      503,
      'sap_etl_not_configured',
      'El cliente SAP ETL no esta configurado (SAP_ETL_BASE_URL / SAP_ETL_TOKEN)'
    );
  }
  return {
    baseUrl: env.SAP_ETL_BASE_URL.replace(/\/$/, ''),
    token: env.SAP_ETL_TOKEN,
    timeoutMs: env.SAP_ETL_TIMEOUT_MS,
    defaultDestination: 'PRD',
  };
}

export function isSapEtlConfigured(): boolean {
  return Boolean(env.SAP_ETL_BASE_URL && env.SAP_ETL_TOKEN);
}

async function postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const cfg = getConfig();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    const text = await res.text();
    let payload: SapEtlEnvelope<TRes> | null = null;
    try {
      payload = text ? (JSON.parse(text) as SapEtlEnvelope<TRes>) : null;
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const code = payload?.error?.code ?? 'sap_etl_http_error';
      const message = payload?.error?.message ?? `HTTP ${res.status} desde SAP ETL`;
      logger.warn({ path, status: res.status, code, message }, 'sap-etl respuesta no-ok');
      throw new HttpError(res.status === 401 || res.status === 403 ? 502 : 502, code, message);
    }

    if (payload?.error) {
      throw new HttpError(502, payload.error.code, payload.error.message);
    }
    if (payload?.data === undefined || payload?.data === null) {
      throw new HttpError(502, 'sap_etl_empty_payload', 'Respuesta vacia del adapter ETL');
    }
    return payload.data;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new HttpError(504, 'sap_etl_timeout', 'Timeout al consultar SAP ETL');
    }
    if (err instanceof HttpError) throw err;
    logger.error({ err, path }, 'sap-etl error de red');
    throw new HttpError(502, 'sap_etl_network', (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function rfcQuery(req: RfcQueryRequest): Promise<RfcQueryResult> {
  const body = {
    destination: req.destination,
    table: req.table,
    fields: req.fields,
    where: req.where ?? '',
    rowCount: req.rowCount ?? 0,
  };
  return postJson<typeof body, RfcQueryResult>('/api/v1/sap/rfc/query', body);
}

export function getDefaultDestination(): string {
  return getConfig().defaultDestination;
}
