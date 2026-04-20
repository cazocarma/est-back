import type { Request } from 'express';
import { Issuer, generators, type Client, type TokenSet } from 'openid-client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error.js';
import { upsertUsuario } from './auth.repository.js';

let cachedClient: Client | null = null;

async function getOidcClient(): Promise<Client> {
  if (cachedClient) return cachedClient;
  const issuer = await Issuer.discover(env.OIDC_DISCOVERY_URL);
  cachedClient = new issuer.Client({
    client_id: env.OIDC_CLIENT_ID,
    client_secret: env.OIDC_CLIENT_SECRET,
    redirect_uris: [env.OIDC_REDIRECT_URI],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
  });
  logger.info({ issuer: issuer.metadata.issuer }, 'OIDC issuer descubierto');
  return cachedClient;
}

export async function buildAuthorizationUrl(req: Request, returnTo: string): Promise<string> {
  const client = await getOidcClient();
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  req.session.preAuth = { state, nonce, codeVerifier, returnTo };

  return client.authorizationUrl({
    scope: env.OIDC_SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
}

export async function handleCallback(req: Request): Promise<{
  usuarioId: number;
  tokenSet: TokenSet;
  returnTo: string;
  role: string;
}> {
  const preAuth = req.session.preAuth;
  if (!preAuth) {
    throw new HttpError(400, 'no_preauth', 'Preauth no encontrado');
  }

  const client = await getOidcClient();
  const params = client.callbackParams(req);

  let tokenSet: TokenSet;
  try {
    tokenSet = await client.callback(env.OIDC_REDIRECT_URI, params, {
      state: preAuth.state,
      nonce: preAuth.nonce,
      code_verifier: preAuth.codeVerifier,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'OIDC callback fallo');
    throw new HttpError(400, 'oidc_callback_failed', 'No se pudo completar el login');
  }

  const claims = tokenSet.claims();
  const roles: string[] = Array.isArray((claims.realm_access as { roles?: string[] } | undefined)?.roles)
    ? ((claims.realm_access as { roles: string[] }).roles)
    : [];

  if (!roles.includes(env.OIDC_REQUIRED_ROLE)) {
    throw new HttpError(403, 'forbidden', 'Usuario sin acceso a EST');
  }

  const usuario = await upsertUsuario({
    sub: claims.sub,
    usuario: (claims.preferred_username as string | undefined) ?? (claims.email as string | undefined) ?? claims.sub,
    nombre: (claims.name as string | undefined) ?? (claims.preferred_username as string | undefined) ?? claims.sub,
    email: (claims.email as string | undefined) ?? null,
    primaryRole: env.OIDC_REQUIRED_ROLE,
  });

  if (!usuario.Activo) {
    throw new HttpError(403, 'forbidden', 'Usuario suspendido');
  }

  return {
    usuarioId: usuario.UsuarioId,
    tokenSet,
    returnTo: preAuth.returnTo,
    role: env.OIDC_REQUIRED_ROLE,
  };
}

export async function refreshIfNeeded(req: Request): Promise<void> {
  const expiresAt = req.session.accessTokenExpiresAt ?? 0;
  const now = Date.now();
  if (expiresAt - now > 30_000) return;
  if (!req.session.refreshToken) throw new Error('No refresh token');

  const client = await getOidcClient();
  const next = await client.refresh(req.session.refreshToken);
  req.session.accessToken = next.access_token;
  if (next.refresh_token) req.session.refreshToken = next.refresh_token;
  if (next.id_token) req.session.idToken = next.id_token;
  req.session.accessTokenExpiresAt = next.expires_at ? next.expires_at * 1000 : now + 300_000;
}

export async function buildEndSessionUrl(idToken: string): Promise<string> {
  const client = await getOidcClient();
  return client.endSessionUrl({
    id_token_hint: idToken,
    post_logout_redirect_uri: env.OIDC_POST_LOGOUT_REDIRECT_URI,
  });
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}
