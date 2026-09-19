import { beforeEach, describe, expect, it, vi } from "vitest";

// Same rationale as authorization.service.test.ts and
// presence.service.test.ts: mock everything that would otherwise need a
// live Postgres/Redis (this sandbox can't run either — see HANDOFF.md's
// standing binaries.prisma.sh note). This covers p2pService's lease
// lifecycle branching/broadcast logic — when it does/doesn't create,
// renew, delete, and broadcast — not real Redis TTL behavior or the
// real recursive-CTE ancestor query behind INITIATE_P2P_SESSION
// authorization (that's exercised via authorization.service.test.ts's
// own mocked-repository tests, and at the raw-SQL level per
// docs/PHASE2_VERIFICATION.md — not through this file).
vi.mock("../../config/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("../authorization/authorization.service", () => ({
  assertCanPerform: vi.fn(),
}));
vi.mock("./p2p.repository", () => ({
  upsertLease: vi.fn(),
  readLease: vi.fn(),
  deleteLease: vi.fn(),
  listLeasesForUser: vi.fn(),
}));

import { prisma } from "../../config/prisma";
import { assertCanPerform } from "../authorization/authorization.service";
import * as p2pRepo from "./p2p.repository";
import {
  assertActiveLease,
  closeSession,
  p2pEvents,
  renewSession,
  requestSession,
  revokeSessionsForUser,
} from "./p2p.service";
import type { P2PSessionAuthorizedEvent, P2PSessionRevokedEvent } from "./p2p.types";

const mockFindUnique = vi.mocked(prisma.user.findUnique);
const mockAssertCanPerform = vi.mocked(assertCanPerform);
const mockUpsertLease = vi.mocked(p2pRepo.upsertLease);
const mockReadLease = vi.mocked(p2pRepo.readLease);
const mockDeleteLease = vi.mocked(p2pRepo.deleteLease);
const mockListLeasesForUser = vi.mocked(p2pRepo.listLeasesForUser);

const ACTOR = { id: "u1", organizationId: "org1", role: "LEADER" } as never;
const ACTIVE_ACTOR_ROW = { id: "u1", organizationId: "org1", status: "ACTIVE", role: "LEADER" } as never;
const REMOVED_ACTOR_ROW = { id: "u1", organizationId: "org1", status: "REMOVED", role: "LEADER" } as never;
const ACTIVE_TARGET_ROW = { id: "u2", organizationId: "org1", status: "ACTIVE", role: "PEER" } as never;
const REMOVED_TARGET_ROW = { id: "u2", organizationId: "org1", status: "REMOVED", role: "PEER" } as never;
const OTHER_ORG_TARGET_ROW = { id: "u2", organizationId: "org2", status: "ACTIVE", role: "PEER" } as never;

/** Captures every event emitted on a given p2pEvents topic during a test. */
function captureEvents<T>(topic: string): T[] {
  const captured: T[] = [];
  const handler = (e: T) => captured.push(e);
  p2pEvents.on(topic, handler);
  return captured;
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockAssertCanPerform.mockReset();
  mockUpsertLease.mockReset();
  mockReadLease.mockReset();
  mockDeleteLease.mockReset();
  mockListLeasesForUser.mockReset();
  p2pEvents.removeAllListeners("p2p:session-authorized");
  p2pEvents.removeAllListeners("p2p:session-revoked");

  // Default: authorization passes unless a test overrides it.
  mockAssertCanPerform.mockResolvedValue(undefined);
});

describe("requestSession", () => {
  it("throws USER_INACTIVE and never touches Redis for a removed actor", async () => {
    mockFindUnique.mockResolvedValueOnce(REMOVED_ACTOR_ROW);
    await expect(requestSession(ACTOR, "u2")).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(mockUpsertLease).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED when the actor no longer exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(requestSession(ACTOR, "u2")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws FORBIDDEN when targeting yourself, before any DB lookup of a target", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW);
    await expect(requestSession(ACTOR, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Only the actor lookup happened — no second findUnique for a target.
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it("throws NODE_NOT_FOUND when the target doesn't exist", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(null);
    await expect(requestSession(ACTOR, "ghost")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });

  it("throws NODE_NOT_FOUND when the target belongs to a different organization", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(OTHER_ORG_TARGET_ROW);
    await expect(requestSession(ACTOR, "u2")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" });
  });

  it("throws USER_INACTIVE when the target is not currently active", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(REMOVED_TARGET_ROW);
    await expect(requestSession(ACTOR, "u2")).rejects.toMatchObject({ code: "USER_INACTIVE" });
  });

  it("propagates FORBIDDEN from the authorization check and never writes a lease", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(ACTIVE_TARGET_ROW);
    mockAssertCanPerform.mockRejectedValueOnce(
      Object.assign(new Error("not authorized"), { code: "FORBIDDEN" })
    );
    await expect(requestSession(ACTOR, "u2")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpsertLease).not.toHaveBeenCalled();
  });

  it("creates a lease and broadcasts p2p:session-authorized on success", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(ACTIVE_TARGET_ROW);
    mockUpsertLease.mockResolvedValueOnce({
      userA: "u1",
      userB: "u2",
      initiatedBy: "u1",
      createdAt: "t0",
      renewedAt: "t0",
      expiresAt: "t0-plus-45s",
    });

    const events = captureEvents<P2PSessionAuthorizedEvent>("p2p:session-authorized");
    const result = await requestSession(ACTOR, "u2");

    expect(mockUpsertLease).toHaveBeenCalledWith("u1", "u2", "u1");
    expect(result).toEqual({ leaseId: "u1:u2", expiresAt: "t0-plus-45s" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userA: "u1", userB: "u2", initiatedBy: "u1", leaseId: "u1:u2" });
  });
});

describe("renewSession", () => {
  it("throws LEASE_EXPIRED when no lease currently exists, even though authorization otherwise passes", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(ACTIVE_TARGET_ROW);
    mockReadLease.mockResolvedValueOnce(null);

    await expect(renewSession(ACTOR, "u2")).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
    expect(mockUpsertLease).not.toHaveBeenCalled();
  });

  it("blocks renewal once the counterpart is no longer ACTIVE — the actual revocation-by-non-renewal mechanism", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(REMOVED_TARGET_ROW);
    await expect(renewSession(ACTOR, "u2")).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(mockReadLease).not.toHaveBeenCalled();
    expect(mockUpsertLease).not.toHaveBeenCalled();
  });

  it("renews an existing lease, preserving the original initiatedBy, and does not broadcast", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW).mockResolvedValueOnce(ACTIVE_TARGET_ROW);
    mockReadLease.mockResolvedValueOnce({
      userA: "u1",
      userB: "u2",
      initiatedBy: "u2", // the OTHER participant originally requested it
      createdAt: "t0",
      renewedAt: "t0",
      expiresAt: "t0-plus-45s",
    });
    mockUpsertLease.mockResolvedValueOnce({
      userA: "u1",
      userB: "u2",
      initiatedBy: "u2",
      createdAt: "t0",
      renewedAt: "t1",
      expiresAt: "t1-plus-45s",
    });

    const events = captureEvents("p2p:session-authorized");
    const result = await renewSession(ACTOR, "u2");

    expect(mockUpsertLease).toHaveBeenCalledWith("u1", "u2", "u2");
    expect(result).toEqual({ leaseId: "u1:u2", expiresAt: "t1-plus-45s" });
    expect(events).toHaveLength(0);
  });
});

describe("closeSession", () => {
  it("throws FORBIDDEN when closing a session with yourself", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW);
    await expect(closeSession(ACTOR, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is a silent no-op when no lease exists — not an error", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW);
    mockReadLease.mockResolvedValueOnce(null);

    const events = captureEvents("p2p:session-revoked");
    await expect(closeSession(ACTOR, "u2")).resolves.toBeUndefined();

    expect(mockDeleteLease).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("deletes the lease and broadcasts CLOSED_BY_PARTICIPANT", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_ACTOR_ROW);
    mockReadLease.mockResolvedValueOnce({
      userA: "u1",
      userB: "u2",
      initiatedBy: "u1",
      createdAt: "t0",
      renewedAt: "t0",
      expiresAt: "t0-plus-45s",
    });

    const events = captureEvents<P2PSessionRevokedEvent>("p2p:session-revoked");
    await closeSession(ACTOR, "u2");

    expect(mockDeleteLease).toHaveBeenCalledWith("u1", "u2");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userA: "u1", userB: "u2", reason: "CLOSED_BY_PARTICIPANT", revokedBy: "u1" });
  });
});

describe("assertActiveLease", () => {
  it("throws LEASE_EXPIRED when no lease exists", async () => {
    mockReadLease.mockResolvedValueOnce(null);
    await expect(assertActiveLease("u1", "u2")).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
  });

  it("resolves without error when a lease exists", async () => {
    mockReadLease.mockResolvedValueOnce({
      userA: "u1",
      userB: "u2",
      initiatedBy: "u1",
      createdAt: "t0",
      renewedAt: "t0",
      expiresAt: "t0-plus-45s",
    });
    await expect(assertActiveLease("u1", "u2")).resolves.toBeUndefined();
  });
});

describe("revokeSessionsForUser", () => {
  it("does nothing when the user holds no leases", async () => {
    mockListLeasesForUser.mockResolvedValueOnce([]);
    const events = captureEvents("p2p:session-revoked");

    await revokeSessionsForUser("u1");

    expect(mockDeleteLease).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("deletes every held lease and broadcasts NODE_REMOVED for each", async () => {
    mockListLeasesForUser.mockResolvedValueOnce([
      { userA: "u1", userB: "u2", initiatedBy: "u1", createdAt: "t0", renewedAt: "t0", expiresAt: "e0" },
      { userA: "u1", userB: "u3", initiatedBy: "u3", createdAt: "t0", renewedAt: "t0", expiresAt: "e0" },
    ]);

    const events = captureEvents<P2PSessionRevokedEvent>("p2p:session-revoked");
    await revokeSessionsForUser("u1");

    expect(mockDeleteLease).toHaveBeenCalledWith("u1", "u2");
    expect(mockDeleteLease).toHaveBeenCalledWith("u1", "u3");
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.reason === "NODE_REMOVED" && e.revokedBy === "u1")).toBe(true);
  });
});
