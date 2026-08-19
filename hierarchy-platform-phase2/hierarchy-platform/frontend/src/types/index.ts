export type Role = "ROOT_LEADER" | "LEADER" | "PEER";
export type UserStatus = "ACTIVE" | "REMOVED";

// Mirrors toPublicUser() in backend/src/modules/auth/auth.service.ts.
// Kept as a hand-written type rather than a generated one for now — a
// shared-types package can be introduced later if drift becomes a
// problem.
export interface PublicUser {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export type RemovalReason = "DIRECT" | "GROUP_LEADER_REMOVED";

// Mirrors HierarchyNode in backend/src/modules/hierarchy/hierarchy.types.ts
// (which itself deliberately excludes passwordHash).
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
  removedAt: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
