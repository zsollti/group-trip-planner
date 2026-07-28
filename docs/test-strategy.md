# Group Trip Planner — test strategy

The map behind Phase 7.4. The posture is the SRS §13 one: **demonstrative, not
exhaustive** — a strong, argued example at every level rather than a coverage
number. This document says what each level owns, so a new test can be put where
it belongs instead of where it is easiest to write.

Everything below runs in CI on every pull request and blocks the merge.

---

## 1. The levels

| Level                   | Runs on                        | Owns                                                                           |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| **Unit** (API + shared) | `node:test`, no I/O            | Pure domain rules: cost engine, permission matrix, lifecycle/expiry, staleness |
| **Unit** (board)        | Vitest + jsdom, mocked `fetch` | Component behaviour, four states, dialog focus management, pure UI helpers     |
| **Integration** (API)   | `node:test` + a real Postgres  | Guards, transactions, concurrency, cascades — everything the database decides  |
| **End-to-end**          | Playwright + Chromium          | That the built bundle, the built server, CORS and the socket agree             |

The dividing line is what each level is _able_ to prove. A permission cell is a
pure function, so it is a unit test; that the guard is actually mounted on a
route is an integration test; that the refusal reaches a person as a refusal is
an end-to-end test. The same rule is why there is exactly one browser assertion
about authorization and thirty-six API ones.

There are **no screenshot or visual-diff tests** anywhere, by standing project
decision — every assertion is behavioural.

---

## 2. The four backbone tests (SRS §10)

These are the named integration tests, all against a real database.

| Backbone                          | Where                                     |
| --------------------------------- | ----------------------------------------- |
| Authorization blocks a non-member | `apps/api/test/backbone-idor.e2e-spec.ts` |
| Atomic lock rejects the loser     | `apps/api/test/locking.e2e-spec.ts`       |
| Account deletion transfers owner  | `apps/api/test/account.e2e-spec.ts`       |
| Lifecycle transitions             | `apps/api/test/lifecycle.e2e-spec.ts`     |

Two of them were strengthened in 7.4 rather than written from scratch:

**The IDOR sweep is self-maintaining.** Every module already asserted its own
non-member case, and the 7.2 audit swept the spine by hand — but both check the
routes that existed when they were written. The sweep instead reads the routes
**Express has actually registered**, and fails if a `trips/:id/...` route is
missing from its table. A new trip-scoped route cannot ship without someone
deciding, in that file, who may call it. Each route must answer an outsider with
`404` — never `403` (which would confirm the trip exists), never `400` (guards
run before validation pipes, so a refusal must not describe the route's shape),
never `500` (a foreign id must not reach Prisma). It also covers the other half
of the rule: nested ids are re-scoped to their parent, so a member of one trip
cannot delete another trip's category by pasting its id into their own URL.

**The lock race is now run concurrently.** The original tests submit a stale
version _after_ the winner committed, which is a fair simulation but not the race
itself — a read-check-then-write implementation would pass them. The added cases
fire five simultaneous locks at one option (exactly one `201`, four `409`, one
audit row) and two simultaneous locks at different options in a single-choice
category (exactly one locked option survives).

---

## 3. The browser journeys

Two, in `e2e/tests/`, each with two real browser contexts because the product is
two people planning together.

1. **The core journey** — register → create trip → invite → join → propose →
   vote → lock. The invite token is read out of the **clipboard**, because that
   is the only route a real user has to it. The proposal is asserted on the
   owner's screen **without a reload**, which is the only place the socket, the
   board's live sync and the REST write are proved to agree. The finished
   decision is checked against the boards overview after a reload — deliberately,
   since tiles carry a 30-second `staleTime` and the join happened in another
   browser, so a soft navigation legitimately shows the previous figures.
2. **Reconnect recovery** (Phase 4.4) — a member's socket is severed, the group
   carries on without them, and on reconnect the missed messages arrive in order,
   with no duplicate of the one already on screen, and the socket is live again
   rather than merely caught up.

The drop in (2) is produced with `page.routeWebSocket`, not `context.setOffline`:
the client opens a pure WebSocket, and an established one survives an offline
browser until Socket.IO's ping timeout notices some forty-five seconds later.
Routing severs it on demand and lets the test decide when reconnecting starts
working again.

Both journeys were verified to **fail when the behaviour they cover is removed** —
the recovery journey was re-run with the catch-up fetch disabled, and reported the
missing messages rather than passing.

### Why the cast is seeded

`POST /auth/register` allows five calls a minute per IP (Phase 7.1) and every
browser here shares one address, so a suite that registered each of its cast
through the form would start failing on the sixth for a reason unrelated to what
it was testing. The registration form is exercised for real, once, by the account
that opens the core journey; everyone else is inserted directly. The API's own
e2e helpers do the same, for the same reason.

Verified email is likewise set directly: creating a trip is gated on it (FR-7),
the link only leaves the server as mail, and `auth.e2e-spec.ts` already covers
that token end to end against a real one.

---

## 4. Running them

```bash
docker compose up -d db                     # the integration + e2e database
pnpm test                                   # unit + integration (API and board)
pnpm --filter @gtp/e2e run e2e:install      # once, per machine — downloads Chromium
pnpm --filter @gtp/e2e run test:e2e         # the browser journeys
```

The Playwright config builds and starts both servers itself (API on `:3100`, the
built SPA on `:4173`), so the browser suite needs nothing running beforehand
except Postgres. It talks to the API across an origin boundary on purpose, the
way production does, so CORS is genuinely exercised.

In CI the browser install and the journeys are **separate steps** from `pnpm
test`, so a browser that fails to download is obviously not a failing test. The
Playwright report is uploaded as an artifact when a run fails.

---

## 5. Known limits

- **The E2E suite is one browser.** Chromium only. Cross-browser differences —
  and mobile layout in particular — are not covered.
- **No load or soak testing at this level.** The directional scale check lives in
  `apps/api/test/load-check.ts` (see `docs/performance-audit.md`); it is run by
  hand, not in CI.
- **No accessibility assertions in the browser suite.** The a11y work from 6.3
  is covered by DOM tests (focus trap, restore, labelling) and by the checklist
  in `docs/ui-audit.md`, not by an automated axe pass.
- **Mail is never actually sent** in any test. Delivery through Resend is
  unexercised; only the queue, the templating and the token logic are.
- **Coverage is not measured**, deliberately — the posture is demonstrative, and
  a percentage would invite writing tests to move the number.
