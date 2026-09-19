import { redis } from "../../config/redis";
import type { P2PLeaseRecord } from "./p2p.types";

// Raw Redis access only — no policy/authorization logic lives here, same
// layering role hierarchy.repository.ts plays for Postgres and
// presence.repository.ts plays for presence (master spec §41: Redis is
// ephemeral/distributed state). p2p.service.ts is the only caller.

/**
 * Master spec §25: "short-lived and renewable." 45s was chosen —
 * distinct from (not reused from) presence's 30s `PRESENCE_TTL_SECONDS`
 * on purpose, per HANDOFF §6's own note that a future Redis-backed
 * ephemeral concern should get its own TTL convention rather than
 * silently sharing presence's. The two numbers answer different
 * questions and have no reason to match: presence's TTL is about
 * detecting a dropped *network* connection quickly; this TTL is about
 * how long a *control-plane authorization decision* stays valid before
 * it must be re-derived. A slightly longer window than presence's is
 * deliberate — re-deriving P2P authorization (a full Postgres
 * ancestor-chain re-check, see p2p.service.ts's renewSession) is more
 * expensive than a presence heartbeat, so it shouldn't need to happen
 * as often. Not validated against a real frontend renewal loop, because
 * none exists yet — same "guess, not a measurement" caveat presence's
 * TTL carries (HANDOFF §4d gap #4); tune alongside a real client.
 *
 * IMPORTANT (master spec §25/§33): this TTL bounds how long the
 * *authorization* is valid without renewal — it is explicitly NOT a
 * limit on how long an established WebRTC connection or an in-progress
 * data transfer may run. A client is expected to keep calling
 * `p2p:renew-session` periodically for as long as it wants the
 * connection to remain authorized; the underlying RTCPeerConnection
 * itself is untouched by lease expiry unless a compliant client chooses
 * to close it in response to a `p2p:session-revoked` event.
 */
export const P2P_LEASE_TTL_SECONDS = 45;

const LEASE_KEY_PREFIX = "p2p:lease:";
const USER_INDEX_PREFIX = "p2p:leases:byUser:";

/** Canonical, order-independent identifier for a user pair — sorted so
 *  "A requests B" and "B requests A" always resolve to the same lease. */
export function pairId(userIdX: string, userIdY: string): [string, string] {
  return userIdX < userIdY ? [userIdX, userIdY] : [userIdY, userIdX];
}

function leaseKey(userIdX: string, userIdY: string): string {
  const [userA, userB] = pairId(userIdX, userIdY);
  return `${LEASE_KEY_PREFIX}${userA}:${userB}`;
}

function userIndexKey(userId: string): string {
  return `${USER_INDEX_PREFIX}${userId}`;
}

function parse(raw: string | null): P2PLeaseRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as P2PLeaseRecord;
  } catch {
    // Corrupt/unexpected Redis value — treat as "no lease" rather than
    // crashing a read over it (same posture presence.repository.ts's
    // caller takes for its own parse failures).
    return null;
  }
}

/**
 * Creates a lease if none exists between these two users, or renews one
 * that already does (same operation either way — the two request paths
 * only differ in what p2p.service.ts does with the result, e.g. whether
 * it broadcasts). `initiatedBy` is only used on first creation; a
 * renewal preserves the original value even if the *other* participant
 * is the one calling renew.
 */
export async function upsertLease(
  userIdX: string,
  userIdY: string,
  requestedBy: string
): Promise<P2PLeaseRecord> {
  const [userA, userB] = pairId(userIdX, userIdY);
  const key = leaseKey(userA, userB);

  const existing = parse(await redis.get(key));
  const now = new Date();
  const record: P2PLeaseRecord = {
    userA,
    userB,
    initiatedBy: existing?.initiatedBy ?? requestedBy,
    createdAt: existing?.createdAt ?? now.toISOString(),
    renewedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + P2P_LEASE_TTL_SECONDS * 1000).toISOString(),
  };

  await redis.set(key, JSON.stringify(record), "EX", P2P_LEASE_TTL_SECONDS);
  await redis.sadd(userIndexKey(userA), key);
  await redis.sadd(userIndexKey(userB), key);

  return record;
}

/** Reads the lease between two users, in either argument order. Returns
 *  null if none exists (never existed, was closed, or TTL-expired — no
 *  distinction is made, same posture presence takes on a missing key). */
export async function readLease(userIdX: string, userIdY: string): Promise<P2PLeaseRecord | null> {
  return parse(await redis.get(leaseKey(userIdX, userIdY)));
}

export async function deleteLease(userIdX: string, userIdY: string): Promise<void> {
  const [userA, userB] = pairId(userIdX, userIdY);
  const key = leaseKey(userA, userB);
  await redis.del(key);
  await redis.srem(userIndexKey(userA), key);
  await redis.srem(userIndexKey(userB), key);
}

/**
 * Every lease `userId` currently holds, on either side of the pair —
 * used by revokeSessionsForUser (master spec §26) to find every session
 * that must be torn down when a node is removed. The index set
 * (`p2p:leases:byUser:{userId}`, no TTL, cleaned explicitly by
 * deleteLease) is necessary because Redis has no native "find all keys
 * referencing this value" query — same reasoning presence.repository.ts
 * gives for its own `presence:sockets:{userId}` set.
 */
export async function listLeasesForUser(userId: string): Promise<P2PLeaseRecord[]> {
  const keys = await redis.smembers(userIndexKey(userId));
  if (keys.length === 0) return [];
  const raw = await redis.mget(...keys);
  return raw.map(parse).filter((record): record is P2PLeaseRecord => record !== null);
}

// Known, deliberately-not-solved-this-phase gap (documented rather than
// silently left, same posture as presence's known gaps in HANDOFF §4d):
// when a lease's Redis key TTL-expires naturally (no explicit close, no
// removal — just nobody renewed it), nothing removes the now-dangling
// key from `p2p:leases:byUser:{userId}`. This does not cause incorrect
// behavior anywhere: listLeasesForUser above already filters out the
// resulting null reads, so a stale index entry is simply invisible to
// every caller. It is a slow, unbounded memory leak in the index sets
// over the life of a long-running server (one stale string per naturally
// -expired, never-explicitly-closed lease, forever). A real fix would
// mean either a periodic sweep or reacting to Redis's own key-expiry
// notification the way presence.keyspaceListener.ts already does for
// presence keys — worth doing before this ships to a long-lived
// production deployment, not urgent for correctness right now.
