# Hierarchical Peer-to-Peer Coordination Platform

A production-quality, portfolio-worthy hierarchical coordination platform:
tree-shaped organizational authority, server-side authorization, real-time
presence, location-aware radar discovery, and WebRTC peer-to-peer
communication with a server-controlled control plane.

This repository is built **incrementally, phase by phase**, following the
project master specification. Each phase adds one coherent layer on top of
a working foundation. Do not expect the whole product on day one — that is
intentional.

## Current status

**Phase 1 — Foundation** ✅ (this commit)

- Monorepo: `backend/` (Express + TypeScript + Prisma + PostgreSQL, with a
  Redis connection wired up and health-checked but not yet used
  functionally — that starts in Phase 4)
- `frontend/` (React + TypeScript + Vite)
- Auth: register (creates an Organization + its `ROOT_LEADER`), login,
  logout, refresh, `GET /users/me`
- Password hashing (bcrypt), access/refresh JWTs, refresh-token rotation
  with server-side revocation via a `Session` table
- `User` model with `role` (`ROOT_LEADER` / `LEADER` / `PEER`) and `status`
  (`ACTIVE` / `REMOVED`) — the removal *machinery* (cascading removal,
  reasons, restoration) is deliberately **not** implemented yet; that is
  Phase 2
- Structured errors, centralized error handling, request validation (zod)

Everything after this — hierarchy management, authorization scopes,
presence, radar, WebRTC, device identity, and the data-transfer protocol —
is intentionally **not** in this commit. See `docs/PHASES.md` (or the
master spec) for what's next.

## Repository layout

```
hierarchy-platform/
├── backend/                 Control-plane API (Express + TS + Prisma)
│   ├── prisma/schema.prisma Persistent data model (PostgreSQL)
│   └── src/
│       ├── config/          env, Prisma client, Redis client
│       ├── common/          errors, async handler
│       ├── middleware/      auth guard, error handler
│       ├── modules/auth/    register/login/logout/refresh
│       └── modules/users/   GET /users/me
├── frontend/                React + TS + Vite client
│   └── src/
│       ├── api/             typed fetch client
│       ├── state/           auth store (zustand)
│       ├── pages/           Login, Register, Dashboard
│       └── components/      shared UI (identity card, status pill…)
└── docker-compose.yml       Local PostgreSQL + Redis for development
```

## Running it locally

### 1. Start PostgreSQL and Redis

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev        # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

Register the first account at `/register` — it becomes the `ROOT_LEADER`
of a brand-new organization. There is intentionally no way to create
`LEADER`/`PEER` accounts yet from the UI or API; that arrives in Phase 2
along with hierarchy management (`POST /hierarchy/leaders`,
`POST /hierarchy/peers`) and cascading removal.

## Non-negotiable architectural rules

These carry over from the master spec and constrain every future phase:

- Hierarchy defines authority; authorization defines visibility; presence
  defines availability; network topology defines transport. These stay
  separate concepts, always.
- The backend is the only control-plane security boundary. The frontend
  never decides what a user is allowed to do or see.
- Physical proximity never grants authorization.
- PostgreSQL is the persistent source of truth; Redis holds ephemeral /
  distributed state only.
- Removal is explicit, auditable state — never a physical delete, never a
  silent re-parent.
- WebRTC is a data-plane mechanism; it is not, and will never be
  advertised as, magically server-revocable once established.
