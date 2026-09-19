// Phase 7 — Radar (master spec §17-19, §38-39, §47 Phase 7).
//
// This module is deliberately a thin composition layer over three
// already-built modules — it introduces no new authorization primitive,
// no new Redis namespace, and no new persistent state of its own:
//   - authorizationService.getVisibilityScope   (master spec §16 — who)
//   - presenceService.getSnapshotForActor        (master spec §20-22 — are they here)
//   - locationService.getDistanceAndBearing      (master spec §17/§19 — where, relative to me)
// Radar's own job is exactly master spec §17's pipeline glue: apply the
// LEADERS/PEERS/ALL role filter (§18) on top of the already-authorized
// visibility scope, then attach each remaining user's current presence
// and location result. It never reads Redis or Postgres directly itself
// — see radar.service.ts's own header comment for why, and for the one
// deliberate performance tradeoff this composition makes.

import type { Role } from "@prisma/client";
import type { DistanceBearingResult } from "../location/location.types";
import type { PresenceStatus } from "../presence/presence.types";

/**
 * Master spec §18's three filter modes. Applied *after* authorization/
 * visibility is already established (§18: "The filter is applied after
 * authorization/visibility is established") — never a substitute for it.
 */
export type RadarFilter = "LEADERS" | "PEERS" | "ALL";

/**
 * Which side of the actor's visibility scope this entry came from
 * (master spec §16: "may discover 1. their direct parent/leader 2.
 * their authorized descendants"). Not required by any endpoint contract
 * in the master spec, but cheap to include and immediately useful for a
 * frontend that wants to render "your parent" differently from "someone
 * in your subgroup" without re-deriving the relationship itself client-
 * side (master spec §41: the frontend is never authoritative — it
 * should read this, not recompute it).
 */
export type RadarRelation = "ANCESTOR" | "DESCENDANT";

/**
 * One radar-visible user. Deliberately flat and self-contained — a
 * frontend RadarUserMarker (master spec §38) should be able to render
 * entirely off one of these without a second lookup.
 */
export interface RadarVisibleUser {
  id: string;
  name: string;
  role: Role;
  relation: RadarRelation;
  presence: {
    status: PresenceStatus;
    lastSeen: string | null;
  };
  location: DistanceBearingResult;
  /**
   * True only when `location.available` is true AND the reading is
   * older than RADAR_STALE_LOCATION_SECONDS (see radar.service.ts).
   * Always false when location isn't available at all — "unavailable"
   * and "stale" are deliberately distinct signals (master spec §39
   * lists both a "stale-location indicator" and general availability
   * as separate radar UI concerns): unavailable means "nothing to
   * show," stale means "something to show, but flag it as dated."
   */
  stale: boolean;
}

export interface RadarSnapshot {
  self: { id: string; name: string; role: Role };
  filter: RadarFilter;
  users: RadarVisibleUser[];
}
