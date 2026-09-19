import { apiRequest } from "./client";
import type { Role } from "../types";

// Mirrors backend/src/modules/radar/radar.types.ts exactly — same
// hand-mirrored-type convention every other api/*.ts file in this
// project follows (PublicUser, HierarchyNode, location's
// DistanceBearingResult), rather than a shared-types package.

export type RadarFilter = "LEADERS" | "PEERS" | "ALL";
export type RadarRelation = "ANCESTOR" | "DESCENDANT";
export type PresenceStatus = "ONLINE" | "OFFLINE";

export type DistanceBearingResult =
  | { available: true; distanceMeters: number; bearingDegrees: number; updatedAt: string }
  | { available: false; reason: "REQUESTER_LOCATION_UNAVAILABLE" | "TARGET_LOCATION_UNAVAILABLE" };

export interface RadarVisibleUser {
  id: string;
  name: string;
  role: Role;
  relation: RadarRelation;
  presence: { status: PresenceStatus; lastSeen: string | null };
  location: DistanceBearingResult;
  stale: boolean;
}

export interface RadarSnapshot {
  self: { id: string; name: string; role: Role };
  filter: RadarFilter;
  users: RadarVisibleUser[];
}

export function getVisibleUsersRequest(filter: RadarFilter): Promise<RadarSnapshot> {
  return apiRequest(`/radar/visible-users?filter=${filter}`);
}
