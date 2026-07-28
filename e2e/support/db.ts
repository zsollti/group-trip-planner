import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

/**
 * Direct database access for the browser suite (Phase 7.4).
 *
 * Used for exactly two things, both of them setup rather than assertion:
 *
 *  1. **Marking an account verified.** Creating a trip is gated on a verified
 *     email (FR-7) and the verification link only ever leaves the server as
 *     mail, which a test run does not send. Minting or intercepting that token
 *     here would test the mail path, which `auth.e2e-spec.ts` already covers
 *     end-to-end against a real token; the browser journey needs a verified
 *     account, not a second copy of that test.
 *  2. **Cleaning up.** These runs write real rows into the same database the
 *     rest of the suite uses, so everything is namespaced by email prefix and
 *     removed afterwards.
 *
 * Nothing is *asserted* through this client. A journey that checked its result
 * in the database would stop being an end-to-end test of the product.
 */

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        "postgresql://gtp:gtp_dev_password@localhost:5432/gtp_dev?schema=public",
    },
  },
});

/** Every address this suite creates, so cleanup can find them all. */
export const E2E_EMAIL_PREFIX = "gtp-e2e+";

/** A fresh address per run, so a crashed run never collides with the next. */
export function e2eEmail(label: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${E2E_EMAIL_PREFIX}${label}-${stamp}@example.com`;
}

/** Flip the verified flag the way clicking the emailed link would. */
export async function markVerified(email: string): Promise<void> {
  await prisma.user.update({
    where: { email },
    data: { emailVerified: true },
  });
}

/**
 * A verified account created straight in the database, ready to sign in with.
 *
 * `POST /auth/register` is rate limited to 5 a minute per IP (Phase 7.1), and
 * every browser in this suite shares one address — so a suite that registered
 * each of its cast through the form would start failing on the sixth, for a
 * reason that has nothing to do with what it was testing. The same trap bit the
 * API's own e2e helpers, which insert users directly for exactly this reason.
 *
 * The registration *form* is still exercised for real, once, by the account that
 * opens the core journey; everyone else after that is scenery.
 */
export async function createVerifiedUser(
  displayName: string,
  password: string,
): Promise<{ email: string }> {
  const email = e2eEmail(displayName.toLowerCase());
  await prisma.user.create({
    data: {
      email,
      displayName,
      emailVerified: true,
      // Matches the argon2id configuration the auth service hashes with, so the
      // real login route verifies this password normally.
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
  return { email };
}

/**
 * Remove everything this suite created. Trips go **before** users on purpose:
 * `Trip.ownerId` deliberately does not cascade, so deleting an owner first fails
 * on the foreign key and leaves the database dirty for the next run.
 */
export async function cleanupE2EData(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: E2E_EMAIL_PREFIX } },
    select: { id: true },
  });
  if (users.length === 0) return;
  const ids = users.map((u) => u.id);
  await prisma.trip.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
