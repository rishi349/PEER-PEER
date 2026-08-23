# Phase tracker

Status of the development phases defined in the master specification.
Update this file whenever a phase is started or completed.

| Phase | Name                        | Status      |
|-------|-----------------------------|-------------|
| 1     | Foundation                  | ✅ Done     |
| 2     | Hierarchy                   | ✅ Done (backend + frontend UI) |
| 3     | Authorization                | ✅ Done (canPerform service + general visibility scope) |
| 4     | Real-Time Presence          | ✅ Done (backend only — see below) |
| 5     | WebRTC P2P                  | ✅ Done (backend/control-plane only — see below) |
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

## Phase 4 — Real-Time Presence (this session)

Added `backend/src/modules/presence/` (types, repository, service, Socket.IO
gateway, Redis keyspace-expiry listener, REST controller/routes) plus
`backend/src/config/socket.ts` (Socket.IO server + `@socket.io/redis-adapter`
for cross-node broadcast). `index.ts` now boots an `http.Server` instead of
calling `app.listen` directly, so Socket.IO can upgrade connections on the
same port.

Presence is ONLINE/OFFLINE only, driven by a Redis key with a 30s TTL
(`presence:{userId}`) renewed by a client `presence:heartbeat` socket event.
TTL expiry is detected via Redis keyspace notifications (best-effort —
falls back gracefully to "just reads as OFFLINE" if the Redis instance
disallows `CONFIG SET`). Multi-device/multi-tab is supported via a
`presence:sockets:{userId}` Redis set — a user only goes OFFLINE once
their *last* tracked socket disconnects. Broadcasts only fire on real
ONLINE↔OFFLINE transitions, never on heartbeat renewal, and are scoped to
exactly the audience authorized to see them (reuses Phase 3's
`authorizationService.getVisibilityScope` — proven symmetric: the set of
users who may see X's presence is exactly X's own ancestors+descendants).
New endpoint: `GET /presence` (REST snapshot fallback; the live path is
Socket.IO's `presence:snapshot`/`presence:update` events).

Backend-only, matching the Phase 3 precedent (master spec §47's Phase 4
list is backend infrastructure only) — no frontend presence UI this
session.

13 new vitest unit tests cover the transition logic (mocking
`presence.repository`, `authorization.service`, and Prisma) — all passing
alongside the 15 pre-existing Phase 3 tests (28/28 total). `tsc --noEmit`
clean except the same pre-existing `@prisma/client`-types-unavailable
errors every phase has had (confirmed still caused by the
`binaries.prisma.sh` block, not new code).

Two known, deliberately-not-solved-this-phase gaps are documented in
`HANDOFF.md` §4d/§5d: (1) a user removed mid-session keeps their existing
socket connection (and can keep heartbeating) until it naturally
disconnects or their access token expires — only *new* connections are
blocked; (2) if Redis disallows `CONFIG SET`, real-time TTL-expiry push
events won't fire, though snapshot reads stay correct regardless. Full
detail in `HANDOFF.md` §4d/§5d.

**Not verified this session** (same standing sandbox limitation as every
phase before it): nothing was run against a live Postgres/Redis/Socket.IO
stack, multi-server broadcast was not exercised against two real server
processes, and the Redis keyspace-notification path was not observed
firing end-to-end. See `HANDOFF.md` §5d for the specific next-session
checklist.

## Phase 5 — WebRTC P2P (this session)

Added `backend/src/modules/p2p/` (types, Redis repository, service,
Socket.IO gateway) — the **control-plane** half of master spec §23-28
only: session-authorization leases and signaling relay. This backend
never touches an actual `RTCPeerConnection`/`DataChannel` — those live
entirely in the browser, peer-to-peer, per §23-24 — so, like Phase 4,
this is backend/infrastructure-only; no frontend WebRTC client was
built this session.

**Authorization**: a new `INITIATE_P2P_SESSION` action in
`authorization.service.ts` — unlike `REMOVE_NODE`/`REACTIVATE_NODE`
(actor must specifically be an *ancestor* of the target), P2P
authorization is symmetric: either direction of the ancestor/descendant
relation permits a session, matching master spec §16's visibility model
and reusing the same relation `presence.service.ts` already relies on
for its own broadcast audience.

**Leases**: Redis-only (`p2p:lease:{sorted-pair}`, 45s TTL, its own
namespace/TTL distinct from presence's), keyed by canonical
lexicographically-sorted user pair so either participant can renew.
`p2p:request-session` creates/refreshes a lease and broadcasts
`p2p:session-authorized` to both participants (mirrors presence's
connect-broadcasts); `p2p:renew-session` re-runs the **full**
Postgres-backed authorization check every time (deliberately more
expensive than presence's silent heartbeat — this is what actually
enforces master spec §26's "prevent lease renewal" once someone is
removed) and is silent on success; `p2p:close-session` is a voluntary,
idempotent teardown. `p2p:signal` relays offer/answer/ICE-candidate
messages to the other participant's room after a cheap Redis-only lease
check (no Postgres hit — signaling can be high-frequency).

**Revocation on removal (§26)**: `hierarchy.service.ts` gained a plain
`hierarchyEvents` `EventEmitter` (same decoupling pattern as Phase 4's
`presenceEvents`) that emits once per successful `removeNode` call, with
the flat list of every newly-REMOVED id (target + cascade). Only
`p2p.gateway.ts` subscribes to it — `hierarchy.service.ts` still knows
nothing about Socket.IO or P2P — and calls
`p2pService.revokeSessionsForUser` for each id, deleting every lease
that user held and broadcasting `p2p:session-revoked` (`reason:
"NODE_REMOVED"`) to the other participant. Per master spec §27, this
cannot force-close an already-open WebRTC connection — it can only
delete the authorization and ask a compliant client to close.

**Refactor along the way**: connection-time Socket.IO auth
(`authenticateSocket`) moved from a private function inside
`presence.gateway.ts` into a new shared `middleware/socketAuth.ts`,
registered exactly once in `config/socket.ts`'s `initSocketIO` rather
than once per gateway — needed once a second gateway (`p2p.gateway.ts`)
had to run on the same authenticated connection. Behavior-preserving;
`presence.gateway.ts`'s own logic is otherwise unchanged.

18 new vitest unit tests (`p2p.service.test.ts`, mocking Postgres/Redis
the same way every prior test file does) plus 5 new
`authorization.service.test.ts` cases for `INITIATE_P2P_SESSION` — 51/51
passing project-wide. `tsc --noEmit`: zero errors in any new or edited
Phase 5 file; the only errors are the same standing
`@prisma/client`-types-unavailable class every phase has had (confirmed
via `npx prisma generate`, still blocked by `binaries.prisma.sh`, same
as always — see HANDOFF.md §5e).

Deliberately **not** built this phase: any REST endpoints for P2P
(everything is Socket.IO-only — signaling and renewal are inherently
real-time and already require an active socket, so a REST path would be
a redundant code path; see master spec §43's "don't blindly implement
every endpoint"), and file-transfer/DataChannel-payload logic of any
kind (§33/§54 — Phase 9 is explicitly deferred pending the user's own
design, unaffected by this phase). Full detail, including a known
lease-index-set memory-leak-on-natural-TTL-expiry gap (harmless,
documented, not fixed this phase) in `HANDOFF.md` §4e/§5e.

**Not verified this session** (same standing sandbox limitation as
every phase before it): nothing was run against a live
Postgres/Redis/Socket.IO stack, no two real browsers ever exchanged a
real WebRTC offer/answer/ICE candidate through this relay, and the
hierarchy-removal → lease-revocation bridge was only exercised through
mocked unit tests, never end-to-end against a real removal through the
real HTTP layer. See `HANDOFF.md` §5e for the specific next-session
checklist.

## Next: Phase 6 — Location

Browser geolocation, privacy controls, location updates, stale-location
handling, Redis-backed transient location (master spec §47 Phase 6).
Phase 5's `p2p:*` Socket.IO event namespace and lease-TTL pattern are a
reasonable template for a `location:*` namespace if transient location
ends up needing its own renewable Redis state — but read master spec
§20/§41 again before assuming presence and location should share
infrastructure; they're deliberately separate concerns (presence =
availability, location = spatial position).

