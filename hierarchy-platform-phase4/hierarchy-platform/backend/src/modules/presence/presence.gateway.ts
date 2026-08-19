import type { Server, Socket } from "socket.io";
import { prisma } from "../../config/prisma";
import { verifyAccessToken } from "../auth/tokens";
import type { AuthenticatedUser } from "../../types/express";
import * as presenceService from "./presence.service";
import type { PresenceChangedEvent } from "./presence.types";

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Socket.IO connection-time auth. Mirrors requireAuth.ts (same JWT, same
 * "Bearer"-less raw token this time via `socket.handshake.auth.token`),
 * plus one extra step REST doesn't need in the same place: a fresh
 * Postgres ACTIVE check right here at connect time.
 *
 * Why here and not left to presence.service.ts alone: REST requests are
 * short-lived, so every service call re-fetching the actor (master spec
 * §15) is cheap and frequent by nature. A socket connection is
 * comparatively long-lived — without this, an already-issued access
 * token for a user who gets removed *before* their token expires could
 * still open a brand new socket connection. This closes that specific
 * gap for *new* connections; presence.service.ts's handleConnect
 * docblock explains the residual gap for already-open sockets.
 */
async function authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const token = socket.handshake.auth?.token as unknown;
    if (typeof token !== "string" || token.length === 0) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    const payload = verifyAccessToken(token);
    const actor = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!actor || actor.status !== "ACTIVE") {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    const authenticated: AuthenticatedUser = {
      id: actor.id,
      organizationId: actor.organizationId,
      role: actor.role,
    };
    socket.data.user = authenticated;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
}

/**
 * Wires presence into a Socket.IO server: connection-time auth, personal
 * rooms (`user:{id}`) for authorization-scoped delivery, the
 * heartbeat/disconnect event handlers, and the bridge from
 * presenceService's decoupled EventEmitter into actual room broadcasts.
 *
 * Call exactly once, from config/socket.ts's initSocketIO — the
 * presenceEvents subscription below is process-global and would
 * double-fire every broadcast if this were called twice.
 */
export function registerPresenceHandlers(io: Server): void {
  io.use(authenticateSocket);

  presenceService.presenceEvents.on("presence:changed", (event: PresenceChangedEvent) => {
    for (const userId of event.audience) {
      io.to(userRoom(userId)).emit("presence:update", {
        userId: event.userId,
        status: event.status,
        lastSeen: event.lastSeen,
      });
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as AuthenticatedUser;
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
