import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import sharp from "sharp";
import type { UploadedImageView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import { applyHttpHardening } from "../src/common/http-hardening.js";

/**
 * The HTTP edge (Phase 7.2). This suite applies {@link applyHttpHardening} —
 * the very function `main.ts` calls — so what it asserts is the shipped policy
 * and not a policy the test invented.
 *
 * Covers the three things the slice's DoD names: headers are present, CORS is
 * an allowlist rather than a wildcard, and the one publicly embedded route
 * carries the resource policy that lets a cross-origin `<img>` load it.
 */
describe("HTTP security headers + CORS (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let env: Env;
  let uploadDir: string;

  const suffix = Date.now();
  const emails: string[] = [];
  const stored: string[] = [];
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
    env = app.get<Env>(ENV);
    applyHttpHardening(app, env);
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
    uploadDir = resolve(env.UPLOAD_DIR);
  });

  after(async () => {
    for (const name of stored) {
      await rm(resolve(uploadDir, name), { force: true }).catch(
        () => undefined,
      );
    }
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("sends the baseline security headers on an ordinary response", async () => {
    const res = await http().get("/health");

    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.ok(
      res.headers["strict-transport-security"]?.includes("max-age="),
      "HSTS is set",
    );
    assert.ok(
      res.headers["content-security-policy"]?.includes("default-src 'self'"),
      "a CSP is set",
    );
    // Express advertises itself by default; helmet removes the banner.
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  describe("CORS is an allowlist", () => {
    it("echoes an allowed origin and permits credentials", async () => {
      const allowed = env.CORS_ORIGINS[0];
      assert.ok(allowed, "the test environment configures at least one origin");

      const res = await http().get("/health").set("Origin", allowed);

      assert.equal(res.headers["access-control-allow-origin"], allowed);
      assert.equal(res.headers["access-control-allow-credentials"], "true");
    });

    it("refuses an origin that is not on the list", async () => {
      const res = await http()
        .get("/health")
        .set("Origin", "https://evil.example");

      // No allow-origin header at all — and in particular never `*`, which
      // could not be combined with credentials anyway.
      assert.equal(res.headers["access-control-allow-origin"], undefined);
    });
  });

  it("refuses a malformed page cursor instead of casting it in the database", async () => {
    // The query string is a boundary too: before 7.2 this string went straight
    // into Prisma's `cursor`, where a failed uuid cast surfaced as a 500.
    const email = `cursor+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Cursor",
        emailVerified: true,
        passwordHash: "x",
      },
    });
    const accessToken = await tokens_.signAccessToken(user);

    await http()
      .get("/notifications?cursor=not-a-uuid")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(400);

    // A well-formed cursor is still honoured (it simply matches no row here).
    await http()
      .get("/notifications?cursor=00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
  });

  it("lets the media route be embedded cross-origin, unlike the API", async () => {
    // The gotcha this asserts: helmet's default CORP is `same-origin`, which
    // would make a browser block the covers and avatars the web app loads from
    // this API's domain with `<img src>`. The media route opts out for itself.
    const email = `headers+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Headers",
        emailVerified: true,
        passwordHash: "x",
      },
    });
    const accessToken = await tokens_.signAccessToken(user);

    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const upload = await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", png, { filename: "x.png", contentType: "image/png" })
      .expect(201);
    const name = (upload.body as UploadedImageView).url.split("/").pop();
    assert.ok(name, "the upload returned a stored name");
    stored.push(name);

    const served = await http().get(`/media/${name}`).expect(200);
    assert.equal(
      served.headers["cross-origin-resource-policy"],
      "cross-origin",
    );
    // The rest of the Phase-6.1 policy is still in force on the same response.
    assert.equal(served.headers["content-type"], "image/webp");
    assert.equal(served.headers["x-content-type-options"], "nosniff");
    assert.equal(
      served.headers["content-security-policy"],
      "default-src 'none'; sandbox",
    );

    // ...whereas an API response keeps the strict default.
    const api = await http().get("/health");
    assert.equal(api.headers["cross-origin-resource-policy"], "same-origin");
  });
});
