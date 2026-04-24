import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getRedis } from '../../infra/redis.js';
import { getIssuerMetadata } from './auth.service.js';
import { logAuditEventRaw } from './auth.audit.js';

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const SESSION_KEY_PREFIX = 'est:sess:';

// Cache del JWKS resolver. Se crea una sola vez.
let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getJwks() {
  if (jwksResolver) return jwksResolver;
  const { jwksUri } = await getIssuerMetadata();
  jwksResolver = createRemoteJWKSet(new URL(jwksUri));
  return jwksResolver;
}

interface LogoutTokenClaims extends JWTPayload {
  sid?: string;
  events?: Record<string, unknown>;
  nonce?: string;
}

async function verifyLogoutToken(token: string): Promise<LogoutTokenClaims> {
  const jwks = await getJwks();
  const { issuer } = await getIssuerMetadata();

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: env.OIDC_CLIENT_ID,
  });

  const claims = payload as LogoutTokenClaims;

  // OIDC Back-Channel Logout 1.0 §2.6
  if (claims.nonce !== undefined) {
    throw new Error('logout_token no debe contener nonce');
  }
  if (!claims.events || typeof claims.events !== 'object') {
    throw new Error('logout_token sin claim events');
  }
  if (!(BACKCHANNEL_EVENT in claims.events)) {
    throw new Error('logout_token sin evento backchannel-logout');
  }
  if (!claims.sub && !claims.sid) {
    throw new Error('logout_token debe traer sub o sid');
  }

  return claims;
}

/**
 * Busca en Redis todas las sesiones cuyo payload matchee kcSid o sub
 * y las destruye. Retorna la cantidad de sesiones borradas.
 */
async function destroyMatchingSessions(
  kcSid: string | null,
  sub: string | null
): Promise<{ deleted: number; scanned: number }> {
  const redis = getRedis();
  let cursor = '0';
  let deleted = 0;
  let scanned = 0;

  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_KEY_PREFIX}*`,
      'COUNT',
      200
    );
    cursor = next;
    if (keys.length === 0) continue;

    const payloads = await redis.mget(...keys);

    for (let i = 0; i < keys.length; i++) {
      scanned++;
      const key = keys[i];
      const raw = payloads[i];
      if (!key || !raw) continue;

      let data: { kcSid?: string; sub?: string } | null = null;
      try {
        data = JSON.parse(raw) as { kcSid?: string; sub?: string };
      } catch {
        continue;
      }

      const matchesKcSid = kcSid && data.kcSid === kcSid;
      const matchesSub = !kcSid && sub && data.sub === sub;

      if (matchesKcSid || matchesSub) {
        await redis.del(key);
        deleted++;
      }
    }
  } while (cursor !== '0');

  return { deleted, scanned };
}

export function buildBackchannelLogoutRouter(): Router {
  const r = Router();

  // Rate limit separado: Keycloak debería pegarle muy poco.
  // 120 req/min permite ráfagas de logout masivo sin bloquear.
  const limiter = rateLimit({ windowMs: 60_000, limit: 120 });

  // Parser urlencoded LOCAL (AUTH_STANDARD §8 prohíbe urlencoded global).
  const parseForm = express.urlencoded({ extended: false, limit: '32kb' });

  r.post(
    '/backchannel-logout',
    limiter,
    parseForm,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const token = typeof req.body?.logout_token === 'string' ? req.body.logout_token : null;
        if (!token) {
          res.status(400).json({ error: { code: 'missing_logout_token', message: 'logout_token requerido' } });
          return;
        }

        let claims: LogoutTokenClaims;
        try {
          claims = await verifyLogoutToken(token);
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'logout_token invalido');
          // Spec: responder 400 ante token invalido. No dar información.
          res.status(400).json({ error: { code: 'invalid_logout_token', message: 'Token invalido' } });
          return;
        }

        const kcSid = claims.sid ?? null;
        const sub = claims.sub ?? null;

        const { deleted, scanned } = await destroyMatchingSessions(kcSid, sub);

        await logAuditEventRaw(
          { sub, ip: req.ip ?? null },
          'BACKCHANNEL_LOGOUT',
          `deleted=${deleted}/${scanned}`
        );

        logger.info({ sub, kcSid, deleted, scanned }, 'backchannel logout procesado');

        // Spec: 200 OK, Cache-Control: no-store, sin Set-Cookie, sin body útil.
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).end();
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}
