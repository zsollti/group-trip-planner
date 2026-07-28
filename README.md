# Group Trip Planner

A web application for coordinating group trips — proposing and **comparing options**
(accommodation, transport, dates, activities) before committing, gathering group
sentiment through **advisory voting**, and recording explicit, audited group
**decisions** with a live per-currency **cost dashboard**.

> **Status:** Phases 0–3 complete. Built as **three parallel UI paradigms** on one
> shared backend, then converged to the **Trip Board** at a design-decision gate and
> polished to flagship finish (the Demoable Milestone; live deploy next).

## Three UIs, one backend — the design exploration

Phases 0–3 were deliberately built as **three genuinely different front-ends on one
shared NestJS backend** — an exercise in UI-paradigm design and in keeping business
logic in shared, framework-agnostic packages. At the end of Phase 3 they were
compared and **converged to one**. The **Trip Board** was chosen and taken to
flagship finish; the other two are **frozen** in the repo as evidence of the
exploration — still readable, but no longer built, linted, or tested (excluded in
`package.json` and CI).

### 🏆 Trip Board — the product (`apps/web-board`)

A spatial planning **canvas**: categories are columns, options are cards, and you
**drag a card onto the "Decided" column to record the group's decision** (backed by
an atomic compare-and-set lock). Per-currency committed-vs-projected cost breakdown,
drag-to-reorder, light/dark, mobile.

![Trip Board — the chosen UI](docs/alternatives/board.png)

### Command Deck — frozen (`apps/web-deck`)

A keyboard-first **console**: a ⌘K command palette, dense option rows, and a
persistent right-rail cost ledger. For power users who live on the keyboard.

![Command Deck — an explored alternative](docs/alternatives/deck.png)

### Trip Feed — frozen (`apps/web-feed`)

A mobile-first **social feed**: option cards in a scrollable stream, tap-to-vote,
and a Plan / 💶 Cost tab switch. For the phone-in-hand, casual-planning case.

![Trip Feed — an explored alternative](docs/alternatives/feed.png)

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Backend:** NestJS + Prisma + PostgreSQL
- **Frontend:** React + TypeScript + Vite — three UI paradigms explored, converged to the Trip Board (above)
- **Shared:** Zod contracts + typed API client in `packages/`
- **Real-time:** WebSockets · **Auth:** JWT access + server-stored refresh token
- **Testing:** `node:test` against a real Postgres (API) + Vitest (board) + Playwright (browser journeys) — see [`docs/test-strategy.md`](./docs/test-strategy.md)

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
