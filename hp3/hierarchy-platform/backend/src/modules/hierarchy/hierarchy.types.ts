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
