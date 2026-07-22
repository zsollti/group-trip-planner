# Group Trip Planner

A web application for coordinating group trips — proposing and **comparing options**
(accommodation, transport, dates, activities) before committing, gathering group
sentiment through **advisory voting**, and recording explicit, audited group
**decisions** with a live per-currency **cost dashboard**.

> **Status:** early implementation — walking skeleton in progress.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Backend:** NestJS + Prisma + PostgreSQL
- **Frontend:** React + TypeScript + Vite (three parallel UI paradigms through the first milestone)
- **Shared:** Zod contracts + typed API client in `packages/`
- **Real-time:** WebSockets · **Auth:** JWT access + server-stored refresh token
- **Testing:** Vitest (unit/integration) + Playwright (E2E)

## Development

_Setup instructions land with the Phase 0 walking skeleton._

## Deployment

The walking skeleton deploys to [Railway](https://railway.com) as three services
(managed Postgres, the NestJS `api`, and the `web-deck` SPA), each built from a
committed Dockerfile. Step-by-step instructions — including the cross-site
cookie/CORS wiring and the environment-variable matrix — are in
[`DEPLOY.md`](./DEPLOY.md).

## License

All rights reserved.
