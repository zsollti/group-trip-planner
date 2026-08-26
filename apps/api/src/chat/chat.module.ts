import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { SocketRateLimiter } from "../common/socket-rate-limiter.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChannelsService } from "./channels.service.js";
import {
  ChannelsController,
  ChatMuteController,
} from "./channels.controller.js";
import { MessagesService } from "./messages.service.js";
import {
  MessageSearchController,
  MessagesController,
} from "./messages.controller.js";

/**
 * Real-time chat (Phase 4). 4.1 wired the authenticated per-trip WebSocket
 * gateway + the channels service; 4.2 adds messages — live send/soft-delete over
 * the socket and the cursor-paged REST history (MessagesController on the shared
 * TripContextGuard/PermissionGuard spine). Imports AuthModule for the JwtService
 * used to verify the handshake token; PrismaService is global.
 */
@Module({
  imports: [AuthModule, RealtimeModule, NotificationsModule],
  controllers: [
    MessagesController,
    MessageSearchController,
    ChannelsController,
    ChatMuteController,
  ],
  providers: [
    ChatGateway,
    ChannelsService,
    MessagesService,
    TripContextGuard,
    PermissionGuard,
    // Gateway-local: the socket budget is per user, and one instance of this
    // holds the counters for the process (Phase 7.1).
    SocketRateLimiter,
  ],
  exports: [ChannelsService],
})
export class ChatModule {}
