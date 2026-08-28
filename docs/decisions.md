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

## The destination is chosen from a list, and still accepts anything

The destination was free text, and a string cannot tell the form which currency
to default to, cannot tell the itinerary which clock a trip runs on, and cannot
be told apart from the same words typed differently. So there is a gazetteer
behind the field now — and the field is still a text input.

**Free text is the design, not the fallback.** A group going to "Dad's cabin", to
"the Dolomites", or to a village of four hundred people is not a case to be
handled; it is a normal trip. So the field suggests and never insists, and
`Trip.destination` remains exactly the string a reader typed or chose. What
choosing adds is a `destinationPlaceId` beside it.

**~74,000 places, not 4.8 million.** GeoNames' full dump is every named
populated place on earth, which is mostly hamlets nobody plans a trip to. The
`cities5000` cut — anywhere over five thousand people — plus every first-level
region and every country covers "Tuscany" and "Portugal" as well as "Lisbon",
and comes to a 2.6 MB gzipped file in the repo.

**Committed, not fetched.** The dataset is built by a script run by hand about
once a year (`places:fetch`) and read from disk by the seeder. A deploy that had
to reach download.geonames.org would fail when somebody else's server did, and
the test suite would need a network. It is the same reasoning as the exchange
rates being optional: a feature that depends on a third party at runtime is a
feature that is down when they are.

**No Postgres extensions.** `unaccent` and `pg_trgm` are both the natural tools
for this and both need `CREATE EXTENSION`, which is a privilege this app should
not demand of whatever database it is pointed at. Accents are folded in the
seeder instead, in JavaScript, into a `searchText` column; a generated `tsvector`
over that column with a GIN index answers word-prefix queries — so "york" finds
New York, which a `startsWith` index never would. The cost is that "lisbonn"
finds nothing, and that is an acceptable cost: people do not misspell the first
four letters of a place they are choosing from a list.

**Ranking is a multiplier, and the two cases either side of it are the test.**
Bands of relevance first — exact name, then prefix, then the rest — was the
obvious design, and the full dataset shows it is wrong: "york" answers with York
in England, Pennsylvania, South Carolina and Nebraska and never reaches New York.
Pure population is wrong the other way, answering "bath" with Bathinda. An exact
name multiplied by fifty holds both.

**The trip copies the timezone; nothing reads it yet.** The itinerary still draws
an option's hours in the _reader's_ zone, so a 07:15 tram in Lisbon shows as
08:15 in Budapest. Fixing that needs the trip to know its own clock, and a trip
cannot know retroactively — so the column is written from the first day the
picker exists, and the rendering change is a separate decision for later. Copied
rather than joined, for the same reason `defaultCurrency` is a column: once a
trip is planned around a clock, that clock is the trip's own data and must not
change because a re-seed corrected a row underneath it.

**Attribution.** The data is © GeoNames and licensed CC BY 4.0. Attribution is a
condition of having it, not a courtesy, and the licence asks for it "in any
reasonable manner for the medium" — which for a search feature means where the
results are. So it is a line under the suggestion list, present exactly when the
data is, rather than a credits page nobody opens. Also in the README, the schema,
and here.

---

## Suspending and erasing an account, from the operator's console

Two powers that reach across every trip in the system, which is why they live on
the console and nowhere else. The console itself is keyed on `ADMIN_EMAILS` and
answers 404 — not 403 — to anyone not on that list.

**A suspension has three columns, not one.** "Is it on", "when does it end" and
"why" are three different answers. A null end beside a set start means
**permanent**: modelling permanence as a far-future date would have left the app
deciding how far is far enough, and every read of it guessing.

**The reason is required, and the suspended person is shown it.** An account
that stops working with no stated cause is the failure this feature exists to
prevent rather than to cause. The message names the suspension, its end date (or
that there is none) and the reason — in the reader's own language, through the
same pattern mechanism every other server message uses. The date inside it is a
bare `YYYY-MM-DD`, because the sentence around it is translated by the exception
filter _later and elsewhere_ than the date would be formatted, and a Hungarian
sentence with an American date in it is worse than a date nobody has to parse.

**A lapsed ban is evaluated as over on read.** No sweeper, no scheduled job —
neither of which this app has — and correct the instant the clock passes rather
than at whatever hour a cron would have run. The row survives its own expiry on
purpose: the console still shows that this account _was_ suspended and why, which
is exactly what an operator needs when the same person writes in again.

**Four paths enforce it, plus the socket.** Sign-in, the Google callback,
refresh-token rotation and the per-request guard. A ban that only closed the
front door would be decorative — an open tab keeps its access token for its full
life and its refresh cookie for a fortnight — so banning also revokes every live
refresh token, and the per-request DB read the authorization model already does
is what makes it take effect _now_. The socket handshake asks separately: it is
the one way into this app that never passes the HTTP guard.

The sign-in check runs **after** the password is verified. A suspension message
names an account's own circumstances, so answering with one on an unverified
guess would turn the login endpoint into an account-existence oracle — undoing
the generic 401 and the dummy-hash timing that are there to prevent exactly that.

**Erasure is the same method the person's own Settings page calls.** Not a copy
of it. What happens to a departing owner's trips is the highest-consequence
branch in the app, and an operator's own implementation of that rule would
eventually answer differently from the preview the person themselves was shown.
So the rule stays the one the app already had (FR-6): each owned trip passes to a
co-organizer, or failing that to the longest-standing participant, and only a
trip with nobody else on it is deleted with everything in it.

It anonymizes rather than `DELETE`s. Personal data goes — address, name,
password, avatar and its bytes — and the row stays so that what this person wrote
in _other people's_ trips renders as "Deleted user" instead of vanishing. A hard
delete would cascade into boards belonging to strangers and rewrite their
history, which is not something a support action about one account should be able
to do.

**Neither can be aimed at yourself.** The console is keyed on the operator's
address, so both buttons would remove the person pressing them from the only tool
that could undo it. Settings has a delete button for anyone who genuinely means
it about themselves.

---

## The cost panel's two readings, and the two budgets behind them

The cost surface has always offered two readings, "The trip" and "Mine". For a
long time both were denominated **per person**, and that single unit was quietly
doing two jobs badly.

It forced a rule. A per-person figure is only comparable with another per-person
figure when both are divided by the same people, so an option priced for part of
the group could not be drawn at all: three of five sharing a €30 taxi owe €10
each, and adding that €10 to an accommodation share divided by five produces a
per-person total nobody actually pays. Those options were therefore dropped from
the ring and named in an aside beneath it. The rule was correct given the unit.
The unit was the mistake.

Two things followed from it that were worse than the aside. The organizer's
picture of what the trip costs was **systematically too low**, because real money
the trip was spending had been excluded from the chart on a technicality about
division. And the sentence under the chart was about the reader's own money while
the chart above it was about everybody's, so the two were measuring different
things a line apart.

**So each reading now picks one unit and holds everything that belongs to it.**
The trip's chart is group money: every locked option, opt-ins included, because
thirty euros is thirty euros the trip spends whoever chips in. The reader's own
chart is their money: their share of the group's decisions, the opt-ins they
joined, and their private items. Neither needs an exception, and
`isSharedByEveryone` and the aside it fed were deleted rather than adapted.

### Why there are two budgets and not one

The trip's target is authored by the organizer, per person, and it is a
guideline for the group's plan. When personal items shipped, the rule was that
private spending is never read against it — the group did not agree to buy
anybody's flight home, and counting it would tell a member they had overspent a
budget they were in fact keeping to.

That rule left the reader's own chart with **no target it could honestly draw**.
The only figure available was the one it must not use, so the chart answered
where the money goes and could not answer how it stands.

The answer was not to relax the rule but to give that chart a number of its own:
a private per-member budget, on the membership, invisible to everyone else. It is
the one figure a personal flight legitimately counts towards, because the person
who set it is the person paying. The trip's target is unchanged and still means
what it meant; a member who sets no budget still gets exactly the old behaviour,
disclaimer sentence and all.

The alternative — dropping the organizer's target and keeping only private ones —
was considered and rejected. "Let's keep this around €500 a head" is the shared
constraint that makes a group converge on options, and without it the trip's
chart has nothing to aim at. It is also the only one of the two that everybody
can see, which is what makes it useful while the plan is still being argued
about.

The trip's ring draws that per-person figure times the member count, so the mark
and the wedges measure the same thing, and the line beneath names the per-person
basis — otherwise it is a number nobody typed.

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
