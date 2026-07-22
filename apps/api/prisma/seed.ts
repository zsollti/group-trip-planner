import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Idempotent dev seed. Real password hashing (argon2) arrives in Phase 0.6, so
 * this demo account has no local password yet.
 */
async function main() {
  const demo = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      email: "demo@example.com",
      displayName: "Demo Traveller",
      emailVerified: true,
      passwordHash: null,
    },
  });
  console.log(`Seeded user ${demo.email} (${demo.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
