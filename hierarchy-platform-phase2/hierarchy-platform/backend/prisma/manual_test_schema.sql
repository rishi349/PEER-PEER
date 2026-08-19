-- Mirrors backend/prisma/schema.prisma exactly (Phase 2 state).
-- Used only for direct SQL integration testing in an environment where
-- `prisma migrate` can't run (see HANDOFF.md §5). Not a replacement for
-- the real Prisma migration — regenerate via `npx prisma migrate dev`
-- wherever that's possible.

CREATE TYPE "Role" AS ENUM ('ROOT_LEADER', 'LEADER', 'PEER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "RemovalReason" AS ENUM ('DIRECT', 'GROUP_LEADER_REMOVED');

CREATE TABLE organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL REFERENCES organizations(id),
  "parentId"         TEXT REFERENCES users(id),
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  "passwordHash"     TEXT NOT NULL,
  role               "Role" NOT NULL,
  status             "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "removalReason"    "RemovalReason",
  "removedBy"        TEXT,
  "removedBecauseOf" TEXT,
  "removedAt"        TIMESTAMP,
  "createdAt"        TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX ON users ("organizationId");
CREATE INDEX ON users ("parentId");

CREATE TABLE hierarchy_events (
  id             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  type           TEXT NOT NULL,
  "actorId"      TEXT,
  "targetId"     TEXT NOT NULL,
  metadata       JSONB,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT now()
);
