/**
 * Light load check (Phase 7.3, decision 3).
 *
 * NOT a test and NOT part of the CI gate — it is a one-off measurement, run by
 * hand, whose job is to validate the NFR-1 scale claim **directionally**: that
 * "thousands of users, hundreds of trips on a modest instance" is a defensible
 * thing to say. It is deliberately not a load-testing exercise; there is no
 * concurrency model, no ramp, no percentile beyond p95.
 *
 * It seeds a realistic-shaped dataset into the configured database, times the
 * read paths that back the app's list views, prints a table, and removes
 * everything it created. The seed is namespaced by a run-scoped email suffix so
 * a failed run cannot leave rows that a later run would count.
 *
 *   pnpm --filter @gtp/api perf:load-check
 *
 * Named `load-check.ts`, not `*.spec.ts`, so `node --test` never collects it.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { ChannelsService } from "../src/chat/channels.service.js";
import { HomeDashboardService } from "../src/dashboard/home-dashboard.service.js";
import { MembersService } from "../src/members/members.service.js";
import { MessagesService } from "../src/chat/messages.service.js";

/** Shape of the seeded world. Modest on purpose — see the docblock. */
const USERS = 500;
const TRIPS = 200;
const MEMBERS_PER_TRIP = 6;
const OPTIONS_PER_TRIP = 12;
const MESSAGES_PER_TRIP = 60;
const ITERATIONS = 30;

const suffix = Date.now();
const email = (n: number) => `loadcheck+${n}+${suffix}@example.invalid`;

interface Timing {
  label: string;
  p50: number;
  p95: number;
  max: number;
}

async function time(
  label: string,
  fn: () => Promise<unknown>,
): Promise<Timing> {
  // One untimed pass so the first query's planning/connection cost doesn't
  // land in the sample.
  await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
  return {
    label,
    p50: at(0.5),
    p95: at(0.95),
    max: samples[samples.length - 1] ?? 0,
  };
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const home = app.get(HomeDashboardService);
  const members = app.get(MembersService);
  const messages = app.get(MessagesService);
  const channels = app.get(ChannelsService);

  console.log(
    `Seeding ${USERS} users / ${TRIPS} trips / ${MEMBERS_PER_TRIP} members ` +
      `/ ${OPTIONS_PER_TRIP} options / ${MESSAGES_PER_TRIP} messages per trip…`,
  );
  const seedStarted = performance.now();

  const userIds = Array.from({ length: USERS }, () => randomUUID());
  await prisma.user.createMany({
    data: userIds.map((id, n) => ({
      id,
      email: email(n),
      displayName: `Load ${n}`,
      emailVerified: true,
      passwordHash: "x",
    })),
  });

  // The first user is a member of every trip — the worst realistic case for the
  // home dashboard, and the account whose reads we time.
  const protagonist = userIds[0]!;
  const tripIds = Array.from({ length: TRIPS }, () => randomUUID());
  const categoryIds = tripIds.map(() => randomUUID());
  const channelIds = tripIds.map(() => randomUUID());

  await prisma.trip.createMany({
    data: tripIds.map((id, i) => ({
      id,
      name: `Load trip ${i}`,
      ownerId: protagonist,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    })),
  });
  await prisma.category.createMany({
    data: categoryIds.map((id, i) => ({
      id,
      tripId: tripIds[i]!,
      name: "Stay",
      singleChoice: true,
      isBuiltin: true,
      builtinKey: "ACCOMMODATION" as const,
      position: 0,
    })),
  });
  await prisma.channel.createMany({
    data: channelIds.map((id, i) => ({
      id,
      tripId: tripIds[i]!,
      type: "GENERAL" as const,
    })),
  });
  await prisma.tripMembership.createMany({
    data: tripIds.flatMap((tripId, i) =>
      Array.from({ length: MEMBERS_PER_TRIP }, (_, m) => ({
        tripId,
        userId: m === 0 ? protagonist : userIds[(i * 7 + m) % USERS]!,
        role: m === 0 ? ("OWNER" as const) : ("PARTICIPANT" as const),
      })),
    ),
    skipDuplicates: true,
  });
  await prisma.option.createMany({
    data: tripIds.flatMap((_, i) =>
      Array.from({ length: OPTIONS_PER_TRIP }, (_, o) => ({
        categoryId: categoryIds[i]!,
        proposerId: userIds[(i + o) % USERS]!,
        title: `Option ${o}`,
        amount: 100 + o,
        currency: "EUR",
        costType: "PER_PERSON" as const,
        status: o === 0 ? ("LOCKED" as const) : ("PROPOSED" as const),
        position: o,
      })),
    ),
  });
  await prisma.message.createMany({
    data: tripIds.flatMap((_, i) =>
      Array.from({ length: MESSAGES_PER_TRIP }, (_, m) => ({
        channelId: channelIds[i]!,
        authorId: userIds[(i + m) % USERS]!,
        body: `Message ${m} in trip ${i}`,
      })),
    ),
  });

  console.log(`Seeded in ${Math.round(performance.now() - seedStarted)}ms\n`);

  const bigTrip = tripIds[0]!;
  const bigTripCtx = {
    trip: await prisma.trip.findUniqueOrThrow({
      where: { id: bigTrip },
      include: { _count: { select: { memberships: true } } },
    }),
    role: "OWNER" as const,
    membershipId: "n/a",
    muted: false,
  };

  const results: Timing[] = [];
  results.push(
    await time("home dashboard (page 1 of 200 trips)", () =>
      home.getHomeDashboard(protagonist, 20, 0),
    ),
  );
  results.push(
    await time("home dashboard (last page)", () =>
      home.getHomeDashboard(protagonist, 20, 180),
    ),
  );
  results.push(
    await time("member list (6 members + blocks)", () =>
      members.listMembers(bigTripCtx),
    ),
  );
  results.push(
    await time("chat history (page of 60)", () =>
      messages.history(bigTrip, channelIds[0]!, undefined, 50),
    ),
  );
  results.push(
    await time("socket ready payload (channels + unread)", () =>
      channels.readyPayload(bigTrip, protagonist),
    ),
  );

  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (n: number) => `${n.toFixed(1)}ms`.padStart(9);
  console.log(
    `${pad("read path", 42)}${"p50".padStart(9)}${"p95".padStart(9)}${"max".padStart(9)}`,
  );
  console.log("-".repeat(69));
  for (const r of results) {
    console.log(`${pad(r.label, 42)}${num(r.p50)}${num(r.p95)}${num(r.max)}`);
  }
  console.log(
    `\n${ITERATIONS} iterations each, sequential, against ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@") ?? "the configured database"}`,
  );

  console.log("\nCleaning up…");
  await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
  console.log("Done.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
