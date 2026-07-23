import { Module } from "@nestjs/common";
import { LifecycleService } from "./lifecycle.service.js";

/**
 * Trip lifecycle (Phase 2.5). Owns the scheduled expiry job that persists
 * Active → History. `ScheduleModule.forRoot()` is registered once in AppModule;
 * this module just provides the cron-decorated service. Exported so tests (and
 * any future manual-trigger endpoint) can invoke `expireTrips()` directly.
 */
@Module({
  providers: [LifecycleService],
  exports: [LifecycleService],
})
export class LifecycleModule {}
