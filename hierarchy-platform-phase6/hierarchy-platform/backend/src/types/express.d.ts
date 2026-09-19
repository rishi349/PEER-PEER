import type { Role } from "@prisma/client";

// Populated by requireAuth. Intentionally minimal — anything beyond
// identity/role must be looked up fresh from Postgres by each handler,
// never trusted purely from the JWT (master spec §15: never trust
// frontend-provided authorization; the same principle applies to stale
// claims baked into a token minted minutes ago).
export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
