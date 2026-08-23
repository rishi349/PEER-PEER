import type { Role, RemovalReason, UserStatus } from "@prisma/client";

// Deliberately excludes passwordHash — raw hierarchy queries never touch
// it, so it can never accidentally leak into a hierarchy response.
export interface HierarchyNode {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  removalReason: RemovalReason | null;
  removedBy: string | null;
  removedBecauseOf: string | null;
  removedAt: Date | null;
  createdAt: Date;
}

/**
 * Emitted (via hierarchy.service.ts's `hierarchyEvents`, added Phase 5)
 * once a `removeNode` call commits successfully. Lists the DIRECT
 * target plus every cascade-removed descendant in one flat array —
 * deliberately not distinguishing which is which here, since by the
 * time this fires hierarchy.service.ts has already resolved that
 * distinction (it's what `removalReason`/`removedBecauseOf` on each row
 * record); from a subscriber's perspective every id in this list is
 * equally now-REMOVED and equally no longer authorized for anything
 * that depended on ACTIVE status. Added so other modules (starting with
 * p2p.service.ts's session revocation, master spec §26) can react to a
 * removal without hierarchy.service.ts importing anything about
 * Socket.IO, Redis, or P2P — same decoupling pattern presence.service.ts
 * established in Phase 4 for `presenceEvents` (see HANDOFF §6).
 */
export interface HierarchyNodesRemovedEvent {
  removedIds: string[];
  removedBy: string;
}
