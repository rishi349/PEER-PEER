import type { Socket } from "socket.io";
import { prisma } from "../config/prisma";
import { verifyAccessToken } from "../modules/auth/tokens";
import type { AuthenticatedUser } from "../types/express";

/**
 * A Socket.IO socket after `authenticateSocket` has run. `data.user` is
 * guaranteed populated for any listener attached inside `io.on("connection", ...)`,
 * because Socket.IO always finishes every `io.use(...)` middleware before
 * emitting `"connection"` — every gateway module (presence, p2p, and
 * whatever later phases add) can rely on this without re-checking.
 */
export interface AuthenticatedSocket extends Socket {
  data: { user: AuthenticatedUser };
}

/**
 * Socket.IO connection-time auth. Moved here in Phase 5 (unchanged in
 * behavior) from presence.gateway.ts, where it originated in Phase 4 as
 * a private function. Phase 5 added a second gateway (p2p.gateway.ts)
 * that needs to run on the exact same authenticated connection —
 * registering this middleware once per gateway would mean verifying the
 * JWT and re-reading Postgres twice (or more, in future phases) per
 * connecting socket for no benefit. It is now registered exactly once,
 * centrally, in config/socket.ts's `initSocketIO`. Every gateway module
 * just reads `socket.data.user` inside its own `io.on("connection", ...)`
 * — see `AuthenticatedSocket` above for why that is always safe.
 *
 * Mirrors requireAuth.ts (same JWT, same "Bearer"-less raw token — this
 * time via `socket.handshake.auth.token`, since "Bearer " is an HTTP
 * header convention and Socket.IO's auth payload is a plain object),
 * plus one extra step REST doesn't need in the same place: a fresh
 * Postgres ACTIVE check right here at connect time.
 *
 * Why here and not left to each service's own re-fetch alone: REST
 * requests are short-lived, so every service call re-fetching the actor
 * (master spec §15) is cheap and frequent by nature. A socket
 * connection is comparatively long-lived — without this check, an
 * already-issued access token for a user who gets removed *before*
 * their token expires could still open a brand new socket connection.
 * This closes that specific gap for *new* connections only. It does
 * **not** retroactively tear down an already-open socket if the user is
 * removed mid-session — see presence.service.ts's `handleConnect`
 * docblock and HANDOFF §4d "known gaps" #1 for the residual gap this
 * leaves, which Phase 5's P2P revocation handles differently (see
 * p2p.service.ts's `revokeSessionsForUser`: it cannot force-disconnect
 * an already-open signaling socket either, but it *can* and does
 * immediately delete the Redis lease and push a revocation event, which
 * is the realistic security model the master spec itself accepts for
 * WebRTC — §27).
 */
export async function authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
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
