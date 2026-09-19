import { beforeEach, describe, expect, it, vi } from "vitest";

// hierarchy.repository.ts imports the real @prisma/client + a live
// PrismaClient instance at runtime. Mocking it out means these tests
// exercise pure canPerform logic without needing a running Postgres or
// a generated Prisma client — see the sandbox's standing
// binaries.prisma.sh network restriction noted throughout HANDOFF.md.
// This covers the actor-role and ownership-chain logic only; it is not
// a substitute for running master spec §46's full authorization suite
// against a real database once one is available.
vi.mock("../hierarchy/hierarchy.repository", () => ({
  getAncestors: vi.fn(),
  getDescendants: vi.fn(),
}));

import { getAncestors } from "../hierarchy/hierarchy.repository";
import { canPerform } from "./authorization.service";

const mockGetAncestors = vi.mocked(getAncestors);

beforeEach(() => {
  mockGetAncestors.mockReset();
});

describe("canPerform — CREATE_LEADER / CREATE_PEER (role rules)", () => {
  it("ROOT_LEADER can create a LEADER", async () => {
    expect(await canPerform({ id: "root", role: "ROOT_LEADER" }, "CREATE_LEADER")).toBe(true);
  });

  it("ROOT_LEADER can create a PEER", async () => {
    expect(await canPerform({ id: "root", role: "ROOT_LEADER" }, "CREATE_PEER")).toBe(true);
  });

  it("LEADER can create a nested LEADER (master spec §3 example)", async () => {
    expect(await canPerform({ id: "b", role: "LEADER" }, "CREATE_LEADER")).toBe(true);
  });

  it("LEADER can create a PEER", async () => {
    expect(await canPerform({ id: "b", role: "LEADER" }, "CREATE_PEER")).toBe(true);
  });

  it("PEER cannot create a LEADER (privilege escalation)", async () => {
    expect(await canPerform({ id: "p1", role: "PEER" }, "CREATE_LEADER")).toBe(false);
  });

  it("PEER cannot create a PEER", async () => {
    expect(await canPerform({ id: "p1", role: "PEER" }, "CREATE_PEER")).toBe(false);
  });
});

describe("canPerform — REMOVE_NODE (ownership)", () => {
  it("denies removal with no target", async () => {
    expect(await canPerform({ id: "a", role: "ROOT_LEADER" }, "REMOVE_NODE")).toBe(false);
    expect(mockGetAncestors).not.toHaveBeenCalled();
  });

  it("denies removing yourself", async () => {
    const actor = { id: "a", role: "ROOT_LEADER" as const };
    expect(await canPerform(actor, "REMOVE_NODE", { id: "a", role: "ROOT_LEADER" })).toBe(false);
    expect(mockGetAncestors).not.toHaveBeenCalled();
  });

  it("denies removing the ROOT_LEADER, even by an ancestor-less actor", async () => {
    const actor = { id: "a", role: "ROOT_LEADER" as const };
    expect(
      await canPerform(actor, "REMOVE_NODE", { id: "root-2", role: "ROOT_LEADER" })
    ).toBe(false);
    expect(mockGetAncestors).not.toHaveBeenCalled();
  });

  it("allows removal when the actor is an ancestor of the target", async () => {
    // getAncestors is nearest-parent-first, matching hierarchy.repository's real contract.
    mockGetAncestors.mockResolvedValueOnce([
      { id: "b", role: "LEADER" },
      { id: "a", role: "ROOT_LEADER" },
    ] as never);

    expect(
      await canPerform({ id: "a", role: "ROOT_LEADER" }, "REMOVE_NODE", { id: "p1", role: "PEER" })
    ).toBe(true);
  });

  it("denies removal across unrelated branches (master spec §16 branch isolation)", async () => {
    // A ├ B ├ nothing;  A ├ C ├ P3 — B tries to remove P3, which is C's, not B's.
    mockGetAncestors.mockResolvedValueOnce([
      { id: "c", role: "LEADER" },
      { id: "a", role: "ROOT_LEADER" },
    ] as never);

    expect(
      await canPerform({ id: "b", role: "LEADER" }, "REMOVE_NODE", { id: "p3", role: "PEER" })
    ).toBe(false);
  });
});

describe("canPerform — REACTIVATE_NODE (ownership)", () => {
  it("denies reactivation with no target", async () => {
    expect(await canPerform({ id: "a", role: "ROOT_LEADER" }, "REACTIVATE_NODE")).toBe(false);
  });

  it("allows reactivation when the actor is an ancestor of the target", async () => {
    mockGetAncestors.mockResolvedValueOnce([{ id: "a", role: "ROOT_LEADER" }] as never);
    expect(
      await canPerform({ id: "a", role: "ROOT_LEADER" }, "REACTIVATE_NODE", {
        id: "b",
        role: "LEADER",
      })
    ).toBe(true);
  });

  it("denies reactivation across unrelated branches", async () => {
    mockGetAncestors.mockResolvedValueOnce([{ id: "a", role: "ROOT_LEADER" }] as never);
    expect(
      await canPerform({ id: "d", role: "LEADER" }, "REACTIVATE_NODE", {
        id: "p1",
        role: "PEER",
      })
    ).toBe(false);
  });
});

describe("canPerform — VIEW_VISIBILITY_SCOPE", () => {
  it("is always allowed for an authenticated actor", async () => {
    expect(await canPerform({ id: "p1", role: "PEER" }, "VIEW_VISIBILITY_SCOPE")).toBe(true);
  });
});

describe("canPerform — INITIATE_P2P_SESSION (Phase 5, symmetric ownership)", () => {
  it("denies a session with no target, without calling getAncestors", async () => {
    expect(await canPerform({ id: "a", role: "ROOT_LEADER" }, "INITIATE_P2P_SESSION")).toBe(false);
    expect(mockGetAncestors).not.toHaveBeenCalled();
  });

  it("denies a session with yourself, without calling getAncestors", async () => {
    expect(
      await canPerform({ id: "a", role: "ROOT_LEADER" }, "INITIATE_P2P_SESSION", { id: "a", role: "ROOT_LEADER" })
    ).toBe(false);
    expect(mockGetAncestors).not.toHaveBeenCalled();
  });

  it("allows a session when the actor is an ancestor of the target (leader -> own peer)", async () => {
    // First getAncestors call resolves the target's ancestor chain
    // (isAncestorOf(actor, target)); second resolves the actor's own
    // chain (isAncestorOf(target, actor)) — canPerform's INITIATE_P2P_SESSION
    // case runs both directions via Promise.all, in that array order.
    mockGetAncestors
      .mockResolvedValueOnce([{ id: "b", role: "LEADER" }, { id: "a", role: "ROOT_LEADER" }] as never) // p1's ancestors
      .mockResolvedValueOnce([{ id: "a", role: "ROOT_LEADER" }] as never); // b's ancestors

    expect(
      await canPerform({ id: "b", role: "LEADER" }, "INITIATE_P2P_SESSION", { id: "p1", role: "PEER" })
    ).toBe(true);
  });

  it("allows a session when the actor is a descendant of the target (peer -> own leader)", async () => {
    mockGetAncestors
      .mockResolvedValueOnce([{ id: "a", role: "ROOT_LEADER" }] as never) // b's ancestors — doesn't contain p1
      .mockResolvedValueOnce([{ id: "b", role: "LEADER" }, { id: "a", role: "ROOT_LEADER" }] as never); // p1's ancestors — contains b

    expect(
      await canPerform({ id: "p1", role: "PEER" }, "INITIATE_P2P_SESSION", { id: "b", role: "LEADER" })
    ).toBe(true);
  });

  it("denies a session across unrelated branches (master spec §16 branch isolation, same as REMOVE_NODE)", async () => {
    // A ├ B; A ├ C ├ P3 — B tries to start a P2P session with P3, which is C's descendant, not B's.
    mockGetAncestors
      .mockResolvedValueOnce([{ id: "c", role: "LEADER" }, { id: "a", role: "ROOT_LEADER" }] as never) // p3's ancestors
      .mockResolvedValueOnce([{ id: "a", role: "ROOT_LEADER" }] as never); // b's ancestors

    expect(
      await canPerform({ id: "b", role: "LEADER" }, "INITIATE_P2P_SESSION", { id: "p3", role: "PEER" })
    ).toBe(false);
  });
});
