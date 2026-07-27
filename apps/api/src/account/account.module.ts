import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { AccountController } from "./account.controller.js";
import { AccountService } from "./account.service.js";

/**
 * Account self-management (Phase 1.5) — GDPR account deletion (FR-6). Reuses the
 * JwtAuthGuard from AuthModule (the caller acts only on themselves) and the pure
 * successor cascade from the policy layer for the ownership auto-transfer.
 */
@Module({
  // UploadsModule supplies the avatar pipeline (Phase 6.2) — which also purges
  // the stored image on GDPR erasure — plus the multer config and the per-user
  // upload throttle guard.
  imports: [AuthModule, UploadsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
