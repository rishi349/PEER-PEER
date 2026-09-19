import { redis } from "../../config/redis";
import type { Coordinates, LocationRecord } from "./location.types";

// Raw Redis access only — no policy/authorization logic lives here, same
// layering role hierarchy.repository.ts plays for Postgres and
// presence.repository.ts/p2p.repository.ts play for their own ephemeral
// concerns (master spec §41). location.service.ts is the only caller.

/**
 * Own TTL constant, deliberately a third distinct number from presence's
 * PRESENCE_TTL_SECONDS (30) and P2P's P2P_LEASE_TTL_SECONDS (45) — per
 * HANDOFF.md §6's own instruction for Phase 6 ("give it a third distinct
 * namespace/TTL too — don't silently reuse either existing one for an
 * unrelated concern"). Sized against PHASE6_PLAN.md §2c's ~20s client
 * update cadence: roughly 2.5x that interval, i.e. a little more than one
 * full missed update of slack before a reading is treated as gone. Same
 * "guess, not a measurement" caveat every prior phase's own TTL carries
 * (HANDOFF.md §4d gap #4, §4e's P2P_LEASE_TTL_SECONDS comment) — there is
 * no real frontend send loop yet to validate this against. Revisit
 * alongside the frontend loop once one exists and is observed in
 * practice.
 */
export const LOCATION_TTL_SECONDS = 50;

const LOCATION_KEY_PREFIX = "location:";

function locationKey(userId: string): string {
  return `${LOCATION_KEY_PREFIX}${userId}`;
}

function parse(raw: string | null): LocationRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocationRecord;
  } catch {
    // Corrupt/unexpected Redis value — treat as "no reading" rather than
    // crashing a read over it, same posture presence.repository.ts and
    // p2p.repository.ts both take on their own parse failures.
    return null;
  }
}

/** Writes (or overwrites) the caller's exact-coordinate reading with a
 *  fresh TTL. There is no separate "renew" operation — unlike presence's
 *  heartbeat or P2P's lease renewal, every location update carries a new
 *  reading, so there is nothing to renew independently of a fresh write. */
export async function writeLocation(userId: string, coords: Coordinates): Promise<LocationRecord> {
  const record: LocationRecord = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy ?? null,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(locationKey(userId), JSON.stringify(record), "EX", LOCATION_TTL_SECONDS);
  return record;
}

export async function readLocation(userId: string): Promise<LocationRecord | null> {
  return parse(await redis.get(locationKey(userId)));
}

/**
 * Explicit cleanup, called when a user disables location sharing
 * (location.service.ts's setSharingEnabled). Not strictly required for
 * correctness on its own — the TTL would expire the key anyway, and
 * getDistanceAndBearing also independently re-checks the Postgres
 * `locationSharingEnabled` flag before ever reading this key (defense in
 * depth, master spec §15) — but deleting immediately closes the window
 * where a stale-but-not-yet-expired reading could otherwise still be
 * sitting in Redis for someone who just opted out.
 */
export async function deleteLocation(userId: string): Promise<void> {
  await redis.del(locationKey(userId));
}
