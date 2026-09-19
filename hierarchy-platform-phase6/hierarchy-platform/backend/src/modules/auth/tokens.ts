import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../../config/env";

export interface AccessTokenPayload {
  sub: string; // user id
  organizationId: string;
  role: Role;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  sessionId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    // @types/jsonwebtoken types expiresIn as a branded string (ms.StringValue),
    // but our value comes from validated-at-boot env config as a plain string.
    // The zod schema is the actual runtime guarantee of validity here.
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export function refreshTokenExpiryDate(): Date {
  const ms = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}
