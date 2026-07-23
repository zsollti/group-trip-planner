import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule, ENV } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TripsModule } from "./trips/trips.module.js";

@Module({
  imports: [
    // First: validate the environment (fails fast) and expose it globally.
    ConfigModule.forRoot(),
    // Structured JSON request/app logging, level driven by the validated env.
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Never log credentials that ride along on requests.
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie"],
            remove: true,
          },
        },
      }),
    }),
    // Global rate-limit floor; auth routes tighten it per-route (SRS FR-5).
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [
          {
            ttl: env.THROTTLE_TTL_SECONDS * 1000,
            limit: env.THROTTLE_LIMIT,
          },
        ],
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TripsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
