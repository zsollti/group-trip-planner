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
  // Exported for the operator's console, which deletes an account on somebody's
  // behalf and must do it by the *same* cascade as the person's own delete
  // button — see `AdminService.deleteUser`. Re-implementing the transfer rule
  // there would give this app two answers to "who inherits the trip".
  exports: [AccountService],
})
export class AccountModule {}
