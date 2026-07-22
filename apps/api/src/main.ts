/**
 * @gtp/api — backend entrypoint (placeholder).
 *
 * The real NestJS bootstrap (env validation, Prisma, /health, structured
 * logging) lands in Phase 0.5; auth endpoints in Phase 0.6. For now this proves
 * the backend consumes the exact same shared contract the front-ends do.
 */
import { CONTRACT_VERSION, RegisterInput } from "@gtp/types";

function main(): void {
  // Prove the backend shares the front-ends' contract: this annotated sample
  // stops type-checking if RegisterInput's shape drifts, and .parse exercises
  // the same validation the real /auth/register handler will use in 0.6.
  const sample: RegisterInput = {
    email: "traveller@example.com",
    password: "correct-horse-battery",
    displayName: "Traveller",
  };
  const parsed = RegisterInput.parse(sample);

  console.log(
    `@gtp/api placeholder — shared contract v${CONTRACT_VERSION}; ` +
      `validated sample for ${parsed.email}. NestJS bootstrap arrives in 0.5.`,
  );
}

main();
