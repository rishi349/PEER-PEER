import { beforeEach, describe, expect, it, vi } from "vitest";

// Same rationale as authorization.service.test.ts: mock everything that
// would otherwise need a live Postgres/Redis (this sandbox can't run
// either — see HANDOFF.md's standing binaries.prisma.sh note). This
// covers presenceService's transition logic — when it does/doesn't
// write, delete, and broadcast — not the real Redis TTL/keyspace
// behavior or the real recursive-CTE ancestor/descendant queries
// (those are exercised at the SQL level separately, per
// docs/PHASE2_VERIFICATION.md, and not through this test file).
vi.mock("../../config/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("../authorization/authorization.service", () => ({
  getVisibilityScope: vi.fn(),
}));
vi.mock("./presence.repository", () => ({
  writeRecord: vi.fn(),
  readRecord: vi.fn(),
  readMany: vi.fn(),
  deleteRecord: vi.fn(),
  addSocket: vi.fn(),
  removeSocket: vi.fn(),
}));

import { prisma } from "../../config/prisma";
import { getVisibilityScope } from "../authorization/authorization.service";
import * as presenceRepo from "./presence.repository";
import {
  getSnapshotForActor,
  handleConnect,
  handleDisconnect,
  handleHeartbeat,
  handleTTLExpiry,
  presenceEvents,
} from "./presence.service";
import type { PresenceChangedEvent } from "./presence.types";

const mockFindUnique = vi.mocked(prisma.user.findUnique);
const mockGetVisibilityScope = vi.mocked(getVisibilityScope);
const mockWriteRecord = vi.mocked(presenceRepo.writeRecord);
const mockReadRecord = vi.mocked(presenceRepo.readRecord);
const mockReadMany = vi.mocked(presenceRepo.readMany);
const mockDeleteRecord = vi.mocked(presenceRepo.deleteRecord);
const mockAddSocket = vi.mocked(presenceRepo.addSocket);
const mockRemoveSocket = vi.mocked(presenceRepo.removeSocket);

const ACTIVE_USER = { id: "u1", status: "ACTIVE" } as never;
const REMOVED_USER = { id: "u1", status: "REMOVED" } as never;

/** Captures every "presence:changed" event emitted during a test. */
function captureEvents(): PresenceChangedEvent[] {
  const captured: PresenceChangedEvent[] = [];
  const handler = (e: PresenceChangedEvent) => captured.push(e);
  presenceEvents.on("presence:changed", handler);
  return captured;
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockGetVisibilityScope.mockReset();
  mockWriteRecord.mockReset();
  mockReadRecord.mockReset();
  mockReadMany.mockReset();
  mockDeleteRecord.mockReset();
  mockAddSocket.mockReset();
  mockRemoveSocket.mockReset();
  presenceEvents.removeAllListeners("presence:changed");

  // Default: empty scope unless a test overrides it.
  mockGetVisibilityScope.mockResolvedValue({ ancestors: [], descendants: [] });
});

describe("handleConnect", () => {
  it("throws USER_INACTIVE and never touches presence state for a removed actor", async () => {
    mockFindUnique.mockResolvedValueOnce(REMOVED_USER);

    await expect(handleConnect("u1", "socket-1")).rejects.toMatchObject({ code: "USER_INACTIVE" });
    expect(mockAddSocket).not.toHaveBeenCalled();
    expect(mockWriteRecord).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED when the actor no longer exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(handleConnect("ghost", "socket-1")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("broadcasts ONLINE on a first connection (no prior record)", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockReadRecord.mockResolvedValueOnce(null);
    mockWriteRecord.mockResolvedValueOnce({ status: "ONLINE", lastSeen: "2026-08-19T00:00:00.000Z" });

    const events = captureEvents();
    await handleConnect("u1", "socket-1");

    expect(mockAddSocket).toHaveBeenCalledWith("u1", "socket-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u1", status: "ONLINE" });
    expect(events[0]?.audience).toContain("u1");
  });

  it("broadcasts ONLINE when the previous record was OFFLINE-equivalent (expired/never seen as ONLINE)", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockReadRecord.mockResolvedValueOnce(JSON.stringify({ status: "OFFLINE", lastSeen: "x" }));
    mockWriteRecord.mockResolvedValueOnce({ status: "ONLINE", lastSeen: "2026-08-19T00:00:00.000Z" });

    const events = captureEvents();
    await handleConnect("u1", "socket-1");

    expect(events).toHaveLength(1);
  });

  it("does NOT broadcast when a second device connects while already ONLINE", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockReadRecord.mockResolvedValueOnce(JSON.stringify({ status: "ONLINE", lastSeen: "x" }));
    mockWriteRecord.mockResolvedValueOnce({ status: "ONLINE", lastSeen: "2026-08-19T00:00:00.000Z" });

    const events = captureEvents();
    await handleConnect("u1", "socket-2");

    expect(mockAddSocket).toHaveBeenCalledWith("u1", "socket-2");
    expect(events).toHaveLength(0);
  });

  it("includes the actor's ancestors and descendants in the broadcast audience", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockReadRecord.mockResolvedValueOnce(null);
    mockWriteRecord.mockResolvedValueOnce({ status: "ONLINE", lastSeen: "t" });
    mockGetVisibilityScope.mockResolvedValueOnce({
      ancestors: [{ id: "root" }, { id: "leaderA" }] as never,
      descendants: [{ id: "peer1" }] as never,
    });

    const events = captureEvents();
    await handleConnect("u1", "socket-1");

    expect(events[0]?.audience.sort()).toEqual(["leaderA", "peer1", "root", "u1"].sort());
  });
});

describe("handleHeartbeat", () => {
  it("only renews the Redis record — no DB check, no broadcast", async () => {
    const events = captureEvents();
    await handleHeartbeat("u1");

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockWriteRecord).toHaveBeenCalledWith("u1", "ONLINE");
    expect(events).toHaveLength(0);
  });
});

describe("handleDisconnect", () => {
  it("does nothing when other sockets for the user remain", async () => {
    mockRemoveSocket.mockResolvedValueOnce(1);
    const events = captureEvents();

    await handleDisconnect("u1", "socket-1");

    expect(mockDeleteRecord).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("deletes the record and broadcasts OFFLINE once the last socket disconnects", async () => {
    mockRemoveSocket.mockResolvedValueOnce(0);
    const events = captureEvents();

    await handleDisconnect("u1", "socket-1");

    expect(mockDeleteRecord).toHaveBeenCalledWith("u1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u1", status: "OFFLINE" });
  });
});

describe("handleTTLExpiry", () => {
  it("always broadcasts OFFLINE (Redis has already dropped the key)", async () => {
    const events = captureEvents();
    await handleTTLExpiry("u1");

    expect(mockDeleteRecord).not.toHaveBeenCalled(); // nothing left to delete
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "u1", status: "OFFLINE" });
  });
});

describe("getSnapshotForActor", () => {
  it("returns OFFLINE with null lastSeen for anyone with no Redis record", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockGetVisibilityScope.mockResolvedValueOnce({
      ancestors: [{ id: "root" }] as never,
      descendants: [{ id: "peer1" }] as never,
    });
    mockReadRecord.mockResolvedValueOnce(null); // self
    mockReadMany.mockResolvedValueOnce([null, null]); // root, peer1

    const snapshot = await getSnapshotForActor({ id: "u1", organizationId: "org1", role: "LEADER" } as never);

    expect(snapshot.self).toEqual({ userId: "u1", status: "OFFLINE", lastSeen: null });
    expect(snapshot.users).toEqual([
      { userId: "root", status: "OFFLINE", lastSeen: null },
      { userId: "peer1", status: "OFFLINE", lastSeen: null },
    ]);
  });

  it("parses ONLINE records correctly and mixes them with OFFLINE ones", async () => {
    mockFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    mockGetVisibilityScope.mockResolvedValueOnce({
      ancestors: [{ id: "root" }] as never,
      descendants: [] as never,
    });
    mockReadRecord.mockResolvedValueOnce(JSON.stringify({ status: "ONLINE", lastSeen: "2026-08-19T00:00:00.000Z" }));
    mockReadMany.mockResolvedValueOnce([null]);

    const snapshot = await getSnapshotForActor({ id: "u1", organizationId: "org1", role: "LEADER" } as never);

    expect(snapshot.self).toEqual({
      userId: "u1",
      status: "ONLINE",
      lastSeen: "2026-08-19T00:00:00.000Z",
    });
    expect(snapshot.users).toEqual([{ userId: "root", status: "OFFLINE", lastSeen: null }]);
  });

  it("throws USER_INACTIVE for a removed actor rather than returning stale presence", async () => {
    mockFindUnique.mockResolvedValueOnce(REMOVED_USER);
    await expect(
      getSnapshotForActor({ id: "u1", organizationId: "org1", role: "LEADER" } as never)
    ).rejects.toMatchObject({ code: "USER_INACTIVE" });
  });
});
