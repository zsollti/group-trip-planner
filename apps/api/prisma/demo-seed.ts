import { PrismaClient, type Prisma } from "@prisma/client";
import { BUILTIN_CATEGORIES } from "@gtp/types";
import argon2 from "argon2";

/**
 * Seeds the public demo trip — the one a visitor lands in after signing in with
 * the credentials published in the README.
 *
 * Why this exists: a stranger evaluating the app has to register, verify an
 * email, create a trip and propose options before anything interesting is on
 * screen. That is several minutes of work to see a board, and most people leave
 * first. This builds a trip that is already mid-flight, so the product is
 * legible on the first screen.
 *
 * **Re-runnable.** It deletes the demo user's trips and rebuilds them, so it can
 * be run whenever the demo has been edited by visitors. Everything hangs off the
 * trip by cascade, so the delete is enough to reset categories, options, votes,
 * channels, messages and the audit log. Real accounts are never touched.
 *
 *   pnpm --filter @gtp/api demo:seed
 *
 * Dates are computed relative to now, so the trip never drifts into the past.
 */

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-trip-2026";
const TRIP_NAME = "Lisbon — long weekend";

/**
 * example.com is reserved by RFC 2606 and cannot receive mail, so no seeded
 * address can ever reach a real person even if a notification escapes.
 */
const CAST = [
  { key: "demo", email: DEMO_EMAIL, name: "Demo User", role: "OWNER" },
  { key: "mira", email: "mira@example.com", name: "Mira Kovács", role: "CO_ORGANIZER" },
  { key: "tomas", email: "tomas@example.com", name: "Tomáš Novák", role: "PARTICIPANT" },
  { key: "anna", email: "anna@example.com", name: "Anna Weber", role: "PARTICIPANT" },
  { key: "sam", email: "sam@example.com", name: "Sam Ellis", role: "GUEST" },
] as const;

type CastKey = (typeof CAST)[number]["key"];

/** Days from now, at midday UTC — stable regardless of the runner's timezone. */
function daysOut(days: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Minutes before now — used to lay chat and votes out on a believable timeline. */
function minsAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function main() {
  // ---------------------------------------------------------------- users ---
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const users = {} as Record<CastKey, { id: string }>;
  for (const person of CAST) {
    users[person.key] = await prisma.user.upsert({
      where: { email: person.email },
      update: { displayName: person.name, emailVerified: true, passwordHash },
      create: {
        email: person.email,
        displayName: person.name,
        emailVerified: true,
        passwordHash,
      },
      select: { id: true },
    });
  }

  // ------------------------------------------------------ reset & rebuild ---
  // Cascades from Trip clear categories, options, votes, channels, messages,
  // reactions, mentions, reads and audit events in one statement.
  const { count: removed } = await prisma.trip.deleteMany({
    where: { ownerId: users.demo.id },
  });
  if (removed > 0) console.log(`Removed ${removed} existing demo trip(s).`);

  const trip = await prisma.trip.create({
    data: {
      name: TRIP_NAME,
      destination: "Lisbon, Portugal",
      description:
        "Five of us, three nights, one long weekend. Flights and the flat are settled — activities are still open.",
      defaultCurrency: "EUR",
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
    if (!found) throw new Error(`Built-in category ${key} missing from the seed`);
    return found.id;
  };

  // ------------------------------------------------------------- options ---
  // Prices are plausible for Lisbon. One activity is priced in GBP on purpose:
  // it makes the cost dashboard show two currencies side by side, which is the
  // whole point of never summing across them.
  type Seed = Omit<Prisma.OptionUncheckedCreateInput, "categoryId" | "proposerId"> & {
    by: CastKey;
  };

  const optionSeeds: Array<{ categoryKey: string; options: Seed[] }> = [
    {
      categoryKey: "DATES",
      options: [
        {
          title: "Fri 15 – Mon 18",
          description: "Cheapest flights of the three, but Mira is away until the 16th.",
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
          startsAt: daysOut(67),
          endsAt: daysOut(70),
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
          description: "Direct both ways, 4h05. Hand luggage included.",
          amount: "212.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 0,
          by: "demo",
        },
        {
          title: "Ryanair via Madrid",
          description: "€70 cheaper, but a 3h layover on the way out and a 06:15 departure.",
          amount: "141.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "sam",
        },
        {
          title: "Airport transfer — pre-booked van",
          description: "One van, both directions, split five ways.",
          amount: "96.00",
          currency: "EUR",
          costType: "TOTAL",
          position: 2,
          by: "mira",
        },
      ],
    },
    {
      categoryKey: "ACCOMMODATION",
      options: [
        {
          title: "Alfama apartment — whole flat",
          description: "Three bedrooms, terrace, 6 min walk to the tram. Three nights, whole place.",
          amount: "1080.00",
          currency: "EUR",
          costType: "TOTAL",
          position: 0,
          by: "mira",
        },
        {
          title: "Hotel Baixa — three twin rooms",
          description: "Central and simple. Breakfast not included.",
          amount: "139.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 1,
          by: "anna",
        },
        {
          title: "Hostel Bairro Alto — private dorm",
          description: "Cheapest by a distance. Loud until 2am, per every review.",
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
        },
        {
          title: "Surf lesson — Costa da Caparica",
          description: "Booked through a UK operator, so it prices in sterling. Held for four boards.",
          amount: "48.00",
          currency: "GBP",
          costType: "PER_PERSON",
          position: 1,
          by: "tomas",
          // Fixed at four, confirmed before Sam joined. Because the roster has
          // changed since, the dashboard flags this headcount as stale rather
          // than quietly recalculating it — and this option is the Activities
          // front-runner, so the flag is actually on screen.
          headcount: 4,
          headcountIsFixed: true,
          headcountConfirmedAt: minsAgo(60 * 40),
        },
        {
          title: "Fado dinner in Alfama",
          description: "Set menu. Needs booking two weeks out.",
          amount: "39.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 2,
          by: "mira",
        },
        {
          title: "Time Out Market food crawl",
          description: "No booking, just turn up hungry. Rough per-head estimate.",
          amount: "30.00",
          currency: "EUR",
          costType: "PER_PERSON",
          position: 3,
          by: "demo",
        },
      ],
    },
  ];

  const optionIds = new Map<string, string>();
  for (const group of optionSeeds) {
    for (const { by, ...data } of group.options) {
      const created = await prisma.option.create({
        data: { ...data, categoryId: cat(group.categoryKey), proposerId: users[by].id },
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

  // --------------------------------------------------------------- votes ---
  // Advisory only — they never decide anything. Spread so each open category has
  // a visible front-runner, which is what the projected total is built from.
  const votes: Array<[string, CastKey[]]> = [
    ["Fri 22 – Mon 25", ["demo", "mira", "tomas", "anna"]],
    ["Fri 15 – Mon 18", ["sam"]],
    ["TAP direct — BUD → LIS", ["demo", "mira", "anna"]],
    ["Ryanair via Madrid", ["sam", "tomas"]],
    ["Airport transfer — pre-booked van", ["mira", "anna", "demo"]],
    ["Alfama apartment — whole flat", ["demo", "mira", "anna", "tomas"]],
    ["Hostel Bairro Alto — private dorm", ["sam"]],
    // Activities is deliberately left undecided, and its front-runner is the
    // GBP option. That is what makes projected differ from committed *and*
    // introduces a second currency into the projection — "if today's
    // front-runners win, you also owe £240" — which is the pair of behaviours
    // the cost engine exists to show.
    ["Surf lesson — Costa da Caparica", ["demo", "tomas", "sam", "anna"]],
    ["Time Out Market food crawl", ["demo", "sam", "tomas"]],
    ["Sintra day trip", ["mira", "tomas"]],
    ["Fado dinner in Alfama", ["mira", "anna"]],
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

  // ------------------------------------------------------------ decisions ---
  // Locked explicitly by an organizer, each with the audit row the real lock
  // transaction writes. Dates and Accommodation are single-choice; Transport is
  // multi-select, which is why two transport options can both stand.
  //
  // Activities is left with no lock on purpose — a category holding any locked
  // option stops contributing a front-runner to the projection (see
  // `packages/types/src/cost.ts`), so locking one here would make projected
  // identical to committed and hide the distinction entirely.
  const decisions: Array<{ title: string; by: CastKey; at: Date }> = [
    { title: "Fri 22 – Mon 25", by: "demo", at: minsAgo(60 * 26) },
    { title: "TAP direct — BUD → LIS", by: "demo", at: minsAgo(60 * 22) },
    { title: "Airport transfer — pre-booked van", by: "mira", at: minsAgo(60 * 21) },
    { title: "Alfama apartment — whole flat", by: "mira", at: minsAgo(60 * 20) },
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
    data: { startDate: daysOut(67), endDate: daysOut(70) },
  });

  // A vote cast before the option materially changed is shown as STALE rather
  // than silently carried over — the demo needs one so the flag is visible.
  await prisma.option.update({
    where: { id: opt("Sintra day trip") },
    data: {
      amount: "52.00",
      description: "Train from Rossio, Pena Palace tickets booked ahead. Price went up in April.",
      materialChangedAt: minsAgo(60 * 2),
      version: { increment: 1 },
    },
  });

  // The roster changed after that fixed headcount was confirmed → stale flag.
  await prisma.trip.update({
    where: { id: trip.id },
    data: { membershipChangedAt: minsAgo(60 * 20) },
  });

  // ---------------------------------------------------------------- chat ---
  const general = await prisma.channel.create({
    data: { tripId: trip.id, type: "GENERAL" },
    select: { id: true },
  });
  const accommodation = await prisma.channel.create({
    data: { tripId: trip.id, type: "CATEGORY", categoryId: cat("ACCOMMODATION") },
    select: { id: true },
  });

  const chat: Array<{ ch: string; by: CastKey; body: string; ago: number }> = [
    { ch: general.id, by: "mira", body: "Right — Lisbon. Everyone put your dates in before Friday please.", ago: 60 * 34 },
    { ch: general.id, by: "sam", body: "The 15th is much cheaper for flights, worth a look", ago: 60 * 33 },
    { ch: general.id, by: "mira", body: "I land back on the 16th though, so that one doesn't work for me", ago: 60 * 32 },
    { ch: general.id, by: "tomas", body: "22nd it is then. Voted.", ago: 60 * 31 },
    { ch: general.id, by: "demo", body: "Dates locked — 22nd to the 25th. Flights next.", ago: 60 * 26 },
    { ch: general.id, by: "anna", body: "Direct flight please. The Madrid layover is three hours each way.", ago: 60 * 24 },
    { ch: general.id, by: "demo", body: "TAP locked, and the van for the airport runs. Activities still open.", ago: 60 * 21 },
    { ch: general.id, by: "tomas", body: "Surf lesson is winning the activities vote — it's booked in sterling, so it shows as its own total.", ago: 60 * 4 },
    { ch: general.id, by: "anna", body: "Heads up, Sintra went up to €52. Re-vote if that changes your mind.", ago: 60 * 2 },
    { ch: accommodation.id, by: "mira", body: "The Alfama flat has a terrace and it's cheaper per head than the hotel.", ago: 60 * 23 },
    { ch: accommodation.id, by: "sam", body: "Hostel is a third of the price…", ago: 60 * 22 },
    { ch: accommodation.id, by: "anna", body: "…and every review mentions the noise. I'd rather sleep.", ago: 60 * 21 },
    { ch: accommodation.id, by: "mira", body: "Flat locked. Three bedrooms, we'll sort who's where later.", ago: 60 * 20 },
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

  // A couple of reactions so the chat doesn't look like a transcript.
  await prisma.reaction.createMany({
    data: [
      { messageId: messageIds[4], userId: users.anna.id, emoji: "🎉" },
      { messageId: messageIds[4], userId: users.tomas.id, emoji: "🎉" },
      { messageId: messageIds[7], userId: users.demo.id, emoji: "🏄" },
      { messageId: messageIds[12], userId: users.demo.id, emoji: "👍" },
    ],
  });

  // Everyone except the demo user has caught up, so the demo account lands with
  // genuine unread badges rather than a cleared-out chat.
  await prisma.channelRead.createMany({
    data: CAST.filter((p) => p.key !== "demo").flatMap((p) => [
      { channelId: general.id, userId: users[p.key].id, lastReadAt: new Date() },
      { channelId: accommodation.id, userId: users[p.key].id, lastReadAt: new Date() },
    ]),
  });

  console.log(
    [
      "",
      "  Demo trip rebuilt.",
      "",
      `    trip      ${TRIP_NAME} (${trip.id})`,
      `    sign in   ${DEMO_EMAIL}`,
      `    password  ${DEMO_PASSWORD}`,
      "",
      `    ${CAST.length} members · ${optionIds.size} options · ${decisions.length} decisions · ${chat.length} messages`,
      "",
    ].join("\n"),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
