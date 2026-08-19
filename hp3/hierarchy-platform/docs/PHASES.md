# Phase tracker

Status of the development phases defined in the master specification.
Update this file whenever a phase is started or completed.

| Phase | Name                        | Status      |
|-------|-----------------------------|-------------|
| 1     | Foundation                  | ✅ Done     |
| 2     | Hierarchy                   | ✅ Done (backend + frontend UI) |
| 3     | Authorization                | ✅ Done (canPerform service + general visibility scope) |
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

## Phase 3 — Authorization (this session)

Added `backend/src/modules/authorization/` (`authorization.service.ts` +
`authorization.types.ts`): a central `canPerform(actor, action, target)`
/ `assertCanPerform(...)` per master spec §15, covering `CREATE_LEADER`,
`CREATE_PEER`, `REMOVE_NODE`, `REACTIVATE_NODE`, `VIEW_VISIBILITY_SCOPE`.
`hierarchy.service.ts`'s Phase 2 inline `ROLE_CREATION_RULES` and
`requireOwnership` were removed and now delegate here instead — same
rules, single source of truth.

Also replaced the Phase 2 `ROOT_LEADER`-only `GET /hierarchy` role gate
with a real general visibility-scope endpoint
(`authorizationService.getVisibilityScope` → ancestors + descendants),
available to any active user, per master spec §16. Route/response shape
changed (`{ self, ancestors, descendants }` instead of `{ nodes }`) —
safe, because the frontend never called this endpoint (it only ever used
`/hierarchy/subtree`, which is unchanged).

15 new vitest unit tests cover the role-creation rules and ownership
logic (`hierarchy.repository` mocked, since Prisma can't run in this
sandbox) — all passing. Full detail in `HANDOFF.md` §4c.

**Also fixed in passing**: `backend/tsconfig.json` was failing
`tsc --noEmit` outright (`moduleResolution=node` deprecation error) with
the TypeScript version this sandbox installed — added
`"ignoreDeprecations": "5.0"` (not `"6.0"`, which is an invalid value
for that flag). Unrelated to Phase 3 logic, but was blocking
verification of it. After that fix, `tsc --noEmit` showed the same
`@prisma/client`-types-unavailable errors every phase has had (confirmed
via `npx prisma generate` — still blocked by `binaries.prisma.sh`, same
as always), plus two real `noUncheckedIndexedAccess` bugs in the new
`authorization.service.ts` (same class of bug Phase 2 hit once already)
— fixed with the same `?? []` fallback pattern. Full detail in
`HANDOFF.md` §5c.

## Next: Phase 4 — Real-Time Presence

Socket.IO + Redis adapter, presence, heartbeat/TTL, distributed
presence across multiple server instances (master spec §21-22). Redis
has been connected and health-checked since Phase 1 but is still
functionally unused — this is where that changes.
