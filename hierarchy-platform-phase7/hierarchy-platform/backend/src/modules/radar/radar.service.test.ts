import { beforeEach, describe, expect, it, vi } from "vitest";

// Same rationale as every other test file in this project (see
// authorization.service.test.ts, presence.service.test.ts,
// location.service.test.ts): mock everything that would otherwise need
// a live Postgres/Redis (this sandbox can't run either — see
// HANDOFF.md's standing binaries.prisma.sh note). This covers
// radar.service.ts's own composition logic — visibility-scope
// filtering, role filtering, discoverability, presence/location
// attachment, staleness — not the real recursive-CTE queries, the real
// Redis reads inside presence/location, or a real HTTP round trip.
vi.mock("../../config/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("../authorization/authorization.service", () => ({
  getVisibilityScope: vi.fn(),
}));
vi.mock("../presence/presence.service", () => ({
  getSnapshotForActor: vi.fn(),
}));
vi.mock("../location/location.service", () => ({
  getDistanceAndBearing: vi.fn(),
}));

import { prisma } from "../../config/prisma";
import { getVisibilityScope } from "../authorization/authorization.service";
import { getDistanceAndBearing } from "../location/location.service";
import { getSnapshotForActor } from "../presence/presence.service";
import type { HierarchyNode } from "../hierarchy/hierarchy.types";
import { RADAR_STALE_LOCATION_SECONDS, getVisibleUsers } from "./radar.service";

const mockFindUnique = vi.mocked(prisma.user.findUnique);
const mockGetVisibilityScope = vi.mocked(getVisibilityScope);
const mockGetSnapshotForActor = vi.mocked(getSnapshotForActor);
const mockGetDistanceAndBearing = vi.mocked(getDistanceAndBearing);

const ACTOR = { id: "actor-1", role: "LEADER", status: "ACTIVE", name: "Actor" };
const ACTOR_TOKEN = { id: "actor-1" } as never;

function node(overrides: Partial<HierarchyNode>): HierarchyNode {
  return {
    id: "id",
    organizationId: "org-1",
    parentId: null,
    name: "Name",
    email: "name@example.com",
    role: "PEER",
    status: "ACTIVE",
    removalReason: null,
    removedBy: null,
    removedBecauseOf: null,
    removedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockGetVisibilityScope.mockReset();
  mockGetSnapshotForActor.mockReset();
  mockGetDistanceAndBearing.mockReset();

  mockFindUnique.mockResolvedValue(ACTOR);
  mockGetSnapshotForActor.mockResolvedValue({
    self: { userId: "actor-1", status: "ONLINE", lastSeen: new Date().toISOString() },
    users: [],
  });
  mockGetDistanceAndBearing.mockResolvedValue({ available: false, reason: "TARGET_LOCATION_UNAVAILABLE" });
});

describe("getVisibleUsers — actor preconditions", () => {
  it("rejects a nonexistent actor without calling getVisibilityScope", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(getVisibleUsers(ACTOR_TOKEN, "ALL")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockGetVisibilityScope).not.toHaveBeenCalled();
  });

  it("rejects a removed actor without calling getVisibilityScope", async () => {
    mockFindUnique.mockResolvedValueOnce({ ...ACTOR, status: "REMOVED" });
    await expect(getVisibleUsers(ACTOR_TOKEN, "ALL")).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(mockGetVisibilityScope).not.toHaveBeenCalled();
  });
});

describe("getVisibleUsers — visibility scope (master spec §16)", () => {
  it("includes the actor's ancestor (parent visibility)", async () => {
    const parent = node({ id: "parent-1", role: "ROOT_LEADER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [parent], descendants: [] });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({ id: "parent-1", relation: "ANCESTOR" });
  });

  it("includes the actor's descendant (descendant visibility)", async () => {
    const child = node({ id: "child-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [child] });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({ id: "child-1", relation: "DESCENDANT" });
  });

  it("never includes anyone outside the returned visibility scope (unrelated branch isolation)", async () => {
    // authorizationService.getVisibilityScope is the single source of
    // truth for who is even a candidate — radar.service.ts adds no
    // authorization logic of its own on top of it. This test confirms
    // radar doesn't, say, also sweep in some other list; the actual
    // cross-branch-denial logic itself is authorization.service.test.ts's
    // job to verify.
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [] });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users).toHaveLength(0);
  });

  it("excludes a removed user even though they're still in the ancestor/descendant chain", async () => {
    const removed = node({ id: "removed-1", role: "PEER", status: "REMOVED" });
    const active = node({ id: "active-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [removed, active] });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users.map((u) => u.id)).toEqual(["active-1"]);
  });
});

describe("getVisibleUsers — role filter (master spec §18)", () => {
  const leader = node({ id: "leader-1", role: "LEADER" });
  const root = node({ id: "root-1", role: "ROOT_LEADER" });
  const peer = node({ id: "peer-1", role: "PEER" });

  beforeEach(() => {
    mockGetVisibilityScope.mockResolvedValue({ ancestors: [root], descendants: [leader, peer] });
  });

  it("LEADERS returns only LEADER and ROOT_LEADER roles", async () => {
    const result = await getVisibleUsers(ACTOR_TOKEN, "LEADERS");
    expect(result.users.map((u) => u.id).sort()).toEqual(["leader-1", "root-1"]);
  });

  it("PEERS returns only PEER role", async () => {
    const result = await getVisibleUsers(ACTOR_TOKEN, "PEERS");
    expect(result.users.map((u) => u.id)).toEqual(["peer-1"]);
  });

  it("ALL returns every role", async () => {
    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");
    expect(result.users.map((u) => u.id).sort()).toEqual(["leader-1", "peer-1", "root-1"]);
  });

  it("defaults filter through in the returned snapshot", async () => {
    const result = await getVisibleUsers(ACTOR_TOKEN, "PEERS");
    expect(result.filter).toBe("PEERS");
    expect(result.self).toMatchObject({ id: "actor-1", role: "LEADER" });
  });
});

describe("getVisibleUsers — presence attachment (master spec §20-22)", () => {
  it("attaches the matching presence entry for a visible user", async () => {
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [peer] });
    mockGetSnapshotForActor.mockResolvedValueOnce({
      self: { userId: "actor-1", status: "ONLINE", lastSeen: "2026-01-01T00:00:00.000Z" },
      users: [{ userId: "peer-1", status: "ONLINE", lastSeen: "2026-01-01T00:00:00.000Z" }],
    });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users[0]?.presence).toEqual({ status: "ONLINE", lastSeen: "2026-01-01T00:00:00.000Z" });
  });

  it("defaults to OFFLINE/null when the user has no presence entry at all", async () => {
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [peer] });
    mockGetSnapshotForActor.mockResolvedValueOnce({
      self: { userId: "actor-1", status: "ONLINE", lastSeen: null },
      users: [],
    });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users[0]?.presence).toEqual({ status: "OFFLINE", lastSeen: null });
  });
});

describe("getVisibleUsers — location + staleness (master spec §17/§19, §39)", () => {
  it("passes through an unavailable location result untouched, and marks it not stale", async () => {
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [peer] });
    mockGetDistanceAndBearing.mockResolvedValueOnce({
      available: false,
      reason: "TARGET_LOCATION_UNAVAILABLE",
    });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users[0]?.location).toEqual({
      available: false,
      reason: "TARGET_LOCATION_UNAVAILABLE",
    });
    expect(result.users[0]?.stale).toBe(false);
  });

  it("marks a fresh reading as not stale", async () => {
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [peer] });
    mockGetDistanceAndBearing.mockResolvedValueOnce({
      available: true,
      distanceMeters: 100,
      bearingDegrees: 45,
      updatedAt: new Date().toISOString(),
    });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users[0]?.stale).toBe(false);
  });

  it("marks a reading older than RADAR_STALE_LOCATION_SECONDS as stale", async () => {
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [peer] });
    const old = new Date(Date.now() - (RADAR_STALE_LOCATION_SECONDS + 5) * 1000).toISOString();
    mockGetDistanceAndBearing.mockResolvedValueOnce({
      available: true,
      distanceMeters: 100,
      bearingDegrees: 45,
      updatedAt: old,
    });

    const result = await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(result.users[0]?.stale).toBe(true);
  });

  it("calls getDistanceAndBearing once per visible candidate with the real actor token", async () => {
    const leader = node({ id: "leader-1", role: "LEADER" });
    const peer = node({ id: "peer-1", role: "PEER" });
    mockGetVisibilityScope.mockResolvedValueOnce({ ancestors: [], descendants: [leader, peer] });

    await getVisibleUsers(ACTOR_TOKEN, "ALL");

    expect(mockGetDistanceAndBearing).toHaveBeenCalledTimes(2);
    expect(mockGetDistanceAndBearing).toHaveBeenCalledWith(ACTOR_TOKEN, "leader-1");
    expect(mockGetDistanceAndBearing).toHaveBeenCalledWith(ACTOR_TOKEN, "peer-1");
  });
});
