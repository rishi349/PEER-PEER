# Phase tracker

Status of the development phases defined in the master specification.
Update this file whenever a phase is started or completed.

| Phase | Name                        | Status      |
|-------|-----------------------------|-------------|
| 1     | Foundation                  | ✅ Done     |
| 2     | Hierarchy                   | ⬜ Not started |
| 3     | Authorization                | ⬜ Not started |
| 4     | Real-Time Presence          | ⬜ Not started |
| 5     | WebRTC P2P                  | ⬜ Not started |
| 6     | Location                    | ⬜ Not started |
| 7     | Radar                       | ⬜ Not started |
| 8     | Security Hardening          | ⬜ Not started |
| 9     | Detailed Data Transfer      | ⬜ Not started (design pending from user) |
| 10    | Testing and Deployment      | ⬜ Not started |

## Phase 1 — Foundation (this commit)

**What was built**

- Monorepo scaffold: `backend/` (Express + TypeScript + Prisma) and
  `frontend/` (React + TypeScript + Vite).
- `docker-compose.yml` for local PostgreSQL + Redis.
- Prisma schema: `Organization`, `User` (role, status), `Session`
  (refresh-token rotation/revocation).
- Auth module: `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, `GET /users/me`.
- Structured error model, zod request validation, centralized error
  handling middleware, JWT auth guard middleware.
- Redis client wired up with a health check (`GET /health`) but not used
  functionally yet — that begins in Phase 4 (Presence).
- Frontend: Login / Register / Dashboard pages, a small auth store
  (zustand) with in-memory access token + silent refresh, a typed API
  client.

**Deliberately not built yet**

- Any hierarchy mutation beyond the implicit root leader created at
  registration (no `LEADER`/`PEER` creation, no `parentId` assignment
  flow).
- Removal, cascading removal, removal reasons, restoration.
- Authorization/visibility scoping beyond "must be authenticated."
- Presence, location, radar, WebRTC signaling, device identity.

## Next: Phase 2 — Hierarchy

Will add: creating leaders/peers under an authenticated leader,
`GET /hierarchy`, `GET /hierarchy/subtree`, `GET /hierarchy/ancestors`,
`DELETE /hierarchy/nodes/:id` (removal + cascading removal + removal
reasons), `POST /hierarchy/nodes/:id/reactivate` (ownership-based
restoration), and the removal-history audit trail. This is the next
message to send when ready to continue.
