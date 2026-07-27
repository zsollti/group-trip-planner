# Group Trip Planner — performance audit

The checklist behind Phase 7.3. Like the security audit, this is a **cross-cutting
pass over surfaces that already exist**, not new features: the question is
whether the data layer holds up at the scale the SRS claims (NFR-1 — "thousands
of users, hundreds of trips on a modest instance").

Re-run this checklist whenever a list view is added or a query in one changes.

---

## 1. Indexes

### The four the slice names

All four already existed and were verified against the live database, not just
the schema file:

| Purpose                                 | Index                              |
| --------------------------------------- | ---------------------------------- |
| TripMembership by user (home dashboard) | `trip_memberships_userId_idx`      |
| Messages by channel (chat history)      | `messages_channelId_createdAt_idx` |
| Options by category (board lanes)       | `options_categoryId_idx`           |
| Votes by option (tallies)               | `votes_optionId_idx`               |

The messages index is composite on `(channelId, createdAt)`, which serves both
the channel filter and the ordering the history page reads in.

### Foreign keys — the gap that was actually there

- [x] **Every single-column foreign key now has a supporting index.** Twelve did
      not.

Postgres creates an index for a PRIMARY KEY and for a UNIQUE constraint but
**not** for a FOREIGN KEY. So a referencing column was only indexed if someone
added one deliberately, or if it happened to lead a composite index declared for
some query. Auditing this by reading `schema.prisma` is error-prone — a column
that appears inside a composite `@@unique` may or may not be the _leading_
column, and only the leading column is usable for a lookup. The list was
therefore taken from the database itself, by asking `pg_constraint` for FK
columns with no index whose leading column matched:

```sql
SELECT c.conrelid::regclass, a.attname
FROM pg_constraint c
JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = 'f' AND array_length(c.conkey,1) = 1
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
  );
```

That returned 12 rows; migration `20260727170000_fk_indexes` adds exactly those
12; the query now returns 0.

**Why it matters here is deletes, not selects.** Every delete of a parent row
makes Postgres look for referencing children, and with no index that is a
sequential scan of the child table. This application deletes parents for real:
GDPR account erasure (Phase 1.5) and trip deletion both cascade widely, and the
`onDelete: SetNull` columns (`messages.deletedById`, `options.lockedById`,
`audit_events.actorId`, `email_jobs.userId`, `trip_memberships.joinedViaInviteId`)
are rewritten the same way. `messages.authorId` is the sharpest case: it is the
largest table, and deleting a user cascades through it.

## 2. N+1 audit

- [x] **The list views issue a constant number of statements.** Verified by
      measurement, not inspection — see `apps/api/test/n-plus-one.e2e-spec.ts`.

`PrismaService` now emits Prisma's `query` event (an `emit: "event"` log level
costs nothing while nobody listens), which gives the tests the statements the
database actually received. `PRISMA_LOG_QUERIES=true` turns the same stream into
readable debug output.

**The tests assert shape, not a magic number.** Each view is exercised twice at
different sizes and the two statement counts are required to be _equal_. That is
the real definition of N+1 — cost growing with row count — and it survives the
queries themselves being rewritten, where an assertion like "issues 4 statements"
would just be a brittle snapshot.

| View                     | Result                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Home dashboard           | Already clean. Phase 3.4 built it that way: one query for all options across the page's trips, grouped in memory. |
| Member list              | Already clean — members and blocks in two parallel queries, names joined via `include`.                           |
| Chat history             | Already clean — authors and reactions come through `include`.                                                     |
| **Socket ready payload** | **Was N+1. Fixed.**                                                                                               |

### The one real finding

`ChannelsService.readyPayload` ran **one `COUNT` per channel** to build the
unread badges, on every socket connect. Measured before the fix: **3 statements
for 1 channel, 8 for 6.**

It mattered because Phase 4.5 made channels _on-demand and per-category_, so a
normal trip has several and an active board has many — the fan-out grows with
the board, on the hottest path there is (every reconnect re-runs it).

The fix is a single aggregate. This is the one place in the codebase that drops
to `$queryRaw`, and the reason is specific: **each channel has its own cutoff** —
that member's read cursor in `channel_reads` — and a per-row comparison against
another table cannot be expressed as one Prisma `groupBy`. A `LEFT JOIN` keeps
never-read channels (a NULL cursor counts everything), which preserves the
original semantics exactly. Values are bound as parameters by the tagged
template, never interpolated.

The behavioural safety net is that the Phase-4.4 unread tests — written long
before this rewrite — still pass unchanged: counts from others, own messages
never counted, mark-read clears.

## 3. Light load check

- [x] **The scale claim is directionally supported.**

`pnpm --filter @gtp/api perf:load-check` seeds a realistic-shaped dataset, times
the read paths behind the list views, and removes what it created. It is
deliberately **not** in the CI gate and **not** a load test: no concurrency, no
ramp, no percentile beyond p95. Per Phase-7 decision 3, the goal is to sanity
check the claim, not to prove a throughput number.

Dataset: 500 users, 200 trips, 6 members / 12 options / 60 messages per trip
(≈12,000 messages, 2,400 options, 1,200 memberships). The timed account is a
member of **all 200 trips** — the worst realistic case for the home dashboard.

Measured on the dev machine against local Postgres 16 in Docker, 30 sequential
iterations each:

| Read path                            |    p50 |    p95 |
| ------------------------------------ | -----: | -----: |
| Home dashboard (page 1 of 200 trips) | 12.9ms | 25.5ms |
| Home dashboard (last page)           | 14.5ms | 18.4ms |
| Member list                          |  2.9ms |  4.2ms |
| Chat history (page of 60)            |  7.9ms |  9.5ms |
| Socket ready payload                 |  2.6ms |  3.4ms |

Every path stays well inside a 100ms budget with headroom, and the home
dashboard — the heaviest, since it summarises cost across every trip on the page
— does not degrade between the first page and the last, which is what offset
pagination over an indexed membership lookup should look like.

## Known limits

- **Sequential, single-client, local.** No concurrency, no connection-pool
  saturation, no network latency between app and database. Production numbers
  will be worse; the point of the check is the _shape_ of the curve, not these
  absolute figures.
- **The measurement machine is a dev laptop**, not the modest instance the claim
  is about.
- Timings call the services directly, so HTTP, auth, and serialization overhead
  are excluded. That is intentional — this audits the data layer — but it means
  these are not end-to-end response times.
- **No `EXPLAIN ANALYZE` review.** Index _presence_ is verified; that the planner
  actually chooses each one under production statistics is not.
- The N+1 tests cover the four list views the slice names. A new list view gets
  no coverage until someone adds it to that spec.
- Write paths (propose, vote, lock, post) are not timed at all — this pass is
  about read scale.
