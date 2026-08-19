import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { registerPresenceHandlers } from "../modules/presence/presence.gateway";
import { env } from "./env";
import { redis } from "./redis";

let io: Server | undefined;

/**
 * Master spec §21: Redis is what lets presence/events reach a client
 * connected to a *different* server instance than the one that produced
 * the event ("If Peer 1 is connected to Server A and Peer 2 to Server
 * B, both must still be able to receive relevant presence/events").
 * @socket.io/redis-adapter is the mechanism — `io.to(room).emit(...)`
 * broadcasts across every server instance sharing this Redis, not just
 * the instance that issued the call.
 *
 * It needs two *dedicated* Redis connections (a client in pub/sub mode
 * can't issue other commands), so this duplicates the shared `redis`
 * client rather than reusing it — same reasoning as the separate
 * subscriber connection in presence.keyspaceListener.ts.
 */
export async function initSocketIO(httpServer: HttpServer): Promise<Server> {
  const server = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  pubClient.on("error", (err) => console.error("[socket.io redis adapter] pub client error:", err.message));
  subClient.on("error", (err) => console.error("[socket.io redis adapter] sub client error:", err.message));

  server.adapter(createAdapter(pubClient, subClient));

  registerPresenceHandlers(server);

  io = server;
  return server;
}

/**
 * For future phases (Phase 5 WebRTC signaling, Phase 7 radar pushes,
 * etc.) that need to broadcast without owning their own Socket.IO
 * connection handling. Not used by anything in Phase 4 itself —
 * presence.gateway.ts receives its `io` reference directly from
 * initSocketIO instead. Throws if called before initSocketIO, since
 * that would otherwise be a silent null-reference bug.
 */
export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO has not been initialized yet — call initSocketIO() first");
  }
  return io;
}
