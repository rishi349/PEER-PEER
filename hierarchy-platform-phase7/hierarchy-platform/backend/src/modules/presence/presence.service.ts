import { EventEmitter } from "node:events";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as authorizationService from "../authorization/authorization.service";
import * as presenceRepo from "./presence.repository";
import type {
  PresenceChangedEvent,
  PresenceRecord,
  PresenceSnapshotEntry,
  PresenceStatus,
} from "./presence.types";

/**
 * Emits `"presence:changed"` whenever a user's status actually
 * transitions (ONLINE <-> OFFLINE) — never on a silent heartbeat
 * renewal. presence.gateway.ts is the only subscriber; it turns these
 * into Socket.IO room broadcasts.
 *
 * This is deliberately an EventEmitter rather than this service
 * importing the Socket.IO `io` instance directly: it keeps presence
 * logic testable without a running Socket.IO server (see
 * presence.service.test.ts), and it lets presence.keyspaceListener.ts
 * (the TTL-expiry path) trigger the exact same broadcast path as the
 * connect/disconnect path without needing an `io` reference of its own.
 */
export const presenceEvents = new EventEmitter();

/**
 * Same re-fetch-from-Postgres-rather-than-trust-the-token pattern as
 * hierarchy.service.ts's requireActiveActor (master spec §15).
 * Duplicated locally rather than imported from there — this codebase's
 * existing convention is for each module to own this small check itself
 * (users.service.ts's getCurrentUser does the same thing inline rather
 * than sharing a helper), so this follows the same pattern rather than
 * introducing a new shared abstraction for a three-line check.
 */
async function requireActiveActor(userId: string) {
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
 * Every user id authorized to see `userId`'s presence, per master spec
 * §16. This is exactly `userId`'s own visibility scope (ancestors +
 * descendants), because the ancestor/descendant relation is symmetric:
 * "Y is authorized to see X" iff X is an ancestor of Y or a descendant
 * of Y — which is precisely the set "X's own ancestors + X's own
 * descendants." Includes `userId` itself, so a user's other open
 * tabs/devices also receive the update.
 */
async function getAudience(userId: string): Promise<string[]> {
  const { ancestors, descendants } = await authorizationService.getVisibilityScope({ id: userId });
  return [userId, ...ancestors.map((a) => a.id), ...descendants.map((d) => d.id)];
}

function parseRecord(raw: string | null): PresenceRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PresenceRecord;
  } catch {
    // Corrupt/unexpected Redis value — treat as "no record" rather than
    // crashing a presence read over it.
    return null;
  }
}

async function emitTransition(userId: string, status: PresenceStatus, lastSeen: string): Promise<void> {
  const audience = await getAudience(userId);
  const event: PresenceChangedEvent = { userId, status, lastSeen, audience };
  presenceEvents.emit("presence:changed", event);
}

/**
 * Called once per new Socket.IO connection (after JWT verification —
 * see presence.gateway.ts). Re-checks the actor is still ACTIVE so a
 * removed user's still-valid (unexpired) access token cannot make them
 * appear online — throws UNAUTHORIZED/USER_INACTIVE if not, which the
 * gateway turns into a rejected connection.
 *
 * Known gap, documented rather than solved this phase: this check only
 * runs at *connect* time. If a user is removed while already connected,
 * their existing socket is not forcibly torn down by this function —
 * their heartbeats will keep renewing presence until they disconnect or
 * their access token naturally expires (max ~15 min, per
 * JWT_ACCESS_TTL). This is the same class of realistic-security-model
 * gap the master spec already accepts for WebRTC revocation (§27) —
 * server-side authorization is enforced for *new* connections/actions,
 * not retroactively against an already-established session. Forcibly
 * disconnecting a removed user's live sockets would require hierarchy's
 * removeNode to reach into the Socket.IO layer, which is out of scope
 * for Phase 4 — a reasonable candidate for Phase 8 (Security Hardening).
 *
 * Broadcasts ONLINE only on an actual OFFLINE -> ONLINE transition,
 * never when a second tab/device connects while the user is already
 * online.
 */
export async function handleConnect(userId: string, socketId: string): Promise<void> {
  await requireActiveActor(userId);

  const previous = parseRecord(await presenceRepo.readRecord(userId));
  await presenceRepo.addSocket(userId, socketId);
  const record = await presenceRepo.writeRecord(userId, "ONLINE");

  if (!previous || previous.status !== "ONLINE") {
    await emitTransition(userId, "ONLINE", record.lastSeen);
  }
}

/**
 * Heartbeat renewal — refreshes the Redis TTL only. Deliberately does
 * NOT re-check Postgres (unlike handleConnect) and NEVER broadcasts:
 * heartbeats are expected every ~15s and a DB round-trip or a socket
 * broadcast on every single one would be wasted work for something that,
 * by definition, isn't a status change.
 */
export async function handleHeartbeat(userId: string): Promise<void> {
  await presenceRepo.writeRecord(userId, "ONLINE");
}

/**
 * Called on Socket.IO `disconnect`. Only transitions to OFFLINE (and
 * only then broadcasts) once the user's *last* tracked socket has
 * disconnected — master spec §29's multi-device model means a second
 * open tab/device should keep the user ONLINE.
 */
export async function handleDisconnect(userId: string, socketId: string): Promise<void> {
  const remaining = await presenceRepo.removeSocket(userId, socketId);
  if (remaining > 0) return;

  await presenceRepo.deleteRecord(userId);
  await emitTransition(userId, "OFFLINE", new Date().toISOString());
}

/**
 * Called by presence.keyspaceListener.ts when a `presence:{userId}` key
 * expires in Redis without a renewing heartbeat — master spec §22: "do
 * not rely only on clean disconnect events." Redis has already dropped
 * the key by the time this fires, so there is nothing left to delete;
 * this only broadcasts the transition.
 *
 * Known gap, documented rather than solved: the matching
 * `presence:sockets:{userId}` set is deliberately left untouched here
 * rather than guessed-cleared, since we don't know which (if any)
 * specific socket actually went stale. In the common case (network
 * drop / tab closed without a clean disconnect) Socket.IO's own
 * heartbeat/ping-timeout will eventually fire a `disconnect` on the
 * server for that socket too, and handleDisconnect will clean up the
 * set then. Until that happens, the socket set may over-count for this
 * user — harmless for the ONLINE/OFFLINE broadcast logic (this function
 * always broadcasts OFFLINE regardless of the set's contents), but
 * worth knowing about if the socket set is ever inspected directly.
 */
export async function handleTTLExpiry(userId: string): Promise<void> {
  await emitTransition(userId, "OFFLINE", new Date().toISOString());
}

/**
 * REST (`GET /presence`) and initial-socket-connect snapshot: the
 * caller's own status plus everyone in their visibility scope (master
 * spec §16), read straight from Redis. A missing Redis key reads back
 * as OFFLINE — that's the correct default for "never connected,"
 * "cleanly disconnected," and "TTL-expired" alike, so no separate
 * bookkeeping is needed to distinguish those here.
 */
export async function getSnapshotForActor(
  actor: AuthenticatedUser
): Promise<{ self: PresenceSnapshotEntry; users: PresenceSnapshotEntry[] }> {
  const freshActor = await requireActiveActor(actor.id);
  const { ancestors, descendants } = await authorizationService.getVisibilityScope({ id: freshActor.id });
  const others = [...ancestors, ...descendants];

  const rawSelf = await presenceRepo.readRecord(freshActor.id);
  const rawOthers = await presenceRepo.readMany(others.map((u) => u.id));

  const toEntry = (userId: string, raw: string | null): PresenceSnapshotEntry => {
    const parsed = parseRecord(raw);
    return {
      userId,
      status: parsed?.status ?? "OFFLINE",
      lastSeen: parsed?.lastSeen ?? null,
    };
  };

  return {
    self: toEntry(freshActor.id, rawSelf),
    users: others.map((u, i) => toEntry(u.id, rawOthers[i] ?? null)),
  };
}
