// Phase 6 — Location (master spec §19-20, §41, §47 Phase 6).
//
// Scope note, read before extending this: this module is deliberately
// separate from presence.* even though the infrastructure looks similar
// (Redis + TTL + own repository/service split) — see HANDOFF.md §7 item
// 6 and PHASE6_PLAN.md §1. Presence answers "is this user currently
// connected;" this module answers "where is this user, and who may be
// told." Do not fold the two together.
//
// This is also NOT the Radar (Phase 7) — no rendering, no range/zoom/
// orientation, no role filter. This module's whole job is to produce
// clean distance+bearing data Phase 7 can consume without rework
// (PHASE6_PLAN.md §1/§3).

/** What the browser's geolocation API gives us for one reading. */
export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Meters, as reported by navigator.geolocation — optional because not
   *  every device/browser reports it. */
  accuracy?: number;
}

/**
 * Shape stored (as JSON) at the `location:{userId}` Redis key. Exact
 * coordinates are stored here — deliberately — because computing
 * distance/bearing for an authorized viewer requires the server to hold
 * both parties' exact positions (PHASE6_PLAN.md §2b). Nothing outside
 * this module (and never anyone else's client) ever reads this record
 * directly; every external read path converts to distance+bearing first
 * (see location.service.ts's getDistanceAndBearing).
 */
export interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** ISO 8601 timestamp of the most recent update that produced this
   *  record — surfaced in API responses so a caller (eventually Phase
   *  7's radar) can decide what "stale" means and render accordingly.
   *  This module does not itself define a staleness policy beyond the
   *  Redis TTL (PHASE6_PLAN.md §4, open question 4). */
  updatedAt: string;
}

/**
 * Why a distance/bearing computation could not be produced. Deliberately
 * modeled as data, not thrown as an AppError — PHASE6_PLAN.md §2b is
 * explicit that "no current location" is a legitimate outcome, not an
 * error condition. Authorization failures (not allowed to see this user
 * at all) and domain failures (target doesn't exist / isn't ACTIVE)
 * remain real thrown errors — this type only covers "authorized, but no
 * location data available to compute from right now."
 *
 * Deliberately NOT split into "sharing is off" vs "no recent reading"
 * for the TARGET case — PHASE6_PLAN.md §2a: both mean the same thing to
 * a caller ("no location available for this user right now"), the same
 * posture presence.service.ts already takes for a missing presence key
 * (never distinguishing "never connected" from "TTL-expired"). The
 * REQUESTER case is kept distinct because it's actionable information
 * specifically for the caller ("turn on your own location sharing to
 * see this"), not a privacy-sensitive fact about someone else.
 */
export type LocationUnavailableReason =
  | "REQUESTER_LOCATION_UNAVAILABLE"
  | "TARGET_LOCATION_UNAVAILABLE";

/**
 * The only shape ever returned for "what is user X's distance/bearing
 * from me" — master spec §19: this backend never returns another user's
 * raw coordinates over any API this phase adds, for any requester. (A
 * user's own exact coordinates could legitimately be read back to that
 * same user per PHASE6_PLAN.md §2b, but no endpoint for that was needed
 * this phase — the frontend already has its own reading locally from
 * navigator.geolocation, so nothing round-trips it. Not built to avoid
 * unneeded surface area; see location.service.ts#getDistanceAndBearing.)
 */
export type DistanceBearingResult =
  | { available: true; distanceMeters: number; bearingDegrees: number; updatedAt: string }
  | { available: false; reason: LocationUnavailableReason };
