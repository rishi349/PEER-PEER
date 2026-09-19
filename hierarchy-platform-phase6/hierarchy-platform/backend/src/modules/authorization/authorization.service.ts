import type { Role, User } from "@prisma/client";
import { AppError } from "../../common/errors";
import * as hierarchyRepo from "../hierarchy/hierarchy.repository";
import type { HierarchyNode } from "../hierarchy/hierarchy.types";
import type { Action } from "./authorization.types";

/**
 * Master spec §15: `canPerform(actor, action, target)` is the one place
 * hierarchy-authority decisions get made. Phase 2 had these rules inline
 * in hierarchy.service.ts (ROLE_CREATION_RULES, requireOwnership) — this
 * module centralizes them so they're independently testable and so
 * future modules (presence/radar/P2P authorization in later phases) can
 * reuse the same policy instead of re-deriving it.
 *
 * What this module deliberately does NOT do: re-check that the actor is
 * authenticated or currently ACTIVE. Callers (hierarchy.service.ts's
 * requireActiveActor) already re-read the actor fresh from Postgres
 * before calling in here, per master spec §15's "never trust stale
 * claims" rule — this module assumes it has already been handed a
 * fresh, active actor row and only answers the role/hierarchy-position
 * question.
 */

// Who may create whom. LEADERs may create nested LEADERs — matches the
// hierarchy example in master spec §3 (LEADER C nested under LEADER B).
// Moved here unchanged from hierarchy.service.ts's Phase 2
// ROLE_CREATION_RULES; still an unconfirmed-by-the-user default (see
// HANDOFF §8/§9) — a one-line change here if the user wants
// ROOT_LEADER-only leader creation instead.
const ROLE_CREATION_RULES: Record<Role, Role[]> = {
  ROOT_LEADER: ["LEADER", "PEER"],
  LEADER: ["LEADER", "PEER"],
  PEER: [],
};

/** True if `actorId` is somewhere in `targetId`'s ancestor chain (i.e. owns it). */
export async function isAncestorOf(actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId) return false;
  const ancestors = await hierarchyRepo.getAncestors(targetId);
  return ancestors.some((a) => a.id === actorId);
}

/**
 * Answers "is this actor allowed to do this?" without throwing.
 * CREATE_LEADER/CREATE_PEER need no target — creation is always scoped
 * to "under myself" (hierarchy.service.ts hard-codes parentId = actor.id).
 * REMOVE_NODE/REACTIVATE_NODE require a target and check ownership via
 * the ancestor chain (master spec §12: ownership-based authority).
 */
export async function canPerform(
  actor: Pick<User, "id" | "role">,
  action: Action,
  target?: Pick<HierarchyNode, "id" | "role">
): Promise<boolean> {
  switch (action) {
    case "CREATE_LEADER":
      return (ROLE_CREATION_RULES[actor.role] ?? []).includes("LEADER");

    case "CREATE_PEER":
      return (ROLE_CREATION_RULES[actor.role] ?? []).includes("PEER");

    case "REMOVE_NODE": {
      if (!target) return false;
      if (target.id === actor.id) return false; // cannot remove yourself
      if (target.role === "ROOT_LEADER") return false; // root can never be removed
      return isAncestorOf(actor.id, target.id);
    }

    case "REACTIVATE_NODE": {
      if (!target) return false;
      return isAncestorOf(actor.id, target.id);
    }

    case "VIEW_VISIBILITY_SCOPE":
      // Every actor may view their own scope — no target-specific check.
      // Kept as an explicit case (rather than falling through a default)
      // so the Action union stays exhaustive and the compiler catches a
      // forgotten case if this union grows later.
      return true;

    case "INITIATE_P2P_SESSION": {
      // Phase 5, master spec §25: "A authorized to communicate with B?"
      // Unlike REMOVE_NODE/REACTIVATE_NODE (actor must specifically be
      // an *ancestor* of target — ownership only runs one direction),
      // P2P communication authorization is symmetric: two users may
      // establish a session if either one is in the other's ancestor
      // chain (equivalently: target is within actor's own visibility
      // scope, master spec §16). This is exactly the same symmetric
      // relation presence.service.ts's getAudience already relies on
      // ("Y is authorized to see X iff X is an ancestor of Y or a
      // descendant of Y") — reused here rather than re-derived, per
      // this module's own stated purpose of being the single place
      // hierarchy-authority decisions get made.
      if (!target) return false;
      if (target.id === actor.id) return false;
      const [actorIsAncestorOfTarget, targetIsAncestorOfActor] = await Promise.all([
        isAncestorOf(actor.id, target.id),
        isAncestorOf(target.id, actor.id),
      ]);
      return actorIsAncestorOfTarget || targetIsAncestorOfActor;
    }

    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}

/** Throwing counterpart of canPerform — use this from services/controllers. */
export async function assertCanPerform(
  actor: Pick<User, "id" | "role">,
  action: Action,
  target?: Pick<HierarchyNode, "id" | "role">,
  message = "You are not authorized to perform this action"
): Promise<void> {
  const allowed = await canPerform(actor, action, target);
  if (!allowed) {
    throw new AppError("FORBIDDEN", message);
  }
}

/**
 * The general visibility scope for any actor, per master spec §16: a
 * user may discover their direct parent/leader (upward coordination)
 * and their authorized descendants (downward coordination) — nothing
 * from unrelated branches. This is the real implementation of the
 * visibility model that Phase 2's ROOT_LEADER-only getOrganizationTree
 * role-gate deliberately stood in for (see HANDOFF §4/§7).
 *
 * For a ROOT_LEADER this naturally covers the entire organization,
 * because every user descends from the root — no special-casing by
 * role is needed here, which is the point: visibility falls out of
 * hierarchy position, not a role check.
 */
export async function getVisibilityScope(
  actor: Pick<User, "id">
): Promise<{ ancestors: HierarchyNode[]; descendants: HierarchyNode[] }> {
  const [ancestors, descendants] = await Promise.all([
    hierarchyRepo.getAncestors(actor.id),
    hierarchyRepo.getDescendants(actor.id),
  ]);
  return { ancestors, descendants };
}
