import bcrypt from "bcrypt";
import { createHash } from "crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { LoginInput, RegisterInput } from "./auth.schemas";
import {
  refreshTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./tokens";

const PASSWORD_SALT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function hashRefreshToken(token: string): string {
  // The refresh token is a signed JWT (bearer secret). We only ever store
  // a one-way hash of it server-side, and use that solely to detect reuse
  // of an already-rotated token — never to reconstruct or validate the
  // token's authenticity (the JWT signature does that).
  return createHash("sha256").update(token).digest("hex");
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    parentId: user.parentId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

async function issueTokenPair(user: User): Promise<TokenPair> {
  const accessToken = signAccessToken({
    sub: user.id,
    organizationId: user.organizationId,
    role: user.role,
  });

  // Create the session first so the refresh token's sessionId claim
  // always refers to a real row before it's ever handed to a client.
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: "", // filled in below once the token is signed
      expiresAt: refreshTokenExpiryDate(),
    },
  });

  const refreshToken = signRefreshToken({ sub: user.id, sessionId: session.id });

  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: hashRefreshToken(refreshToken) },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("ALREADY_EXISTS", "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);

  // Registration creates a brand-new organization with the registrant as
  // its ROOT_LEADER. There is intentionally no other way to create a
  // user in Phase 1 — LEADER/PEER creation under a parent arrives in
  // Phase 2 with the hierarchy module.
  const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const organization = await tx.organization.create({
      data: { name: input.organizationName },
    });

    return tx.user.create({
      data: {
        organizationId: organization.id,
        parentId: null,
        name: input.name,
        email: input.email,
        passwordHash,
        role: "ROOT_LEADER",
        status: "ACTIVE",
      },
    });
  });

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), tokens };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This account is no longer active");
  }

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), tokens };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired refresh token");
  }

  const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError("UNAUTHORIZED", "Session is no longer valid");
  }

  if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
    // The token presented doesn't match the last one issued for this
    // session — most likely reuse of an already-rotated refresh token.
    // Revoke the whole session defensively rather than trusting it.
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    throw new AppError("UNAUTHORIZED", "Session is no longer valid");
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    throw new AppError("UNAUTHORIZED", "Session is no longer valid");
  }
  if (user.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This account is no longer active");
  }

  // Rotate: the old session is retired, a new one issued.
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), tokens };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return; // already unusable; logout is idempotent
  }

  await prisma.session.updateMany({
    where: { id: payload.sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { toPublicUser };
