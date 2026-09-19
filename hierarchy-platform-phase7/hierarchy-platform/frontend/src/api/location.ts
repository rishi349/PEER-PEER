import { apiRequest } from "./client";

export interface LocationCoordinatesInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Mirrors backend/src/modules/location/location.types.ts's
// DistanceBearingResult. Not called by any UI yet this phase — Phase
// 7's radar is the actual consumer (PHASE6_PLAN.md §1/§4) — included
// here so the frontend's typed API surface matches the backend's from
// day one, the same way api/hierarchy.ts already exposes every
// hierarchy.routes.ts endpoint regardless of whether every one has a UI
// caller yet.
export type DistanceBearingResult =
  | { available: true; distanceMeters: number; bearingDegrees: number; updatedAt: string }
  | { available: false; reason: "REQUESTER_LOCATION_UNAVAILABLE" | "TARGET_LOCATION_UNAVAILABLE" };

export function getSharingRequest(): Promise<{ enabled: boolean }> {
  return apiRequest("/location/sharing");
}

export function setSharingRequest(enabled: boolean): Promise<{ enabled: boolean }> {
  return apiRequest("/location/sharing", { method: "PATCH", body: { enabled } });
}

export function updateLocationRequest(
  coords: LocationCoordinatesInput
): Promise<{ updatedAt: string }> {
  return apiRequest("/location", { method: "POST", body: coords });
}

export function getDistanceRequest(targetUserId: string): Promise<DistanceBearingResult> {
  return apiRequest(`/location/distance/${targetUserId}`);
}
