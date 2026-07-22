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

## License

All rights reserved.
