import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule, ENV } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { HealthModule } from "./health/health.module.js";

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
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
