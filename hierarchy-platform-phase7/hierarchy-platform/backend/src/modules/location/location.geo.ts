// Pure geo math — no Redis/Postgres/authorization dependency, deliberately
// kept as small standalone functions (same separation-of-concerns
// instinct master spec §38 asks for on the frontend's radar calculations
// — "keep calculations independent from rendering... unit-test the
// calculations independently"). location.service.ts is the only caller
// on the backend; a future Phase 7 radar could reuse this shape of
// function client-side too, but nothing here is backend-specific enough
// to prevent that.

// Deliberately not `Coordinates`/`LocationRecord` from location.types.ts —
// the math here only ever needs latitude/longitude, and `Coordinates`'s
// optional `accuracy` vs `LocationRecord`'s nullable `accuracy` would
// otherwise force an awkward cast at every call site for a field neither
// function uses.
interface LatLon {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Great-circle distance between two points via the haversine formula.
 * Accurate enough for this product's purposes (radar range display, not
 * survey-grade navigation) and avoids pulling in a geo library for one
 * formula.
 */
export function haversineDistanceMeters(from: LatLon, to: LatLon): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Initial compass bearing (0-360, 0 = true north, clockwise) from `from`
 * to `to`. This is the bearing a radar marker would be placed at relative
 * to the viewer — master spec §17/§38's DISTANCE + BEARING output.
 */
export function initialBearingDegrees(from: LatLon, to: LatLon): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  const bearing = toDegrees(Math.atan2(y, x));

  return (bearing + 360) % 360;
}
