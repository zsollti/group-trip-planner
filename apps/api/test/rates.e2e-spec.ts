import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import {
  HttpRatesProvider,
  RATES_PROVIDER,
  type RateSnapshot,
  type RatesProvider,
} from "../src/rates/rates.provider.js";
import { RatesService } from "../src/rates/rates.service.js";

/**
 * The daily rate snapshot: storing it, keeping it, and refusing to use it
 * (post-launch). Real database, **no network** — the feed is a stub, which is
 * the whole reason it sits behind an injected provider.
 *
 * The property worth most here is the third one: a third-party feed that fails
 * must cost the app nothing at all. Stale rates keep converting and say their
 * date; that is far better than an app that stops answering because somebody
 * else's server had a bad morning.
 *
 * This spec writes the one **globally shared** table in the schema, so it puts
 * back whatever it found. Nothing else asserts on rate rows for that reason.
 */
describe("Exchange rates (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rates: RatesService;

  /** What the stub feed will answer with next, or an error to throw. */
  let nextSnapshot: RateSnapshot | Error = {
    asOf: "2026-08-12",
    rates: { HUF: 400, USD: 1.1 },
  };

  const stubProvider: RatesProvider = {
    fetchLatest: () =>
      nextSnapshot instanceof Error
        ? Promise.reject(nextSnapshot)
        : Promise.resolve(nextSnapshot),
  };

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ sendVerificationEmail: () => Promise.resolve() })
      .overrideProvider(RATES_PROVIDER)
      .useValue(stubProvider)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    rates = app.get(RatesService);
  });

  beforeEach(async () => {
    // `onModuleInit` already ran a catch-up refresh through the stub, so start
    // every case from a known empty table rather than from boot's leftovers.
    await prisma.exchangeRate.deleteMany();
    clearCache();
    nextSnapshot = { asOf: "2026-08-12", rates: { HUF: 400, USD: 1.1 } };
  });

  after(async () => {
    if (prisma) await prisma.exchangeRate.deleteMany();
    if (app) await app.close();
  });

  /** The service caches for minutes; a test must not wait them out. */
  function clearCache(): void {
    (rates as unknown as { cache: unknown }).cache = null;
  }

  it("stores a fetched snapshot, keyed by code", async () => {
    assert.equal(await rates.refresh(), true);

    const rows = await prisma.exchangeRate.findMany({
      orderBy: { code: "asc" },
    });
    assert.deepEqual(
      rows.map((r) => r.code),
      ["HUF", "USD"],
    );
    assert.equal(Number(rows[0]!.perEur), 400);
    // The source's publication date, stored as the calendar day it is.
    assert.equal(rows[0]!.asOf.toISOString().slice(0, 10), "2026-08-12");
    assert.equal(rows[0]!.source, "ecb");
  });

  it("hands the rates out for conversion, with the date they were published", async () => {
    await rates.refresh();
    clearCache();

    const current = await rates.current(new Date("2026-08-12T09:00:00Z"));
    assert.equal(current?.asOf, "2026-08-12");
    assert.equal(current?.rates.HUF, 400);
    // The pivot is 1 by definition and is never stored as a row.
    assert.equal(current?.rates.EUR, undefined);
  });

  it("keeps the last good rates when the feed fails", async () => {
    await rates.refresh();
    clearCache();

    nextSnapshot = new Error("502 from the rate feed");
    assert.equal(await rates.refresh(), false);

    clearCache();
    const current = await rates.current(new Date("2026-08-12T09:00:00Z"));
    // Unchanged, and still being served. A feed outage is not an app outage,
    // and there is no hardcoded fallback table to be quietly wrong from.
    assert.equal(current?.rates.HUF, 400);
    assert.equal(current?.asOf, "2026-08-12");
  });

  it("replaces a stored rate rather than accumulating rows", async () => {
    await rates.refresh();
    nextSnapshot = { asOf: "2026-08-13", rates: { HUF: 410, USD: 1.2 } };
    await rates.refresh();

    const rows = await prisma.exchangeRate.findMany();
    assert.equal(rows.length, 2);
    clearCache();
    const current = await rates.current(new Date("2026-08-13T09:00:00Z"));
    assert.equal(current?.rates.HUF, 410);
    assert.equal(current?.asOf, "2026-08-13");
  });

  it("fetches at most once a day, however often the tick fires", async () => {
    const now = new Date("2026-08-12T09:00:00Z");
    assert.equal(await rates.refreshIfStale(now), true);

    clearCache();
    // Same day, already stored: the hourly tick must not spend a call on it.
    nextSnapshot = new Error("must not be called");
    assert.equal(await rates.refreshIfStale(now), false);

    // Next day, it should go.
    clearCache();
    nextSnapshot = { asOf: "2026-08-13", rates: { HUF: 410 } };
    assert.equal(
      await rates.refreshIfStale(new Date("2026-08-13T09:00:00Z")),
      true,
    );
  });

  it("stops offering a conversion once the rates are too old to mean anything", async () => {
    await rates.refresh(); // published 2026-08-12
    clearCache();

    // Within the window: still offered, and the date is shown so the reader
    // can judge it for themselves.
    assert.notEqual(
      await rates.current(new Date("2026-09-05T09:00:00Z")),
      null,
    );

    clearCache();
    // Well past it: the exact per-currency figures are still right, so the app
    // falls back to those rather than converting at a rate from another month.
    assert.equal(await rates.current(new Date("2026-10-20T09:00:00Z")), null);
  });

  it("does nothing at all when no feed is configured", async () => {
    // The unconfigured deployment — and every test run, which is what keeps
    // the suite offline.
    const unconfigured = new RatesService(prisma, null);
    assert.equal(await unconfigured.refresh(), false);
    assert.equal(await unconfigured.refreshIfStale(), false);
    assert.equal(await unconfigured.current(), null);
    assert.equal(await prisma.exchangeRate.count(), 0);
  });
});

/**
 * The feed adapter's own rules, with a stubbed `fetch`. Everything here is
 * about refusing a bad snapshot rather than storing it: a wrong rate is worse
 * than no rate, because only one of the two is visible to the reader.
 */
describe("HttpRatesProvider", () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });

  function answerWith(body: unknown, status = 200): void {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;
  }

  const provider = new HttpRatesProvider("https://rates.example/latest");

  it("reads the publication date and the rates", async () => {
    answerWith({ base: "EUR", date: "2026-08-12", rates: { HUF: 400 } });
    const snapshot = await provider.fetchLatest();
    assert.equal(snapshot.asOf, "2026-08-12");
    assert.equal(snapshot.rates.HUF, 400);
  });

  it("drops the pivot if the feed echoes it back", async () => {
    answerWith({
      base: "EUR",
      date: "2026-08-12",
      rates: { EUR: 1, HUF: 400 },
    });
    const snapshot = await provider.fetchLatest();
    assert.equal(snapshot.rates.EUR, undefined);
  });

  it("refuses a feed quoted against something other than the pivot", async () => {
    // Every stored rate means "units per one EUR". A USD-based feed would be
    // silently wrong in every conversion it fed.
    answerWith({ base: "USD", date: "2026-08-12", rates: { HUF: 360 } });
    await assert.rejects(provider.fetchLatest(), /based on USD/);
  });

  it("refuses a zero rate rather than converting money to nothing", async () => {
    answerWith({ base: "EUR", date: "2026-08-12", rates: { HUF: 0 } });
    await assert.rejects(provider.fetchLatest());
  });

  it("refuses a body that is not the shape it claims", async () => {
    answerWith({ base: "EUR", date: "yesterday", rates: { HUF: 400 } });
    await assert.rejects(provider.fetchLatest());
  });

  it("refuses a non-200 instead of parsing an error page", async () => {
    answerWith({ error: "rate limited" }, 429);
    await assert.rejects(provider.fetchLatest(), /answered 429/);
  });
});
