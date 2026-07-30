# Group Trip Planner — security audit

The checklist behind Phase 7.2 (OWASP sweep). Phase 7 is hardening, not new
features: this pass looks at every surface the app already exposes and asks
whether it is guarded, validated, encoded, and headed correctly.

Scope is `apps/api` plus `apps/web-board` — the winner of the Phase-3.5 design
gate. `web-deck` and `web-feed` are frozen "alternatives explored" and are
deliberately excluded (they are not deployed).

Re-run this checklist whenever an endpoint, a socket event, or a rendering sink
is added.

---

## 1. Authentication and session

- [x] **Passwords are argon2id** hashed; no reversible storage anywhere.
- [x] **Access tokens carry authentication claims only.** `JwtAuthGuard` loads
      the user fresh from the database on every request, so a role change or a
      block takes effect immediately (SRS FR-4). Authorization is never read out
      of a token.
- [x] **Refresh tokens are stored hashed** (SHA-256), rotate on every use, and
      **reuse of a revoked token revokes the whole family**.
- [x] The refresh cookie is `httpOnly`, `SameSite` configurable, `Secure` in
      production, and **scoped to `/auth`** so it is never attached to the
      application API.
- [x] The access token lives in **memory only** on the client (`http.ts` module
      variable) — never `localStorage`, never a cookie.
- [x] **No user enumeration.** Registration answers identically for a new and an
      existing address and performs matching argon2 work; login returns a
      generic 401 with a dummy verify to keep timing uniform. Login rate limits
      are keyed on **IP, not email**, precisely so the counter cannot become an
      enumeration oracle (Phase 7.1).
- [x] Email verification tokens are single-use and stored hashed.
- [x] The Google OAuth return path is clamped on **both** legs — `state`
      round-trips through the browser and is attacker-controllable at the
      callback (closed during the Phase-6 gate cleanup).

## 2. Authorization — the IDOR sweep

Every HTTP route and every socket event was walked. The rule the codebase
follows: **the caller never names their own privileges, and never names the
parent of the resource they are addressing.**

| Surface                                                      | Gate                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Trip-scoped routes                                           | `JwtAuthGuard` → `TripContextGuard` → `PermissionGuard` + `@RequirePermission`                              |
| `GET /trips/:id`                                             | `JwtAuthGuard` + `TripContextGuard` (membership _is_ the permission)                                        |
| Account / notifications / dashboard                          | `JwtAuthGuard`; every query is filtered by the caller's own `userId`                                        |
| `POST /trips`, `POST /uploads/image`, `POST /account/avatar` | `+ VerifiedEmailGuard` + per-user throttle                                                                  |
| Socket events                                                | Handshake middleware (token → fresh DB user → membership → block)                                           |
| Public by design                                             | `GET /health`, `GET /trips/:id/preview`, `GET /media/:name`, `/email/unsubscribe`, the `/auth` entry points |

- [x] **Non-members get 404, not 403.** `TripContextGuard` refuses a malformed
      id, a missing trip, and a non-member with the _same_ response — trip
      existence is not disclosed.
- [x] **Nested ids are re-scoped to their parent, never trusted.** A category is
      looked up by `{ id, tripId }`; an option by `{ id, categoryId }`; a chat
      channel through `channelInTrip()`; the reconnect anchor is re-checked
      against the channel it claims. Addressing another trip's category through
      your own trip's URL is a 404.
- [x] **Per-user records are filtered by owner in the query itself.** Marking a
      notification read matches on `{ id, userId }`, so another account's id
      simply matches nothing.
- [x] **Socket handlers take `tripId` and `userId` from the authenticated
      socket, never from the message payload.** Only `messageId`/`emoji` come
      from the client, and both are re-scoped server-side.
- [x] `RealtimeGateway` is **broadcast-only** — it defines no `@SubscribeMessage`
      handler, so it presents no inbound surface.
- [x] Role is re-read from the database on the handshake (and therefore on every
      reconnect), never carried in the handshake payload.

## 3. Input validation — Zod at every boundary

- [x] **Every `@Body()` is parsed by `ZodValidationPipe`** with a schema from
      `@gtp/types` — verified by inspection across all 20 body-taking handlers.
      One schema serves the frontend and the backend, so drift breaks the build.
- [x] **Every socket payload is `safeParse`d** before use; a failure is an
      ordinary `{ ok: false }` ack, not a dropped connection.
- [x] **Query parameters are validated** (closed in this pass — see below). Page
      cursors must be UUIDs; `limit`/`offset` fall back to a default and are
      **clamped** by the service, so no caller can ask for an unbounded page.
- [x] Route params that reach the database are UUID-checked in the guard, which
      runs _before_ validation pipes.
- [x] Optimistic concurrency (`version`) is enforced for trips, categories, and
      options, so a stale write is a 409 rather than a silent overwrite.

## 4. Output encoding / XSS

- [x] **No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`** anywhere in
      `apps/web-board` or `packages/*`. All user text renders as React children,
      which escapes by construction.
- [x] **The one user-supplied `href`** (an option's link) is scheme-constrained
      at the contract boundary _and_ re-checked at the render site — see the
      findings below.
- [x] External links carry `rel="noreferrer noopener"`.
- [x] **HTML email escapes interpolated user text** (fixed in this pass).
- [x] Served images cannot be talked into executing: fixed `Content-Type`,
      `nosniff`, and `default-src 'none'; sandbox`.

## 5. File uploads (Phase 6 policy, re-verified)

- [x] Pipeline order is still **size cap → magic bytes → sharp re-encode →
      random UUID name → storage**. The declared MIME must be allowlisted _and_
      agree with the sniffed bytes.
- [x] Re-encoding to WebP means the stored bytes are ours, not the caller's;
      EXIF/GPS is dropped, and libvips' `limitInputPixels` covers decompression
      bombs.
- [x] The stored name is a fresh UUID — no caller-supplied filename ever reaches
      the filesystem, and `GET /media/:name` validates the name **before** any
      filesystem call, so traversal 404s pre-resolution.
- [x] Cover and avatar are **one-step multipart**, never "upload then PATCH the
      URL": a client that could name the URL could point a trip page at any
      address. `nameFromUrl()` returns null for anything that isn't ours, so a
      hand-edited URL can never become a file delete.
- [x] Uploads are throttled **per user**, not per IP (re-encoding is CPU-bound).

## 6. Transport, headers, CORS

- [x] **Helmet is installed** (added in this pass) via `applyHttpHardening()`,
      the same function `main.ts` and the e2e suite both call. It sets HSTS,
      `nosniff`, `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`,
      `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
      a default CSP, and removes `X-Powered-By`.
- [x] **CORS is an allowlist, never a wildcard.** Origins come from
      `CORS_ORIGINS`; credentials are enabled (the refresh cookie is cross-site
      in production), which by spec forbids `*` anyway. An unlisted origin gets
      no `access-control-allow-origin` header at all.
- [x] Socket.IO CORS is locked to the **same** origin list via `WsCorsAdapter`.
- [x] `Cross-Origin-Resource-Policy` stays strict (`same-origin`) for the API and
      is relaxed **only** on `/media/:name`, the one route a browser embeds from
      another origin.
- [x] Secure/`SameSite` cookie behaviour is env-driven and was proven end-to-end
      against the real cross-site deployment in Phase 0.8.
- [x] **The refresh cookie must not be cross-site.** Found in the polish pass,
      from production use rather than from this checklist: `SameSite=None` makes
      the cookie legal, not *deliverable*. With the API on a different registrable
      domain than the app, `POST /auth/refresh` is a third-party cookie request,
      and WebKit — every browser on iOS — blocks those unconditionally. The
      deployment tested clean on desktop Chrome and was **completely unusable on a
      phone**: Google sign-in dead (OAuth delivers the session only via that
      cookie), email/password surviving exactly until the first reload. Availability
      is a security property, and "works in the browser I tested" is how this class
      of bug ships. The fix is topological — put the API on a subdomain of the app's
      domain and drop to `SameSite=Lax` (`DEPLOY.md` §5). No code change makes a
      blocked cookie arrive.

## 7. Secrets

- [x] **No secret is committed.** The only tracked env file is
      `apps/api/.env.example`, whose `JWT_SECRET` is the literal placeholder
      `change-me-to-a-long-random-secret`. A scan of all tracked files for
      provider key shapes (`re_…`, `AIza…`, `sk_…`) returns nothing.
- [x] `JWT_SECRET` is required with a minimum length and validated at startup —
      the process refuses to boot without it.
- [x] `authorization` and `cookie` headers are redacted in structured logs.

## 8. Abuse limits (Phase 7.1, cross-referenced)

- [x] Three tiers in `common/throttle-policy.ts`: an IP global floor, tight
      pre-auth limits, and per-user write limits.
- [x] Socket message sending is rate-limited by `SocketRateLimiter`, keyed on the
      user so extra tabs do not multiply the budget.
- [x] `PerUserThrottle` + `GlobalThrottlerGuard` keep per-user limits from also
      being applied per IP.

## 9. Data protection

- [x] Account deletion anonymizes in a transaction and purges avatar bytes after
      it commits.
- [x] Notification email is preference-gated at enqueue time; transactional mail
      (verification, invites) is deliberately never suppressible.
- [x] One-click unsubscribe verifies its HMAC with `timingSafeEqual`.

---

## What this pass changed

Four gaps were found and closed. Each fix has a test, and each test was
confirmed to **fail when the fix is reverted** — asserting a passing state
proves nothing on its own.

1. **No security headers at all.** Helmet was never installed; responses carried
   `X-Powered-By: Express` and no HSTS, CSP, or framing policy. Now applied
   centrally. _Gotcha worth remembering:_ helmet's default
   `Cross-Origin-Resource-Policy: same-origin` would have made browsers **block
   every cover image and avatar** in production, where the API and the web app
   are separate domains — the failure would only have appeared at 7.5, in the
   browser, not in any test. `/media/:name` opts out for itself.

2. **HTML injection into invite email.** `sendInviteEmail` interpolated the
   user-chosen trip name straight into the mail body while the later
   `sendMentionEmail` (Phase 5.2) escaped — the earlier one had simply been
   missed. Since the recipient address is typed by the inviter, an unescaped
   name let anyone compose arbitrary markup, including a link of their choosing,
   inside mail sent from our own domain. Now escaped.

3. **Unconstrained URL scheme on an `href` sink.** `z.string().url()` reads as a
   scheme check but is not one: it delegates to `new URL()`, which parses
   `javascript:alert(1)` and `data:text/html,…` happily. Those values landed in
   `option.url` and were rendered as `href` on every option card.
   **Honest severity: this was not live-exploitable.** React 19 replaces a
   `javascript:` href with a thrown error, and browsers refuse top-level
   navigation to `data:` — both verified rather than assumed. But the contract
   was wrong, and the protection came from the renderer rather than from us: any
   non-React consumer would reinstate the hole. The scheme is now constrained in
   `@gtp/types`, and because that only governs _new_ writes, `isHttpUrl()` also
   guards the render site so rows stored earlier cannot become links.

4. **Query string bypassed validation.** Bodies had been Zod-parsed since Phase
   0.6, but page cursors were raw strings handed to Prisma, where a bad UUID
   surfaced as a `PrismaClientKnownRequestError` and a **500**. Nothing leaked —
   Nest masks non-HTTP exceptions — but it was the one boundary still passing
   unvalidated input to the database. `parseCursor`/`parseLimit` in
   `common/query-params.ts` now cover the three cursor-paged reads (notifications,
   activity, chat history), the chat catch-up anchor, and the offset-paged home
   dashboard.

## Accepted risks

Deliberate, with reasoning — not oversights.

- **`GET /media/:name` is public.** Image URLs are unguessable UUIDs and are
  embedded in `<img>` tags that cannot carry an `Authorization` header. Knowing
  a URL grants the image; it grants nothing else. Per-trip authorization on
  images would require signed URLs, which is a 7.5-scale change.
- **CSRF on `/auth/refresh` and `/auth/logout`.** These are the only
  cookie-authenticated routes. A third-party page can cause a token rotation or
  a logout, but cannot read the response (CORS), so the impact is nuisance, not
  disclosure. Every application route uses a Bearer header, which a cross-site
  request cannot attach.
- **`GET /trips/:id/preview` discloses four fields to anyone with a trip id.**
  That is its purpose — it backs the invite landing page for a logged-out
  visitor.
- **The invite email subject is not escaped.** It is a plain-text field in a JSON
  API payload, not a header this code assembles, so there is no header-injection
  path.

## Known limits

- **No password-reset endpoint exists**, so the reset limits Phase 7.1's issue
  text mentions have nothing to apply to. There is likewise **no
  resend-verification endpoint**, which leaves an unverified user whose email was
  lost with no way forward (noted in 6.4 and still open).
- Dependency vulnerability scanning is not wired into CI; `pnpm audit` was not
  run as part of this pass.
- The sweep is a **code audit plus targeted tests**, not a penetration test. No
  fuzzing, no automated scanner (ZAP/Burp), no dependency-confusion review.
- CSP is helmet's default on the API. It governs only framework error pages
  there — the SPA is served separately by Caddy. ~~Not covered by this audit;
  give it its own pass at 7.5.~~ **Closed in 7.5, see the addendum below.**
- Per project convention the frontend has no screenshot tests; the rendered
  result is reviewed by the owner.

---

## Addendum — Phase 7.5 (deploy)

Two items the 7.2 sweep could not reach, because neither exists until the app is
actually deployed.

### The SPA's own headers (the deferred item above)

`apps/web-board/Caddyfile` now sends a **Content-Security-Policy**, `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `Permissions-Policy`
denying geolocation/camera/microphone/payment/USB, and drops Caddy's `Server`
banner.

- `script-src 'self'` with no `unsafe-inline` and no nonce — Vite emits external
  fingerprinted modules and no inline script.
- `style-src` **does** allow `'unsafe-inline'`, and this is the one relaxation in
  the set. Inline `style` attributes are unavoidable here: dnd-kit writes drag
  transforms onto the element and the avatar fallback sets its own hue. Style
  injection is a real but far narrower risk than script injection.
- `connect-src` and `img-src` are driven by `API_ORIGIN` / `API_WS_ORIGIN`
  service variables. The websocket needs its own entry — a `wss://` origin is
  **not** covered by the matching `https://` one, and getting that wrong breaks
  only chat and live updates while every REST call keeps working.

**Verified against the real image, not the config file.** `vite preview` (what
the e2e suite normally serves) sends no headers at all, so a CSP mistake is
invisible to every test in this repo. The deploy image was therefore built and
run, and the three Playwright journeys were re-run against it through the new
`E2E_WEB_URL` seam — all three pass, which exercises the REST origin, the
websocket origin and the image origin in a real browser.

### Sentry sends more than `sendDefaultPii: false` implies

Error reporting was added in this phase, which means a new third party receives
data from inside request handling. The SDK option that reads as though it
covers this does not.

With the scrub disabled and an error thrown inside `POST /auth/login`, the event
sent to the ingest endpoint contained the **plaintext password**, the
**`Authorization` header**, and the **refresh cookie** (twice — once under
`headers`, once under `cookies`), despite `sendDefaultPii: false`. That option
governs the _user's identity_ — IP address, user id — not the request envelope
around it. Confirmed empirically against a local ingest stand-in rather than
inferred from the documentation.

`beforeSend` in `apps/api/src/observability/instrument.ts` is therefore
load-bearing: it drops the body wholesale (a field-name denylist is a list
someone forgets to extend) and removes both headers, mirroring the redaction
pino already applies. Method, path and stack trace survive, which is what a
report needs.

The browser side has its own version of the problem: `/join/:token` **is** the
credential, so a raw URL in an event or a breadcrumb hands out a working invite.
`apps/web-board/src/lib/monitoring.ts` redacts invite and verification tokens
from both, and is unit-tested — the leak is otherwise invisible, since the app
behaves identically either way and the evidence only ever appears in someone
else's dashboard.

Both sides are **opt-in**: with no DSN the SDK is never initialised, so local
development and CI send nothing anywhere.

### New production-only startup checks

Three settings whose development defaults are convenient and whose production
values are load-bearing now fail startup instead of shipping green
(`apps/api/src/config/env.ts`, unit-tested in `test/env.spec.ts`):

- `UPLOAD_DIR` must be absolute — a relative path lives inside the container and
  is discarded on every redeploy, silently losing every cover and avatar.
- every `CORS_ORIGINS` entry must be `https://` — this is the strict-CORS
  requirement enforced rather than documented, and it stops the localhost
  default reaching production.
- `JWT_SECRET` must not be the `.env.example` placeholder.
