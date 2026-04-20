# syntax=docker/dockerfile:1.7
# ══════════════════════════════════════════════════════════
#  est-back — Multi-stage build (Node 22 + Debian bookworm-slim)
#
#  Stages:
#    - deps    : node_modules de runtime (--omit=dev), npm cache montado
#    - builder : deps completas + tsc build (para prd)
#    - dev     : hereda builder; CMD `tsx watch` (fuente via bind mount
#                desde docker-compose.dev.yml). Sin install en runtime.
#    - runtime : imagen prd minima (deps + dist); non-root `est`
#
#  Rotacion de digest base (mensual):
#    docker pull node:22-bookworm-slim
#    docker inspect --format='{{index .RepoDigests 0}}' node:22-bookworm-slim
# ══════════════════════════════════════════════════════════

# ── Stage 1: deps (runtime) ───────────────────────────────
FROM node:22-bookworm-slim@sha256:f3a68cf41a855d227d1b0ab832bed9749469ef38cf4f58182fb8c893bc462383 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm install --omit=dev --no-audit --no-fund; fi

# ── Stage 2: builder (deps completas + tsc) ───────────────
FROM node:22-bookworm-slim@sha256:f3a68cf41a855d227d1b0ab832bed9749469ef38cf4f58182fb8c893bc462383 AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi
COPY tsconfig*.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# ── Stage 3: dev (tsx watch) ──────────────────────────────
FROM builder AS dev
ENV NODE_ENV=development
EXPOSE 4000
CMD ["npx", "tsx", "watch", "--env-file=/app/.env", "src/server.ts"]

# ── Stage 4: runtime (prd) ────────────────────────────────
FROM node:22-bookworm-slim@sha256:f3a68cf41a855d227d1b0ab832bed9749469ef38cf4f58182fb8c893bc462383 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    PORT=4000

RUN groupadd -r est \
 && useradd -r -g est -d /app est \
 && mkdir -p /var/lib/est/uploads \
 && chown -R est:est /app /var/lib/est

COPY --from=deps    --chown=est:est /app/node_modules ./node_modules
COPY --from=builder --chown=est:est /app/dist         ./dist
COPY --chown=est:est package.json package-lock.json* ./

USER est
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
