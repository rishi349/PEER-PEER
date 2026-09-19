// Pure calculations only — no DOM, no React, no API calls. Master spec
// §38: "Keep calculations independent from rendering... Unit-test the
// calculations independently." The backend already computes
// getDistance/getBearing (backend/src/modules/location/location.geo.ts,
// Phase 6) and hands this frontend clean distanceMeters/bearingDegrees
// numbers per master spec §17/§19's server-only distance/bearing rule —
// this module only ever adds the one calculation §38 says belongs on
// the client: getRadarPosition (distance/bearing/range/orientation →
// x/y). It never re-derives distance or bearing itself, and it never
// receives or needs raw coordinates.

export interface RadarPosition {
  x: number;
  y: number;
  /** True when the real distance exceeds the currently selected range —
   *  the marker is still placed (clamped to the outer ring) rather than
   *  hidden, so a user knows "someone is out there, past your current
   *  range" instead of them just silently disappearing. */
  clipped: boolean;
}

/**
 * Converts distance + bearing (from the backend, master spec §17/§19)
 * into a 2D point on the radar face.
 *
 * - `radiusPx` is the pixel radius of the outermost ring in the SVG.
 * - `rangeMeters` is the real-world distance that outermost ring
 *   represents — the user-controlled "range" (master spec §39).
 * - `orientationDegrees` rotates the whole face; 0 = north-up. No
 *   device-compass input exists yet (see RadarControls.tsx's own note),
 *   so every caller in this phase passes 0 — kept as a real parameter,
 *   not hardcoded here, so wiring up a real compass later doesn't
 *   require touching this function.
 * - Bearing 0° (true north) maps to "up" on screen (negative y, since
 *   SVG y grows downward), matching every existing radar/compass
 *   convention and master spec §39's mockup ("● Leader C" positioned
 *   above "YOU").
 */
export function getRadarPosition(
  distanceMeters: number,
  bearingDegrees: number,
  rangeMeters: number,
  orientationDegrees: number,
  radiusPx: number
): RadarPosition {
  const clipped = distanceMeters > rangeMeters;
  const ratio = rangeMeters > 0 ? Math.min(distanceMeters / rangeMeters, 1) : 1;
  const r = ratio * radiusPx;

  const relativeBearing = ((bearingDegrees - orientationDegrees) % 360 + 360) % 360;
  const angleRad = (relativeBearing * Math.PI) / 180;

  return {
    x: r * Math.sin(angleRad),
    y: -r * Math.cos(angleRad),
    clipped,
  };
}

/** Compass-word for a bearing, for the details panel (e.g. "NE"). */
export function bearingToCompass(bearingDegrees: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(((bearingDegrees % 360) + 360) % 360 / 45) % 8;
  return points[index] ?? "N";
}

/** Human-readable distance — meters under 1km, otherwise km to 1 decimal. */
export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}
