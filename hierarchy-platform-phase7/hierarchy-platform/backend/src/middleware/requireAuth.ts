import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/errors";
import { verifyAccessToken } from "../modules/auth/tokens";

// Verifies the bearer access token and attaches a minimal identity to
// req.user. This is the control-plane boundary (master spec §15) — every
// handler that needs to know "who is this user?" goes through here, and
// nothing about hierarchy position, ownership, or permissions is ever
// trusted from the client beyond this raw identity.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      organizationId: payload.organizationId,
      role: payload.role,
    };
    next();
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired access token");
  }
}
