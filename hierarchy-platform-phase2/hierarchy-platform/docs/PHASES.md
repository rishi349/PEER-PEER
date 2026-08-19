# Phase tracker

Status of the development phases defined in the master specification.
Update this file whenever a phase is started or completed.

| Phase | Name                        | Status      |
|-------|-----------------------------|-------------|
| 1     | Foundation                  | ✅ Done     |
| 2     | Hierarchy                   | ✅ Done (backend + frontend UI) |
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

## Phase 2 — Hierarchy frontend (this session)

Added the Dashboard hierarchy UI on top of the already-complete backend:
`HierarchyPanel` (fetches `GET /hierarchy/subtree` on mount), an
add-Leader/Peer form (`POST /hierarchy/leaders` / `/peers`, always under
the signed-in user — that's all the API supports), a flat indented tree
built client-side from `parentId`, a Remove action with a confirmation
modal that predicts and warns about cascade count, a Reactivate action,
and a removal-details modal (reason / removed by / removed because of /
removed at) sourced only from backend fields — never inferred. Full
detail in `HANDOFF.md` §4b.

Verified: `tsc --noEmit` (strict, `noUnusedLocals`/`noUnusedParameters`)
and `vite build` both clean. **Not** exercised against a running
backend in this sandbox — same `binaries.prisma.sh` network restriction
noted in Phase 2's backend verification; Prisma can't run here, so there
is no live API to click through. Next session should smoke-test this
against a real running stack.

## Next: Phase 3 — Authorization

`canPerform(actor, action, target)` service and real branch-isolated
visibility scoping (master spec §16) — `GET /hierarchy` is currently a
`ROOT_LEADER`-only role gate, not the general visibility service.
