import session from 'express-session';
import RedisStore from 'connect-redis';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { getRedis } from '../infra/redis.js';

// Payload de sesion segun AUTH_STANDARD.md §4
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    sub?: string;
    kcSid?: string;         // claim 'sid' del id_token — necesario para backchannel logout (§11.2)
    usuario?: string;
    nombre?: string;
    email?: string | null;
    role?: string;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpiresAt?: number;
    csrfToken?: string;
    // Preauth (usado solo entre /login y /callback)
    preAuth?: {
      state: string;
      nonce: string;
      codeVerifier: string;
      returnTo: string;
    };
  }
}

export function buildSessionMiddleware(): RequestHandler {
  const store = new RedisStore({
    client: getRedis(),
    prefix: 'est:sess:',
    ttl: env.SESSION_TTL_SECONDS,
  });

  return session({
    store,
    name: env.SESSION_COOKIE_NAME,
    secret: env.SESSION_COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.SESSION_COOKIE_SECURE,
      sameSite: env.SESSION_COOKIE_SAMESITE,
      path: '/',
      maxAge: env.SESSION_TTL_SECONDS * 1000,
    },
  });
}
