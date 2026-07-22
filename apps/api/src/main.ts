/**
 * @gtp/api — NestJS bootstrap (Phase 0.5).
 *
 * Wires up: Zod env validation at startup (fail-fast), Prisma, structured JSON
 * logging (pino), and `GET /health`. Auth endpoints arrive in Phase 0.6.
 */
import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { ENV } from "./config/config.module.js";
import type { Env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  // Imported dynamically so that env validation (which runs while AppModule's
  // metadata is built) throws *inside* this try/catch — giving the clean
  // startup error below rather than an unhandled module-evaluation stack trace.
  const { AppModule } = await import("./app.module.js");

  // bufferLogs holds early logs until the pino logger is installed below, so
  // nothing is emitted through Nest's default logger first.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Route SIGTERM/SIGINT through the module lifecycle (Prisma disconnect, etc.).
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);

  // Parse the refresh-token cookie; lock CORS to the frontend origins and allow
  // credentials so the httpOnly refresh cookie can flow cross-origin.
  app.use(cookieParser());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });

  await app.listen(env.PORT);

  app
    .get(Logger)
    .log(`API listening on http://localhost:${env.PORT}`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  // Startup failure (most commonly invalid environment). Print the clear
  // message and exit non-zero so process managers / CI see the failure.
  const message = error instanceof Error ? error.message : String(error);
  // Logger isn't available on a boot failure, so write straight to stderr.
  console.error(`\nAPI failed to start:\n${message}\n`);
  process.exit(1);
});
