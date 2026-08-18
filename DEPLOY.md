# Deploy — production runbook (Railway)

Everything needed to put **Group Trip Planner** on a public URL and keep it
there: the services, the environment matrix, migrations, backups, monitoring,
and the CI-gated deploy on merge to `main`.

**Production only, no staging.** The full gate (lint · typecheck · build · unit
· integration · Playwright) runs on every pull request; merging to `main` is the
deploy. There is no second environment to drift out of sync with this one.

| Service     | What it is                              | Built from                  | Public |
| ----------- | --------------------------------------- | --------------------------- | ------ |
| `Postgres`  | Managed database + daily backups        | Railway plugin              | no     |
| `api`       | NestJS API; applies migrations on boot  | `apps/api/Dockerfile`       | yes    |
| `web-board` | The Trip Board SPA, static behind Caddy | `apps/web-board/Dockerfile` | yes    |

The API and the web app get **separate** domains — two different sites. That is
the constraint the whole auth transport is built around, and Phase 0.8 proved it
early on purpose: the refresh cookie is `SameSite=None; Secure` and the API
answers CORS with an explicit origin allowlist. Both halves have to line up, or
login appears to work and silent refresh quietly fails.

> **Cost.** This fits Railway's Trial ($5 credit) but consumes it while running —
> the database is the main drain. See [Teardown](#10-teardown) to stop usage.

---

## 0. Prerequisites

- A Railway account, signed in with GitHub, with the app installed on
  `zsollti/group-trip-planner`.
- The code on `main` (Railway builds from a branch or an upload; both need the
  Dockerfiles and `railway.json` files present).
- One secret generated locally:

  ```bash
  openssl rand -hex 32     # JWT_SECRET — the API refuses the placeholder in production
  ```

---

## 1. Project + database

1. Railway → **New Project** → **Deploy PostgreSQL**.
2. Leave the service named **`Postgres`** — the API references it as
   `${{Postgres.DATABASE_URL}}`, which breaks if it is renamed.

### Backups

Postgres service → **Settings → Backups** → enable **daily** snapshots and set
retention (7 days is plenty here). Railway takes these on the managed volume; no
application change is involved.

Two things worth knowing before you need them:

- A restore replaces the volume, so note the point-in-time you restore to.
- Backups cover the **database only**. Uploaded images live on the API's volume
  (§4) and are not in the snapshot; they are re-uploadable content, and losing
  them costs a cover photo rather than a trip's decisions.

---

## 2. The `api` service

1. **+ New** → **GitHub Repo** → `zsollti/group-trip-planner`. Rename the
   service to **`api`** (Settings → Name) — the deploy workflow targets it by
   name.
2. **Settings → Source**
   - **Root Directory:** empty / `/` — the Dockerfile builds from the repo root
     because this is a pnpm workspace.
   - **Config file:** `apps/api/railway.json` (selects the Dockerfile builder and
     the `/health` healthcheck). If the field is missing in your UI, add a
     service variable `RAILWAY_DOCKERFILE_PATH = apps/api/Dockerfile` instead.
   - **Turn OFF automatic deploys on push.** Deploys come from the CI-gated
     workflow in §8; leaving both on means every merge deploys twice, and the
     Railway-native one starts before CI has finished.
3. **Settings → Networking → Generate Domain**, port **3000**. Copy the domain.
4. Set the variables in §3 **before** the first deploy — a boot without
   `DATABASE_URL`/`JWT_SECRET` fails fast by design.

---

## 3. Environment matrix

### `api`

| Variable          | Value                                | Why                                                                                                                                               |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`         | Reference variable — tracks the Postgres service over the private net.                                                                            |
| `JWT_SECRET`      | _(the `openssl rand -hex 32` value)_ | Required. Production **rejects** the `.env.example` placeholder.                                                                                  |
| `NODE_ENV`        | `production`                         | Baked into the image too; set it so the production checks are on.                                                                                 |
| `COOKIE_SAMESITE` | `lax`                                | `lax` **only** if the api is a subdomain of the web app's domain (§5, "Same-site API domain"). `none` otherwise — which breaks sign-in on mobile. |
| `COOKIE_SECURE`   | `true`                               | A `SameSite=None` cookie without `Secure` is dropped by every browser.                                                                            |
| `CORS_ORIGINS`    | `https://<web-board domain>`         | The origin allowlist. Production **refuses to boot** on a non-https one.                                                                          |
| `WEB_APP_URL`     | `https://<web-board domain>`         | Where verification / unsubscribe links land in the SPA.                                                                                           |
| `API_PUBLIC_URL`  | `https://<api domain>`               | Unsubscribe links are clicked from a mail client with no session, so they hit the API directly.                                                   |
| `UPLOAD_DIR`      | `/data/uploads`                      | **Must be absolute, on the volume from §4.** See the warning there.                                                                               |

Optional but wanted in a real deployment:

| Variable               | Value                                         | Effect                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`       | _(Resend key)_                                | Sends real email. Without it, verification links are written to the logs.                                                                                                                                                                                                                          |
| `EMAIL_FROM`           | `Trips <no-reply@your-domain>`                | Needs a domain verified with Resend; the default sender is Resend's sandbox.                                                                                                                                                                                                                       |
| `SENTRY_DSN`           | _(project DSN)_                               | Turns on error reporting. Unset = the SDK is never initialised.                                                                                                                                                                                                                                    |
| `SENTRY_ENVIRONMENT`   | `production`                                  | Separates real events from a local reproduction.                                                                                                                                                                                                                                                   |
| `SENTRY_RELEASE`       | _(commit sha)_                                | Links a stack trace to source. Optional; events still group without it.                                                                                                                                                                                                                            |
| `GOOGLE_CLIENT_ID`     | _(OAuth client id)_                           | All **three** are needed, or `GET /auth/google` 404s and the button is off.                                                                                                                                                                                                                        |
| `GOOGLE_CLIENT_SECRET` | _(OAuth client secret)_                       |                                                                                                                                                                                                                                                                                                    |
| `GOOGLE_CALLBACK_URL`  | `https://<api domain>/auth/google/callback`   | Must match the Google console entry **byte for byte**.                                                                                                                                                                                                                                             |
| `EXCHANGE_RATES_URL`   | `https://api.frankfurter.app/latest?from=EUR` | Turns on the approximate all-in total. **Unset = no fetching at all**: the rate table stays empty, every dashboard reports `converted: null`, and the cost strip is the per-currency one it has always been. No API key; ECB reference rates, ~30 currencies.                                      |
| `ADMIN_EMAILS`         | _(your address)_                              | Who may open the operator console at `/admin`. Comma-separated, case-insensitive. **Unset = the console is off** and every `/admin` route answers 404 to everyone — deliberately, since it reads across every account. Granting or revoking is a variable change and a restart, never a migration. |

### `web-board`

| Variable          | Value                   | Notes                                                                                                         |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`    | `https://<api domain>`  | **Build-time.** Vite inlines it; changing it needs a rebuild.                                                 |
| `VITE_SENTRY_DSN` | _(browser project DSN)_ | **Build-time.** Omit and the SDK is tree-shaken out of the bundle entirely.                                   |
| `VITE_APP_ENV`    | `production`            | **Build-time.** Labels browser events.                                                                        |
| `API_ORIGIN`      | `https://<api domain>`  | **Runtime.** Feeds the CSP in `apps/web-board/Caddyfile`.                                                     |
| `API_WS_ORIGIN`   | `wss://<api domain>`    | **Runtime.** A `wss://` origin is not covered by the matching `https://` entry — the websocket needs its own. |

> The build-time / runtime split is the one that catches people. The three
> `VITE_*` values are frozen into the JavaScript when the image is built; the two
> Caddy values are read when the container starts. A `VITE_*` change that is not
> followed by a rebuild silently keeps the old value.

---

## 4. Persistent storage for uploads

Covers and avatars are re-encoded and written to disk by the local storage
driver (`StorageDriver` / `LocalDiskStorage`, Phase 6.1 — swapping in R2 is a
provider change and nothing above the seam moves).

**A container's filesystem is discarded on every redeploy.** Without a volume,
every uploaded image disappears the next time `main` is merged, while the
database rows keep pointing at them — so the app serves 404s for pictures that
users can see are missing but cannot re-attach.

1. `api` service → **Settings → Volumes** → **Add Volume**, mount path
   **`/data`**.
2. Confirm `UPLOAD_DIR=/data/uploads` in the variables (§3). The directory is
   created on first write.

The API enforces this: in production it refuses to start on a relative
`UPLOAD_DIR`, with a message saying why. That check exists because this is a
data-loss bug no test can see — it needs two deploys to appear.

---

## 5. The `web-board` service

1. **+ New** → **GitHub Repo** → same repo (one repo can back several services).
   Rename to **`web-board`**.
2. **Settings → Source** → Root Directory empty / `/`; config file
   `apps/web-board/railway.json`. Turn off automatic deploys, as with the API.
3. Add the variables from §3.
4. **Settings → Networking → Generate Domain**, port **80** (Caddy).
5. Go back and set the API's `CORS_ORIGINS` / `WEB_APP_URL` to this domain, then
   redeploy the API.

### Same-site API domain (required, or mobile sign-in breaks)

**Put the API on a subdomain of the web app's domain** — `api.example.com` next to
`trips.example.com`, not a generated `*.up.railway.app` host. This is not a
cosmetic preference; a foreign API domain breaks sign-in on every phone.

Why: the session is an httpOnly refresh cookie set on the **API** origin, and the
SPA trades it for an access token with a cross-site `POST /auth/refresh`. If the
API is on a different registrable domain, that cookie is a **third-party** cookie.
Desktop Chrome still sends it, so the deployment looks healthy. Every iOS browser
is WebKit, and WebKit blocks third-party cookies outright — the refresh 401s, the
route guard bounces to the sign-in card, and the user is dumped back on the login
page. Google sign-in fails completely, because OAuth has no other way to deliver a
token; email/password appears to work until the first reload, which makes this
easy to misdiagnose.

Put both on one registrable domain and the cookie is same-site, `Lax` is enough,
and no browser has an opinion about it. The two hosts are still different
_origins_, so CORS is still required and unchanged.

1. `api` service → **Settings → Networking → Custom Domain** → `api.<your domain>`;
   add the CNAME it gives you at your DNS provider.
2. Set `GOOGLE_CALLBACK_URL` to `https://api.<your domain>/auth/google/callback`
   and add the same string in the Google console (below).
3. Set `COOKIE_SAMESITE=lax`. Leave `COOKIE_DOMAIN` **unset** — a host-only cookie
   on the API host is correct, since that host is what the refresh call goes to.
4. Point the web service's API base URL at the new host and redeploy it.

Keep the old generated domain attached until the new one serves traffic, so
nothing 404s mid-switch.

### Google OAuth

The Google client is created in the [Cloud console](https://console.cloud.google.com/apis/credentials).
Add the production callback as an **Authorized redirect URI**:

```
https://<api domain>/auth/google/callback
```

It must match `GOOGLE_CALLBACK_URL` exactly — Google compares the string, not the
URL semantics, so a trailing slash is a different URI. The local
`http://localhost:3000/auth/google/callback` entry can stay alongside it.

---

## 6. Monitoring

**Health check.** `GET /health` pings the database and answers `503` when it
cannot reach it, so a green check means "up **and** connected", not "the process
is running". Railway's own healthcheck already points at it
(`apps/api/railway.json`), and the deploy workflow polls it between the API and
web deploys, as the gate on serving a newer frontend (§8).

**Errors — Sentry.** Two projects, one per runtime: a **Node** project for the
API (`SENTRY_DSN`) and a **Browser/React** one for the board (`VITE_SENTRY_DSN`).
Both are opt-in — with no DSN the SDK is never initialised, which is how local
development and CI run.

> Both sides scrub their events before sending, and the API's scrub is
> load-bearing rather than decorative: `sendDefaultPii: false` governs the
> _user's identity_, not the request envelope around it, and with the scrub
> disabled a thrown error inside `POST /auth/login` carried the plaintext
> password, the `Authorization` header and the refresh cookie to the ingest
> endpoint. See `apps/api/src/observability/instrument.ts`. The browser side
> strips invite and verification tokens out of URLs and breadcrumbs, since
> `/join/:token` _is_ the credential.

**Uptime ping.** Point an external monitor at `https://<api domain>/health` on a
5-minute interval — [UptimeRobot](https://uptimerobot.com) and Better Stack both
do this on a free tier. It has to be external: a monitor running inside the
platform you are monitoring cannot tell you the platform is down. Alert on two
consecutive failures to ride out a redeploy.

---

## 7. Migrations

The API container runs `prisma migrate deploy` before it boots, so a deploy
applies any pending migration against the managed database. Running it at start
rather than at build time is deliberate — the database is only reachable over
Railway's private network, which does not exist during a build.

If a migration fails, the process exits non-zero, Railway restarts it, and the
old deployment keeps serving. `migrate deploy` never generates or resets a
schema; it applies committed migration files in order and nothing else.

### ⚠️ Dropping or renaming a column needs two deploys

Railway replaces containers by rolling, so for a moment after the migration runs
the **old** API is still serving against the new schema. That is harmless for an
additive migration — the old code simply does not use the new column — and it is
an outage for a destructive one: every query selecting a dropped column answers
500 until the new container takes over.

**The health check does not catch it.** `/health` only pings Postgres, which
stays perfectly healthy throughout, so the deploy gate reports green through the
window.

So use expand/contract for any drop or rename:

1. **Expand** — deploy code that no longer reads the column. The column stays.
2. **Contract** — a second deploy whose migration drops it.

Every migration up to 2026-08-15 was additive. The participants change
(`20260815160000_option_participants` and its companion) dropped four columns and
accepted the window knowingly, on an app with no live traffic. Do not treat that
as the precedent.

### Loading the place list

The destination field on the create-trip form suggests real places. They come
from a **seeded table** — ~74,000 rows built from GeoNames — and like the demo
seed it is not run by a deploy. Unlike the demo seed, it only has to be run
**once per environment**, and again only when a newer dataset is committed.

**From the operator console (preferred).** Sign in as an address listed in
`ADMIN_EMAILS`, open **/admin**, and use _Place list → Load the place list_. It
takes a few seconds and says so while it works, then reports what it loaded —
seventy-odd thousand places against two hundred and fifty countries is the shape
of a real load, and it is how you tell that from an empty file. It writes a
`PLACES_SEEDED` row into the operator log naming you.

No confirmation step, unlike the demo rebuild, because there is nothing to lose:
it writes one reference table that no trip has a foreign key into, and a trip
that resolved to a place already keeps its own copy of what it took.

**Or from the CLI**, when the console is not available — the API is up but the
web app is not, or `ADMIN_EMAILS` is unset:

```bash
railway ssh --service api
# the image's WORKDIR is /app/apps/api
pnpm places:seed
```

Both run the same `src/places/places-seed.ts`. It reads
`prisma/data/places.tsv.gz`, which is in the repo and therefore in the image;
nothing reaches the network. It is idempotent — rows are keyed by
GeoNames' own ids — so running it twice is running it once.

**If you skip it, nothing breaks.** The endpoint matches nothing, the field
offers no suggestions, and a destination typed into it is saved exactly as it was
before this existed. That is the degraded state, and it is deliberate: a
gazetteer that has not loaded should not be able to stop anybody planning a trip.

To rebuild the dataset from a newer GeoNames dump — worth doing about once a
year — run `pnpm --filter @gtp/api places:fetch` **locally**, commit the changed
`prisma/data/`, and re-run `places:seed` after the deploy. The fetch script is
the only thing in this repo that talks to download.geonames.org, and it never
runs in CI or in production.

### Seeding (and resetting) the public demo trip

The README publishes credentials for a demo account so a visitor can see a
populated board without registering. That data comes from the demo seed, which is
**not** run automatically — a deploy must never rewrite trip data.

Run it deliberately, one of three ways.

**From the operator console (preferred).** Sign in as an address listed in
`ADMIN_EMAILS`, open **/admin**, and use _Demo data → Rebuild the demo trip_. It
asks once before it does anything, then reports what it built and how many demo
trips it replaced, and writes a `DEMO_RESEEDED` row into the operator log naming
you.

It runs the same code as the CLI below — `src/admin/demo-seed.ts`, imported by
both — so there is no chance of the button and the terminal building different
demos. Reach for one of the CLI routes when the console is not available to you:
the API is up but the web app is not, `ADMIN_EMAILS` is unset, or you are
seeding a fresh database that has no operator account yet.

**Inside the container (preferred).** `apps/api/prisma` is copied into the image
and `@gtp/types` is built there, so the script is already present and the private
`DATABASE_URL` resolves:

```bash
railway ssh --service api
# the image's WORKDIR is /app/apps/api
pnpm demo:seed
```

**From your machine (fallback).** `railway run` will _not_ work here: it injects
the service's variables into a local process, and `DATABASE_URL` points at
`*.railway.internal`, which does not resolve outside Railway. Use the Postgres
service's **public** URL instead — Railway exposes it as `DATABASE_PUBLIC_URL`
(Postgres service → _Variables_):

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" pnpm --filter @gtp/api demo:seed
```

```powershell
$env:DATABASE_URL="<DATABASE_PUBLIC_URL>"; pnpm --filter @gtp/api demo:seed
```

A shell variable takes precedence over `apps/api/.env`, so a local `.env` cannot
silently redirect this at your development database — but check the trip id the
script prints against production before assuming it landed.

It deletes the demo user's trips and rebuilds them, so the same command is both
the initial seed and the reset when visitors have edited the demo. It touches
nothing owned by a real account, and it is safe to re-run at any time.

Re-run it whenever the demo has been left in a poor state. If that becomes
frequent, the natural next step is a scheduled Railway cron job on the same
command — the script is already idempotent, so nothing has to change to support
that.

The console's button is rate-limited to three runs an hour. That is not an abuse
control (both admin guards have already run by then); it is there so a
double-click cannot start a second rebuild while the first is still deleting and
rewriting the same rows.

---

## 8. CI/CD — deploy on merge

`.github/workflows/deploy.yml` runs on `workflow_run` of the **CI** workflow
completing on `main`, and only proceeds when it concluded green. That ordering is
the point: a `push`-triggered deploy would race CI and could ship code that had
not passed it. It is also why Railway's own auto-deploy is switched off (§2) —
this workflow is the single path to production.

Set up, once:

1. Railway → project **Settings → Tokens** → create a **project token** scoped to
   the production environment.
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - secret **`RAILWAY_TOKEN`** = that token.
   - variable **`API_PUBLIC_URL`** = `https://<api domain>` — the workflow's
     post-deploy health poll uses it, and warns rather than fails if it is unset.
   - variable **`WEB_PUBLIC_URL`** = `https://<web domain>` — the frontend
     deploy verification below uses it, and warns rather than fails if unset.

The API deploys first, so the schema the new frontend expects is in place before
that frontend is served. The API health poll runs **between** the two deploys,
where it acts as a gate: if the API is not answering, the newer frontend is not
shipped against it.

**Each deploy is verified by outcome, not by the CLI's exit code.**
`railway up --ci` streams build logs and exits non-zero when _the stream_ dies,
which says nothing about whether the build succeeded. On 2026-08-10 that
happened repeatedly on both services: the upload was accepted, a build id was
returned, the dashboard showed **Success**, the site served the new bundle — and
the command still reported failure. Retrying was tried first and was the wrong
instrument: the exit code is not flaky, it is wrong, so three attempts just
produced three identical deployments and failed anyway.

So `.github/scripts/railway-up.sh` treats _that specific_ failure as
"submitted, unverified" and lets the checks decide, while any other non-zero
exit stays fatal. The checks are:

- **API** — `GET /health`, which answers 503 when it cannot reach Postgres, so
  green means "up **and** connected".
- **Trip Board** — the workflow writes the deploying commit to
  `apps/web-board/public/build.txt` before uploading, Vite copies `public/` into
  the bundle, and the workflow then polls `<web>/build.txt` until it reports
  that SHA. This is the check that was missing entirely: twice on 2026-08-10 the
  only way to answer "did the frontend ship" was to fetch the production CSS
  bundle and grep it by hand. Note the SPA history fallback serves `index.html`
  for a missing `/build.txt`, so the poll compares the body exactly rather than
  trusting a 200.

The CLI is **pinned** (`@railway/cli@5.35.1`). An unpinned `npm install -g` in
the deploy path lets a bad release break production deploys with no change of
ours; bump it deliberately.

`workflow_dispatch` is enabled too, for the case that needs it most: a variable
change. The three `VITE_*` values are compiled into the bundle, so changing one
in Railway does nothing until something rebuilds the image.

---

## 9. Verify the live deployment

Open the web domain and walk the real path:

1. **Register** → the account is created unverified.
2. **Verify** — click the emailed link, or find the logged URL in the API logs if
   Resend is not configured.
3. **Create a trip**, **invite** someone (or open the invite link in a private
   window), **propose** an option, **vote**, then **drag a card to Decided**.
4. **Upload a cover image**, then redeploy the API and reload — the cover must
   still be there. This is the check that the volume in §4 is actually mounted,
   and it is the only way to catch a missing one.
5. Open the board in two windows and post a chat message — it should appear in
   both without a reload (the websocket is up, so `API_WS_ORIGIN` is right).
6. Reload a signed-in page — you stay signed in (cross-site silent refresh
   worked).

---

## 10. Teardown

Trial credit is consumed while services run:

- **Remove the deployment** on `api`, `web-board` and `Postgres` (the database is
  the main drain). The service tiles, variables and domains stay, so a
  **Redeploy** brings everything back in seconds.
- Project Settings → **Danger** → delete the project removes everything at once;
  rebuilding from this document is then the recovery path.

---

## Troubleshooting

- **`Invalid environment configuration` at boot.** A required variable is
  missing or a production check failed. The message lists every problem at once
  and names the variable — including the three production-only rules (absolute
  `UPLOAD_DIR`, https-only `CORS_ORIGINS`, no placeholder `JWT_SECRET`).
- **API boots then `/health` 503s.** The database is unreachable. Confirm
  `DATABASE_URL` is the `${{Postgres.DATABASE_URL}}` reference and that Postgres
  is running. The healthcheck pings the DB on purpose.
- **Login works but a reload signs you out**, or a CORS error appears in the
  console. The cross-site pair is misaligned: `CORS_ORIGINS` must be the exact
  web origin, `COOKIE_SECURE=true`, over https — and `COOKIE_SAMESITE` must match
  the topology (`lax` for a same-site api subdomain, `none` for a foreign one).
- **Signing in works on a laptop but not on a phone** — Google sign-in returns to
  the login page, and email/password drops the session on reload. The API is on a
  different registrable domain than the web app, so the refresh cookie is a
  third-party cookie and mobile browsers refuse to send it. Fix the topology
  (§5, "Same-site API domain"); no application setting works around it. The
  sign-in card now says so rather than failing silently.
- **The board loads but calls `localhost:3000`.** `VITE_API_URL` was not set at
  build time. Set it and rebuild — it is build-time only.
- **Everything renders but nothing loads, with CSP errors in the console.**
  `API_ORIGIN` / `API_WS_ORIGIN` on the web service do not match the API domain.
  They are separate entries by necessity: a `wss://` origin is not covered by the
  matching `https://` one.
- **Chat and live updates never connect, but the REST calls work.**
  `API_WS_ORIGIN` specifically — the fetches pass CSP while the socket is blocked.
- **Cover images and avatars vanished after a deploy.** The volume from §4 is not
  mounted, or `UPLOAD_DIR` points off it. In production the API refuses to start
  on a relative path, so the likely cause is an absolute path outside `/data`.
- **Images 404 or are blocked cross-origin.** `GET /media/:name` opts itself out
  of the API's strict `Cross-Origin-Resource-Policy` (Phase 7.2) because an
  `<img>` on the web domain is a cross-origin read; if that opt-out is ever
  removed, every cover and avatar breaks in the browser and in no test.
- **Google sign-in returns `redirect_uri_mismatch`.** `GOOGLE_CALLBACK_URL` and
  the console's Authorized redirect URI differ — compare them character by
  character, trailing slash included.
- **Build fails on `argon2`.** The slim base normally uses a prebuilt binary. If
  it does not, add build tools before the install step in `apps/api/Dockerfile`:
  `RUN apt-get install -y --no-install-recommends python3 make g++`.
