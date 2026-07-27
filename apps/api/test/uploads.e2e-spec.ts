import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import sharp from "sharp";
import type { UploadedImageView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";

/**
 * The image upload pipeline (Phase 6.1, security-critical) against the real
 * stack — this slice's DoD, end to end:
 *
 *  - a valid image is accepted, **re-encoded** (EXIF gone), and stored under a
 *    random name that bears no relation to what the client called it;
 *  - a **disguised non-image** — right extension, right Content-Type, wrong
 *    bytes — is rejected;
 *  - an **oversized** upload is rejected;
 *  - the **served path can't execute**: the media route fixes the content type,
 *    sends `nosniff`, and refuses any name it didn't generate.
 */
describe("Image uploads (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let uploadDir: string;

  const suffix = Date.now();
  const emails: string[] = [];
  const stored: string[] = [];
  const http = () => request(app.getHttpServer());

  /** A real JPEG with EXIF: a GPS tag and an orientation, both of which must be
   *  gone from what we store. */
  async function jpegWithExif(): Promise<Buffer> {
    return sharp({
      create: {
        width: 64,
        height: 40,
        channels: 3,
        background: { r: 200, g: 40, b: 40 },
      },
    })
      .withExif({
        IFD0: { Copyright: "Somebody", Orientation: "1" },
        IFD2: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" },
      })
      .jpeg()
      .toBuffer();
  }

  async function makeUser(label: string, verified = true) {
    const email = `upload+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: verified,
        passwordHash: "x",
      },
    });
    return { user, accessToken: await tokens_.signAccessToken(user) };
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
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
    uploadDir = resolve(app.get<Env>(ENV).UPLOAD_DIR);
  });

  after(async () => {
    // Only the files this suite created — never the whole directory.
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

  it("accepts a real image, re-encodes it and strips EXIF", async () => {
    const me = await makeUser("happy");
    const original = await jpegWithExif();
    // Sanity: the fixture really does carry the metadata we expect stripped.
    assert.ok(
      (await sharp(original).metadata()).exif,
      "fixture has EXIF to begin with",
    );

    const res = await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${me.accessToken}`)
      .attach("file", original, {
        filename: "holiday.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);

    const body = res.body as UploadedImageView;
    const name = body.url.split("/").pop()!;
    stored.push(name);

    assert.match(
      name,
      /^[0-9a-f-]{36}\.webp$/,
      "stored under a server-generated random name, not 'holiday.jpg'",
    );
    assert.ok(!body.url.includes("holiday"), "client filename is not reflected");
    assert.equal(body.width, 64);
    assert.equal(body.height, 40);

    // Fetch it back and prove the stored bytes are our re-encode, not the input.
    const served = await http().get(`/media/${name}`).expect(200);
    const meta = await sharp(served.body as Buffer).metadata();
    assert.equal(meta.format, "webp", "re-encoded to the one format we write");
    assert.equal(meta.exif, undefined, "EXIF is gone");
  });

  it("rejects a disguised non-image (bad magic bytes)", async () => {
    const me = await makeUser("disguise");
    // The classic: a script named .jpg, declaring image/jpeg. Only the bytes
    // give it away.
    await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${me.accessToken}`)
      .attach("file", Buffer.from('<?php system($_GET["c"]); ?>'), {
        filename: "avatar.jpg",
        contentType: "image/jpeg",
      })
      .expect(400);
  });

  it("rejects an oversized upload", async () => {
    const me = await makeUser("toobig");
    const max = app.get<Env>(ENV).UPLOAD_MAX_BYTES;
    // A valid JPEG header followed by padding past the cap: multer aborts while
    // reading, so this never lands in memory whole.
    const huge = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(max + 1024, 0x41),
    ]);

    const res = await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${me.accessToken}`)
      .attach("file", huge, {
        filename: "huge.jpg",
        contentType: "image/jpeg",
      });
    assert.ok(
      res.status === 413 || res.status === 400,
      `oversized upload refused (got ${res.status})`,
    );
  });

  it("requires an authenticated, verified caller", async () => {
    await http()
      .post("/uploads/image")
      .attach("file", await jpegWithExif(), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(401);

    const unverified = await makeUser("unverified", false);
    await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${unverified.accessToken}`)
      .attach("file", await jpegWithExif(), {
        filename: "a.jpg",
        contentType: "image/jpeg",
      })
      .expect(403);
  });

  it("serves stored images inertly and refuses names it didn't generate", async () => {
    const me = await makeUser("serve");
    const res = await http()
      .post("/uploads/image")
      .set("Authorization", `Bearer ${me.accessToken}`)
      .attach("file", await jpegWithExif(), {
        filename: "x.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);
    const name = (res.body as UploadedImageView).url.split("/").pop()!;
    stored.push(name);

    const served = await http().get(`/media/${name}`).expect(200);
    // The type is ours, and the browser is told not to second-guess it — this
    // is what stops a stored file being coaxed into executing.
    assert.equal(served.headers["content-type"], "image/webp");
    assert.equal(served.headers["x-content-type-options"], "nosniff");

    // Traversal and unknown names are 404s, decided before any filesystem call.
    await http().get("/media/..%2F..%2F.env").expect(404);
    await http().get("/media/evil.php").expect(404);
    await http()
      .get("/media/f47ac10b-58cc-4372-a567-0e02b2c3d479.webp")
      .expect(404);
  });
});
