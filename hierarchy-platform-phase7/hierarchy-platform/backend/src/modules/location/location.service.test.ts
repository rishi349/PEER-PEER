import { beforeEach, describe, expect, it, vi } from "vitest";

// Same rationale as presence.service.test.ts / p2p.service.test.ts: mock
// everything that would otherwise need a live Postgres/Redis (this
// sandbox can't run either — see HANDOFF.md's standing binaries.prisma.sh
// note). This covers locationService's opt-in gating, preference
// read/write, and authorization/availability branching — not real Redis
// TTL behavior or the real recursive-CTE ancestor/descendant queries
// behind getVisibilityScope (those are exercised elsewhere — see
// docs/PHASE2_VERIFICATION.md and authorization.service.test.ts).
vi.mock("../../config/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("../authorization/authorization.service", () => ({
  getVisibilityScope: vi.fn(),
}));
vi.mock("./location.repository", () => ({
  writeLocation: vi.fn(),
  readLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

import { prisma } from "../../config/prisma";
import { getVisibilityScope } from "../authorization/authorization.service";
import * as locationRepo from "./location.repository";
import {
  getDistanceAndBearing,
  getSharingEnabled,
  setSharingEnabled,
  updateLocation,
} from "./location.service";

const mockFindUnique = vi.mocked(prisma.user.findUnique);
const mockUpdate = vi.mocked(prisma.user.update);
const mockGetVisibilityScope = vi.mocked(getVisibilityScope);
const mockWriteLocation = vi.mocked(locationRepo.writeLocation);
const mockReadLocation = vi.mocked(locationRepo.readLocation);
const mockDeleteLocation = vi.mocked(locationRepo.deleteLocation);

const ACTOR = { id: "u1", organizationId: "org1", role: "LEADER" } as never;

const ACTIVE_SHARING_ON = {
  id: "u1",
  organizationId: "org1",
  status: "ACTIVE",
  role: "LEADER",
  locationSharingEnabled: true,
} as never;
const ACTIVE_SHARING_OFF = {
  id: "u1",
  organizationId: "org1",
  status: "ACTIVE",
  role: "LEADER",
  locationSharingEnabled: false,
} as never;
const REMOVED_ACTOR_ROW = {
  id: "u1",
  organizationId: "org1",
  status: "REMOVED",
  role: "LEADER",
  locationSharingEnabled: true,
} as never;

const TARGET_SHARING_ON = {
  id: "u2",
  organizationId: "org1",
  status: "ACTIVE",
  role: "PEER",
  locationSharingEnabled: true,
} as never;
const TARGET_SHARING_OFF = {
  id: "u2",
  organizationId: "org1",
  status: "ACTIVE",
  role: "PEER",
  locationSharingEnabled: false,
} as never;
const REMOVED_TARGET_ROW = {
  id: "u2",
  organizationId: "org1",
  status: "REMOVED",
  role: "PEER",
  locationSharingEnabled: true,
} as never;
const OTHER_ORG_TARGET_ROW = {
  id: "u2",
  organizationId: "org2",
  status: "ACTIVE",
  role: "PEER",
  locationSharingEnabled: true,
} as never;

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockGetVisibilityScope.mockReset();
  mockWriteLocation.mockReset();
  mockReadLocation.mockReset();
  mockDeleteLocation.mockReset();

  // Default: target is within scope unless a test overrides it.
  mockGetVisibilityScope.mockResolvedValue({ ancestors: [], descendants: [{ id: "u2" }] } as never);
});

describe("updateLocation", () => {
  it("throws USER_INACTIVE for a removed actor and never writes to Redis", async () => {
    mockFindUnique.mockResolvedValueOnce(REMOVED_ACTOR_ROW);
    await expect(updateLocation(ACTOR, { latitude: 1, longitude: 1 })).rejects.toMatchObject({
      code: "USER_INACTIVE",
    });
    expect(mockWriteLocation).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED when the actor no longer exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(updateLocation(ACTOR, { latitude: 1, longitude: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws LOCATION_SHARING_DISABLED when the actor has not opted in — defense in depth against a client that ignores the toggle", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_OFF);
    await expect(updateLocation(ACTOR, { latitude: 1, longitude: 1 })).rejects.toMatchObject({
      code: "LOCATION_SHARING_DISABLED",
    });
    expect(mockWriteLocation).not.toHaveBeenCalled();
  });

  it("writes the reading and returns updatedAt when sharing is enabled", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON);
    mockWriteLocation.mockResolvedValueOnce({
      latitude: 1,
      longitude: 1,
      accuracy: null,
      updatedAt: "2026-08-23T00:00:00.000Z",
    });

    const result = await updateLocation(ACTOR, { latitude: 1, longitude: 1 });

    expect(mockWriteLocation).toHaveBeenCalledWith("u1", { latitude: 1, longitude: 1 });
    expect(result).toEqual({ updatedAt: "2026-08-23T00:00:00.000Z" });
  });
});

describe("setSharingEnabled", () => {
  it("persists the preference to Postgres", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_OFF);
    await setSharingEnabled(ACTOR, true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { locationSharingEnabled: true },
    });
  });

  it("does not touch Redis when turning sharing on", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_OFF);
    await setSharingEnabled(ACTOR, true);
    expect(mockDeleteLocation).not.toHaveBeenCalled();
  });

  it("proactively deletes any Redis reading when turning sharing off", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON);
    const result = await setSharingEnabled(ACTOR, false);
    expect(mockDeleteLocation).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ enabled: false });
  });
});

describe("getSharingEnabled", () => {
  it("reflects the fresh Postgres value, not a cached/stale one", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON);
    await expect(getSharingEnabled(ACTOR)).resolves.toEqual({ enabled: true });
  });
});

describe("getDistanceAndBearing", () => {
  it("throws FORBIDDEN when querying yourself, before any target lookup", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON);
    await expect(getDistanceAndBearing(ACTOR, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it("throws NODE_NOT_FOUND when the target doesn't exist", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(null);
    await expect(getDistanceAndBearing(ACTOR, "ghost")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });

  it("throws NODE_NOT_FOUND when the target belongs to a different organization", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(OTHER_ORG_TARGET_ROW);
    await expect(getDistanceAndBearing(ACTOR, "u2")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });

  it("throws USER_INACTIVE when the target is not currently active", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(REMOVED_TARGET_ROW);
    await expect(getDistanceAndBearing(ACTOR, "u2")).rejects.toMatchObject({ code: "USER_INACTIVE" });
  });

  it("throws FORBIDDEN when the target is outside the requester's visibility scope — cross-branch isolation", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(TARGET_SHARING_ON);
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [] } as never);
    await expect(getDistanceAndBearing(ACTOR, "u2")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockReadLocation).not.toHaveBeenCalled();
  });

  it("returns TARGET_LOCATION_UNAVAILABLE (not an error) when the target has sharing turned off — never distinguished from 'no reading'", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(TARGET_SHARING_OFF);
    const result = await getDistanceAndBearing(ACTOR, "u2");
    expect(result).toEqual({ available: false, reason: "TARGET_LOCATION_UNAVAILABLE" });
    // Sharing is off for the target — this must be checked before ever
    // touching Redis for their reading (defense in depth, mirrors the
    // deleteLocation-on-opt-out cleanup in location.repository.ts).
    expect(mockReadLocation).not.toHaveBeenCalled();
  });

  it("returns TARGET_LOCATION_UNAVAILABLE when sharing is on but no Redis reading exists (e.g. TTL-expired)", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(TARGET_SHARING_ON);
    mockReadLocation.mockResolvedValueOnce(null); // target's reading
    const result = await getDistanceAndBearing(ACTOR, "u2");
    expect(result).toEqual({ available: false, reason: "TARGET_LOCATION_UNAVAILABLE" });
  });

  it("returns REQUESTER_LOCATION_UNAVAILABLE when the target has a reading but the requester doesn't", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(TARGET_SHARING_ON);
    mockReadLocation
      .mockResolvedValueOnce({ latitude: 1, longitude: 1, accuracy: null, updatedAt: "t0" }) // target
      .mockResolvedValueOnce(null); // requester
    const result = await getDistanceAndBearing(ACTOR, "u2");
    expect(result).toEqual({ available: false, reason: "REQUESTER_LOCATION_UNAVAILABLE" });
  });

  it("computes distance and bearing, and returns the target's raw coordinates to nobody", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_SHARING_ON).mockResolvedValueOnce(TARGET_SHARING_ON);
    mockReadLocation
      .mockResolvedValueOnce({ latitude: 1, longitude: 0, accuracy: null, updatedAt: "target-t0" }) // target
      .mockResolvedValueOnce({ latitude: 0, longitude: 0, accuracy: null, updatedAt: "requester-t0" }); // requester

    const result = await getDistanceAndBearing(ACTOR, "u2");

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.distanceMeters).toBeCloseTo(111_194.9, 0);
      expect(result.bearingDegrees).toBeCloseTo(0, 4); // target is due north
      expect(result.updatedAt).toBe("target-t0");
    }
    expect(JSON.stringify(result)).not.toContain("latitude");
    expect(JSON.stringify(result)).not.toContain("longitude");
  });
});
