import type { PrismaClient, Prisma } from "@prisma/client";
import { avatarPresetUrl, BUILTIN_CATEGORIES, placeLabel } from "@gtp/types";
import argon2 from "argon2";

/**
 * The public demo trip — the board a visitor lands in after signing in with the
 * credentials published in the README.
 *
 * Why this exists: a stranger evaluating the app has to register, verify an
 * email, create a trip and propose options before anything interesting is on
 * screen. That is several minutes of work to see a board, and most people leave
 * first. This builds a trip that is already mid-flight, so the product is
 * legible on the first screen.
 *
 * **Re-runnable.** It deletes the demo user's trips and rebuilds them, so it can
 * be run whenever visitors have edited the demo. Everything hangs off the trip
 * by cascade, so the delete resets categories, options, votes, channels,
 * messages and the audit log with it. Real accounts are never touched.
 *
 * Two callers, which is why this lives in `src/` rather than in the script that
 * used to hold it:
 *
 *  - `prisma/demo-seed.ts`, the CLI (`pnpm --filter @gtp/api demo:seed`);
 *  - `AdminService.reseedDemo`, behind the operator console's button.
 *
 * Consequences of the second caller, both deliberate:
 *
 *  - **No `console.log` and no `process.exit`.** It returns a summary and lets
 *    the caller decide how to say it — the CLI prints it, the console renders it.
 *  - **No decorators, and no import that needs compiling.** The CLI runs under
 *    node's `--experimental-strip-types`, which strips types and refuses
 *    anything that needs real transformation. A `@Injectable()` here would break
 *    `pnpm demo:seed` at parse time.
 *
 * Dates are computed relative to now, so the trip never drifts into the past.
 */

export const DEMO_EMAIL = "demo@example.com";
export const DEMO_PASSWORD = "demo-trip-2026";
export const DEMO_TRIP_NAME = "Lisbon — long weekend";
/**
 * The trip that already happened.
 *
 * A demo account with one active board shows exactly half the product: History
 * is a real state a trip ends in — read-only, still browsable, still holding
 * what it cost — and a visitor could only reach it by waiting a year or editing
 * a date. So the demo owns a second board, a year behind, already ended.
 *
 * Deliberately smaller than the Lisbon one. Its job is to be *finished*, which
 * means every lane decided and nothing left arguing; a second board with the
 * same amount of open business in it would just be two of the same screen.
 */
export const DEMO_HISTORY_TRIP_NAME = "Tallinn — Christmas market";

/**
 * example.com is reserved by RFC 2606 and cannot receive mail, so no seeded
 * address can ever reach a real person even if a notification escapes.
 */
/**
 * The two demo destinations, by GeoNames id.
 *
 * Ids and not names, because an id is what a person choosing from the picker
 * actually sends and what the trip actually stores — seeding by name would have
 * meant a lookup this seed could get wrong in a way the product cannot. They are
 * stable across dumps, which is the property the whole `places` table is keyed
 * on.
 */
const LISBON = 2267057;
const TALLINN = 588409;

/** What a chosen destination writes onto a trip. */
interface SeededDestination {
  destination: string;
  destinationPlaceId: number | null;
  destinationLat: number | null;
  destinationLon: number | null;
  destinationTimezone: string | null;
}

/**
 * Resolve one of the demo destinations against the gazetteer.
 *
 * The demo's whole job is to look like a board somebody actually made, and since
 * the destination became a chosen place rather than a typed string, a demo with
 * two typed strings was quietly showing the *old* product: no coordinates, no
 * timezone, no resolved id — the three things that separate "Lisbon, Portugal"
 * from Lisbon.
 *
 * It reads the table directly rather than going through `PlacesService`, for the
 * same reason nothing else in this file has a decorator on it: the CLI runs
 * under node's `--experimental-strip-types` and cannot instantiate a Nest
 * provider. The label is built by the shared {@link placeLabel}, though, so the
 * seeded string is character-for-character the one the picker would have written.
 *
 * **It falls back to the typed name, and that is the important part.** The
 * gazetteer is loaded once per environment by a separate step, and a fresh
 * database has an empty `places` table — so the alternative to this fallback is
 * a demo seed that crashes on the one environment where somebody is most likely
 * to run it first. Free text is a first-class destination in this product
 * anyway; a demo without coordinates is the old demo, not a broken one.
 */
async function seedDestination(
  prisma: PrismaClient,
  geonameId: number,
  fallback: string,
): Promise<SeededDestination> {
  const place = await prisma.place.findUnique({
    where: { geonameId },
    include: { country: { select: { name: true } } },
  });
  if (!place) {
    return {
      destination: fallback,
      destinationPlaceId: null,
      destinationLat: null,
      destinationLon: null,
      destinationTimezone: null,
    };
  }
  return {
    destination: placeLabel({
      name: place.name,
      region: place.admin1Name,
      countryName: place.country.name,
    }),
    destinationPlaceId: place.geonameId,
    destinationLat: place.latitude,
    destinationLon: place.longitude,
    destinationTimezone: place.timezone,
  };
}

/**
 * The demo's five, each in a mark and a colour of their own.
 *
 * **Fixed, not random.** Every other account picks its look at sign-up with
 * `randomAvatarLook`, and this is the one place that must not: the seed is
 * re-run from the operator console and the whole point of that button is that
 * it rebuilds the *same* board. A cast that changed faces between runs would
 * make the demo look broken to the one person most likely to be watching it.
 *
 * Chosen so no two sit adjacent on the hue ring — a crew list of five is the
 * hardest place in the app to tell colours apart, because the marks are small
 * and they are lined up against each other.
 */
const CAST = [
  {
    key: "demo",
    email: DEMO_EMAIL,
    name: "Demo User",
    role: "OWNER",
    look: { preset: "compass", colour: "SKY" },
  },
  {
    key: "mira",
    email: "mira@example.com",
    name: "Mira Kovács",
    role: "CO_ORGANIZER",
    look: { preset: "map", colour: "ROSE" },
  },
  {
    key: "tomas",
    email: "tomas@example.com",
    name: "Tomáš Novák",
    role: "PARTICIPANT",
    look: { preset: "backpack", colour: "LIME" },
  },
  {
    key: "anna",
    email: "anna@example.com",
    name: "Anna Weber",
    role: "PARTICIPANT",
    look: { preset: "camera", colour: "VIOLET" },
  },
  {
    key: "sam",
    email: "sam@example.com",
    name: "Sam Ellis",
    role: "GUEST",
    look: { preset: "tent", colour: "AMBER" },
  },
] as const;

type CastKey = (typeof CAST)[number]["key"];

/** What the seed built, for a caller that has to report it. */
export interface DemoSeedSummary {
  tripId: string;
  tripName: string;
  /** The address to sign in with — the one fact a reader of this needs. */
  email: string;
  members: number;
  options: number;
  decisions: number;
  messages: number;
  /** Demo trips deleted to make room. Zero on a first run. */
  removedTrips: number;
}

/** The nights the trip runs, as offsets from today. */
const ARRIVE = 67;
const DEPART = 70;

/** Days from now, at midday UTC — stable regardless of the runner's timezone. */
function daysOut(days: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * The December that is always behind us: last year's.
 *
 * The active trip is built from offsets so it never drifts into the past. The
 * history trip needs the opposite *and* one more thing offsets cannot give it:
 * a season. "Tallinn — Christmas market" dated to some Tuesday in August is the
 * kind of detail that quietly tells a visitor the whole board is fake, and 372
 * days ago is a different month every year the demo is re-seeded.
 *
 * Last year's December is past whatever the date is today — in January it is
 * thirteen months back, in November twenty-three — so this is in the past by
 * construction, and it is December every time.
 */
function lastDecember(day: number, hour = 12, minute = 0): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1, 11, day);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/**
 * A wall-clock time on one of the trip's days, UTC.
 *
 * The times exist so the itinerary has something to draw: a decision with no
 * clock lands in the timeline's "not placed" list, which is honest but shows
 * none of the alignment the page is for. They are also internally consistent —
 * the van leaves the airport after the flight lands, the flat is checked into
 * that afternoon — because a demo whose own hours contradict each other is worse
 * than one with no hours at all.
 */
function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d;
}

/** Minutes before now — used to lay chat and votes out on a believable timeline. */
function minsAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * Build (or rebuild) the demo trip.
 *
 * Takes the client rather than making one, so the console's request runs on the
 * app's pool and the CLI can own its own connection lifecycle.
 */
export async function seedDemoTrip(
  prisma: PrismaClient,
): Promise<DemoSeedSummary> {
  // ------------------------------------------------------------------ users ---
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  const users = {} as Record<CastKey, { id: string }>;
  for (const person of CAST) {
    users[person.key] = await prisma.user.upsert({
      where: { email: person.email },
      // The look is written on both paths. A re-seed has to restore the whole
      // demo, including what its cast look like — leaving it off `update` would
      // mean the button repaired everything except the thing a visitor sees
      // first.
      update: {
        displayName: person.name,
        emailVerified: true,
        passwordHash,
        avatarUrl: avatarPresetUrl(person.look.preset, person.look.colour),
      },
      create: {
        email: person.email,
        displayName: person.name,
        emailVerified: true,
        passwordHash,
        avatarUrl: avatarPresetUrl(person.look.preset, person.look.colour),
      },
      select: { id: true },
    });
  }

  // -------------------------------------------------------- reset & rebuild ---
  // Cascades from Trip clear categories, options, votes, channels, messages,
  // reactions, mentions, reads and audit events in one statement.
  //
  // **Not `ownerId: demo` alone.** The demo account owns the boards this script
  // builds — right up until a visitor uses the demo to try transferring
  // ownership, which is a thing the demo exists to let people try. The old
  // board then stopped matching, survived the reset, and the next seed left the
  // account looking at two Lisbons: the new one it owns, and the previous one
  // where it is now somebody's co-organizer.
  //
  // So a demo trip is one the demo account is **in**, that is either still
  // owned by a member of the cast or still carries one of the two names this
  // file gives them. Both halves are needed and neither is enough: the first
  // misses a board handed to a real visitor who joined by link, the second
  // misses a renamed one. What the pair deliberately will not touch is a trip a
  // real person owns and merely invited the demo account into — that is their
  // board, not this script's, and deleting it would be the worst kind of
  // surprise from a button labelled "rebuild the demo".
  const castIds = CAST.map((p) => users[p.key].id);
  const { count: removedTrips } = await prisma.trip.deleteMany({
    where: {
      memberships: { some: { userId: users.demo.id } },
      OR: [
        { ownerId: { in: castIds } },
        { name: { in: [DEMO_TRIP_NAME, DEMO_HISTORY_TRIP_NAME] } },
      ],
    },
  });

  const lisbon = await seedDestination(prisma, LISBON, "Lisbon, Portugal");

  const trip = await prisma.trip.create({
    data: {
      name: DEMO_TRIP_NAME,
      ...lisbon,
      description:
        "Five of us, three nights, one long weekend. Flights, the flat and a couple of the activities are settled. The rest is still being argued about.",
      defaultCurrency: "EUR",
      // A target, not a limit — nothing is refused for exceeding it. Set on the
      // demo because the cost panel is half a feature without one: the donut
      // draws where the money went, and the reading it is *for* is "against
      // what?".
      //
      // **520 is chosen to sit between the two answers**, because the verdict is
      // per *viewer* and the demo should show both halves of that:
      //
      //   what everyone pays  106 + 106 + 96/5 + 1080/5 + 39  =  486.20 EUR
      //   plus the surf lesson, for the four who joined it     ≈  +56 EUR
      //
      // So a member who is only in for what the whole group agreed lands
      // comfortably under the target, and the same board tells the demo account
      // — who is in the water — that it is over. That difference is the entire
      // point of pricing an option for whoever's in, and a single target either
      // side of both figures would have shown one state to everybody.
      budgetPerPerson: "520.00",
      expiresAt: daysOut(365),
      ownerId: users.demo.id,
      memberships: {
        create: CAST.map((p) => ({ userId: users[p.key].id, role: p.role })),
      },
      categories: {
        create: BUILTIN_CATEGORIES.map((c) => ({
          name: c.name,
          builtinKey: c.builtinKey,
          singleChoice: c.singleChoice,
          position: c.position,
          isBuiltin: true,
        })),
      },
    },
    select: { id: true },
  });

  const categories = await prisma.category.findMany({
    where: { tripId: trip.id },
    select: { id: true, builtinKey: true },
  });
  const cat = (key: string) => {
    const found = categories.find((c) => c.builtinKey === key);
    if (!found)
      throw new Error(`Built-in category ${key} missing from the seed`);
    return found.id;
  };

  // ---------------------------------------------------------------- options ---
  // Prices are plausible for Lisbon. One activity is priced in GBP on purpose:
  // it makes the cost dashboard show two currencies side by side, which is the
  // whole point of never summing across them.
  //
  // Most options carry clock times; three deliberately do not (Ryanair, the
  // hostel, the food crawl). A demo where everything is placed never shows the
  // timeline's "not placed" list, and that list is the honest half of the
  // feature — a real trip always has a decision nobody has put an hour on yet.
  type Seed = Omit<
    Prisma.OptionUncheckedCreateInput,
    "categoryId" | "proposerId"
  > & {
    by: CastKey;
  };

  const optionSeeds: Array<{ categoryKey: string; options: Seed[] }> = [
    {
      categoryKey: "DATES",
      options: [
        {
          title: "Fri 15 – Mon 18",
          description:
            "Cheapest flights of the three, but Mira is away until the 16th.",
          currency: "EUR",
          position: 0,
          by: "tomas",
          startsAt: daysOut(60),
          endsAt: daysOut(63),
        },
        {
          title: "Fri 22 – Mon 25",
          description: "Works for everyone. Slightly pricier flights.",
          currency: "EUR",
          position: 1,
          by: "demo",
          startsAt: daysOut(ARRIVE),
          endsAt: daysOut(DEPART),
        },
        {
          title: "Fri 5 – Mon 8 (following month)",
          description: "Warmer, but Sam is back at work.",
          currency: "EUR",
          position: 2,
          by: "anna",
          startsAt: daysOut(88),
          endsAt: daysOut(91),
        },
      ],
    },
    {
      categoryKey: "TRANSPORT",
      options: [
        {
          title: "TAP direct — BUD → LIS",
          description:
            "Out on the Friday morning, 4h05. Hand luggage included.",
          amount: "106.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 0,
          by: "demo",
          startsAt: at(ARRIVE, 7, 15),
          endsAt: at(ARRIVE, 11, 20),
        },
        {
          // The way home, and the reason it is its own option rather than a
          // second date on the outbound one: an option is one span, so a trip
          // whose flight out and flight back are the same row can only ever
          // draw the going. The last day was the one day of the demo with
          // nothing on it, which read as a group that never left.
          //
          // Two legs at 106 rather than one booking at 212 — the money is
          // unchanged, which is the point: this exists to give the timeline its
          // last-day bar, not to make the trip more expensive.
          title: "TAP direct — LIS → BUD",
          description: "Home on the Monday evening. Same fare, same bag.",
          amount: "106.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "demo",
          startsAt: at(DEPART, 17, 40),
          endsAt: at(DEPART, 21, 45),
        },
        {
          title: "Ryanair via Madrid",
          description:
            "€71 cheaper for the pair, but a 3h layover on the way out and a 06:15 departure.",
          amount: "141.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 2,
          by: "sam",
        },
        {
          title: "Airport transfer — pre-booked van",
          description: "One van, both directions, split five ways.",
          amount: "96.00",
          currency: "EUR",
          costType: "TOTAL",
          position: 3,
          by: "mira",
          // After the TAP flight lands, not before it.
          startsAt: at(ARRIVE, 11, 45),
          endsAt: at(ARRIVE, 12, 30),
        },
      ],
    },
    {
      categoryKey: "ACCOMMODATION",
      options: [
        {
          title: "Alfama apartment — whole flat",
          description:
            "Three bedrooms, terrace, 6 min walk to the tram. Three nights, whole place.",
          amount: "1080.00",
          currency: "EUR",
          costType: "TOTAL",
          position: 0,
          by: "mira",
          // Check-in to check-out — the span that covers every night of the
          // trip, which is what the itinerary's gap check reads.
          startsAt: at(ARRIVE, 15),
          endsAt: at(DEPART, 11),
        },
        {
          title: "Hotel Baixa — three twin rooms",
          description: "Central and simple. Breakfast not included.",
          amount: "139.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "anna",
          startsAt: at(ARRIVE, 14),
          endsAt: at(DEPART, 12),
        },
        {
          title: "Hostel Bairro Alto — private dorm",
          description:
            "Cheapest by a distance. Loud until 2am, per every review.",
          amount: "62.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 2,
          by: "sam",
        },
      ],
    },
    {
      categoryKey: "ACTIVITIES",
      options: [
        {
          title: "Sintra day trip",
          description: "Train from Rossio, Pena Palace tickets booked ahead.",
          amount: "44.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 0,
          by: "anna",
          startsAt: at(ARRIVE + 1, 9),
          endsAt: at(ARRIVE + 1, 18),
        },
        {
          title: "Surf lesson — Costa da Caparica",
          description:
            "Booked through a UK operator, so it prices in sterling. Held for four boards.",
          amount: "48.00",
          currency: "GBP",
          costType: "PER_PERSON",
          position: 1,
          by: "tomas",
          // Priced for whoever is in rather than for the trip: four of the
          // five want it, which is the case this mode exists for, and it is
          // what puts an option in the cost chart's "priced for part of the
          // group" aside.
          participationMode: "OPT_IN" as const,
          startsAt: at(ARRIVE + 2, 10),
          endsAt: at(ARRIVE + 2, 13),
        },
        {
          title: "Tram 28 photo walk — 07:00 start",
          description:
            "Empty trams and good light, at the cost of the lie-in. Whoever's up.",
          amount: "12.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 2,
          by: "mira",
          // The second opt-in option, and the one the demo account is **not**
          // in. With only the surf lesson, signing up was the only state the
          // board could show; a visitor could see who was in but never the
          // invitation to join. Two of the five here, neither of them demo.
          participationMode: "OPT_IN" as const,
          startsAt: at(ARRIVE + 1, 7),
          endsAt: at(ARRIVE + 1, 8, 30),
        },
        {
          title: "Fado dinner in Alfama",
          description: "Set menu. Needs booking two weeks out.",
          amount: "39.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 3,
          by: "mira",
          startsAt: at(ARRIVE + 2, 20),
          endsAt: at(ARRIVE + 2, 22, 30),
        },
        {
          title: "Time Out Market food crawl",
          description:
            "No booking, just turn up hungry. Rough per-head estimate.",
          amount: "30.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 4,
          by: "demo",
        },
      ],
    },
  ];

  const optionIds = new Map<string, string>();
  for (const group of optionSeeds) {
    for (const { by, ...data } of group.options) {
      const created = await prisma.option.create({
        data: {
          ...data,
          categoryId: cat(group.categoryKey),
          proposerId: users[by].id,
        },
        select: { id: true, title: true },
      });
      optionIds.set(created.title, created.id);
    }
  }
  const opt = (title: string) => {
    const id = optionIds.get(title);
    if (!id) throw new Error(`Option "${title}" was not seeded`);
    return id;
  };

  // ------------------------------------------------------------------ votes ---
  // Advisory only — they never decide anything. Spread so each open category has
  // a visible front-runner, which is what the projected total is built from.
  const votes: Array<[string, CastKey[]]> = [
    ["Fri 22 – Mon 25", ["demo", "mira", "tomas", "anna"]],
    ["Fri 15 – Mon 18", ["sam"]],
    ["TAP direct — BUD → LIS", ["demo", "mira", "anna"]],
    ["TAP direct — LIS → BUD", ["demo", "mira", "anna"]],
    ["Ryanair via Madrid", ["sam", "tomas"]],
    ["Airport transfer — pre-booked van", ["mira", "anna", "demo"]],
    ["Alfama apartment — whole flat", ["demo", "mira", "anna", "tomas"]],
    ["Hostel Bairro Alto — private dorm", ["sam"]],
    // The surf lesson wins its vote and is then locked, so the demo shows the
    // whole arc in one lane: a vote that ran, the decision it led to, and the
    // options that are still standing under it. The tram walk stays lightly
    // voted — an option nobody has rallied behind is as much a part of a real
    // board as the winner.
    ["Surf lesson — Costa da Caparica", ["demo", "tomas", "sam", "anna"]],
    ["Time Out Market food crawl", ["demo", "sam", "tomas"]],
    ["Sintra day trip", ["mira", "tomas"]],
    ["Fado dinner in Alfama", ["mira", "anna"]],
    ["Tram 28 photo walk — 07:00 start", ["mira"]],
  ];
  for (const [title, voters] of votes) {
    await prisma.vote.createMany({
      data: voters.map((v) => ({
        optionId: opt(title),
        userId: users[v].id,
        createdAt: minsAgo(60 * 30),
      })),
    });
  }

  // -------------------------------------------------------------- decisions ---
  // Locked explicitly by an organizer, each with the audit row the real lock
  // transaction writes.
  //
  // Every lane here except Dates seeds multi-select (`BUILTIN_CATEGORIES`),
  // which is what lets Transport hold three decisions — both flight legs and
  // the van — and Activities hold two of its five. That used to be a lie the
  // seed told: it wrote its locks with `prisma.option.update`, straight past the
  // service that enforces the rule, so it shipped two locked options in a lane
  // the API would have refused to let anyone lock twice.
  //
  // Activities used to carry no lock at all, to keep the cost dashboard's
  // projected total differing from its committed one — a category holding any
  // locked option stops contributing a front-runner (`packages/types/src/
  // cost.ts`). That constraint is gone: the board's cost surface reads locked
  // money only, and nothing on any screen renders the projection. So the demo
  // can show what it should have shown all along — a multi-select lane with two
  // decisions in it and three candidates still standing underneath.
  const decisions: Array<{ title: string; by: CastKey; at: Date }> = [
    { title: "Fri 22 – Mon 25", by: "demo", at: minsAgo(60 * 26) },
    { title: "TAP direct — BUD → LIS", by: "demo", at: minsAgo(60 * 22) },
    { title: "TAP direct — LIS → BUD", by: "demo", at: minsAgo(60 * 22) },
    {
      title: "Airport transfer — pre-booked van",
      by: "mira",
      at: minsAgo(60 * 21),
    },
    {
      title: "Alfama apartment — whole flat",
      by: "mira",
      at: minsAgo(60 * 20),
    },
    // The two that make Activities a decided-but-not-finished lane. The surf
    // lesson is also the demo's only opt-in decision and its only sterling one,
    // so locking it puts a second currency and a "priced for part of the group"
    // line into the committed total rather than leaving both hypothetical.
    {
      title: "Surf lesson — Costa da Caparica",
      by: "mira",
      at: minsAgo(60 * 3),
    },
    { title: "Fado dinner in Alfama", by: "demo", at: minsAgo(60 * 2) },
  ];
  for (const d of decisions) {
    await prisma.option.update({
      where: { id: opt(d.title) },
      data: {
        status: "LOCKED",
        lockedById: users[d.by].id,
        lockedAt: d.at,
        version: { increment: 1 },
      },
    });
    await prisma.auditEvent.create({
      data: {
        tripId: trip.id,
        actorId: users[d.by].id,
        action: "OPTION_LOCKED",
        targetType: "OPTION",
        targetId: opt(d.title),
        metadata: { optionTitle: d.title },
        createdAt: d.at,
      },
    });
  }

  // The Dates lock writes the trip's dates back, exactly as the real one does.
  await prisma.trip.update({
    where: { id: trip.id },
    data: { startDate: daysOut(ARRIVE), endDate: daysOut(DEPART) },
  });

  // A vote cast before the option materially changed is shown as STALE rather
  // than silently carried over — the demo needs one so the flag is visible.
  await prisma.option.update({
    where: { id: opt("Sintra day trip") },
    data: {
      amount: "52.00",
      description:
        "Train from Rossio, Pena Palace tickets booked ahead. Price went up in April.",
      materialChangedAt: minsAgo(60 * 2),
      version: { increment: 1 },
    },
  });

  // ---------------------------------------------------------- participation ---
  // Who is in for each opt-in option. Four of the five for the surf lesson, so
  // the board shows three faces and a "+1" and the £48 divides by four rather
  // than by the trip — and two for the tram walk, chosen so the demo account is
  // looking at one option it has joined and one it has not.
  const participation: Array<[string, CastKey[]]> = [
    ["Surf lesson — Costa da Caparica", ["demo", "tomas", "sam", "anna"]],
    ["Tram 28 photo walk — 07:00 start", ["mira", "anna"]],
  ];
  for (const [title, joiners] of participation) {
    await prisma.optionParticipant.createMany({
      data: joiners.map((k) => ({
        optionId: opt(title),
        userId: users[k].id,
        createdAt: minsAgo(60 * 24),
      })),
    });
  }

  // ------------------------------------------------------------------- chat ---
  const general = await prisma.channel.create({
    data: { tripId: trip.id, type: "GENERAL" },
    select: { id: true },
  });
  const accommodation = await prisma.channel.create({
    data: {
      tripId: trip.id,
      type: "CATEGORY",
      categoryId: cat("ACCOMMODATION"),
    },
    select: { id: true },
  });

  const chat: Array<{ ch: string; by: CastKey; body: string; ago: number }> = [
    {
      ch: general.id,
      by: "mira",
      body: "Right, Lisbon. Everyone put your dates in before Friday please.",
      ago: 60 * 34,
    },
    {
      ch: general.id,
      by: "sam",
      body: "The 15th is much cheaper for flights, worth a look",
      ago: 60 * 33,
    },
    {
      ch: general.id,
      by: "mira",
      body: "I land back on the 16th though, so that one doesn't work for me",
      ago: 60 * 32,
    },
    {
      ch: general.id,
      by: "tomas",
      body: "22nd it is then. Voted.",
      ago: 60 * 31,
    },
    {
      ch: general.id,
      by: "demo",
      body: "Dates locked: 22nd to the 25th. Flights next.",
      ago: 60 * 26,
    },
    {
      ch: general.id,
      by: "anna",
      body: "Direct flight please. The Madrid layover is three hours each way.",
      ago: 60 * 24,
    },
    {
      ch: general.id,
      by: "demo",
      body: "Both TAP legs locked: out Friday morning, back Monday evening. The van for the airport runs is in too. Activities still open.",
      ago: 60 * 21,
    },
    {
      ch: general.id,
      by: "tomas",
      body: "Surf lesson is winning the activities vote. It's booked in sterling, so it shows as its own total.",
      ago: 60 * 4,
    },
    {
      ch: general.id,
      by: "mira",
      body: "Also putting the 7am tram walk in. I'm going either way, join if you're up.",
      ago: 60 * 3,
    },
    {
      ch: general.id,
      by: "anna",
      body: "Heads up, Sintra went up to €52. Re-vote if that changes your mind.",
      ago: 60 * 2,
    },
    // The two locks in the Activities lane, said out loud. Appended after the
    // general thread rather than slotted into it on purpose: the reactions
    // below index into `messageIds`, and inserting above index 7 would silently
    // move the 🏄 onto somebody else's line.
    {
      ch: general.id,
      by: "mira",
      body: "Surf lesson is locked in. Four of us are in the water, £48 each.",
      ago: 60 * 3,
    },
    {
      ch: general.id,
      by: "demo",
      body: "And the Fado dinner. Sintra, the tram walk and the market are still open, so vote when you get a minute.",
      ago: 60 * 2,
    },
    {
      ch: accommodation.id,
      by: "mira",
      body: "The Alfama flat has a terrace and it's cheaper per head than the hotel.",
      ago: 60 * 23,
    },
    {
      ch: accommodation.id,
      by: "sam",
      body: "Hostel is a third of the price…",
      ago: 60 * 22,
    },
    {
      ch: accommodation.id,
      by: "anna",
      body: "…and every review mentions the noise. I'd rather sleep.",
      ago: 60 * 21,
    },
    {
      ch: accommodation.id,
      by: "mira",
      body: "Flat locked. Three bedrooms, we'll sort who's where later.",
      ago: 60 * 20,
    },
  ];

  const messageIds: string[] = [];
  for (const m of chat) {
    const created = await prisma.message.create({
      data: {
        channelId: m.ch,
        authorId: users[m.by].id,
        body: m.body,
        createdAt: minsAgo(m.ago),
      },
      select: { id: true },
    });
    messageIds.push(created.id);
  }

  // A couple of reactions so the chat doesn't look like a transcript. Indexed
  // from the end for the two in the accommodation channel, so inserting a
  // message into the general thread cannot silently move them onto another line.
  const react = (i: number) => messageIds[i]!;
  await prisma.reaction.createMany({
    data: [
      { messageId: react(4), userId: users.anna.id, emoji: "🎉" },
      { messageId: react(4), userId: users.tomas.id, emoji: "🎉" },
      { messageId: react(7), userId: users.demo.id, emoji: "🏄" },
      {
        messageId: react(messageIds.length - 1),
        userId: users.demo.id,
        emoji: "👍",
      },
    ],
  });

  // Everyone except the demo user has caught up, so the demo account lands with
  // genuine unread badges rather than a cleared-out chat.
  await prisma.channelRead.createMany({
    data: CAST.filter((p) => p.key !== "demo").flatMap((p) => [
      {
        channelId: general.id,
        userId: users[p.key].id,
        lastReadAt: new Date(),
      },
      {
        channelId: accommodation.id,
        userId: users[p.key].id,
        lastReadAt: new Date(),
      },
    ]),
  });

  await seedHistoryTrip(prisma, users);

  /*
   * The summary describes the **active** board, and only it.
   *
   * That is the trip a caller points a visitor at — an ended one is not where
   * anybody should start — and the counts have to describe the same trip the id
   * names, or they are figures about nothing in particular. Folding the history
   * trip's options in was tried and is wrong for exactly that reason: the
   * console would have reported twenty-two options on a board that has fifteen.
   * That the second board exists shows up on the next run instead, as a
   * `removedTrips` of two.
   */
  return {
    tripId: trip.id,
    tripName: DEMO_TRIP_NAME,
    email: DEMO_EMAIL,
    members: CAST.length,
    options: optionIds.size,
    decisions: decisions.length,
    messages: chat.length,
    removedTrips,
  };
}

/**
 * The trip the group already took, a year ago.
 *
 * Built after the active one and owned by the same account, so the same
 * `deleteMany` at the top of `seedDemoTrip` clears both on a re-seed — there is
 * no second reset to keep in step, and no way for one to survive the other.
 *
 * **Everything in it is decided, and its dates are behind us.** Those two facts
 * are the whole feature: `status: "HISTORY"` with an `expiresAt` in the past is
 * exactly the state the hourly lifecycle job leaves a trip in when it ends, so
 * this is the real thing rather than a board wearing a badge. The job is
 * idempotent over it — it only moves `ACTIVE` rows — so nothing flips it back.
 *
 * It reuses the cast rather than inventing five more people, which is also
 * truer: the same group that is going to Lisbon went to Tallinn last winter,
 * and a visitor recognises the faces between the two boards.
 */
async function seedHistoryTrip(
  prisma: PrismaClient,
  users: Record<CastKey, { id: string }>,
): Promise<void> {
  // Four days in the middle of last December. The weekday is whatever that
  // year gave — the titles say the dates rather than naming a day, so they
  // cannot come out contradicting the calendar the timeline draws.
  const ARRIVED = lastDecember(12);
  const LEFT = lastDecember(15);
  /** A clock time on one of those four days. */
  const on = (day: number, hour: number, minute = 0) =>
    lastDecember(day, hour, minute);
  /** How the votes, locks and chat are spread out before the trip. */
  const before = (days: number) => lastDecember(12 - days);

  const tallinn = await seedDestination(prisma, TALLINN, "Tallinn, Estonia");

  const trip = await prisma.trip.create({
    data: {
      name: DEMO_HISTORY_TRIP_NAME,
      ...tallinn,
      description:
        "Last winter's one. Three nights, a lot of mulled wine, and the flights were the cheapest we have ever found. Ended, so the board is read-only now.",
      defaultCurrency: "EUR",
      // Under what it cost, on purpose. A finished trip that came in over its
      // target is the more interesting of the two readings, and it is the one
      // the active board cannot show without being edited into the past: the
      // cost panel's over-budget band and its red row need a trip that is done.
      budgetPerPerson: "300.00",
      startDate: ARRIVED,
      endDate: LEFT,
      // Expired, and marked as such. The status column is what every list and
      // dashboard reads; the date is what makes that status honest.
      expiresAt: lastDecember(16),
      status: "HISTORY",
      ownerId: users.demo.id,
      memberships: {
        create: CAST.map((p) => ({ userId: users[p.key].id, role: p.role })),
      },
      categories: {
        create: BUILTIN_CATEGORIES.map((c) => ({
          name: c.name,
          builtinKey: c.builtinKey,
          singleChoice: c.singleChoice,
          position: c.position,
          isBuiltin: true,
        })),
      },
    },
    select: { id: true },
  });

  const categories = await prisma.category.findMany({
    where: { tripId: trip.id },
    select: { id: true, builtinKey: true },
  });
  const cat = (key: string) => {
    const found = categories.find((c) => c.builtinKey === key);
    if (!found)
      throw new Error(`Built-in category ${key} missing from the history seed`);
    return found.id;
  };

  type PastSeed = Omit<
    Prisma.OptionUncheckedCreateInput,
    "categoryId" | "proposerId"
  > & { by: CastKey };

  const seeds: Array<{ categoryKey: string; options: PastSeed[] }> = [
    {
      categoryKey: "DATES",
      options: [
        {
          title: "12 – 15 December",
          description:
            "The weekend the markets opened. This is the one we did.",
          currency: "EUR",
          position: 0,
          by: "demo",
          startsAt: ARRIVED,
          endsAt: LEFT,
        },
        {
          // One that lost, so the finished board still shows that a choice was
          // made rather than that there was only ever one answer.
          title: "19 – 22 December",
          description: "Too close to Christmas. Half of us had family things.",
          currency: "EUR",
          position: 1,
          by: "sam",
          startsAt: lastDecember(19),
          endsAt: lastDecember(22),
        },
      ],
    },
    {
      categoryKey: "TRANSPORT",
      options: [
        {
          title: "Wizz Air — BUD → TLL",
          description: "Out Friday lunchtime. Cabin bag only, no seat picked.",
          amount: "94.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 0,
          by: "demo",
          startsAt: on(12, 11, 30),
          endsAt: on(12, 14, 55),
        },
        {
          title: "Wizz Air — TLL → BUD",
          description: "Home Monday evening, same fare.",
          amount: "94.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "demo",
          startsAt: on(15, 19, 10),
          endsAt: on(15, 22, 30),
        },
      ],
    },
    {
      categoryKey: "ACCOMMODATION",
      options: [
        {
          title: "Old Town apartment — Vene street",
          description:
            "Two bedrooms and a sofa bed, four minutes from the square.",
          amount: "540.00",
          currency: "EUR",
          // Priced for the whole booking, not per head — the other half of the
          // cost model, and the finished board is a good place to show it since
          // the figure is final.
          costType: "TOTAL",
          position: 0,
          by: "mira",
          startsAt: on(12, 15),
          endsAt: on(15, 11),
        },
      ],
    },
    {
      categoryKey: "ACTIVITIES",
      options: [
        {
          title: "Christmas market — Raekoja plats",
          description: "Free to wander. Mulled wine is extra and unavoidable.",
          amount: "18.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 0,
          by: "anna",
          startsAt: on(12, 17, 30),
          endsAt: on(12, 21),
        },
        {
          title: "Seaplane Harbour museum",
          description: "The submarine is worth the ticket on its own.",
          amount: "20.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "tomas",
          startsAt: on(13, 10),
          endsAt: on(13, 13),
        },
      ],
    },
  ];

  const ids = new Map<string, string>();
  for (const group of seeds) {
    for (const { by, ...data } of group.options) {
      const created = await prisma.option.create({
        data: {
          ...data,
          categoryId: cat(group.categoryKey),
          proposerId: users[by].id,
        },
        select: { id: true, title: true },
      });
      ids.set(created.title, created.id);
    }
  }
  const opt = (title: string) => {
    const id = ids.get(title);
    if (!id) throw new Error(`History option "${title}" was not seeded`);
    return id;
  };

  // Votes, cast while it was still being decided — a year ago, like everything
  // else here. A finished board with no votes on it reads as one person's
  // itinerary rather than as a group's.
  const votes: Array<[string, CastKey[]]> = [
    ["12 – 15 December", ["demo", "mira", "tomas", "anna"]],
    ["19 – 22 December", ["sam"]],
    ["Wizz Air — BUD → TLL", ["demo", "mira", "sam"]],
    ["Old Town apartment — Vene street", ["demo", "mira", "anna", "tomas"]],
    ["Christmas market — Raekoja plats", ["mira", "anna", "sam"]],
    ["Seaplane Harbour museum", ["tomas", "demo"]],
  ];
  for (const [title, voters] of votes) {
    await prisma.vote.createMany({
      data: voters.map((v) => ({
        optionId: opt(title),
        userId: users[v].id,
        createdAt: before(20),
      })),
    });
  }

  // Everything the group settled on. All of it, because that is what "this trip
  // happened" means — the losing date option above is the only thing left
  // standing, and it is standing as the road not taken.
  const decided: Array<{ title: string; by: CastKey; ago: number }> = [
    { title: "12 – 15 December", by: "demo", ago: 18 },
    { title: "Wizz Air — BUD → TLL", by: "demo", ago: 15 },
    { title: "Wizz Air — TLL → BUD", by: "demo", ago: 15 },
    { title: "Old Town apartment — Vene street", by: "mira", ago: 12 },
    { title: "Christmas market — Raekoja plats", by: "mira", ago: 9 },
    { title: "Seaplane Harbour museum", by: "tomas", ago: 6 },
  ];
  for (const d of decided) {
    await prisma.option.update({
      where: { id: opt(d.title) },
      data: {
        status: "LOCKED",
        lockedById: users[d.by].id,
        lockedAt: before(d.ago),
        version: { increment: 1 },
      },
    });
    await prisma.auditEvent.create({
      data: {
        tripId: trip.id,
        actorId: users[d.by].id,
        action: "OPTION_LOCKED",
        targetType: "OPTION",
        targetId: opt(d.title),
        metadata: { optionTitle: d.title },
        createdAt: before(d.ago),
      },
    });
  }

  const general = await prisma.channel.create({
    data: { tripId: trip.id, type: "GENERAL" },
    select: { id: true },
  });

  const chat: Array<{ by: CastKey; body: string; ago: number }> = [
    {
      by: "mira",
      body: "Flights are €94 return. Booking tonight unless anyone objects.",
      ago: 16,
    },
    {
      by: "anna",
      body: "The apartment sleeps five and it's on the square. Sold.",
      ago: 13,
    },
    {
      by: "demo",
      body: "That's everything locked. See you at the airport.",
      ago: 5,
    },
    {
      // Written after they got home, which is what makes the board feel ended
      // rather than merely expired.
      by: "tomas",
      body: "Home. Cold, expensive, worth it. The submarine especially.",
      ago: -4,
    },
  ];
  for (const m of chat) {
    await prisma.message.create({
      data: {
        channelId: general.id,
        authorId: users[m.by].id,
        body: m.body,
        createdAt: before(m.ago),
      },
    });
  }

  // Read by everyone, the demo account included: an ended trip should not greet
  // a visitor with unread badges on a conversation that finished a year ago.
  await prisma.channelRead.createMany({
    data: CAST.map((p) => ({
      channelId: general.id,
      userId: users[p.key].id,
      lastReadAt: lastDecember(16),
    })),
  });
}
