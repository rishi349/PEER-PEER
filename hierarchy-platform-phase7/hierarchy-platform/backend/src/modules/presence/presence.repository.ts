import { redis } from "../../config/redis";
import type { PresenceRecord, PresenceStatus } from "./presence.types";

// Raw Redis access only — no policy/authorization logic lives here, same
// layering role hierarchy.repository.ts plays for Postgres (master spec
// §41: Redis is ephemeral/distributed state, never queried through
// Prisma). presence.service.ts is the only caller.

/**
 * How long a presence record survives in Redis without a renewing
 * heartbeat before Redis itself expires it (master spec §21-22). Chosen
 * to give roughly one missed heartbeat of slack assuming a ~15s client
 * heartbeat interval — not validated against a real frontend heartbeat
 * loop yet (none exists — see HANDOFF). Revisit this number once one
 * does.
 */
export const PRESENCE_TTL_SECONDS = 30;

export const PRESENCE_KEY_PREFIX = "presence:";
const SOCKET_SET_KEY_PREFIX = "presence:sockets:";

export function presenceKey(userId: string): string {
  return `${PRESENCE_KEY_PREFIX}${userId}`;
}

function socketSetKey(userId: string): string {
  return `${SOCKET_SET_KEY_PREFIX}${userId}`;
}

/** Writes (or renews) the presence record with a fresh TTL. Used for both
 *  "just connected" and "heartbeat renewal" — the record shape is the same. */
export async function writeRecord(userId: string, status: PresenceStatus): Promise<PresenceRecord> {
  const record: PresenceRecord = { status, lastSeen: new Date().toISOString() };
  await redis.set(presenceKey(userId), JSON.stringify(record), "EX", PRESENCE_TTL_SECONDS);
  return record;
}

export async function readRecord(userId: string): Promise<string | null> {
  return redis.get(presenceKey(userId));
}

/** Batch read for snapshot building. Returns null for any user with no record. */
export async function readMany(userIds: string[]): Promise<(string | null)[]> {
  if (userIds.length === 0) return [];
  return redis.mget(...userIds.map(presenceKey));
}

export async function deleteRecord(userId: string): Promise<void> {
  await redis.del(presenceKey(userId));
}

export async function addSocket(userId: string, socketId: string): Promise<void> {
  await redis.sadd(socketSetKey(userId), socketId);
}

/**
 * Removes one socket from the user's tracked-sockets set (supports
 * multiple simultaneous tabs/devices — master spec §29) and returns how
 * many sockets remain, so the caller can decide whether this was the
 * user's *last* connection.
 */
export async function removeSocket(userId: string, socketId: string): Promise<number> {
  await redis.srem(socketSetKey(userId), socketId);
  return redis.scard(socketSetKey(userId));
}
