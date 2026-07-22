/**
 * @gtp/api — backend entrypoint (placeholder).
 *
 * The real NestJS bootstrap (env validation, Prisma, /health, structured
 * logging) lands in Phase 0.5; auth endpoints in Phase 0.6. For now this proves
 * the app is part of the workspace and can consume the shared contract package.
 */
import { CONTRACT_VERSION } from "@gtp/types";

function main(): void {
  console.log(
    `@gtp/api placeholder — shared contract v${CONTRACT_VERSION}. ` +
      `NestJS bootstrap arrives in Phase 0.5.`,
  );
}

main();
