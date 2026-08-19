import bcrypt from "bcrypt";
import type { Prisma, Role, User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as hierarchyRepo from "./hierarchy.repository";
import type { CreateMemberInput } from "./hierarchy.schemas";
import type { HierarchyNode } from "./hierarchy.types";

const PASSWORD_SALT_ROUNDS = 12;

// Who may create whom. LEADERs may create nested LEADERs, matching the
// hierarchy example in master spec §3 (LEADER C nested under LEADER B).
// This was an open question in HANDOFF.md §9 — resolved with this
// default; revisit if the user wants ROOT_LEADER-only leader creation.
const ROLE_CREATION_RULES: Record<Role, Role[]> = {
  ROOT_LEADER: ["LEADER", "PEER"],
  LEADER: ["LEADER", "PEER"],
  PEER: [],
};

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

async function requireOwnership(actorId: string, targetId: string): Promise<void> {
  const ancestors = await hierarchyRepo.getAncestors(targetId);
  const isAncestor = ancestors.some((a) => a.id === actorId);
  if (!isAncestor) {
    throw new AppError("FORBIDDEN", "You do not have authority over this user");
  }
}

export async function createMember(
  actor: AuthenticatedUser,
  role: "LEADER" | "PEER",
  input: CreateMemberInput
) {
  const freshActor = await requireActiveActor(actor.id);

  const allowedRoles = ROLE_CREATION_RULES[freshActor.role] ?? [];
  if (!allowedRoles.includes(role)) {
    throw new AppError("FORBIDDEN", `${freshActor.role} cannot create a ${role}`);
  }

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
 * The full organization tree, flat. ROOT_LEADER only for now — general
 * parent/descendant visibility scoping for LEADER/PEER is Phase 3's
 * canPerform/visibility service, not duplicated here ahead of time.
 */
export async function getOrganizationTree(actor: AuthenticatedUser) {
  const freshActor = await requireActiveActor(actor.id);
  if (freshActor.role !== "ROOT_LEADER") {
    throw new AppError("FORBIDDEN", "Only the root leader can view the full organization tree");
  }
  const nodes = await hierarchyRepo.getOrganizationTree(freshActor.organizationId);
  return nodes.map(toNodePublic);
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

  await requireOwnership(freshActor.id, target.id);

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

  await requireOwnership(freshActor.id, target.id);

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
