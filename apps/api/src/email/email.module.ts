import { Module } from "@nestjs/common";
import { EmailQueueService } from "./email-queue.service.js";
import { EmailService } from "./email.service.js";
import { UnsubscribeController } from "./unsubscribe.controller.js";

/**
 * Both email channels (Phase 5.2). {@link EmailService} is the transactional
 * path other modules already inject directly; {@link EmailQueueService} is the
 * async notification path that NotificationsModule enqueues onto and that the
 * cron worker drains. Both are exported so the seam stays explicit; the
 * unauthenticated unsubscribe endpoint lives here because it belongs to the mail
 * it is embedded in, not to any trip.
 */
@Module({
  controllers: [UnsubscribeController],
  providers: [EmailService, EmailQueueService],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
