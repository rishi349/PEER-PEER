import { EventEmitter } from "node:events";
import type { User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as authorizationService from "../authorization/authorization.service";
import * as p2pRepo from "./p2p.repository";
import type {
  P2PRevocationReason,
  P2PSessionAuthorizedEvent,
  P2PSessionRevokedEvent,
} from "./p2p.types";

/**
 * Emits `"p2p:session-authorized"` and `"p2p:session-revoked"`.
 * p2p.gateway.ts is the only subscriber; it turns these into Socket.IO
 * room broadcasts. Same decoupling reason as presence.service.ts's
 * `presenceEvents` (see that file's docblock, and HANDOFF §6): this
 * keeps lease lifecycle logic testable without a running Socket.IO
 * server (see p2p.service.test.ts), and lets a hierarchy removal
 * (routed through p2p.gateway.ts, not this file — see below) trigger
 * the exact same broadcast path a voluntary close does.
 *
 * This module deliberately never imports `hierarchy.service.ts` or
 * anything about Socket.IO. The hierarchy-removal → revocation bridge
 * lives entirely in p2p.gateway.ts, which subscribes to
 * hierarchy.service.ts's `hierarchyEvents` and calls
 * `revokeSessionsForUser` below — this file only knows "how to revoke a
 * user's leases," not "when a removal happens."
 */
export const p2pEvents = new EventEmitter();

/**
 * Same re-fetch-from-Postgres-rather-than-trust-the-token pattern every
 * other service in this codebase uses (master spec §15). Duplicated
 * locally rather than imported — matches the established convention
 * (see presence.service.ts's own copy of this exact comment).
 */
async function requireActiveActor(userId: string): Promise<User> {
  const actor = await prisma.user.findUnique({ where: { id: userId } });
  if (!actor) {
    throw new AppError("UNAUTHORIZED", "Actor no longer exists");
  }
  if (actor.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This account is no longer active");
  }
  return actor;
}

/**
 * The domain-precondition + authorization gate shared by requestSession
 * and renewSession: target must exist, be in the same org, be
 * currently ACTIVE, not be the actor themselves, and be someone the
 * actor is authorized to reach per master spec §16/§25 (see
 * authorization.service.ts's INITIATE_P2P_SESSION case). Deliberately
 * re-run in full by *both* request and renew — see renewSession's own
 * comment for why renewal doesn't take a shortcut here.
 */
async function requireEligibleCounterpart(freshActor: User, targetId: string): Promise<User> {
  if (targetId === freshActor.id) {
    throw new AppError("FORBIDDEN", "You cannot start a P2P session with yourself");
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.organizationId !== freshActor.organizationId) {
    throw new AppError("NODE_NOT_FOUND", "User not found");
  }
  if (target.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This user is not currently active");
  }

  await authorizationService.assertCanPerform(
    freshActor,
    "INITIATE_P2P_SESSION",
    target,
    "You are not authorized to establish a P2P session with this user"
  );

  return target;
}

function emitRevoked(userA: string, userB: string, reason: P2PRevocationReason, revokedBy: string): void {
  const event: P2PSessionRevokedEvent = { userA, userB, reason, revokedBy };
  p2pEvents.emit("p2p:session-revoked", event);
}

/**
 * Requests a new (or effectively-fresh) P2P session authorization lease
 * between the actor and `targetId` — master spec §25's "A → Server: I
 * want to connect to B" flow. Always broadcasts `p2p:session-authorized`
 * (via p2pEvents) so the *other* participant's client learns a session
 * was just authorized, even if they didn't call this — mirrors
 * presence.service.ts's handleConnect always-broadcast-on-connect
 * behavior. If a lease between these two already exists, this
 * effectively renews it (same underlying Redis write as renewSession)
 * but still broadcasts, since from the callee's perspective a fresh
 * `p2p:request-session` from the caller is worth knowing about again
 * even mid-session (e.g. the caller's client reconnected/reloaded).
 */
export async function requestSession(
  actor: AuthenticatedUser,
  targetId: string
): Promise<{ leaseId: string; expiresAt: string }> {
  const freshActor = await requireActiveActor(actor.id);
  const target = await requireEligibleCounterpart(freshActor, targetId);

  const record = await p2pRepo.upsertLease(freshActor.id, target.id, freshActor.id);
  const leaseId = `${record.userA}:${record.userB}`;

  const event: P2PSessionAuthorizedEvent = {
    userA: record.userA,
    userB: record.userB,
    initiatedBy: record.initiatedBy,
    leaseId,
    expiresAt: record.expiresAt,
  };
  p2pEvents.emit("p2p:session-authorized", event);

  return { leaseId, expiresAt: record.expiresAt };
}

/**
 * Renews an existing lease — master spec §25's "renewable" requirement,
 * and the actual mechanism behind §26's "prevent lease renewal" once a
 * participant is removed. Unlike presence.service.ts's `handleHeartbeat`
 * (which deliberately skips the Postgres check for performance, since
 * heartbeats are expected every ~15s), renewal here deliberately DOES
 * re-run the full `requireEligibleCounterpart` check — fresh Postgres
 * reads for both users, and a fresh `assertCanPerform` authorization
 * decision — every single time. This is intentional, not an oversight:
 * a P2P lease is a live authorization *decision*, not just a liveness
 * signal, and master spec §26 requires that decision to be
 * re-derivable-as-false the moment either participant is removed. At a
 * lease TTL of 45s and an expected renewal cadence far less frequent
 * than presence's heartbeats, the extra Postgres round-trips are an
 * acceptable, deliberate cost for that guarantee. (In practice, removal
 * is *also* pushed proactively and immediately via
 * `revokeSessionsForUser` below — this recheck is defense-in-depth for
 * the gap between a removal and a subscriber's next scheduled renewal
 * attempt, not the only mechanism.)
 *
 * Throws LEASE_EXPIRED if no lease currently exists between these two
 * users — renewal is deliberately not "create if missing," so a client
 * can't accidentally paper over a revoked/expired session as if it were
 * a normal keep-alive; they must go through `requestSession` again,
 * which re-broadcasts `p2p:session-authorized` for the other side.
 */
export async function renewSession(
  actor: AuthenticatedUser,
  targetId: string
): Promise<{ leaseId: string; expiresAt: string }> {
  const freshActor = await requireActiveActor(actor.id);
  const target = await requireEligibleCounterpart(freshActor, targetId);

  const existing = await p2pRepo.readLease(freshActor.id, target.id);
  if (!existing) {
    throw new AppError("LEASE_EXPIRED", "No active session to renew — request a new session instead");
  }

  const record = await p2pRepo.upsertLease(freshActor.id, target.id, existing.initiatedBy);
  return { leaseId: `${record.userA}:${record.userB}`, expiresAt: record.expiresAt };
}

/**
 * Voluntary close — either participant may end a session at any time.
 * Idempotent: closing an already-gone lease is not an error (mirrors
 * `reactivateNode`'s precedent of treating "there's nothing to do here"
 * as a normal outcome rather than throwing, where the alternative would
 * just be noisy for a client that's simply cleaning up).
 */
export async function closeSession(actor: AuthenticatedUser, targetId: string): Promise<void> {
  const freshActor = await requireActiveActor(actor.id);
  if (targetId === freshActor.id) {
    throw new AppError("FORBIDDEN", "You cannot close a session with yourself");
  }

  const existing = await p2pRepo.readLease(freshActor.id, targetId);
  if (!existing) return;

  await p2pRepo.deleteLease(freshActor.id, targetId);
  emitRevoked(existing.userA, existing.userB, "CLOSED_BY_PARTICIPANT", freshActor.id);
}

/**
 * Validates a lease currently exists between two users — used by
 * p2p.gateway.ts before relaying a signaling message (offer/answer/ICE
 * candidate). Deliberately a cheap Redis-only read with no Postgres
 * hit and no `assertCanPerform` re-check: signaling traffic is high
 * frequency (an ICE negotiation can send many candidate messages in a
 * few seconds), and lease *existence* already encodes the authorization
 * decision — it was made (and will be re-made on every renewal) by
 * requestSession/renewSession above. A missing lease here means
 * "never authorized," "explicitly closed," "TTL-expired," or "just
 * revoked because someone was removed" — this function does not
 * distinguish which, same posture presence takes on a missing presence
 * key.
 */
export async function assertActiveLease(userIdX: string, userIdY: string): Promise<void> {
  const existing = await p2pRepo.readLease(userIdX, userIdY);
  if (!existing) {
    throw new AppError("LEASE_EXPIRED", "No active P2P session authorization between these users");
  }
}

/**
 * Revokes every lease `userId` currently holds — master spec §26,
 * called (via p2p.gateway.ts, which subscribes to hierarchy.service's
 * `hierarchyEvents`) once for each id in a `hierarchy:nodes-removed`
 * event. Deletes each lease from Redis (so it can never be found again
 * by `assertActiveLease`/renewed by `renewSession`) and broadcasts a
 * `NODE_REMOVED` revocation for each one, so the *other* participant's
 * client learns immediately rather than only discovering it the next
 * time it tries to renew.
 *
 * This function does not itself know or care *why* `userId` was
 * removed (DIRECT vs GROUP_LEADER_REMOVED) — every removed id is
 * equally no longer authorized for anything, per
 * `HierarchyNodesRemovedEvent`'s own docblock.
 */
export async function revokeSessionsForUser(userId: string): Promise<void> {
  const leases = await p2pRepo.listLeasesForUser(userId);
  for (const lease of leases) {
    await p2pRepo.deleteLease(lease.userA, lease.userB);
    emitRevoked(lease.userA, lease.userB, "NODE_REMOVED", userId);
  }
}
