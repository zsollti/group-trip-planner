import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChannelsService } from "./channels.service.js";
import { ChannelsController } from "./channels.controller.js";
import { MessagesService } from "./messages.service.js";
import { MessagesController } from "./messages.controller.js";

/**
 * Real-time chat (Phase 4). 4.1 wired the authenticated per-trip WebSocket
 * gateway + the channels service; 4.2 adds messages — live send/soft-delete over
 * the socket and the cursor-paged REST history (MessagesController on the shared
 * TripContextGuard/PermissionGuard spine). Imports AuthModule for the JwtService
 * used to verify the handshake token; PrismaService is global.
 */
@Module({
  imports: [AuthModule],
  controllers: [MessagesController, ChannelsController],
  providers: [
    ChatGateway,
    ChannelsService,
    MessagesService,
    TripContextGuard,
    PermissionGuard,
  ],
  exports: [ChannelsService],
})
export class ChatModule {}
