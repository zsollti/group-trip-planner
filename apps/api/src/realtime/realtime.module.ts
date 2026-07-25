import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway.js";

/**
 * The shared realtime emitter (Phase 4.5). Exposes {@link RealtimeGateway} so any
 * module can push into a trip's socket room. Imported by the chat, options, and
 * (transitively) trips modules that need to broadcast live changes. The gateway
 * itself owns no connection logic — it reuses the single Socket.IO server the
 * chat gateway authenticates and joins sockets on.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
