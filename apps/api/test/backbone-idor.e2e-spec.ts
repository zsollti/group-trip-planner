import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { GlobalThrottlerGuard } from "../src/common/per-user-throttle.js";

/**
 * **Backbone test 1 of 4 (SRS §10): the authorization guard blocks a non-member.**
 *
 * Every module already carries its own non-member assertion, and Phase 7.2 swept
 * the spine by hand. Both of those check the routes that existed when they were
 * written — neither notices a *new* trip-scoped route that ships without a guard,
 * which is exactly how an IDOR gets in. So this sweep is table-driven and, more
 * importantly, **self-maintaining**: it reads the routes Express actually has
 * registered and fails if one of them is missing from the table below. Adding a
 * `trips/:id/...` route without thinking about authorization breaks this test.
 *
 * What each route must do for an outsider holding a valid session:
 *  - **404, never 403** — a 403 would confirm the trip exists (Phase-1 decision 4);
 *  - **404, never 400** — guards run before validation pipes, so a garbage body
 *    must not produce a validation error that betrays the route's shape. Every
 *    probe below deliberately sends **no body at all**;
 *  - **404, never 500** — a real id that belongs to someone else must not reach
 *    Prisma.
 *
 * It also covers the second half of the same defense: **nested ids are re-scoped
 * to their parent**, so a genuine member of trip A cannot reach trip B's category
 * or option by pasting its id into their own trip's URL.
 *
 * The socket half of the IDOR surface lives in `chat.e2e-spec.ts` ("rejects a
 * non-member socket"), since it needs a real Socket.IO client.
 *
 * The global rate limiter is stubbed out here: this spec's ~80 requests are an
 * authorization sweep, not traffic, and `rate-limit.spec.ts` owns the limits.
 */

/** Ids of a fully-populated trip the stranger is *not* a member of. */
interface Ids {
  trip: string;
  category: string;
  option: string;
  channel: string;
  /** A real member of the trip — the target of the member-management routes. */
  member: string;
  invite: string;
}

// `put` joined the list when the chat mute arrived: it replaces the whole
// setting on every call, so it is a PUT rather than a PATCH. Supertest
// dispatches it the same way the other four are dispatched.
type Method = "get" | "post" | "put" | "patch" | "delete";

interface Probe {
  /** The route template exactly as Nest registers it with Express. */
  route: string;
  method: Method;
  url: (ids: Ids) => string;
  /**
   * Deliberately reachable without membership. Only the Visitor-scope preview
   * qualifies (SRS §7) — it exists to be public and returns name/dates/
   * destination/member-count only.
   */
  publicRoute?: true;
}

const PROBES: Probe[] = [
  // --- trips ---------------------------------------------------------------
  {
    route: "/trips/:id/preview",
    method: "get",
    url: (i) => `/trips/${i.trip}/preview`,
    publicRoute: true,
  },
  { route: "/trips/:id", method: "get", url: (i) => `/trips/${i.trip}` },
  { route: "/trips/:id", method: "patch", url: (i) => `/trips/${i.trip}` },
  { route: "/trips/:id", method: "delete", url: (i) => `/trips/${i.trip}` },
  {
    route: "/trips/:id/cover",
    method: "post",
    url: (i) => `/trips/${i.trip}/cover`,
  },
  {
    route: "/trips/:id/cover",
    method: "delete",
    url: (i) => `/trips/${i.trip}/cover`,
  },

  // --- dashboard + activity ------------------------------------------------
  {
    route: "/trips/:id/dashboard",
    method: "get",
    url: (i) => `/trips/${i.trip}/dashboard`,
  },
  {
    route: "/trips/:id/activity",
    method: "get",
    url: (i) => `/trips/${i.trip}/activity`,
  },

  // --- categories ----------------------------------------------------------
  {
    route: "/trips/:id/categories",
    method: "get",
    url: (i) => `/trips/${i.trip}/categories`,
  },
  {
    route: "/trips/:id/categories",
    method: "post",
    url: (i) => `/trips/${i.trip}/categories`,
  },
  {
    route: "/trips/:id/categories/reorder",
    method: "post",
    url: (i) => `/trips/${i.trip}/categories/reorder`,
  },
  {
    route: "/trips/:id/categories/:categoryId",
    method: "patch",
    url: (i) => `/trips/${i.trip}/categories/${i.category}`,
  },
  {
    route: "/trips/:id/categories/:categoryId",
    method: "delete",
    url: (i) => `/trips/${i.trip}/categories/${i.category}`,
  },

  // --- options -------------------------------------------------------------
  {
    route: "/trips/:id/categories/:categoryId/options",
    method: "get",
    url: (i) => `/trips/${i.trip}/categories/${i.category}/options`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options",
    method: "post",
    url: (i) => `/trips/${i.trip}/categories/${i.category}/options`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/reorder",
    method: "post",
    url: (i) => `/trips/${i.trip}/categories/${i.category}/options/reorder`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId",
    method: "patch",
    url: (i) => `/trips/${i.trip}/categories/${i.category}/options/${i.option}`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId",
    method: "delete",
    url: (i) => `/trips/${i.trip}/categories/${i.category}/options/${i.option}`,
  },

  // --- votes ---------------------------------------------------------------
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/votes",
    method: "post",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/votes`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/votes",
    method: "delete",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/votes`,
  },

  // --- participation -------------------------------------------------------
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/participation",
    method: "post",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/participation`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/participation",
    method: "delete",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/participation`,
  },

  // --- locking -------------------------------------------------------------
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/lock",
    method: "post",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/lock`,
  },
  {
    route: "/trips/:id/categories/:categoryId/options/:optionId/unlock",
    method: "post",
    url: (i) =>
      `/trips/${i.trip}/categories/${i.category}/options/${i.option}/unlock`,
  },

  // --- invites -------------------------------------------------------------
  {
    route: "/trips/:id/invites",
    method: "post",
    url: (i) => `/trips/${i.trip}/invites`,
  },
  {
    route: "/trips/:id/invites",
    method: "get",
    url: (i) => `/trips/${i.trip}/invites`,
  },
  {
    route: "/trips/:id/invites/:inviteId",
    method: "delete",
    url: (i) => `/trips/${i.trip}/invites/${i.invite}`,
  },

  // --- members -------------------------------------------------------------
  {
    route: "/trips/:id/members",
    method: "get",
    url: (i) => `/trips/${i.trip}/members`,
  },
  {
    route: "/trips/:id/members/mute",
    method: "post",
    url: (i) => `/trips/${i.trip}/members/mute`,
  },
  {
    route: "/trips/:id/members/:userId",
    method: "patch",
    url: (i) => `/trips/${i.trip}/members/${i.member}`,
  },
  {
    route: "/trips/:id/members/:userId",
    method: "delete",
    url: (i) => `/trips/${i.trip}/members/${i.member}`,
  },
  {
    route: "/trips/:id/members/:userId/block",
    method: "post",
    url: (i) => `/trips/${i.trip}/members/${i.member}/block`,
  },
  {
    route: "/trips/:id/members/:userId/block",
    method: "delete",
    url: (i) => `/trips/${i.trip}/members/${i.member}/block`,
  },
  {
    route: "/trips/:id/members/transfer",
    method: "post",
    url: (i) => `/trips/${i.trip}/members/transfer`,
  },
  {
    route: "/trips/:id/members/leave",
    method: "post",
    url: (i) => `/trips/${i.trip}/members/leave`,
  },

  // --- chat ----------------------------------------------------------------
  {
    route: "/trips/:id/channels",
    method: "post",
    url: (i) => `/trips/${i.trip}/channels`,
  },
  {
    route: "/trips/:id/channels/:channelId/read",
    method: "post",
    url: (i) => `/trips/${i.trip}/channels/${i.channel}/read`,
  },
  {
    route: "/trips/:id/channels/:channelId/messages",
    method: "get",
    url: (i) => `/trips/${i.trip}/channels/${i.channel}/messages`,
  },
  {
    route: "/trips/:id/channels/:channelId/messages/since",
    method: "get",
    url: (i) => `/trips/${i.trip}/channels/${i.channel}/messages/since`,
  },
  {
    route: "/trips/:id/messages/search",
    method: "get",
    url: (i) => `/trips/${i.trip}/messages/search`,
  },
  {
    route: "/trips/:id/chat-mute",
    method: "get",
    url: (i) => `/trips/${i.trip}/chat-mute`,
  },
  {
    route: "/trips/:id/chat-mute",
    method: "put",
    url: (i) => `/trips/${i.trip}/chat-mute`,
  },
];

/** `"GET /trips/:id"` — the key both discovery and the table agree on. */
function key(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

interface ExpressLayer {
  route?: {
    path?: string | string[];
    methods?: Record<string, boolean>;
    stack?: { method?: string }[];
  };
}

/**
 * Every trip-scoped route Express has actually registered.
 *
 * Reading the live router rather than a hand-kept list is the whole point: a new
 * `trips/:id/...` route shows up here the moment it is wired, whether or not
 * anyone remembered to think about who may call it.
 */
function registeredTripRoutes(app: INestApplication): Set<string> {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack?: ExpressLayer[] };
    _router?: { stack?: ExpressLayer[] };
  };
  const stack = instance.router?.stack ?? instance._router?.stack ?? [];

  const found = new Set<string>();
  for (const layer of stack) {
    const route = layer.route;
    if (!route?.path) continue;
    const paths = Array.isArray(route.path) ? route.path : [route.path];
    // Express 5 keeps `methods`; fall back to the route's own layer stack so a
    // future Express change degrades into a visible failure, not a silent pass.
    const methods = route.methods
      ? Object.entries(route.methods)
          .filter(([, on]) => on)
          .map(([m]) => m)
      : (route.stack ?? []).map((l) => l.method ?? "");
    for (const path of paths) {
      if (!path.includes("/trips/:id")) continue;
      for (const method of methods) {
        if (method && method !== "_all") found.add(key(method, path));
      }
    }
  }
  return found;
}

describe("Backbone: the authorization guard blocks non-members (IDOR sweep)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  let ids: Ids;
  let strangerToken: string;
  /** A member of a *different* trip — used for the cross-trip re-scoping check. */
  let neighbourToken: string;
  let neighbourTrip: string;

  async function makeUser(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `idor+${label}+${suffix}@example.com`,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
    return { user, accessToken: await tokens_.signAccessToken(user) };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .overrideGuard(GlobalThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);

    const owner = await makeUser("owner");
    const member = await makeUser("member");
    const stranger = await makeUser("stranger");
    const neighbour = await makeUser("neighbour");
    strangerToken = stranger.accessToken;
    neighbourToken = neighbour.accessToken;

    const trip = await createTrip(owner.accessToken, "Fortress");
    neighbourTrip = await createTrip(neighbour.accessToken, "Next door");

    // A real member, so the member-management routes get a live target id
    // rather than one that would 404 for its own sake.
    const invited = await http()
      .post(`/trips/${trip}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);
    await http()
      .post(`/join/${(invited.body as { token: string }).token}`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .expect(201);

    const cats = await http()
      .get(`/trips/${trip}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const category = (
      cats.body as { id: string; builtinKey: string | null }[]
    ).find((c) => c.builtinKey === "TRANSPORT")!.id;

    const option = await http()
      .post(`/trips/${trip}/categories/${category}/options`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Night train", currency: "EUR" })
      .expect(201);

    const channel = await prisma.channel.findFirstOrThrow({
      where: { tripId: trip, type: "GENERAL" },
    });

    ids = {
      trip,
      category,
      option: (option.body as { id: string }).id,
      channel: channel.id,
      member: member.user.id,
      invite: (invited.body as { id: string }).id,
    };
  });

  after(async () => {
    if (prisma) {
      await prisma.trip.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it("the sweep covers every trip-scoped route Express has registered", () => {
    const registered = registeredTripRoutes(app);

    // If discovery silently returned nothing, the coverage check below would
    // pass vacuously — which is the failure mode this test exists to prevent.
    assert.ok(
      registered.size >= 30,
      `route discovery found only ${registered.size} trip-scoped routes; ` +
        `the Express router shape has probably changed`,
    );

    const covered = new Set(PROBES.map((p) => key(p.method, p.route)));
    const uncovered = [...registered].filter((r) => !covered.has(r)).sort();
    assert.deepEqual(
      uncovered,
      [],
      "trip-scoped route(s) with no IDOR probe — add them to PROBES and " +
        "confirm a non-member is refused",
    );

    const stale = [...covered].filter((r) => !registered.has(r)).sort();
    assert.deepEqual(stale, [], "probe(s) for routes that no longer exist");
  });

  it("answers a non-member with 404 on every guarded trip-scoped route", async () => {
    const wrong: string[] = [];
    for (const probe of PROBES) {
      if (probe.publicRoute) continue;
      // No body on purpose: guards run before validation pipes, so the refusal
      // must not come back as a 400 describing what the route wanted.
      const res = await http()
        [probe.method](probe.url(ids))
        .set("Authorization", `Bearer ${strangerToken}`);
      if (res.status !== 404) {
        wrong.push(`${key(probe.method, probe.route)} → ${res.status}`);
      }
    }
    assert.deepEqual(
      wrong,
      [],
      "every guarded trip-scoped route must answer a non-member with 404 " +
        "(403 would confirm the trip exists; 400 would describe the route; " +
        "500 means a foreign id reached the database)",
    );
  });

  it("leaks nothing about the trip in the 404 body", async () => {
    const res = await http()
      .get(`/trips/${ids.trip}`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .expect(404);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes("Fortress"), "trip name must not appear");
    assert.equal((res.body as { message: string }).message, "Trip not found");
  });

  it("refuses every guarded trip-scoped route without a session (401)", async () => {
    const wrong: string[] = [];
    for (const probe of PROBES) {
      if (probe.publicRoute) continue;
      const res = await http()[probe.method](probe.url(ids));
      if (res.status !== 401) {
        wrong.push(`${key(probe.method, probe.route)} → ${res.status}`);
      }
    }
    assert.deepEqual(wrong, [], "anonymous callers must get 401 everywhere");
  });

  it("re-scopes nested ids to their parent: a member of one trip cannot borrow another's", async () => {
    // The neighbour is a legitimate Owner — of a different trip. Pasting this
    // trip's category/option/channel ids under their own trip must not work.
    const borrowed: { method: Method; url: string }[] = [
      // The sharpest of the three: unscoped, this would delete another trip's
      // category outright.
      {
        method: "delete",
        url: `/trips/${neighbourTrip}/categories/${ids.category}`,
      },
      {
        method: "get",
        url: `/trips/${neighbourTrip}/categories/${ids.category}/options`,
      },
      {
        method: "get",
        url: `/trips/${neighbourTrip}/channels/${ids.channel}/messages`,
      },
    ];
    for (const { method, url } of borrowed) {
      const res = await http()
        [method](url)
        .set("Authorization", `Bearer ${neighbourToken}`)
        .send({ name: "Borrowed" });
      assert.equal(res.status, 404, `${url} must not resolve across trips`);
      // A route that does not exist also answers 404, which would make this
      // assertion pass without testing anything. Nest's own miss reads
      // "Cannot GET /…"; ours names the resource.
      const message = (res.body as { message?: string }).message ?? "";
      assert.ok(
        !message.startsWith("Cannot "),
        `${method.toUpperCase()} ${url} hit no handler at all (${message}) — ` +
          "the re-scoping was never exercised",
      );
    }

    // The borrowed DELETE must have changed nothing.
    assert.ok(
      await prisma.category.findUnique({ where: { id: ids.category } }),
      "the other trip's category survived the cross-trip delete",
    );

    // And the reverse direction: their own token against the trip they are not
    // in, using that trip's real ids, is the plain non-member case.
    await http()
      .get(`/trips/${ids.trip}/categories/${ids.category}/options`)
      .set("Authorization", `Bearer ${neighbourToken}`)
      .expect(404);
  });
});
