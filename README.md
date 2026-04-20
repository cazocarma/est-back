# est-back

Backend BFF de EST. Node.js 22 + Express 4 + TypeScript estricto + SQL Server + Redis.
Cumple `est-infra/docs/AUTH_STANDARD.md` (patron BFF, tokens server-side, CSRF, auditoria).

## Cómo se corre

**Todo el stack vive en Docker Compose** — este proyecto no se levanta local.
Las variables de entorno viven en `est-infra/.env` (fuente unica de verdad).

```bash
cd ../est-infra
make up-build      # primera vez
make logs-back     # follow logs
```

El Dockerfile es multi-stage: stage `dev` con `tsx watch` (hot-reload via
bind mount), stage `runtime` slim con `dist/` precompilado para produccion.

Ver [est-infra/README.md](../est-infra/README.md) para el detalle operacional.

## Estructura

```
src/
├── app.ts                        # bootstrap (middlewares + rutas)
├── server.ts                     # entry point
├── config/
│   ├── env.ts                    # zod validation (lee de env vars, no .env local)
│   └── logger.ts                 # pino
├── infra/
│   ├── db.ts                     # mssql pool
│   ├── redis.ts                  # ioredis
│   └── sap-etl.client.ts         # cliente del adapter SAP ETL (Fase 3)
├── middleware/
│   ├── requestId.ts
│   ├── error.ts
│   ├── session.ts                # express-session + connect-redis
│   ├── csrf.ts                   # X-CSRF-Token timingSafeEqual
│   ├── authn.ts                  # sesion + refresh silencioso + rol
│   └── requireRole.ts            # requireAdmin con cache
├── shared/
│   ├── pagination.ts
│   └── validate.ts
└── features/
    ├── health/
    ├── auth/                     # Fase 1 - BFF OIDC + DEV_BYPASS
    ├── maestros/                 # Fase 2 - temporadas, plantas, unidades, catalogos
    ├── sap-sync/                 # Fase 3 - sync ETL
    ├── sap/                      # Fase 3 - lectura espejo SAP
    ├── agronomos/                # Fase 4 - CRUD + asignaciones + mi-perfil
    ├── calendario-general/       # Fase 5 - ventanas temporales por especie
    └── estimaciones-generales/   # Fase 6 - estimacion + control de version + snapshots
```

## Dev bypass de Keycloak

Para desarrollo, `AUTH_DEV_BYPASS=true` en `est-infra/.env` hace que
`GET /api/v1/auth/login` cree inmediatamente una sesion con usuario
`dev@greenvic.cl` y rol `est-admin`, sin llamar a Keycloak. El guard de
`config/env.ts` rechaza arranque si `NODE_ENV=production` y el flag esta
activo.

## Estado actual

- [x] Fase 0 - scaffolding + health
- [x] Fase 1 - auth BFF (login/callback/me/logout + CSRF + auditoria + DEV_BYPASS)
- [x] Fase 2 - mantenedores internos (temporadas, plantas, unidades, grupos, catalogos)
- [x] Fase 3 - sync SAP (estructura completa, mapping placeholder)
- [x] Fase 4 - agronomos y asignaciones
- [x] Fase 5 - calendario general (ventanas por especie)
- [x] Fase 6 (MVP) - estimacion general con control de version + snapshots
- [ ] Sub-fase 6.1 - wizard de creacion de estimacion
- [ ] Fase 7 - estimacion bisemanal
- [ ] Fase 8 - reportes + BI

Ver `../est-infra/DEVELOPMENT_PLAN.md` para el roadmap completo.
