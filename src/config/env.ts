import { z } from 'zod';

const bool = z
  .string()
  .transform((v) => v.toLowerCase() === 'true')
  .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // DB
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_ENCRYPT: bool.default('true'),
  DB_TRUST_SERVER_CERTIFICATE: bool.default('true'),

  // OIDC (BFF — ver platform/docs/AUTH_STANDARD.md)
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_DISCOVERY_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  OIDC_POST_LOGOUT_REDIRECT_URI: z.string().url(),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OIDC_REQUIRED_ROLE: z.string().min(1),

  // Sesion BFF (connect-redis contra platform_cache, DB 4)
  SESSION_REDIS_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default('est.sid'),
  SESSION_COOKIE_SECRET: z.string().min(32),
  SESSION_COOKIE_SECURE: bool.default('true'),
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('strict'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),

  // SAP ETL adapter
  SAP_ETL_BASE_URL: z.string().url().optional(),
  SAP_ETL_TOKEN: z.string().min(1).optional(),
  SAP_ETL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuracion invalida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
