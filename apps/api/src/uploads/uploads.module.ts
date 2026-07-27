import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { AuthModule } from "../auth/auth.module.js";
import { LocalDiskStorage } from "./local-disk.storage.js";
import { MediaController } from "./media.controller.js";
import { STORAGE_DRIVER } from "./storage.driver.js";
import { UploadsController } from "./uploads.controller.js";
import { UploadsService } from "./uploads.service.js";
import { UserThrottlerGuard } from "./user-throttler.guard.js";

/**
 * Image uploads (Phase 6.1). Owns the hardened pipeline and the storage seam.
 *
 * The multer options are registered here, from the validated env, because a
 * `@UseInterceptors(FileInterceptor(...))` decorator is evaluated at class
 * definition time — long before DI exists — so a size limit written inline
 * could only have come from raw `process.env`, dodging the schema's coercion
 * and defaults. Registering async keeps one source of truth for configuration.
 *
 * `STORAGE_DRIVER` is bound to the local-disk implementation for now; swapping
 * in R2 is a one-line provider change, and nothing above the seam moves.
 */
@Module({
  imports: [
    AuthModule,
    MulterModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // No `storage` on purpose: multer's default is in-memory, which is what
        // we want here. The bytes are unvalidated until the service has sniffed
        // and re-encoded them, so they must not touch the filesystem yet — and
        // the size cap below keeps "in memory" bounded.
        limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [UploadsController, MediaController],
  providers: [
    UploadsService,
    LocalDiskStorage,
    { provide: STORAGE_DRIVER, useExisting: LocalDiskStorage },
    UserThrottlerGuard,
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
