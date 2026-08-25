import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Auth backbone integration test (real DB). Exercises the full DoD flow:
 * register -> verify -> login -> me -> refresh -> logout, plus the security
 * properties: generic errors, no account enumeration, guarded /me.
 *
 * EmailService is overridden to capture the verification token (the raw token
 * is only ever emailed; the DB stores just its hash).
 */
describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let capturedToken: string | undefined;

  const email = `e2e+${Date.now()}@example.com`;
  const password = "Correct-Horse9Battery";
  const displayName = "E2E Traveller";

  before(async () => {
    const emailMock = {
      sendVerificationEmail: (_to: string, token: string) => {
        capturedToken = token;
        return Promise.resolve();
      },
      sendAccountExistsNotice: () => Promise.resolve(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  });

  after(async () => {
    if (prisma) await prisma.user.deleteMany({ where: { email } });
    if (app) await app.close();
  });

  it("register -> verify -> login -> me -> refresh -> logout", async () => {
    const agent = request.agent(app.getHttpServer());

    const register = await agent
      .post("/auth/register")
      .send({ email, password, displayName });
    assert.equal(register.status, 201);
    assert.deepEqual(register.body, { status: "verification_sent" });
    assert.ok(capturedToken, "a verification token was issued");

    const verify = await agent
      .post("/auth/verify")
      .send({ token: capturedToken });
    assert.equal(verify.status, 200);
    assert.equal(verify.body.email, email);
    assert.equal(verify.body.emailVerified, true);

    const login = await agent.post("/auth/login").send({ email, password });
    assert.equal(login.status, 200);
    assert.ok(login.body.accessToken, "access token returned");
    const cookies = login.headers["set-cookie"] as unknown as string[];
    assert.ok(
      cookies.some((c) => c.startsWith("gtp_refresh=")),
      "refresh cookie set",
    );
    const accessToken: string = login.body.accessToken;

    const me = await agent
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.email, email);

    // Agent carries the refresh cookie automatically.
    const refresh = await agent.post("/auth/refresh");
    assert.equal(refresh.status, 200);
    assert.ok(refresh.body.accessToken, "rotated access token returned");

    const logout = await agent.post("/auth/logout");
    assert.equal(logout.status, 204);

    const refreshAfterLogout = await agent.post("/auth/refresh");
    assert.equal(refreshAfterLogout.status, 401);
  });

  it("login with a wrong password returns a generic 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "not-the-password" });
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid email or password");
  });

  it("login with an unknown email returns the same generic 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: `nobody+${Date.now()}@example.com`, password });
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid email or password");
  });

  it("re-registering an existing email does not reveal it exists", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password, displayName: "Someone Else" });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { status: "verification_sent" });
  });

  it("/auth/me without a token is rejected", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me");
    assert.equal(res.status, 401);
  });
});
