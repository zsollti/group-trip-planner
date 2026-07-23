import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AccountController } from "./account.controller.js";
import { AccountService } from "./account.service.js";

/**
 * Account self-management (Phase 1.5) — GDPR account deletion (FR-6). Reuses the
 * JwtAuthGuard from AuthModule (the caller acts only on themselves) and the pure
 * successor cascade from the policy layer for the ownership auto-transfer.
 */
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
