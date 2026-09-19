import type { Server } from "socket.io";
import type { AuthenticatedSocket } from "../../middleware/socketAuth";
import * as presenceService from "./presence.service";
import type { PresenceChangedEvent } from "./presence.types";

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Wires presence into a Socket.IO server: personal rooms (`user:{id}`)
 * for authorization-scoped delivery, the heartbeat/disconnect event
 * handlers, and the bridge from presenceService's decoupled
 * EventEmitter into actual room broadcasts.
 *
 * Connection-time auth is **not** registered here as of Phase 5 — it
 * used to be (`io.use(authenticateSocket)`, Phase 4), but moved to
 * config/socket.ts's `initSocketIO` so it runs exactly once for every
 * gateway sharing this Socket.IO server (p2p.gateway.ts as of Phase 5)
 * instead of once per gateway. See middleware/socketAuth.ts for the
 * full reasoning. `socket.data.user` is still guaranteed populated by
 * the time the `"connection"` listener below fires — that guarantee now
 * comes from config/socket.ts's registration order, not from this file.
 *
 * Call exactly once, from config/socket.ts's initSocketIO — the
 * presenceEvents subscription below is process-global and would
 * double-fire every broadcast if this were called twice.
 */
export function registerPresenceHandlers(io: Server): void {
  presenceService.presenceEvents.on("presence:changed", (event: PresenceChangedEvent) => {
    for (const userId of event.audience) {
      io.to(userRoom(userId)).emit("presence:update", {
        userId: event.userId,
        status: event.status,
        lastSeen: event.lastSeen,
      });
    }
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    const user = socket.data.user;
    socket.join(userRoom(user.id));

    void (async () => {
      await presenceService.handleConnect(user.id, socket.id);
      const snapshot = await presenceService.getSnapshotForActor(user);
      socket.emit("presence:snapshot", snapshot);
    })().catch((err) => {
      console.error(`[presence] connect handling failed for user ${user.id}:`, (err as Error).message);
      socket.disconnect(true);
    });

    socket.on("presence:heartbeat", () => {
      presenceService.handleHeartbeat(user.id).catch((err) => {
        console.error(`[presence] heartbeat failed for user ${user.id}:`, (err as Error).message);
      });
    });

    socket.on("disconnect", () => {
      presenceService.handleDisconnect(user.id, socket.id).catch((err) => {
        console.error(`[presence] disconnect handling failed for user ${user.id}:`, (err as Error).message);
      });
    });
  });
}
