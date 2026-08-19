import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { HierarchyNode } from "./hierarchy.types";

// Column list shared by every query below — kept in one place so
// "never select passwordHash" only has to be true once.
const NODE_COLUMNS = Prisma.sql`
  id, "organizationId", "parentId", name, email, role, status,
  "removalReason", "removedBy", "removedBecauseOf", "removedAt", "createdAt"
`;

// Master spec §35: recursive CTEs first, materialized paths/closure
// tables only if profiling later demands it.

/** All descendants of `rootId` (NOT including rootId itself). */
export async function getDescendants(rootId: string): Promise<HierarchyNode[]> {
  return prisma.$queryRaw<HierarchyNode[]>`
    WITH RECURSIVE subtree AS (
      SELECT ${NODE_COLUMNS} FROM users WHERE "parentId" = ${rootId}
      UNION ALL
      SELECT u.id, u."organizationId", u."parentId", u.name, u.email, u.role, u.status,
             u."removalReason", u."removedBy", u."removedBecauseOf", u."removedAt", u."createdAt"
      FROM users u
      INNER JOIN subtree s ON u."parentId" = s.id
    )
    SELECT * FROM subtree
  `;
}

/** Ancestor chain of `userId`, ordered nearest-parent-first up to the root. */
export async function getAncestors(userId: string): Promise<HierarchyNode[]> {
  return prisma.$queryRaw<HierarchyNode[]>`
    WITH RECURSIVE ancestors AS (
      SELECT ${NODE_COLUMNS}, 1 AS depth
      FROM users
      WHERE id = (SELECT "parentId" FROM users WHERE id = ${userId})
      UNION ALL
      SELECT u.id, u."organizationId", u."parentId", u.name, u.email, u.role, u.status,
             u."removalReason", u."removedBy", u."removedBecauseOf", u."removedAt", u."createdAt",
             a.depth + 1
      FROM users u
      INNER JOIN ancestors a ON u.id = a."parentId"
    )
    SELECT id, "organizationId", "parentId", name, email, role, status,
           "removalReason", "removedBy", "removedBecauseOf", "removedAt", "createdAt"
    FROM ancestors
    ORDER BY depth ASC
  `;
}

/** Every user in an organization, flat — the client reconstructs the tree from parentId.
 *  Currently unused by any service (Phase 3 replaced hierarchy.service.ts's old
 *  ROOT_LEADER-only caller with authorizationService.getVisibilityScope, which combines
 *  getAncestors + getDescendants instead). Left in place as a tested, working primitive —
 *  it's the natural query for a future admin/audit view or a Radar "ALL" filter for the
 *  ROOT_LEADER (master spec §18) — rather than deleted just because nothing calls it yet. */
export async function getOrganizationTree(organizationId: string): Promise<HierarchyNode[]> {
  return prisma.$queryRaw<HierarchyNode[]>`
    SELECT ${NODE_COLUMNS}
    FROM users
    WHERE "organizationId" = ${organizationId}
    ORDER BY "createdAt" ASC
  `;
}
