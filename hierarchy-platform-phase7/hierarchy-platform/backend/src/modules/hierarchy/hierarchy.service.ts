import { EventEmitter } from "node:events";
import bcrypt from "bcrypt";
import type { Prisma, Role, User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as authorizationService from "../authorization/authorization.service";
import * as hierarchyRepo from "./hierarchy.repository";
import type { CreateMemberInput } from "./hierarchy.schemas";
import type { HierarchyNode, HierarchyNodesRemovedEvent } from "./hierarchy.types";

const PASSWORD_SALT_ROUNDS = 12;

/**
 * Emits `"hierarchy:nodes-removed"` once removeNode's transaction below
 * commits successfully — added in Phase 5 so other modules (starting
 * with p2p.service.ts's session revocation, master spec §26) can react
 * to a removal without this module importing anything about Socket.IO,
 * Redis, or P2P. Plain EventEmitter, not Socket.IO — same decoupling
 * pattern presence.service.ts established in Phase 4 for
 * `presenceEvents` (see HANDOFF §6). This module never subscribes to
 * its own emitter and never imports p2p — the subscription lives
 * entirely in p2p.gateway.ts, which is the one file that knows about
 * both hierarchy removal and Socket.IO.
 */
export const hierarchyEvents = new EventEmitter();

// Phase 3: role-creation rules and ownership checks now live in
// authorization.service.ts's canPerform/assertCanPerform (master spec
// §15) instead of being inlined here. This module still owns the
// domain-level preconditions (target exists, target isn't already in
// the state you're asking for, target isn't the actor) — those aren't
// "who is allowed" questions, they're "does this operation even make
// sense" questions, so they stay here rather than in the policy module.

function toNodePublic(u: {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  email: string;
  role: Role;
  status: HierarchyNode["status"];
  removalReason: HierarchyNode["removalReason"];
  removedBy: string | null;
  removedBecauseOf: string | null;
  removedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    organizationId: u.organizationId,
    parentId: u.parentId,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    removalReason: u.removalReason,
    removedBy: u.removedBy,
    removedBecauseOf: u.removedBecauseOf,
    removedAt: u.removedAt,
    createdAt: u.createdAt,
  };
}

// Re-reads the actor from Postgres rather than trusting the access
// token's claims — a token minted minutes ago can't reflect a removal
// that happened since (master spec §15).
async function requireActiveActor(actorId: string): Promise<User> {
  const actor = await prisma.user.findUnique({ where: { id: actorId } });
  if (!actor) {
    throw new AppError("UNAUTHORIZED", "Actor no longer exists");
  }
  if (actor.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This account is no longer active");
  }
  return actor;
}

export async function createMember(
  actor: AuthenticatedUser,
  role: "LEADER" | "PEER",
  input: CreateMemberInput
) {
  const freshActor = await requireActiveActor(actor.id);

  await authorizationService.assertCanPerform(
    freshActor,
    role === "LEADER" ? "CREATE_LEADER" : "CREATE_PEER",
    undefined,
    `${freshActor.role} cannot create a ${role}`
  );

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("ALREADY_EXISTS", "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({
      data: {
        organizationId: freshActor.organizationId,
        parentId: freshActor.id,
        name: input.name,
        email: input.email,
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });

    await tx.hierarchyEvent.create({
      data: {
        organizationId: freshActor.organizationId,
        type: "NODE_CREATED",
        actorId: freshActor.id,
        targetId: user.id,
        metadata: { role },
      },
    });

    return user;
  });

  return toNodePublic(created);
}

/** The caller's own subgroup: themselves plus every descendant. */
export async function getMySubtree(actor: AuthenticatedUser) {
  const freshActor = await requireActiveActor(actor.id);
  const descendants = await hierarchyRepo.getDescendants(freshActor.id);
  return {
    root: toNodePublic(freshActor),
    members: descendants.map(toNodePublic),
  };
}

/** The caller's ancestor chain, nearest parent first, up to the org root. */
export async function getMyAncestors(actor: AuthenticatedUser) {
  const freshActor = await requireActiveActor(actor.id);
  const ancestors = await hierarchyRepo.getAncestors(freshActor.id);
  return ancestors.map(toNodePublic);
}

/**
 * Phase 3: the actor's full authorized visibility scope, per master spec
 * §16 — direct ancestor chain (upward coordination) plus the actor's own
 * subgroup (downward coordination), nothing from unrelated branches.
 * Replaces the Phase 2 ROOT_LEADER-only role gate that used to sit here
 * (see HANDOFF §4/§7): every active user can call this now, not just the
 * root. For a ROOT_LEADER it still resolves to the whole organization,
 * because everyone descends from the root — that falls out of the
 * ancestor-chain/descendant-subtree logic itself, not a role check.
 */
export async function getVisibilityScope(actor: AuthenticatedUser) {
  const freshActor = await requireActiveActor(actor.id);
  const { ancestors, descendants } = await authorizationService.getVisibilityScope(freshActor);
  return {
    self: toNodePublic(freshActor),
    ancestors: ancestors.map(toNodePublic),
    descendants: descendants.map(toNodePublic),
  };
}

/**
 * Cascading removal — master spec §6-9. Marks the target DIRECT and every
 * currently-ACTIVE descendant GROUP_LEADER_REMOVED. Already-removed
 * descendants are left untouched so their original removal reason/actor
 * is never overwritten (§13).
 */
export async function removeNode(actor: AuthenticatedUser, targetId: string) {
  const freshActor = await requireActiveActor(actor.id);

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.organizationId !== freshActor.organizationId) {
    throw new AppError("NODE_NOT_FOUND", "User not found");
  }
  if (target.id === freshActor.id) {
    throw new AppError("FORBIDDEN", "You cannot remove yourself");
  }
  if (target.role === "ROOT_LEADER") {
    throw new AppError("FORBIDDEN", "The root leader cannot be removed");
  }
  if (target.status !== "ACTIVE") {
    throw new AppError("INVALID_HIERARCHY_OPERATION", "This user is already removed");
  }

  await authorizationService.assertCanPerform(
    freshActor,
    "REMOVE_NODE",
    target,
    "You do not have authority over this user"
  );

  const descendants = await hierarchyRepo.getDescendants(target.id);
  const activeDescendants = descendants.filter((d) => d.status === "ACTIVE");
  const now = new Date();

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        status: "REMOVED",
        removalReason: "DIRECT",
        removedBy: freshActor.id,
        removedBecauseOf: null,
        removedAt: now,
      },
    });
    await tx.hierarchyEvent.create({
      data: {
        organizationId: freshActor.organizationId,
        type: "NODE_REMOVED",
        actorId: freshActor.id,
        targetId: target.id,
        metadata: { reason: "DIRECT" },
      },
    });

    for (const d of activeDescendants) {
      await tx.user.update({
        where: { id: d.id },
        data: {
          status: "REMOVED",
          removalReason: "GROUP_LEADER_REMOVED",
          removedBy: freshActor.id,
          removedBecauseOf: target.id,
          removedAt: now,
        },
      });
      await tx.hierarchyEvent.create({
        data: {
          organizationId: freshActor.organizationId,
          type: "NODE_REMOVED",
          actorId: freshActor.id,
          targetId: d.id,
          metadata: { reason: "GROUP_LEADER_REMOVED", removedBecauseOf: target.id },
        },
      });
    }
  });

  // Phase 5: notify subscribers (p2p.gateway.ts) that these ids just
  // became REMOVED, so any live P2P session-authorization lease
  // involving them can be revoked immediately — master spec §26. Fired
  // only after the transaction above has actually committed, so a
  // subscriber never reacts to a removal that could still roll back.
  const removalEvent: HierarchyNodesRemovedEvent = {
    removedIds: [target.id, ...activeDescendants.map((d) => d.id)],
    removedBy: freshActor.id,
  };
  hierarchyEvents.emit("hierarchy:nodes-removed", removalEvent);

  return { removedId: target.id, cascadedCount: activeDescendants.length };
}

/**
 * Ownership-based restoration — master spec §11-12. Reactivating a node
 * never cascades to its descendants; it only requires that the node's
 * *immediate* parent is currently active, so restoration always happens
 * top-down, one owner's decision at a time.
 */
export async function reactivateNode(actor: AuthenticatedUser, targetId: string) {
  const freshActor = await requireActiveActor(actor.id);

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.organizationId !== freshActor.organizationId) {
    throw new AppError("NODE_NOT_FOUND", "User not found");
  }
  if (target.status !== "REMOVED") {
    throw new AppError("INVALID_HIERARCHY_OPERATION", "This user is not currently removed");
  }

  await authorizationService.assertCanPerform(
    freshActor,
    "REACTIVATE_NODE",
    target,
    "You do not have authority over this user"
  );

  if (target.parentId) {
    const parent = await prisma.user.findUnique({ where: { id: target.parentId } });
    if (!parent || parent.status !== "ACTIVE") {
      throw new AppError(
        "INVALID_HIERARCHY_OPERATION",
        "This user's parent leader must be restored first"
      );
    }
  }

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: {
        status: "ACTIVE",
        removalReason: null,
        removedBy: null,
        removedBecauseOf: null,
        removedAt: null,
      },
    });
    await tx.hierarchyEvent.create({
      data: {
        organizationId: freshActor.organizationId,
        type: "NODE_REACTIVATED",
        actorId: freshActor.id,
        targetId: target.id,
        metadata: {},
      },
    });
    return user;
  });

  return toNodePublic(updated);
}
