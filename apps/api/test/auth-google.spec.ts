import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { resolveReturnOrigin } from "../src/auth/google-auth.guard.js";
import { ENV } from "../src/config/config.module.js";
import { isGoogleOAuthEnabled, type Env } from "../src/config/env.js";

/**
 * Google OAuth (Phase 1.0). The full browser round-trip needs Google itself, so
 * here we pin the parts we own: the find-or-create that turns a verified Google
 * profile into our standard User (FR-1), the open-redirect clamp on the return
 * origin, and that the routes 404 when Google isn't configured (test env has no
 * GOOGLE_* vars).
 */
describe("Google OAuth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      await prisma.trip.deleteMany({
        where: { ownerId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("exposes /auth/google per configuration (redirect when set, else 404)", async () => {
    // The routes are only live when the OAuth client is configured. CI has no
    // GOOGLE_* vars (→ 404); a local .env with real creds flips this to a
    // redirect to Google's consent screen. Assert the behavior that matches the
    // environment the suite is actually running in.
    const env = app.get<Env>(ENV);
    if (isGoogleOAuthEnabled(env)) {
      const res = await http()
        .get("/auth/google?redirect=http://localhost:5173")
        .expect(302);
      assert.match(String(res.headers.location), /accounts\.google\.com/);
    } else {
      await http().get("/auth/google").expect(404);
      await http().get("/auth/google/callback").expect(404);
    }
  });

  it("creates a verified, password-less account for a new Google profile", async () => {
    const email = `gnew+${suffix}@example.com`;
    emails.push(email);

    const user = await auth.validateGoogleProfile({
      email: email.toUpperCase(), // normalization is the service's job
      displayName: "Grace Hopper",
    });

    assert.equal(user.email, email);
    assert.equal(user.displayName, "Grace Hopper");
    assert.equal(user.emailVerified, true);
    assert.equal(user.passwordHash, null);
  });

  it("reuses the existing account (no duplicate) for a returning Google user", async () => {
    const email = `greturn+${suffix}@example.com`;
    emails.push(email);
    const first = await auth.validateGoogleProfile({
      email,
      displayName: "Ada",
    });
    const second = await auth.validateGoogleProfile({
      email,
      displayName: "Ada Lovelace",
    });

    assert.equal(second.id, first.id);
    const count = await prisma.user.count({ where: { email } });
    assert.equal(count, 1, "no duplicate user row");
  });

  it("verifies a pre-existing unverified local account on Google sign-in", async () => {
    const email = `gunver+${suffix}@example.com`;
    emails.push(email);
    const local = await prisma.user.create({
      data: {
        email,
        displayName: "Local",
        emailVerified: false,
        passwordHash: "x",
      },
    });

    const linked = await auth.validateGoogleProfile({
      email,
      displayName: "Local",
    });
    assert.equal(linked.id, local.id);
    assert.equal(linked.emailVerified, true, "Google proves ownership");
  });

  it("refuses a deleted (anonymized) account", async () => {
    const email = `gdeleted+${suffix}@example.com`;
    emails.push(email);
    await prisma.user.create({
      data: {
        email,
        displayName: "Deleted user",
        emailVerified: false,
        anonymizedAt: new Date(),
      },
    });

    await assert.rejects(
      () => auth.validateGoogleProfile({ email, displayName: "x" }),
      /deleted/i,
    );
  });

  it("clamps the return origin to the CORS allowlist (open-redirect guard)", () => {
    const env = {
      CORS_ORIGINS: ["http://localhost:5173", "http://localhost:5174"],
      WEB_APP_URL: "http://localhost:5173",
    } as unknown as Env;

    // An allowed origin passes through.
    assert.equal(
      resolveReturnOrigin("http://localhost:5174", env),
      "http://localhost:5174",
    );
    // An unknown / malicious origin falls back to the first allowed one.
    assert.equal(
      resolveReturnOrigin("https://evil.example.com", env),
      "http://localhost:5173",
    );
    // Missing / non-string candidates also fall back.
    assert.equal(resolveReturnOrigin(undefined, env), "http://localhost:5173");
  });
});
