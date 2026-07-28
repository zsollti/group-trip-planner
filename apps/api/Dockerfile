# syntax=docker/dockerfile:1
#
# @gtp/api production image (Phase 0.8 deploy dry-run).
#
# Build context is the REPO ROOT — this is a pnpm workspace and the API depends
# on the workspace package @gtp/types, so the image must see the whole workspace
# (lockfile + every package manifest) to install and build correctly.
#
#   docker build -f apps/api/Dockerfile -t gtp-api .   # run from repo root
#
# On Railway: set the service's config-as-code path to apps/api/railway.json
# (which points here) and leave the service Root Directory at "/".
FROM node:22-slim

# argon2 (password hashing) and Prisma's query engine both need OpenSSL at
# runtime; ca-certificates lets the container reach Resend/Postgres over TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm is pinned via package.json "packageManager"; corepack activates it.
RUN corepack enable
WORKDIR /app

# --- 1. Manifests first, so `pnpm install` is cached until deps change ---
# The whole workspace's manifests are required: pnpm validates the lockfile
# against every package even when installing only the API subtree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui-primitives/package.json ./packages/ui-primitives/package.json
COPY apps/web-deck/package.json ./apps/web-deck/package.json
COPY apps/web-feed/package.json ./apps/web-feed/package.json
COPY apps/web-board/package.json ./apps/web-board/package.json

# The API's postinstall runs `prisma generate`, which needs the schema present
# at install time — copy it before installing.
COPY apps/api/prisma ./apps/api/prisma

# Install only the @gtp/api subtree (api + @gtp/types). devDependencies are
# included (NODE_ENV is not "production" yet) because the build needs tsc and
# the Prisma CLI. postinstall generates the Prisma client for THIS platform
# (linux/openssl), so the engine matches the runtime image.
RUN pnpm install --frozen-lockfile --filter "@gtp/api..."

# --- 2. Sources + build (turbo builds @gtp/types before @gtp/api) ---
COPY packages/types ./packages/types
COPY apps/api ./apps/api
RUN pnpm --filter "@gtp/api..." build

# --- 3. Runtime ---
# Set production only now: it drives Secure cookies + the env contract, and
# setting it earlier would have made pnpm skip the devDeps the build needs.
ENV NODE_ENV=production
WORKDIR /app/apps/api
# Informational; the app listens on $PORT (Railway injects it; default 3000).
EXPOSE 3000

# Apply any pending migrations against the managed Postgres, then boot. Running
# migrate at container start (not build) means the DB is reachable via Railway's
# private network. On failure the process exits non-zero and Railway restarts.
#
# `--import ./dist/observability/instrument.js` starts Sentry in the loader
# phase (Phase 7.5). main.ts imports the same module anyway, so errors would be
# captured either way; preloading it is what lets the SDK install its ESM hooks
# *before* the libraries it instruments are resolved, which is where the
# request/query breadcrumbs attached to a report come from. Evaluated once —
# both paths resolve to the same module URL. No-ops without SENTRY_DSN.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node --import ./dist/observability/instrument.js dist/main.js"]
