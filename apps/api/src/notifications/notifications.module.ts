import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EmailModule } from "../email/email.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

/**
 * In-app notifications (Phase 5.1). Owns the bell's read/mark-read API and the
 * fan-out service the triggers call. It **exports** {@link NotificationsService}
 * so the option (propose/lock) and chat (mention) modules can notify without
 * either depending on the other — the same shape as {@link RealtimeModule}.
 * Phase 5.2 hangs the async email queue off that same seam: `EmailModule`
 * supplies the queue a `MENTION` fan-out enqueues onto. Imports AuthModule for
 * `JwtAuthGuard`; PrismaService is global.
 */
@Module({
  imports: [AuthModule, RealtimeModule, EmailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
