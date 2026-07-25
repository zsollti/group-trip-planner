import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule, ENV } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TripsModule } from "./trips/trips.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { MembersModule } from "./members/members.module.js";
import { AccountModule } from "./account/account.module.js";
import { CategoriesModule } from "./categories/categories.module.js";
import { OptionsModule } from "./options/options.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { LifecycleModule } from "./lifecycle/lifecycle.module.js";
import { ChatModule } from "./chat/chat.module.js";

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
    // Cron scheduling for the trip-expiry job (Phase 2.5).
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    TripsModule,
    InvitesModule,
    MembersModule,
    AccountModule,
    CategoriesModule,
    OptionsModule,
    DashboardModule,
    LifecycleModule,
    ChatModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
