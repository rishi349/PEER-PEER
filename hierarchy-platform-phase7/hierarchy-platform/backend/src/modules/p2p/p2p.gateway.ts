import type { Server } from "socket.io";
import { AppError } from "../../common/errors";
import type { AuthenticatedSocket } from "../../middleware/socketAuth";
import { hierarchyEvents } from "../hierarchy/hierarchy.service";
import type { HierarchyNodesRemovedEvent } from "../hierarchy/hierarchy.types";
import * as p2pService from "./p2p.service";
import type {
  P2PSessionAuthorizedEvent,
  P2PSessionRevokedEvent,
  SignalPayload,
} from "./p2p.types";

function userRoom(userId: string): string {
  return `user:${userId}`;
}

type AckResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
type Ack<T> = (response: AckResponse<T>) => void;

function toAckError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: "Something went wrong" };
}

/**
 * Wires P2P session authorization + signaling relay into the shared
 * Socket.IO server: request/renew/close over acknowledged events (see
 * `Ack<T>` above — these are request/response in nature, unlike
 * presence's fire-and-forget heartbeat, so they use Socket.IO's
 * built-in ack-callback mechanism rather than a matching pair of named
 * events), a fire-and-forget signaling relay, and the bridge from both
 * `p2pService.p2pEvents` and `hierarchy.service.ts`'s `hierarchyEvents`
 * into actual room broadcasts.
 *
 * Call exactly once, from config/socket.ts's initSocketIO (after
 * `registerPresenceHandlers` — order between the two doesn't actually
 * matter functionally, since connection-time auth is now registered
 * centrally in config/socket.ts itself rather than by either gateway;
 * see middleware/socketAuth.ts). Both event subscriptions below
 * (`hierarchyEvents` and `p2pEvents`) are process-global and would
 * double-fire every broadcast if this were called twice — same
 * invariant presence.gateway.ts's `registerPresenceHandlers` already
 * documents for its own subscription.
 */
export function registerP2PHandlers(io: Server): void {
  // Bridges hierarchy.service.ts's removal events into P2P revocation
  // (master spec §26). hierarchy.service.ts never imports anything from
  // this module or from socket.io — see its own `hierarchyEvents`
  // docblock — so this gateway is the one place that knows about both
  // sides. Mirrors the decoupling pattern Phase 4 established (presence
  // .service.ts emits on a plain EventEmitter; presence.gateway.ts is
  // the only file that turns those into socket broadcasts).
  hierarchyEvents.on("hierarchy:nodes-removed", (event: HierarchyNodesRemovedEvent) => {
    for (const removedId of event.removedIds) {
      p2pService.revokeSessionsForUser(removedId).catch((err) => {
        console.error(
          `[p2p] failed to revoke sessions for removed user ${removedId}:`,
          (err as Error).message
        );
      });
    }
  });

  p2pService.p2pEvents.on("p2p:session-authorized", (event: P2PSessionAuthorizedEvent) => {
    // Both rooms, not just the callee: harmless for the caller (who
    // already has this same data from their own request-session ack —
    // a second open tab of the caller's own account also learns about
    // it this way) and keeps this symmetric with the revoked broadcast
    // below.
    io.to(userRoom(event.userA)).emit("p2p:session-authorized", event);
    io.to(userRoom(event.userB)).emit("p2p:session-authorized", event);
  });

  p2pService.p2pEvents.on("p2p:session-revoked", (event: P2PSessionRevokedEvent) => {
    io.to(userRoom(event.userA)).emit("p2p:session-revoked", event);
    io.to(userRoom(event.userB)).emit("p2p:session-revoked", event);
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    const user = socket.data.user;

    socket.on(
      "p2p:request-session",
      (payload: { targetUserId?: string }, ack?: Ack<{ leaseId: string; expiresAt: string }>) => {
        const targetUserId = payload?.targetUserId;
        if (!targetUserId) {
          ack?.({ ok: false, error: { code: "VALIDATION_ERROR", message: "targetUserId is required" } });
          return;
        }
        p2pService
          .requestSession(user, targetUserId)
          .then((result) => ack?.({ ok: true, data: result }))
          .catch((err) => {
            console.error(`[p2p] request-session failed for ${user.id}:`, (err as Error).message);
            ack?.({ ok: false, error: toAckError(err) });
          });
      }
    );

    socket.on(
      "p2p:renew-session",
      (payload: { targetUserId?: string }, ack?: Ack<{ leaseId: string; expiresAt: string }>) => {
        const targetUserId = payload?.targetUserId;
        if (!targetUserId) {
          ack?.({ ok: false, error: { code: "VALIDATION_ERROR", message: "targetUserId is required" } });
          return;
        }
        p2pService
          .renewSession(user, targetUserId)
          .then((result) => ack?.({ ok: true, data: result }))
          .catch((err) => ack?.({ ok: false, error: toAckError(err) }));
      }
    );

    socket.on("p2p:close-session", (payload: { targetUserId?: string }, ack?: Ack<null>) => {
      const targetUserId = payload?.targetUserId;
      if (!targetUserId) {
        ack?.({ ok: false, error: { code: "VALIDATION_ERROR", message: "targetUserId is required" } });
        return;
      }
      p2pService
        .closeSession(user, targetUserId)
        .then(() => ack?.({ ok: true, data: null }))
        .catch((err) => ack?.({ ok: false, error: toAckError(err) }));
    });

    // Fire-and-forget, unlike the three above: an ICE-candidate stream
    // can be many messages a second during negotiation, so this does
    // not use the ack-callback pattern. Errors (no active lease) are
    // reported back to the sender only, on a dedicated event, rather
    // than thrown — throwing inside a socket event handler has nowhere
    // useful to go.
    socket.on("p2p:signal", (payload: { targetUserId?: string; payload?: SignalPayload }) => {
      const targetUserId = payload?.targetUserId;
      const signal = payload?.payload;
      if (!targetUserId || !signal) return;

      p2pService
        .assertActiveLease(user.id, targetUserId)
        .then(() => {
          io.to(userRoom(targetUserId)).emit("p2p:signal", { fromUserId: user.id, payload: signal });
        })
        .catch((err) => {
          socket.emit("p2p:signal-error", { targetUserId, error: toAckError(err) });
        });
    });
  });
}
