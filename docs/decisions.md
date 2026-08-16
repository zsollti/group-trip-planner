# Technical decisions

The [README](../README.md) covers the four decisions that shape the _product_ —
advisory voting, the category-aware atomic lock, per-request authorization, and a
cost engine that refuses to convert currencies. This document covers the ones
that shape the _codebase_: which tools I picked, what I rejected, and what each
choice cost me.

I have tried to write down the trade-off rather than the conclusion. A stack list
says what I used; it does not say whether I understood why.

---

## The shape of the repository

**A pnpm + Turborepo monorepo, TypeScript everywhere.**

The decision that everything else follows from is that the request and response
schemas live in one package, `@gtp/types`, imported by both the API and the
front-end. That is only possible if both sides speak the same language, so
TypeScript everywhere stopped being a preference and became structural.

What it buys: renaming a field breaks the build on both sides in the same commit.
I verified this deliberately rather than assuming it — renamed a field, watched
two packages fail to compile, put it back.

What it costs: the API cannot be the fastest thing on the JVM, and I gave up the
option of writing the backend in a language better suited to it. For an
application whose hard problems are all in the database, that was cheap.

Turborepo is doing less work than it looks like. It gives me a cached task graph
so `pnpm build` at the root builds `@gtp/types` before anything that imports it.
With three packages and four apps I could have done that with shell scripts; I
would not want to.

**The shared package holds definitions, the API holds enforcement.**

The cost engine and the permission matrix live in `@gtp/types` as pure functions.
The browser reads them so the UI can hide a control the user cannot use; the
server reads the same objects to actually refuse the request. The rule is written
once, but it is enforced exactly where it can be trusted.

---

## Backend

**NestJS**, over Express or Fastify directly.

I wanted guards as a first-class concept. Authorization in this app is the
feature most likely to be got wrong quietly, and Nest's guard pipeline gives me
one obvious place to put it and one obvious thing to test. Dependency injection
also lets me construct services against a real database in integration tests
without a mocking framework.

The cost is a framework that is opinionated and heavy for an API this size, and
a decorator-driven style that leaks into how the code has to be compiled — see
the testing section, where it forced a decision I did not expect to make.

**Prisma + PostgreSQL**, over TypeORM or raw SQL.

The deciding factor is one line:

```ts
prisma.option.updateMany({ where: { id, version }, data: { ... } })
```

That is the conditional write the entire locking design rests on, and Prisma
expresses it plainly while still generating types from the schema. Migrations
are files in the repository, reviewed like code.

Where Prisma got in the way: it does not create an index for a foreign key, and
neither does PostgreSQL. Twelve of mine had none until I asked the live database
rather than reading the schema file. That is written up in
[`performance-audit.md`](performance-audit.md).

**REST, not GraphQL.**

The client is one SPA that I also wrote. GraphQL solves a problem I do not have —
many clients with divergent data needs — and would have added a schema layer
alongside the Zod contract that already exists. REST also keeps the endpoints
legible to anyone reading the repository without running it.

**WebSockets for chat, and only chat drove the decision.**

In-app chat was a requirement from the start, which forced long-lived connections
into the design and ruled out a purely serverless deployment. Once the socket
existed, live board updates and presence rode along on it. If chat had been cut,
this would be a very different and simpler system — worth saying, because "we
added real-time" is usually the expensive decision people describe as a feature.

**Zod at every boundary**, with the schemas shared.

Validation lives at the edge and the parsed type flows inward. Query parameters
included — those bypassed validation at one point and it took a security pass to
notice, which is exactly the sort of gap "validate at the boundary" is supposed
to make impossible and only does if the boundary has no gaps in it.

---

## Authentication

**A short-lived access token held in memory, plus a rotating refresh token stored
server-side in an httpOnly cookie.**

The access token is never written to `localStorage` and never to a cookie — it
lives in a module variable, so it dies with the tab and cannot be read by
injected script. The refresh token is stored hashed, rotates on every use, and
**reuse of an already-spent token revokes the whole family**, which is what turns
a stolen refresh token from a permanent compromise into a detectable one.

The cost is real: a page reload has no access token and must exchange the refresh
cookie before the first request. That is one extra round trip on every cold load,
and I would make the same trade again.

Authorization deliberately does not live in the token at all — the reasoning is
in the README, because it is a product decision as much as a technical one.

---

## Frontend

**React + Vite, with React Router and TanStack Query** — no meta-framework.

The backend is a separate deployable service. Next.js would have spent most of
its value on a server I already have and would have fought the separation the
rest of the design depends on. Vite builds a static bundle that any web server
can hold, which is why the front-end deploys as a container behind Caddy with no
Node process at all.

TanStack Query is doing the heavy lifting the app would otherwise need a store
for: caching, invalidation after mutations, and optimistic updates for voting.
Deciding is deliberately _not_ optimistic — the one place the UI waits for the
server, because showing a decision that is about to be taken back is worse than
showing a spinner.

**Refetching is scoped to what a change can actually have moved.** The first
version of the live board invalidated the same four queries — the lane, the cost
dashboard, the category list and the trip detail — after every write and again
on every broadcast, so voting cost seven requests: the most frequent act on a
board, and the one that changes the least. Two things fixed that. Writes that
touch exactly one option now apply their own response to the cached lane instead
of discarding it and asking the server what it just told them. And the socket
event carries how far the change reached, so an ordinary edit refreshes two
queries where a decision still refreshes four.

The interesting part is why the exceptions are exceptions. Locking is excluded
from both, because in a single-choice lane it silently unlocks the option it
supersedes — the response describes one card while a second one changed
off-screen — and locking the Dates option writes the trip's own start and end.
A renaming of a lane goes the other way: its options are untouched, but the cost
dashboard labels its lines with the category's name and colour, so skipping it
would leave the chart painted the old shade. The rule that emerges is that a
cache is only as narrow as your account of what a write touches, and that
account has to include the things the server does on your behalf.

**CSS Modules and custom-property design tokens**, not Tailwind or CSS-in-JS.

The tokens are the mechanism, not decoration: light and dark are the same
stylesheet with different custom-property values, resolved by the browser with no
runtime and no flash. It also means the theme is a contract a reviewer can read
in one file. The cost is that I write more CSS by hand than a utility framework
would need.

---

## Testing

**`node:test` for the API, Vitest for the front-end.** This is the decision that
changed under contact with reality, and it is the one I would ask about.

I planned Vitest everywhere — one runner, one config, shared with the build tool.
It does not work for this API. NestJS resolves dependencies from type metadata
emitted by `emitDecoratorMetadata`, and **only `tsc` emits it** — esbuild, which
Vitest uses to transform TypeScript, cannot. Running the API's tests through
Vitest breaks dependency injection in ways that look like unrelated runtime
errors.

So the API compiles with `tsc` and runs the compiled JavaScript under Node's
built-in test runner, which needs no transform at all. The front-end has no
decorators, so it keeps Vitest and the jsdom environment that comes with it. Two
runners is a cost I pay for one framework's compilation model.

**Integration tests run against a real PostgreSQL, never a mock.** Everything I
most needed to be right — the conditional write under concurrency, cascade
deletes, guards actually being mounted — is decided by the database. A mocked
database would have agreed with me about all of it. The full argument, and where
each level of test belongs, is in [`test-strategy.md`](test-strategy.md).

---

## Operations

**Railway**, over Vercel plus a separate database host.

One platform holding the managed PostgreSQL, the API and a persistent volume,
with a private network between them. Long-lived WebSocket connections rule out
most serverless platforms, and splitting the database across a provider boundary
would have bought nothing.

**Everything builds from a committed Dockerfile.** The build is the same locally
and in production, and the deploy configuration is reviewable. Migrations run
when the API container starts rather than at build time, because the database is
only reachable on the private network, which does not exist during a build.

**GitHub Actions gates the merge, and only then deploys.** Deployment triggers on
a successful CI run for that commit, not on the push itself — so a red build
cannot reach production even by racing.

---

## Decisions I reversed

**Object storage: Cloudflare R2, then local disk behind a driver.**

I chose R2 up front — S3-compatible, no egress fees. When I got to implementing
uploads, the honest position was that I did not need it yet and adding a second
vendor to prove I could was the wrong trade.

What I did instead was put the seam in without the vendor. Everything
security-critical — size limit, magic-byte sniffing, `sharp` re-encode that
discards EXIF and GPS, random filename — lives _above_ a four-method
`StorageDriver` interface. Local disk is the only implementation; R2 drops in
behind the same interface without the pipeline changing.

Uploads are proxied through the API rather than presigned direct-to-bucket
specifically so that seam can exist. Nothing reaches storage without passing the
checks first. A presigned URL would have been cheaper and would have moved the
validation to a place I could not enforce it.

**Front-end paradigm: three built, one kept.**

Rather than argue about the interface on paper, I built three genuinely different
front-ends on the same backend — a keyboard-first console, a mobile feed, and a
spatial board — compared them on the same seeded trip, and kept one. The other
two are frozen in the repository. The README has the comparison.

This is the most expensive decision in the project by a wide margin. It was
affordable only because the backend, the contract package and the API client were
built once and shared, which is itself the argument for keeping business logic
out of the component tree.

**Retiring the Budget category.**

The trip was seeded with five built-in categories; it is now seeded with four.
Budget was the one that did not survive using the app.

A category on this board is a question with competing answers: you propose
options, the group dot-votes, an organizer locks one in. A budget is not that
shape. It is a constraint the other decisions are measured against, and there is
no version of "€800 per person" that beats "€900 per person" by getting more
votes.

The concrete harm was in the cost engine. Every non-Dates option carries cost
fields, and the committed total sums **every** locked option across **every**
category — so locking a figure in the Budget lane added it to the same total as
the flights and the hotel that figure was supposed to bound. The number that
looked most authoritative on the board was the one double-counting.

The trip's cost is already an emergent property of what the other lanes decide.
A target to compare it against belongs on the trip, next to the total, not in a
lane pretending to be a decision. That target now exists: `Trip.budgetPerPerson`,
set at creation or in the trip's edit dialog, drawn under the cost strip with
how far the **projection** is under or over it. Per person, because a group
total means nothing until you have divided it by a headcount that is still
moving; and denominated in the trip's own currency, since it would otherwise be
a second answer to a question the trip already answers. It compares against the
projection rather than the locked total because "what will this cost us if the
front-runners win" is the question a target is asked — reading it against what
is already decided would say "fine" right up until the trip was fully decided.
Totals are never converted, so the line names any currency it is not counting
rather than implying those are covered.

The enum value stays. Trips created before this still have their Budget row, and
removing the value from the schema would make every one of those categories fail
to parse — a contract change dressed up as a cleanup. Nothing creates a new one;
the old ones are ordinary deletable categories.

**Selection mode belongs to the trip, not the category.**

Each category carries a `single_choice` flag: lock one option and the others
release, or keep several winners. The seed used to guess it per category —
Dates and Accommodation single, Transport and Activities multi — on a reading of
what those words usually mean.

The reading is not wrong so much as not knowable. A trip to one city wants one
hotel; a trip down a coast wants a different one every third night. A weekend
away has one flight each way, which is two locked options in a category the seed
called single-choice. Guessing per category means guessing wrong for half of
them, and there was no way for a group to say so.

So every category now seeds single-choice — a category is a question, and a
question has an answer — and Organizers switch any of them either way. The
stricter default is the safe one precisely _because_ it is reversible.

Two rules bound it, both refused with a 409 rather than a 403, because neither
is about the caller's role and an Owner is refused for the same reason anyone
else is. Dates cannot be widened: the trip's `start_date`/`end_date` hold one
range, written from the one locked Dates option, and a second winner there would
have nothing to write back to. And a category cannot be narrowed while two of
its options are locked — the flag would leave it already violating its own
invariant, with nobody having chosen which decision survives. The error names
the count and tells the caller to unlock down to one.

**The Decided rail, twice — and then not at all.**

Locked options first lived in a "Decided" column pinned at the front of the lane
row. It was a `.lane`: same width, same cards, distinguished by a dashed border.
It read as a sixth category and it was not one — the lanes are the trip's open
questions and this was the answers — so it became a flat rail above them, beside
the cost it produces.

That was a real improvement to a thing that should not have existed. The tell was
a separate fix: a decision used to _leave_ its lane for the rail, which meant a
lane showed the options a group rejected and not the one it chose — the
comparison the lane exists for, missing its conclusion. So a decision started
staying in its lane as well. Both copies were defended at the time as answering
different questions: the lane says what we picked and what we picked it over, the
rail says what the trip looks like now.

They did not. On any real board the rail was the same set of cards as the tops of
the lanes directly beneath it, in a different shape, and the shorter version was
directly above the longer one. Two views of identical data, one screen apart, is
not two questions.

What the band should hold was the thing the board genuinely could not tell you:
**who you are planning with**. The member count was a number in the subtitle and
the names were two clicks deep behind a "⋯" menu, in an app whose first word is
"group". The crew panel is read-only — roles, kicks, blocks and ownership
transfer stay behind a deliberate click, because a board's most consequential
controls should not be its most ambient ones.

The cost of removing it was one gesture. Drag-to-decide needed a target, so each
lane grew its own, rendered only while one of its own cards is in hand; that is a
shorter drag than crossing the board, and it never leaves the horizontally
scrolling container that broke the rail version once already. Drag-_out_-to-unlock
had nowhere to go and is gone: the settled card's "⋯" menu carries Unlock, as it
always did.

---

## Things I deliberately did not build

- **Currency conversion.** Covered in the README. The short version is that a
  total produced by an invented exchange rate looks authoritative and is wrong.
- **Expense settlement** — who owes whom. This app answers "what would this trip
  cost us if we chose these options", which is a planning question. Settlement is
  a different product with different data.
- **Real bookings or payments.** Out of scope permanently, not deferred.
- **Server-side rendering.** The app is behind a login and its content is
  private; there is nothing to index and no first-paint argument that outweighs
  the deployment simplicity of a static bundle.
- **A microservice split.** It is one deployable API. At this size, service
  boundaries would be cost with no corresponding benefit — and the transactional
  guarantees the locking design depends on are much harder to keep across them.
