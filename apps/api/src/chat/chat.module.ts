import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChannelsService } from "./channels.service.js";

/**
 * Real-time chat (Phase 4). 4.1 wires the authenticated per-trip WebSocket
 * gateway and the channels service (General auto-created with the trip; the read
 * side backs the socket's ready payload). Imports AuthModule for the shared
 * JwtService used to verify the handshake token; PrismaService is global.
 */
@Module({
  imports: [AuthModule],
  providers: [ChatGateway, ChannelsService],
  exports: [ChannelsService],
})
export class ChatModule {}
