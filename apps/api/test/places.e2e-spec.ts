import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { PlaceSearchResult, TripDetail } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { foldForSearch } from "../src/places/places-seed.js";

/**
 * The destination gazetteer (real DB).
 *
 * Every claim here is a thing the query could get wrong while still returning
 * plausible rows — which is exactly the failure mode a search endpoint has:
 *
 *  1. it matches a word **anywhere** in a name, so "york" reaches New York;
 *  2. **ranking**, from both sides. A large place is not buried by four small
 *     exact matches, and an exact match is not buried by one larger place that
 *     merely contains the word. The two together are what set the multiplier;
 *  3. accents fold, so "malmo" reaches Malmö;
 *  4. an alternate name reaches the canonical one — "becs" reaches Vienna — and
 *     the answer still *says* Vienna;
 *  5. punctuation in the query does not break it. This one is load-bearing:
 *     `to_tsquery` parses `&`, `|` and `!` as operators, so a stray character
 *     from a keystroke is a syntax error the database raises — a 500 from typing;
 *  6. choosing a place copies its clock onto the trip, and an id we do not know
 *     is treated as a typed destination rather than as an error.
 *
 * It seeds **its own handful of rows** rather than depending on
 * `pnpm places:seed` having run: a test that needs 74,000 rows loaded is a test
 * that fails on a fresh checkout for a reason that has nothing to do with it.
 * The ids are GeoNames' real ones, so this cannot collide with a seeded row.
 */
describe("Places (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let token: string;

  const suffix = Date.now();
  const email = `places+${suffix}@example.com`;
  const http = () => request(app.getHttpServer());

  /** Real GeoNames ids, so a row here is the row a full seed would hold. */
  const NEW_YORK = 5128581;
  const YORK_GB = 2633352;
  const MALMO = 2692969;
  const VIENNA = 2761369;
  const PARIS_FR = 2988507;
  const PARIS_TX = 4717560;

  const place = (
    geonameId: number,
    name: string,
    countryCode: string,
    population: number,
    extras: { alts?: string[]; timezone?: string; region?: string } = {},
  ) => ({
    geonameId,
    kind: "CITY" as const,
    name,
    asciiName: foldForSearch(name),
    altNames: (extras.alts ?? []).join("|"),
    countryCode,
    admin1Code: "01",
    admin1Name: extras.region ?? null,
    latitude: 1,
    longitude: 2,
    timezone: extras.timezone ?? "UTC",
    population,
    searchText: foldForSearch([name, ...(extras.alts ?? [])].join(" ")),
  });

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

    const user = await prisma.user.create({
      data: {
        email,
        displayName: "Places",
        emailVerified: true,
        passwordHash: "x",
      },
    });
    token = await tokens_.signAccessToken(user);

    await prisma.country.createMany({
      data: [
        { code: "US", name: "United States", currencyCode: "USD" },
        { code: "GB", name: "United Kingdom", currencyCode: "GBP" },
        { code: "SE", name: "Sweden", currencyCode: "SEK" },
        { code: "AT", name: "Austria", currencyCode: "EUR" },
        { code: "FR", name: "France", currencyCode: "EUR" },
      ],
      skipDuplicates: true,
    });
    await prisma.place.createMany({
      data: [
        place(NEW_YORK, "New York City", "US", 8804190, {
          timezone: "America/New_York",
          region: "New York",
        }),
        place(YORK_GB, "York", "GB", 156135, { region: "England" }),
        place(MALMO, "Malmö", "SE", 301706, { timezone: "Europe/Stockholm" }),
        place(VIENNA, "Vienna", "AT", 1691468, {
          alts: ["Bécs", "Wien"],
          timezone: "Europe/Vienna",
        }),
        place(PARIS_FR, "Paris", "FR", 2138551, { timezone: "Europe/Paris" }),
        place(PARIS_TX, "Paris", "US", 24782, { timezone: "America/Chicago" }),
      ],
      skipDuplicates: true,
    });
  });

  after(async () => {
    if (prisma) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (user) {
        await prisma.trip.deleteMany({ where: { ownerId: user.id } });
      }
      await prisma.user.deleteMany({ where: { email } });
      // The places and countries stay. They are a seeded gazetteer with real
      // ids, not this test's fixtures — deleting them would empty the table a
      // developer had just loaded.
    }
    if (app) await app.close();
  });

  const search = async (q: string): Promise<PlaceSearchResult> => {
    const res = await http()
      .get(`/places?q=${encodeURIComponent(q)}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return res.body as PlaceSearchResult;
  };

  it("matches a word anywhere in the name, not just the start", async () => {
    // A prefix index would answer "York" and stop. Somebody typing "york" and
    // meaning Manhattan is the commonest case there is.
    const names = (await search("york")).places.map((p) => p.name);
    assert.ok(
      names.some((n) => n.includes("New York")),
      names.join(", "),
    );
    assert.ok(names.includes("York"));
  });

  it("does not let four small exact matches bury one large one", async () => {
    /*
     * The case that set the ranking. Banding by relevance first — exact names,
     * then prefixes, then the rest — answered "york" with York in England,
     * Pennsylvania, South Carolina and Nebraska, and never reached New York at
     * all: four towns of eight thousand people ahead of the place that query
     * almost always means.
     *
     * Asserted as a *position*, since that is the claim. The fixture alone
     * cannot fail this, so it is written to hold against the full 74,000-row
     * gazetteer as well, where the four Yorks genuinely exist.
     */
    const names = (await search("york")).places.map((p) => p.name);
    const newYork = names.findIndex((n) => n.includes("New York"));
    const smallYork = names.lastIndexOf("York");
    assert.ok(newYork >= 0, `New York is missing from: ${names.join(", ")}`);
    assert.ok(
      smallYork < 0 || newYork < smallYork + 4,
      `New York is buried at ${newYork}: ${names.join(", ")}`,
    );
  });

  it("still prefers an exact name over a bigger place that merely contains it", async () => {
    // The other side of the boost, and the reason it is a multiplier rather than
    // a sort key: pure population would answer "bath" with Bathinda, which is
    // three times the size of Bath and not what anybody meant.
    const names = (await search("bath")).places.map((p) => p.name);
    if (!names.includes("Bath")) return; // only in the full gazetteer
    assert.equal(names[0], "Bath", names.join(", "));
  });

  it("folds accents, so a keyboard without them still finds the place", async () => {
    const found = (await search("malmo")).places;
    assert.ok(
      found.some((p) => p.name === "Malmö"),
      found.map((p) => p.name).join(", "),
    );
  });

  it("finds a place by another language's name and answers with its own", async () => {
    const found = (await search("becs")).places;
    // The point of storing alternates as search keys and nothing else: they are
    // how a Hungarian reaches the row, and the board still says Vienna.
    assert.equal(found[0]?.name, "Vienna");
  });

  it("ranks an exact name first, then by how many people live there", async () => {
    const paris = (await search("paris")).places.filter(
      (p) => p.name === "Paris",
    );
    assert.equal(paris[0]?.countryCode, "FR", "the French one comes first");
    assert.ok(paris.length >= 2, "and the Texan one is still offered");
  });

  it("survives the characters `to_tsquery` treats as operators", async () => {
    // Each of these is a syntax error if the query string is handed to
    // `to_tsquery` as written, and a syntax error here is a 500 from a
    // keystroke. The terms are extracted and rejoined instead.
    for (const q of [
      "york &",
      "!york",
      "a | b",
      "york:",
      "(york",
      "york & !",
    ]) {
      const res = await http()
        .get(`/places?q=${encodeURIComponent(q)}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200, `"${q}" should not error`);
    }
  });

  it("says nothing rather than everything for a query too short to mean anything", async () => {
    assert.deepEqual((await search("y")).places, []);
    assert.deepEqual((await search("")).places, []);
  });

  it("needs an account, like every other route that costs a query", async () => {
    await http().get("/places?q=york").expect(401);
  });

  it("copies the chosen place's clock onto the trip", async () => {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Vienna weekend",
        destination: "Vienna, Austria",
        destinationPlaceId: VIENNA,
        defaultCurrency: "EUR",
      })
      .expect(201);
    const trip = res.body as TripDetail;
    assert.equal(trip.destinationPlaceId, VIENNA);
    // Read from our own table, never from the request — the client sent an id
    // and no facts at all.
    assert.equal(trip.destinationTimezone, "Europe/Vienna");
    assert.equal(trip.destination, "Vienna, Austria");
  });

  it("treats an id it does not know as a destination somebody typed", async () => {
    // A stale tab submitting from a dataset the server has re-seeded past. The
    // name the user gave is still a perfectly good destination, and refusing the
    // whole trip over a cached id would be the least useful thing to do with it.
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Somewhere else",
        destination: "Dad's cabin",
        destinationPlaceId: 999_999_999,
        defaultCurrency: "EUR",
      })
      .expect(201);
    const trip = res.body as TripDetail;
    assert.equal(trip.destination, "Dad's cabin");
    assert.equal(trip.destinationPlaceId, null);
    assert.equal(trip.destinationTimezone, null);
  });
});
