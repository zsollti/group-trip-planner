import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { ServerOptions } from "socket.io";

/**
 * Socket.IO adapter that locks the WebSocket CORS to the same frontend origins
 * as the REST API (Phase 4.1). The `@WebSocketGateway` decorator can't read the
 * validated env, so the allowed origins are injected here and applied when the
 * IO server is created — keeping the socket handshake's cross-origin policy
 * identical to `enableCors` on the HTTP side.
 */
export class WsCorsAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    });
  }
}
