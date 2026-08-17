import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
// The Nest wiring lives on the /setup subpath; the package root is the SDK.
import { SentryModule } from "@sentry/nestjs/setup";
import {
  LocalizingExceptionFilter,
  LocalizingSentryFilter,
} from "./i18n/localizing.filter.js";
import { GlobalThrottlerGuard } from "./common/per-user-throttle.js";
import { sentryEnabled } from "./observability/instrument.js";
import { ScheduleModule } from "@nestjs/schedule";
import { RatesModule } from "./rates/rates.module.js";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AdminModule } from "./admin/admin.module.js";
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
import { NotificationsModule } from "./notifications/notifications.module.js";
import { ActivityModule } from "./activity/activity.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";

@Module({
  imports: [
    // Error reporting (Phase 7.5), registered only when a DSN is configured —
    // see observability/instrument.ts. Wiring it unconditionally would install
    // an exception filter that reports to nothing, which reads as monitoring
    // being on when it is not.
    ...(sentryEnabled ? [SentryModule.forRoot()] : []),
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
    RatesModule,
    DashboardModule,
    LifecycleModule,
    ChatModule,
    NotificationsModule,
    ActivityModule,
    UploadsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
    // **Exactly one global filter**, whichever the deployment needs. It renders
    // every exception message in the reader's language and then delegates to its
    // base for the response itself.
    //
    // With Sentry configured the base is `SentryGlobalFilter`, which reports
    // unhandled exceptions and extends Nest's `BaseExceptionFilter`, so the HTTP
    // responses clients see are unchanged; 4xx HttpExceptions (a 404 for a
    // non-member, a 409 on a lost lock race) are expected behaviour and are not
    // reported.
    //
    // Registering a second filter beside Sentry's instead would have made the
    // outcome depend on which one Nest consults first, and both wrong answers are
    // silent: either messages stop being translated, or exceptions stop being
    // reported. Subclassing removes the question.
    {
      provide: APP_FILTER,
      useClass: sentryEnabled
        ? LocalizingSentryFilter
        : LocalizingExceptionFilter,
    },
  ],
})
export class AppModule {}
