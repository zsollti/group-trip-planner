# syntax=docker/dockerfile:1
#
# @gtp/web-deck production image (Phase 0.8 deploy dry-run).
#
# Builds the Vite SPA in a Node stage, then serves the static output with Caddy
# (which handles SPA history-fallback — every unknown path returns index.html so
# React Router can take over). Build context is the REPO ROOT.
#
#   docker build -f apps/web-deck/Dockerfile \
#     --build-arg VITE_API_URL=https://<api-domain> -t gtp-web-deck .
#
# On Railway: set the service config-as-code path to apps/web-deck/railway.json
# and set VITE_API_URL as a service variable (Railway passes it as a build arg).

# --- Build stage ---
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Manifests first for install caching (full workspace, see api/Dockerfile note).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web-deck/package.json ./apps/web-deck/package.json
COPY apps/web-feed/package.json ./apps/web-feed/package.json
COPY apps/web-board/package.json ./apps/web-board/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui-primitives/package.json ./packages/ui-primitives/package.json

# Install only the web-deck subtree (web-deck + types + api-client +
# ui-primitives). The API is excluded, so its Prisma postinstall never runs here.
RUN pnpm install --frozen-lockfile --filter "@gtp/web-deck..."

# Sources. turbo builds the three workspace packages before web-deck.
COPY packages ./packages
COPY apps/web-deck ./apps/web-deck

# Vite inlines VITE_* at build time. Railway exposes service variables as build
# args; declare it so `import.meta.env.VITE_API_URL` points at the live API.
# (Changing the API URL later therefore requires a web rebuild/redeploy.)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter "@gtp/web-deck..." build

# --- Runtime stage: static files behind Caddy ---
FROM caddy:2-alpine AS runner
COPY apps/web-deck/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web-deck/dist /srv
# Caddy binds to $PORT (Railway injects it; default 80 for local runs).
EXPOSE 80
