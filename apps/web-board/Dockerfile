# syntax=docker/dockerfile:1
#
# @gtp/web-board production image (Phase 7.5).
#
# The Trip Board is the Phase-3.5 winner and the app that ships. Builds the Vite
# SPA in a Node stage, then serves the static output with Caddy, which handles
# SPA history-fallback and the security headers (see the Caddyfile). Build
# context is the REPO ROOT — this is a pnpm workspace.
#
#   docker build -f apps/web-board/Dockerfile \
#     --build-arg VITE_API_URL=https://<api-domain> -t gtp-web-board .
#
# On Railway: set the service config-as-code path to apps/web-board/railway.json
# and set VITE_API_URL as a service variable (Railway passes it as a build arg).

# --- Build stage ---
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Manifests first for install caching (full workspace, see api/Dockerfile note).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web-board/package.json ./apps/web-board/package.json
COPY apps/web-deck/package.json ./apps/web-deck/package.json
COPY apps/web-feed/package.json ./apps/web-feed/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui-primitives/package.json ./packages/ui-primitives/package.json

# Install only the web-board subtree (web-board + types + api-client +
# ui-primitives). The API is excluded, so its Prisma postinstall never runs here.
RUN pnpm install --frozen-lockfile --filter "@gtp/web-board..."

# Sources. turbo builds the three workspace packages before web-board.
COPY packages ./packages
COPY apps/web-board ./apps/web-board

# Vite inlines VITE_* at build time. Railway exposes service variables as build
# args; declare them so the bundle points at the live API and (when a DSN is
# configured) reports its errors. Changing either later needs a web rebuild.
ARG VITE_API_URL
ARG VITE_SENTRY_DSN
ARG VITE_APP_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_APP_ENV=$VITE_APP_ENV
RUN pnpm --filter "@gtp/web-board..." build

# --- Runtime stage: static files behind Caddy ---
FROM caddy:2-alpine AS runner
COPY apps/web-board/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web-board/dist /srv
# Caddy binds to $PORT (Railway injects it; default 80 for local runs).
EXPOSE 80
