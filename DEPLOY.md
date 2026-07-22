# Deploy — Railway (Phase 0.8 dry-run)

Puts the walking skeleton on a public URL: **register → verify → login** works
from the internet. Three Railway services in one project:

| Service    | What it is                       | Built from                     | Public? |
| ---------- | -------------------------------- | ------------------------------ | ------- |
| `Postgres` | Managed database                 | Railway plugin                 | no      |
| `api`      | NestJS API + runs the migration  | `apps/api/Dockerfile`          | yes     |
| `web-deck` | React SPA (Command Deck), static | `apps/web-deck/Dockerfile`     | yes     |

The API and the web app get **separate** `*.up.railway.app` domains — i.e. two
different sites. That's the whole reason this dry-run exists: it forces the
cross-site cookie + CORS handshake now, while the app is tiny. The config below
handles it (`SameSite=None; Secure` refresh cookie + a locked CORS origin).

> **Cost:** everything here fits the Railway **Trial** ($5 credit). See
> [Teardown](#7-teardown-stop-usage) to stop usage when you're done demoing.

---

## 0. Prerequisites

- A Railway account (Trial is fine), signed in with GitHub.
- This branch (`phase-0.8-railway-deploy`) merged to `main`, **or** pushed —
  Railway deploys from a GitHub branch, so the Dockerfiles + `railway.json`
  files must be on the branch you point it at.
- One secret generated locally (used in step 3):

  ```bash
  # A strong JWT signing secret (min 16 chars; this gives 64 hex chars).
  openssl rand -hex 32
  ```

  Copy the output somewhere for a moment — you'll paste it into the API service.

---

## 1. Create the project + database

1. Railway dashboard → **New Project** → **Deploy PostgreSQL** (or **Empty
   Project**, then **+ New** → **Database** → **PostgreSQL**).
2. You now have a project with a **Postgres** service. Leave it — no config
   needed. It exposes a `DATABASE_URL` we reference from the API in step 3.

---

## 2. Create the API service

1. In the project: **+ New** → **GitHub Repo** → pick
   `zsollti/group-trip-planner`. If the repo isn't listed, click **Configure
   GitHub App** and grant Railway access to it (this is the repo authorization
   we skipped at signup).
2. Railway creates a service from the repo. Rename it to **`api`** (service
   Settings → Name).
3. **Settings → Source**
   - **Branch:** `main` (or `phase-0.8-railway-deploy` if not yet merged).
   - **Root Directory:** leave empty / `/`. The Dockerfile builds from the
     repo root on purpose (pnpm workspace).
   - **Config-as-code / Railway config file:** set to **`apps/api/railway.json`**.
     That file selects the Dockerfile builder and the `/health` healthcheck.
   - If your Railway UI has no config-path field, instead add a service
     **variable** `RAILWAY_DOCKERFILE_PATH = apps/api/Dockerfile` — same effect.
4. **Don't deploy yet** — set the variables in step 3 first (a boot without
   `DATABASE_URL`/`JWT_SECRET` fails fast by design).

---

## 3. API environment variables

API service → **Variables** → add these. Use Railway's **reference** syntax for
the database so it always tracks the Postgres service:

| Variable          | Value                                   | Notes                                        |
| ----------------- | --------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`            | Reference variable — click "Add Reference".  |
| `JWT_SECRET`      | *(paste the `openssl rand -hex 32`)*    | Required, min 16 chars.                       |
| `NODE_ENV`        | `production`                            | Also baked in the image; set it to be sure.   |
| `COOKIE_SAMESITE` | `none`                                  | **Required** — api & web are different sites. |
| `COOKIE_SECURE`   | `true`                                  | Cross-site `SameSite=None` cookies must be Secure. |
| `CORS_ORIGINS`    | *(fill in step 5)*                      | The web app's `https://…` origin.             |
| `WEB_APP_URL`     | *(fill in step 5)*                      | Where verification links point.               |

Optional (only if you want real emails instead of logged links):
`RESEND_API_KEY`, `EMAIL_FROM`. Without `RESEND_API_KEY`, the verification link
is written to the API logs — fine for a dry-run (see step 6).

Then **Settings → Networking → Generate Domain** for the API. Copy it, e.g.
`https://gtp-api-production.up.railway.app`. Trigger a **Deploy**.

Watch the build/deploy logs. On success you'll see the migration apply
(`prisma migrate deploy`) then `API listening…`, and the service goes green.
Verify: open `https://<api-domain>/health` → `{"status":"ok","db":"up",…}`.

---

## 4. Create the web service

1. **+ New** → **GitHub Repo** → same repo (Railway lets one repo back multiple
   services). Rename to **`web-deck`**.
2. **Settings → Source**
   - **Branch:** same as the API.
   - **Root Directory:** empty / `/`.
   - **Config file:** **`apps/web-deck/railway.json`** (or variable
     `RAILWAY_DOCKERFILE_PATH = apps/web-deck/Dockerfile`).
3. **Variables** → add **`VITE_API_URL`** = the API domain from step 3
   (`https://gtp-api-production.up.railway.app`, no trailing slash).
   > This is read at **build time** (Vite inlines it). It must be set *before*
   > the build, and changing it later needs a redeploy.
4. **Settings → Networking → Generate Domain** for the web app. Copy it, e.g.
   `https://gtp-web-deck-production.up.railway.app`. Deploy.

---

## 5. Wire the two origins together (the cross-site step)

Now that both domains exist, close the loop on the API:

1. API service → **Variables**:
   - `CORS_ORIGINS` = the **web** domain, e.g.
     `https://gtp-web-deck-production.up.railway.app`
     (comma-separate if you add more front-ends later).
   - `WEB_APP_URL` = the same web domain.
2. Redeploy the API (Railway usually redeploys automatically on a variable
   change).

Why this matters: the browser only sends the httpOnly refresh cookie on a
cross-site request when it's `SameSite=None; Secure` (step 3) **and** the API
answers CORS with `Access-Control-Allow-Origin: <web domain>` +
`Allow-Credentials: true` (that origin must be in `CORS_ORIGINS`). Both halves
have to line up or login "works" but silent-refresh fails.

---

## 6. Verify the live skeleton (Definition of Done)

Open the **web** domain in a browser and:

1. **Register** with a real-looking email + password.
2. **Verify email:** if you set `RESEND_API_KEY`, click the emailed link.
   Otherwise open the **API service logs** in Railway, find the logged
   verification URL, and open it.
3. **Login** with the same credentials → you land on the app's empty
   authenticated dashboard.
4. Reload the page — you stay logged in (silent refresh via the cookie worked).

If all four pass, Phase 0.8 is done: the walking skeleton runs at a public URL.

---

## 7. Teardown (stop usage)

Trial credit is consumed while services run. To stop it after demoing:

- **Pause** or **Remove** the `api` and `web-deck` services (and `Postgres` if
  you don't need the data). Project Settings → **Danger** → delete the project
  removes everything at once.
- Redeploying later is just re-creating the services from this same config.

---

## Troubleshooting

- **Build fails on `argon2`** (native module): the slim base normally uses a
  prebuilt binary. If not, add build tools to `apps/api/Dockerfile` before the
  install step:
  `RUN apt-get install -y --no-install-recommends python3 make g++`.
- **API boots then 503s on `/health`:** the DB isn't reachable — confirm
  `DATABASE_URL` is the `${{Postgres.DATABASE_URL}}` reference and Postgres is
  running. The healthcheck pings the DB on purpose.
- **`Invalid environment configuration` in logs:** a required var is missing
  (`DATABASE_URL`/`JWT_SECRET`). The message lists exactly which — set it.
- **Login works but reload logs you out / CORS error in console:** the
  cross-site pair is misaligned. Recheck `CORS_ORIGINS` == exact web origin,
  `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, and that you're on `https`.
- **Web shows a blank page / calls `localhost:3000`:** `VITE_API_URL` wasn't set
  at build time. Set it and redeploy the web service (it's build-time only).
- **Prisma "engine not found" at runtime:** the client is generated inside the
  image on the same platform it runs on, so this shouldn't occur; if it does
  after a base-image change, ensure `apps/api/prisma` is copied before install
  (it is) so `prisma generate` runs during postinstall.
