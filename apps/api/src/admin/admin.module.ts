import { Module } from "@nestjs/common";
import { AccountModule } from "../account/account.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { EmailModule } from "../email/email.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

/**
 * The operator's console (post-launch). Imports AuthModule for `JwtAuthGuard`
 * and `TokenService` (a resent verification needs a freshly issued token) and
 * EmailModule to actually send it; PrismaService is global.
 *
 * Nothing is exported. The one thing outside this module that needs to know who
 * an operator is — the auth mapper, so the front-end can offer the link — asks
 * the pure `isAdminEmail` instead, which is what keeps this module off the auth
 * module's import list and out of a cycle with it.
 */
@Module({
  imports: [AccountModule, AuthModule, EmailModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
