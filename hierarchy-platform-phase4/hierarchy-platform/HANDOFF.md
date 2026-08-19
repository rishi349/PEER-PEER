# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this
> project up in a new session: read this whole file before touching
> code.** It tells you what exists, what was decided and why, what's
> verified, and exactly what to build next. The authoritative product
> spec is `claude_project_master_prompt_final.md` (the project's master
> prompt) — this document is the **engineering status report** against
> that spec, not a replacement for it.

Last updated: **Phase 4 — Real-Time Presence, complete (backend only).**
Phases 1-4 are done (backend + frontend for 1-2; Phase 3 and Phase 4 are
backend-only, as intended for both — see §4c and §4d). Nothing from
Phase 5 onward has been started.

**Continuity note:** this project is built inside an ephemeral sandbox
filesystem that does not persist between separate conversations. The
only durable copy is whatever zip the user has downloaded most recently
(now includes everything through Phase 4). **If you are a fresh agent
session, you have no filesystem access to this code unless the user
re-uploads that zip.** Ask for it if `/mnt/user-data/uploads` doesn't
already have it.

---

## 1. How to orient yourself in 60 seconds

1. Read `docs/PHASES.md` for the phase-by-phase checklist (source of
   truth for status — keep it updated as you go).
2. Read §6 below ("Conventions") before writing any new code.
3. Read §7 ("What's next") for the concrete next increment.
4. Do **not** regenerate the whole app. The master prompt is explicit:
   build incrementally, inspect before changing, smallest coherent
   increment, explain before implementing, verify, then summarize.
5. The user has asked to complete all remaining phases, but has also
   accepted that this happens in verified layers, not one giant
   unreviewed dump — Phase 3+ should keep following that same discipline
   unless the user explicitly says otherwise in a session you can see.

---

## 2. Repository map (everything that exists right now)

```
hierarchy-platform/
├── README.md                  Setup instructions (stale — still describes Phase 1 only;
│                               no session has updated it since. HANDOFF.md/docs/PHASES.md
│                               are the maintained continuity docs, not this file.)
├── docker-compose.yml          Local Postgres 16 + Redis 7
├── docs/PHASES.md              Phase checklist — keep current
├── HANDOFF.md                  This file
├── backend/
│   ├── prisma/schema.prisma    Organization, User, Session, HierarchyEvent
│   └── src/
│       ├── config/              env.ts, prisma.ts, redis.ts, socket.ts (NEW)
│       ├── common/              errors.ts (AppError + ErrorCode union), asyncHandler.ts
│       ├── middleware/          requireAuth.ts, errorHandler.ts
│       ├── types/express.d.ts   req.user augmentation (AuthenticatedUser — also reused
│       │                        by presence.gateway.ts for socket.data.user)
│       ├── modules/auth/        register/login/refresh/logout + JWT helpers
│       ├── modules/users/       GET /users/me
│       ├── modules/hierarchy/   backend/src/modules/hierarchy/ — see §4 below
│       ├── modules/authorization/ canPerform/assertCanPerform — see §4c below
│       ├── modules/presence/    NEW — see §4d below
│       ├── app.ts               Express app assembly + /health (+ /presence mount, NEW)
│       └── index.ts             entrypoint — NOW creates an http.Server + boots
│                                 Socket.IO + the presence keyspace listener (§4d)
└── frontend/
    └── src/
        ├── api/                  client.ts (fetch wrapper + silent refresh), auth.ts, hierarchy.ts
        ├── state/                authStore.ts, hierarchyStore.ts — both zustand
        ├── components/
        │   ├── AuthShell, Field, RolePill, RadarSweepBackground, ProtectedRoute   (Phase 1)
        │   └── hierarchy/        Phase 2 UI — see §4b below
        ├── pages/                LoginPage, RegisterPage, DashboardPage
        └── styles/               global.css (design tokens), forms.css
```

Frontend is **completely untouched this session** — Phase 4 is backend-only,
same as Phase 3. No presence UI exists yet (no online/offline dot, no
Socket.IO client connection, nothing in `frontend/src` imports `socket.io-client`
— it isn't even a frontend dependency). See §4d for why, and §7 for what a
future frontend-presence session would need to build.

---

## 3. Phase 1 recap (unchanged since it was built — see git history/prior
HANDOFF versions in the zip if you need more detail)

Auth (register/login/refresh/logout, JWT access token in memory +
httpOnly rotating refresh cookie, bcrypt), `GET /users/me`, `User` /
`Organization` / `Session` models, structured errors, the "Vantage"
dark command-deck design system on the frontend. Full detail was in the
Phase-1-only version of this file; condensed here because Phase 2 now
supersedes several of its "not built yet" notes.

---

## 4. Phase 2 — Hierarchy (NEW this session)

### Schema changes (`backend/prisma/schema.prisma`)

- Added `RemovalReason` enum: `DIRECT | GROUP_LEADER_REMOVED`.
- Added to `User`: `removalReason`, `removedBy` (plain string user-id,
  **not** a Prisma relation — see rationale comment in the schema file:
  three self-relations on one model for audit metadata wasn't worth the
  complexity), `removedBecauseOf`, `removedAt`. All nullable, all
  currently null for every existing row.
- Added `HierarchyEvent` model — **append-only audit log**. Never
  updated or deleted. This is deliberately separate from the removal
  columns on `User`, which describe *current* state only and get
  **cleared** (not preserved) on reactivation. History lives in
  `HierarchyEvent`, not in mutable columns — if you need "show me every
  time this user was removed and restored," query `HierarchyEvent`, not
  `User`.
- **A real Postgres migration has not been run or generated in this
  sandbox** (same `binaries.prisma.sh` network restriction as Phase 1 —
  see §5). Run `npx prisma migrate dev --name phase2-hierarchy` in a
  normal environment before starting the backend.

### New module: `backend/src/modules/hierarchy/`

- `hierarchy.repository.ts` — three raw-SQL recursive CTE queries
  (`getDescendants`, `getAncestors`, `getOrganizationTree`), per master
  spec §35's explicit instruction to use recursive CTEs before
  materialized paths/closure tables. Uses `Prisma.sql` for the shared
  column list and tagged-template parameterization (safe from SQL
  injection). **Never selects `passwordHash`.**
- `hierarchy.schemas.ts` — zod validation for creating a member
  (name/email/password).
- `hierarchy.service.ts` — the actual logic:
  - `createMember(actor, role, input)` — creates a `LEADER` or `PEER`
    under the actor. **Role-creation rule implemented**:
    `ROOT_LEADER` and `LEADER` can both create `LEADER` or `PEER`;
    `PEER` can create nobody. This resolves the "can leaders create
    nested leaders?" open question from the Phase 1 handoff — chosen
    because it matches the master spec's own illustrated hierarchy
    (§3, LEADER C nested under LEADER B). **Flag this decision to the
    user; it was not explicitly confirmed.**
  - `getMySubtree(actor)` — actor + all descendants, flat list.
  - `getMyAncestors(actor)` — ancestor chain, nearest-parent-first.
  - `getOrganizationTree(actor)` — **ROOT_LEADER only**, full flat org
    list. This is a deliberate Phase 2 simplification, not full
    visibility scoping — general parent/descendant visibility for
    LEADER/PEER (master spec §16, branch isolation) is explicitly
    deferred to Phase 3's authorization service. Don't mistake this
    role gate for the real authorization layer.
  - `removeNode(actor, targetId)` — **cascading removal**, master spec
    §6-9. Validates: target exists in same org, target isn't the actor,
    target isn't `ROOT_LEADER` (can't be removed), target is currently
    `ACTIVE`, and — the actual authorization check — **actor must be an
    ancestor of target** (`requireOwnership`, walks the ancestor chain
    via the repository). On success: target → `REMOVED` /
    `DIRECT` / `removedBy=actor`; every currently-**ACTIVE**
    descendant → `REMOVED` / `GROUP_LEADER_REMOVED` /
    `removedBecauseOf=target.id`. Already-removed descendants are
    **skipped** so a prior removal's reason/actor is never overwritten
    (§13's "do not overwrite historical events"). Whole thing runs in a
    `$transaction`, and emits one `HierarchyEvent` per affected node.
  - `reactivateNode(actor, targetId)` — **ownership-based restoration**,
    master spec §11-12. Same ancestor-based authorization check. Key
    rule: **does not cascade** — only flips the target node itself.
    Enforces top-down restoration order by requiring the target's
    *immediate* parent to currently be `ACTIVE` before allowing the
    target to be reactivated (throws `INVALID_HIERARCHY_OPERATION`
    otherwise, with a message telling the caller to restore the parent
    first). Clears the removal columns on the live row; the historical
    record persists in `HierarchyEvent`.
- `hierarchy.controller.ts` / `hierarchy.routes.ts` — thin, standard
  shape matching the auth/users modules. All routes behind
  `requireAuth`.

### New API surface (mounted at `/hierarchy` in `app.ts`)

```
POST   /hierarchy/leaders            create a LEADER under the caller
POST   /hierarchy/peers              create a PEER under the caller
GET    /hierarchy/subtree            caller's own subtree (self + descendants)
GET    /hierarchy/ancestors          caller's ancestor chain
GET    /hierarchy                    full org tree — ROOT_LEADER only
DELETE /hierarchy/nodes/:id          cascading removal
POST   /hierarchy/nodes/:id/reactivate   ownership-based restoration
```

### New error codes (`common/errors.ts`)

`NODE_NOT_FOUND` (404), `INVALID_HIERARCHY_OPERATION` (400),
`INVALID_ROLE` (400, defined but not yet thrown anywhere — reserved for
Phase 3).

---

## 4b. Phase 2 frontend — hierarchy UI (NEW this session)

Backend was already done (§4 above, prior session). This session built
the Dashboard UI against it, per HANDOFF §7 item 2's own spec.

### New files

```
frontend/src/api/hierarchy.ts             typed wrappers for all 7 /hierarchy endpoints
frontend/src/state/hierarchyStore.ts      zustand: root, members, fetchSubtree, addMember,
                                           removeMember, reactivateMember, isMutating, error
frontend/src/components/hierarchy/
  hierarchyUtils.ts        buildTree/flattenTree (parentId → tree), countActiveDescendants
                            (client-side cascade-count prediction for the confirm dialog),
                            nodeName (id → display name lookup within root+members)
  HierarchyPanel.tsx        top-level section: fetch-on-mount, owns modal state, renders below
  AddMemberForm.tsx/.css    collapsible Leader/Peer tabs + Field inputs; hidden for PEER role
                            (UI convenience only — backend ROLE_CREATION_RULES is still the
                            real gate)
  HierarchyTree.tsx/.css    flattens buildTree() output into rows
  HierarchyNodeRow.tsx/.css indent-by-depth row: RolePill, ACTIVE dot / clickable REMOVED tag,
                            Remove button (hidden for self), Reactivate button (REMOVED only)
  RemoveConfirmModal.tsx    warns with a real predicted cascade count (countActiveDescendants)
                            before calling DELETE /hierarchy/nodes/:id
  RemovalDetailsModal.tsx   master spec §9's removal-details panel — reason / removed by /
                            removed because of / removed at, all read directly off
                            HierarchyNode fields, nothing inferred client-side
  Modal.css                 shared dark-modal chrome for the two modals above
```

### Edited files

- `frontend/src/types/index.ts` — added `RemovalReason` and `HierarchyNode`
  (hand-mirrors backend `hierarchy.types.ts`, same "no shared-types
  package yet" convention as `PublicUser`).
- `frontend/src/pages/DashboardPage.tsx` / `.css` — removed the
  "Hierarchy / Phase 2" card from the `UPCOMING_PHASES` roadmap grid
  (it's built now), added `<HierarchyPanel />` in a new
  `.dashboard__main-column` wrapper above the remaining roadmap cards.

### Design/API notes for whoever picks this up next

- **Every add is always "under me."** `POST /hierarchy/leaders` and
  `/peers` hard-code `parentId = freshActor.id` server-side — there is
  no "add under a chosen node" endpoint. So `AddMemberForm` only ever
  appears once, tied to the signed-in user, not per-row. If a future
  session wants "B adds a peer under C" in one step, that's a new
  backend capability, not a frontend gap.
- **Mutations always refetch** (`fetchSubtree()` again after every
  add/remove/reactivate) rather than patching client state by hand.
  Deliberate: cascading removal and restoration-ordering logic lives
  entirely server-side (master spec §15/§41); reconstructing that
  client-side would risk silently drifting from what the backend
  actually did. Org sizes at this stage make the extra round-trip cheap.
  Revisit only if profiling says otherwise.
- **`removedBy` / `removedBecauseOf` are expected to always resolve** to
  a name via `nodeName()` without a fallback-to-API-lookup path: because
  `removeNode` requires the actor to be an ancestor of the target
  (`requireOwnership`), whoever performed any removal inside a given
  actor's subtree is necessarily also inside that same actor's subtree
  — so `root + members` from one `GET /hierarchy/subtree` call is always
  enough to label every removal shown in that view. If this stops being
  true (e.g. Phase 3 changes who's allowed to remove whom), `nodeName()`'s
  id-slice fallback will silently start showing truncated ids instead of
  names — worth grepping for if removal details ever look wrong later.
- **Cascade-count in the confirm modal is a client-side prediction**
  (`countActiveDescendants`, mirrors the backend's own
  `status === "ACTIVE"` filter) purely for UX copy before the request is
  sent. The server is still what actually decides and executes the
  cascade; this number is never sent to the API or trusted for anything
  but display.
- **PEER can't see the add-member form** (`canAddMembers = role !==
  "PEER"` in `HierarchyPanel`) — cosmetic only, matches master spec §37's
  own example of UI-convenience-vs-real-enforcement. The actual boundary
  is `ROLE_CREATION_RULES` in `authorization.service.ts` now (moved there
  in Phase 3, see §4c) — same rule, new location.

---

## 4c. Phase 3 — Authorization (NEW this session)

Backend-only phase, as the master spec's Phase 3 scope implies (§47
lists "permission service, subtree authorization, parent visibility,
descendant visibility, role authorization, secure APIs" — no frontend
item). No frontend files were touched this session.

### New module: `backend/src/modules/authorization/`

- `authorization.types.ts` — the `Action` union:
  `CREATE_LEADER | CREATE_PEER | REMOVE_NODE | REACTIVATE_NODE |
  VIEW_VISIBILITY_SCOPE`. Extend this, not a second rule table, when a
  future module (presence/radar/P2P authorization) needs a new decision.
- `authorization.service.ts` — the actual policy, per master spec §15's
  `canPerform(actor, action, target)`:
  - `canPerform(actor, action, target?)` → `Promise<boolean>`, no
    throwing, one `switch` over `Action`. A `never`-typed default case
    makes the compiler error if a new `Action` is added without a
    matching case — deliberate, so this can't silently drift out of
    sync with the type union.
  - `assertCanPerform(actor, action, target?, message?)` — throwing
    wrapper (`AppError("FORBIDDEN", ...)`), what services actually call.
  - `isAncestorOf(actorId, targetId)` — the ownership check, calls
    `hierarchyRepo.getAncestors(targetId)` and checks membership. Used
    by `REMOVE_NODE` and `REACTIVATE_NODE`.
  - `ROLE_CREATION_RULES` — moved here **unchanged** from Phase 2's
    `hierarchy.service.ts` (`ROOT_LEADER`/`LEADER` can create
    `LEADER`/`PEER`, `PEER` can create nobody). Still the same
    not-explicitly-confirmed-by-the-user default flagged in Phase 2's
    HANDOFF §8 — one line to change (`ROLE_CREATION_RULES.LEADER`) if
    the user wants `ROOT_LEADER`-only leader creation instead.
  - `getVisibilityScope(actor)` — `{ ancestors, descendants }` via
    `Promise.all([hierarchyRepo.getAncestors, hierarchyRepo.getDescendants])`.
    This is the master spec §16 visibility model made real: parent chain
    + own subtree, nothing from unrelated branches. For a `ROOT_LEADER`
    this happens to cover the whole org — not because of a role check,
    but because everyone's ancestor chain terminates at the root, so the
    root's own descendant set already *is* everyone. No special-casing
    needed, which was the actual point of doing this in Phase 3 instead
    of leaving Phase 2's role gate in place.

### `hierarchy.service.ts` changes

- Removed the inline `ROLE_CREATION_RULES` const and `requireOwnership`
  function entirely. `createMember` now calls
  `authorizationService.assertCanPerform(freshActor, "CREATE_LEADER" |
  "CREATE_PEER", undefined, <same error message as before>)`.
  `removeNode`/`reactivateNode` now call
  `authorizationService.assertCanPerform(freshActor, "REMOVE_NODE" |
  "REACTIVATE_NODE", target, <same error message as before>)` in place
  of `requireOwnership`.
- **Domain-precondition checks were deliberately left in place**, not
  moved into the authorization module: `removeNode`'s "not yourself" /
  "not the root leader" / "not already removed" checks, and
  `reactivateNode`'s "must currently be REMOVED" / "immediate parent
  must be ACTIVE" checks, all still live in `hierarchy.service.ts`. The
  reasoning (also written as a comment at the top of the file now): those
  are "does this operation even make sense" questions with specific,
  helpful error messages, not "who is allowed" questions. `canPerform`'s
  `REMOVE_NODE`/`REACTIVATE_NODE` cases **also** re-check
  self-removal/root-immutability internally (so the policy module is
  correct and testable in isolation, see below) — by the time
  `hierarchy.service.ts` reaches the `assertCanPerform` call those
  specific paths are already ruled out, so this is intentional
  defense-in-depth, not dead code; a future caller of `canPerform` that
  skips the domain checks is still protected.
- **`getOrganizationTree` was replaced with `getVisibilityScope`** —
  renamed, and semantics changed:
  - **Before (Phase 2)**: `ROOT_LEADER`-only, threw `FORBIDDEN` for
    everyone else, returned `{ nodes: HierarchyNode[] }` (flat, whole
    org).
  - **After (Phase 3)**: any active user, returns
    `{ self, ancestors, descendants }`.
  - Controller export renamed to match
    (`hierarchyController.getVisibilityScope`), route unchanged
    (`GET /hierarchy` in `hierarchy.routes.ts`).
  - **This is a breaking response-shape change on `GET /hierarchy`** —
    confirmed safe because the frontend never called this endpoint (grepped
    for it before changing; only `/hierarchy/subtree`,
    `/hierarchy/leaders`, `/hierarchy/peers`, and
    `/hierarchy/nodes/:id[/reactivate]` are used anywhere in
    `frontend/src`). If a future session wires up an "org view" UI
    against `GET /hierarchy`, build it against the new shape.
  - `hierarchy.repository.ts`'s `getOrganizationTree` (the raw-SQL flat
    org query) is now unused by any service but was **left in place**,
    not deleted — it's a working, previously-SQL-verified query
    (`docs/PHASE2_VERIFICATION.md`) that's the natural fit for a future
    admin/audit view or the Radar "ALL" filter (master spec §18) for a
    `ROOT_LEADER`. Said so in a comment at its definition.

### New tests: `backend/src/modules/authorization/authorization.service.test.ts`

15 vitest unit tests, all passing (`node node_modules/vitest/vitest.mjs
run` — see §5c for why not the `.bin/vitest` shim directly). Covers
master spec §46's authorization list where it's testable without a live
database:
- role-creation rules: `ROOT_LEADER`/`LEADER` can create `LEADER`/`PEER`,
  nested `LEADER` creation works, `PEER` can create neither (privilege
  escalation denied)
- `REMOVE_NODE`/`REACTIVATE_NODE`: no target → denied, self-removal →
  denied, removing `ROOT_LEADER` → denied, ancestor removing a
  descendant → allowed, **cross-branch removal → denied** (the actual
  §16 branch-isolation case: B tries to remove C's descendant P3 and is
  rejected)
- `hierarchy.repository` is mocked (`vi.mock`) rather than hit for real —
  same reason as always in this project: Prisma can't run in this
  sandbox. **This tests `canPerform`'s logic given a known ancestor
  chain, not the real recursive-CTE ancestor query** — that part is
  still only verified at the raw-SQL level from Phase 2
  (`docs/PHASE2_VERIFICATION.md`), not through the actual TypeScript
  service. Still true that nobody has run this against a live
  Postgres/Redis stack end-to-end. See §5c and §7.

---

## 4d. Phase 4 — Real-Time Presence (NEW this session)

Backend-only phase, matching the Phase 3 precedent: master spec §47's
Phase 4 list ("Socket.IO, Redis adapter, presence, heartbeat, TTL,
distributed presence") is entirely backend infrastructure — no frontend
item is implied, and none was built. No frontend files were touched this
session (verified by `git`-style diff of the extracted zip before/after —
everything under `frontend/` is byte-identical to the Phase 3 delivery).

### New module: `backend/src/modules/presence/`

- `presence.types.ts` — `PresenceStatus = "ONLINE" | "OFFLINE"` only.
  Master spec §20 lists a broader vocabulary (also CONNECTING/CONNECTED/
  DISCONNECTED, REMOVED, DISCOVERABLE/HIDDEN) — the file's top comment
  explains why each of those is deliberately **not** modeled here:
  CONNECTING/CONNECTED/DISCONNECTED describe a P2P *session's* state
  (Phase 5), REMOVED isn't a presence value at all (a removed user simply
  never has a presence record — see below), and DISCOVERABLE/HIDDEN is an
  unbuilt future visibility preference (Phase 6/7 territory). Also
  defines `PresenceRecord` (the JSON shape stored in Redis),
  `PresenceSnapshotEntry` (API-facing shape), and `PresenceChangedEvent`
  (the internal transition-event shape — see service section below).
- `presence.repository.ts` — raw Redis layer, same role
  `hierarchy.repository.ts` plays for Postgres (no policy logic, just
  reads/writes):
  - `PRESENCE_TTL_SECONDS = 30` — chosen to give roughly one missed
    heartbeat of slack assuming a ~15s client heartbeat interval. **Not
    validated against a real frontend heartbeat loop, because none
    exists yet** — this number is a reasonable starting guess, not a
    measured one. Revisit once a frontend actually heartbeats.
  - `presenceKey(userId)` → `presence:{userId}`, holding a JSON-encoded
    `PresenceRecord` with a 30s Redis-native `EX` TTL.
  - A second key family, `presence:sockets:{userId}` (a Redis **Set**,
    no TTL, cleaned up explicitly) — tracks every currently-connected
    socket id for that user, so multi-tab/multi-device (master spec §29)
    doesn't flip someone OFFLINE just because they closed one of several
    open tabs. `addSocket`/`removeSocket` (returns the remaining count)/
    implicit `SCARD` are how the service decides "was this the user's
    *last* connection."
  - `writeRecord`, `readRecord`, `readMany` (batched `MGET` for snapshot
    building), `deleteRecord`.
- `presence.service.ts` — the actual logic. This is the file to read
  first if you're extending presence or building Phase 5's signaling on
  top of it:
  - `requireActiveActor(userId)` — same re-fetch-from-Postgres pattern as
    `hierarchy.service.ts`'s function of the same name, **deliberately
    duplicated locally** rather than imported (matches this codebase's
    existing convention — `users.service.ts` also inlines its own copy
    rather than sharing one; see the code comment for the reasoning).
  - `getAudience(userId)` — the authorization-scoped broadcast audience
    for a presence change about `userId`. Reuses Phase 3's
    `authorizationService.getVisibilityScope({id: userId})`
    (ancestors + descendants) and includes `userId` itself. **The key
    insight documented in the code**: because the ancestor/descendant
    relation is symmetric, "everyone authorized to see X's presence" is
    exactly "X's own visibility scope" — no new authorization primitive
    was needed for this, and no new `Action` was added to
    `authorization.types.ts`.
  - `handleConnect(userId, socketId)` — called once per new Socket.IO
    connection (from `presence.gateway.ts`, after JWT verification).
    Re-checks the actor is `ACTIVE` in Postgres (throws
    `UNAUTHORIZED`/`USER_INACTIVE` otherwise — the gateway turns that
    into a rejected connection), tracks the socket, writes an `ONLINE`
    record, and broadcasts **only if** the previous record was missing
    or not already `ONLINE` — a second tab/device connecting while
    already online does not re-broadcast.
  - `handleHeartbeat(userId)` — **silent** TTL renewal only. No Postgres
    check, no broadcast, ever. This is intentional: heartbeats are
    expected every ~15s and neither a DB round-trip nor a socket
    broadcast on every single one would be justified for something that,
    by definition, isn't a status change.
  - `handleDisconnect(userId, socketId)` — removes the socket from the
    tracked set; only deletes the Redis presence key and broadcasts
    `OFFLINE` once the set is empty (i.e. this was the user's last
    connection).
  - `handleTTLExpiry(userId)` — called by the keyspace listener (below)
    when a presence key expires without a renewing heartbeat. Redis has
    already dropped the key by the time this runs, so there's nothing to
    delete — it only broadcasts `OFFLINE`. **Known, documented gap**:
    this does not attempt to clean up `presence:sockets:{userId}`,
    because it doesn't know which specific socket went stale. In the
    ordinary case (dropped connection / closed tab) Socket.IO's own
    ping-timeout will eventually fire a real `disconnect` for that
    socket too, and `handleDisconnect` cleans up the set then — until
    that happens the socket set may over-count for that user, which is
    harmless for the ONLINE/OFFLINE broadcast logic itself (unaffected
    by the set's contents) but worth knowing if the set is ever
    inspected directly for some other purpose later.
  - `getSnapshotForActor(actor)` — used by both `GET /presence` and the
    Socket.IO `presence:snapshot` event on connect. Re-fetches the actor
    fresh, gets their visibility scope, batch-reads Redis for everyone in
    it. A missing Redis key reads back as `OFFLINE` with `lastSeen: null`
    — deliberately not distinguishing "never connected" from "cleanly
    disconnected" from "TTL-expired," since all three mean the same thing
    to a caller: this user is not currently present.
  - `presenceEvents` — a plain Node `EventEmitter`, exported. Every
    transition function above calls `emitTransition`, which computes the
    audience and emits a single `"presence:changed"` event
    (`PresenceChangedEvent`). **This is the decoupling point between
    presence logic and Socket.IO**: `presence.service.ts` never imports
    `io` or anything from `socket.io`. This is why the 13 unit tests
    (below) can test real transition logic without a Socket.IO server —
    they just attach a listener to `presenceEvents` and assert on what
    gets emitted.
- `presence.gateway.ts` — `registerPresenceHandlers(io)`, called exactly
  once from `config/socket.ts`:
  - `io.use(authenticateSocket)` — connection-time auth. Verifies the
    JWT the same way `requireAuth.ts` does for REST
    (`socket.handshake.auth.token`, no `Bearer` prefix — that's an HTTP
    header convention, Socket.IO's auth payload is a plain object), but
    **also** re-fetches the actor from Postgres and rejects the
    connection outright if they're not `ACTIVE`. This is stricter than
    REST's `requireAuth`, which only decodes the JWT and defers the
    fresh-DB-check to whichever service method gets called next — the
    reasoning (in the code comment) is that a socket connection is
    comparatively long-lived, so it's worth paying for one DB read at
    connect time to close the "removed user's still-valid token opens a
    brand-new connection" gap. See the residual gap this leaves for
    *already-open* sockets, documented in both this file and
    `handleConnect`'s docblock, and repeated in §4d's "known gaps"
    subsection below.
  - Subscribes to `presenceService.presenceEvents` exactly once (inside
    `registerPresenceHandlers`, not at module load time, since `io` isn't
    available until then) and fans each `"presence:changed"` event out to
    `io.to("user:" + id).emit("presence:update", ...)` for every id in
    the event's audience. **This subscription is process-global** —
    calling `registerPresenceHandlers` twice would double-broadcast every
    transition. It's currently only ever called once, from
    `config/socket.ts`'s `initSocketIO`; if a future session refactors
    server bootstrapping, preserve that invariant.
  - On `connection`: joins the socket to room `user:{id}`, calls
    `handleConnect`, then emits `presence:snapshot` (the same shape
    `GET /presence` returns) directly to the connecting socket. Any
    thrown error here (e.g. `handleConnect`'s `ACTIVE` check somehow
    still failing — defense in depth, since `authenticateSocket` should
    already have caught it) disconnects the socket rather than leaving it
    half-initialized.
  - `socket.on("presence:heartbeat", ...)` and `socket.on("disconnect",
    ...)` call the matching service functions, logging (not throwing) on
    failure so one bad heartbeat doesn't crash anything.
- `presence.keyspaceListener.ts` — `startPresenceExpiryListener()`,
  called once from `index.ts`. Attempts
  `CONFIG SET notify-keyspace-events Ex` on the shared Redis connection
  (best-effort — wrapped in try/catch, logs a warning and continues if
  it fails, e.g. because a managed Redis provider disables `CONFIG SET`),
  then opens a **dedicated duplicated** Redis connection (subscriber mode
  occupies a connection exclusively — this is the same reason
  `config/socket.ts` duplicates two more connections for the Socket.IO
  Redis adapter) and subscribes to `__keyevent@0__:expired`. On a
  matching `presence:*` key, calls `presenceService.handleTTLExpiry`.
  **If `CONFIG SET` is unavailable, this whole push-notification path
  silently does nothing** — logged clearly, and explicitly **not**
  treated as fatal, because `getSnapshotForActor` reads an expired key as
  simply absent = `OFFLINE` regardless of whether this listener is
  running. Only the proactive "tell already-connected clients someone
  just went stale in real time" behavior depends on it.
- `presence.controller.ts` / `presence.routes.ts` — one route,
  `GET /presence` → `presenceService.getSnapshotForActor(actor)`. Same
  thin-controller shape as every other module (`requireActor` helper
  duplicated locally, matching the existing per-controller convention).

### New API surface

```
GET /presence            REST snapshot: { self, users } — same shape the
                          Socket.IO "presence:snapshot" event sends on connect
```

### New Socket.IO surface (not a REST endpoint — connect via `socket.io-client` to the backend's origin, same port as the REST API)

```
Client sends:
  auth: { token: <access token, same one used as the REST Bearer token> }   (on connect)
  "presence:heartbeat"                                                        (no payload; every ~15s recommended)

Server sends:
  "presence:snapshot"   { self: {...}, users: [...] }        (once, right after connect)
  "presence:update"     { userId, status, lastSeen }         (on any ONLINE/OFFLINE transition
                                                                for anyone in your visibility scope)
```

### Infra changes

- `backend/src/config/socket.ts` (new) — `initSocketIO(httpServer)`
  constructs the Socket.IO `Server`, attaches
  `@socket.io/redis-adapter` (via two `redis.duplicate()` connections —
  a pub/sub client can't run other commands, hence dedicated
  connections, not the shared client) so `io.to(room).emit(...)` reaches
  sockets connected to *other* server instances too (master spec §21's
  explicit multi-server requirement), then calls
  `registerPresenceHandlers(server)`. Also exports `getIO()` for future
  phases (Phase 5 signaling, Phase 7 radar pushes) that might want to
  broadcast without owning their own connection-handling code — **unused
  by anything in Phase 4 itself**, added because it's a one-line, low-risk
  affordance, not because Phase 4 needed it.
- `backend/src/index.ts` (rewritten) — now builds an `http.Server`
  explicitly (`http.createServer(app)`) instead of calling
  `app.listen(...)` directly, since Socket.IO needs the raw HTTP server
  to perform the WebSocket upgrade. Calls `initSocketIO(httpServer)` and
  `startPresenceExpiryListener()` before `httpServer.listen(...)`. The
  Redis-connection-failure handling is unchanged in spirit from Phase 1
  (log and keep booting rather than crash) — comment updated to note
  presence now functionally depends on Redis, unlike Phase 1-3.
- `backend/src/app.ts` — one import + one `app.use("/presence",
  presenceRouter)` line added. Nothing else in `app.ts` changed.
- `backend/package.json` — added `socket.io` and `@socket.io/redis-adapter`
  as real dependencies (`npm install --ignore-scripts socket.io
  @socket.io/redis-adapter`, same `--ignore-scripts` flag every prior
  session has used to dodge Prisma's blocked postinstall). Versions were
  left to whatever npm resolved (`@socket.io/redis-adapter` landed on
  `^8.3.0`) rather than pinned by hand.

### Known gaps — read before extending this (deliberately not solved this phase)

1. **A user removed mid-session is not forcibly disconnected.** The
   `ACTIVE` check happens at Socket.IO connect time
   (`authenticateSocket`) and again defensively inside
   `handleConnect` — but nothing currently reaches into an
   *already-connected* socket when `hierarchy.service.ts`'s
   `removeNode` runs. A removed user's still-open socket keeps working
   (heartbeats keep renewing their presence as `ONLINE`) until they
   disconnect on their own or their access token naturally expires
   (≤`JWT_ACCESS_TTL`, currently 15 minutes). This mirrors the same
   realistic-security-model gap the master spec already accepts for
   WebRTC revocation (§27: "a malicious client can ignore an
   application-level revocation event") — server-side authorization is
   enforced for *new* connections/actions here, not retroactively torn
   down against an already-established one. Closing this gap would mean
   `removeNode` reaching into the Socket.IO layer (e.g. looking up and
   force-disconnecting that user's sockets, or maintaining a
   short-lived revocation-check on each heartbeat) — that's a
   reasonable Phase 8 (Security Hardening) candidate, not Phase 4 scope.
   **Flagging this explicitly so it isn't mistaken for an oversight.**
2. **TTL-expiry push notifications depend on Redis allowing `CONFIG
   SET`.** Verified working against this project's own
   `redis:7-alpine` docker-compose service (where `CONFIG SET` is
   unrestricted) — **not** verified against any managed/hosted Redis
   provider, some of which disable `CONFIG SET` entirely. If that
   happens in a real deployment, `startPresenceExpiryListener` logs a
   warning and the app keeps running; snapshot reads
   (`GET /presence`, connect-time `presence:snapshot`) stay correct
   either way (an expired key just reads as absent = OFFLINE) — only
   the proactive "push an update to already-connected clients the
   moment someone goes stale" behavior is lost. If this project is ever
   deployed against managed Redis, check that provider's docs for
   keyspace-notification support before assuming this path works.
3. **`presence:sockets:{userId}` can over-count after a TTL expiry**
   (detailed in the `handleTTLExpiry` bullet above) until Socket.IO's
   own ping-timeout eventually fires a real `disconnect` for the stale
   socket. Does not affect the ONLINE/OFFLINE broadcast logic itself.
4. **`PRESENCE_TTL_SECONDS = 30` is a guess, not a measurement** — there
   is no frontend heartbeat loop yet to validate the 30s TTL / ~15s
   heartbeat-interval assumption against. Whoever builds the frontend
   presence client should treat this as a starting point, not a fixed
   constant, and may want to tune both numbers together.

---

## 5. Verification performed this session (backend, Phase 2 — prior session)

- `npx tsc --noEmit` in `backend/` after adding the hierarchy module:
  found and fixed one **real** bug (`noUncheckedIndexedAccess` flagged
  `ROLE_CREATION_RULES[freshActor.role]` as possibly `undefined`; fixed
  with a `?? []` fallback). All remaining tsc errors are the **same
  known sandbox limitation as Phase 1**: `@prisma/client`'s types
  (`User`, `Role`, `RemovalReason`, `UserStatus`, `Prisma.sql`) aren't
  available because `prisma generate` can't reach
  `binaries.prisma.sh` from this sandbox's network allowlist. This is
  environmental, not a code defect — **run `npx prisma generate` (or
  `migrate dev`) on a normal machine and re-run `tsc --noEmit`; it
  should come back fully clean.** If it doesn't, that's a real bug to
  chase down, not this same known issue.
- **SQL logic has now been integration-tested against a real
  PostgreSQL instance** — all 6 cases passed (recursive descendants CTE,
  recursive ancestors CTE, cascading removal, non-cascading restoration,
  top-down restoration ordering enforcement, and "never overwrite an
  already-removed descendant's history"). Full detail and reproduction
  steps: `docs/PHASE2_VERIFICATION.md`. **Important caveat**: this
  tested the literal SQL strings via `psql` directly, copied out of
  `hierarchy.repository.ts`/`hierarchy.service.ts` by hand — it did
  **not** execute the actual TypeScript service functions or HTTP
  routes, because `PrismaClient` still can't run in this sandbox (same
  `binaries.prisma.sh` block as the type-generation issue below). A bug
  in the TypeScript glue around otherwise-correct SQL would not be
  caught by this. Turning this into real `vitest` integration tests
  (master spec §46) is still the right next step once Prisma can run
  normally.
- No automated tests exist yet for hierarchy logic. Master spec §46 has
  a full test matrix for this (cascading removal, restoration ordering,
  ownership) — writing these tests is still a good candidate for a
  future increment.

### 5b. Verification performed this session (frontend, Phase 2 UI)

- `npm install` + `npx tsc --noEmit` in `frontend/` — **clean**, no
  errors. This project's `tsconfig.json` has `strict`,
  `noUnusedLocals`, and `noUnusedParameters` all on, so this is a
  reasonably strong signal (unused-import/dead-code mistakes would have
  failed this).
- `npx vite build` — **clean production build**, 77 modules, no
  warnings.
- **Not verified**: this was not clicked through against a running
  backend. Same sandbox limitation as the backend's own Phase 2
  verification (`binaries.prisma.sh` is outside the network allowlist,
  so Prisma can't run here → no live API to hit). The type-level
  contract between frontend and backend was checked by hand instead:
  every request/response shape in `api/hierarchy.ts` was read directly
  from `hierarchy.controller.ts`/`hierarchy.service.ts`'s actual
  `res.json(...)` calls, not guessed from the routes list or the master
  spec. That's a real check, but it is not the same as an integration
  test — **the next session with a working Prisma/Postgres/Redis
  environment should run both stacks together and click through**: add
  a leader, add a peer under that leader (needs a second login — the
  UI has no "log in as" shortcut, use a second browser profile or
  incognito window), remove the leader and confirm the cascade warning
  count matches what actually happens, reactivate, check the removal
  details modal against what Postgres actually stored.

### 5c. Verification performed this session (backend, Phase 3 — authorization)

- `npm install --ignore-scripts` in `backend/` (avoids the Prisma
  postinstall hitting the blocked `binaries.prisma.sh` — same
  restriction noted throughout this file).
- `npx tsc --noEmit` — **failed initially for an unrelated reason**:
  `tsconfig.json`'s `"moduleResolution": "node"` is deprecated in the
  TypeScript version this environment resolved (`6.0.3` — package.json
  pins `^5.5.4`, so a newer minor/major got installed). Fixed by adding
  `"ignoreDeprecations": "5.0"` to `backend/tsconfig.json` (note: **not**
  `"6.0"` — tried that first, it's an invalid value for this flag and
  errors immediately; `"5.0"` is correct). This is a real, small,
  keep-it fix independent of Phase 3 — it was blocking `tsc --noEmit`
  outright.
- **After that fix, `tsc --noEmit` still showed errors — the familiar
  ones.** All remaining errors are `@prisma/client` exporting no
  `PrismaClient`/`Role`/`User`/`Prisma`/etc. members, in the same files
  every prior session has hit (`config/prisma.ts`, `auth.service.ts`,
  `tokens.ts`, `hierarchy.*.ts`, and now `authorization.service.ts`
  joins that list). Confirmed the cause is still exactly what HANDOFF
  has said since Phase 1: ran `npx prisma generate` directly and got
  `Failed to fetch sha256 checksum at
  https://binaries.prisma.sh/... 403 Forbidden`. **This is environmental,
  not a code defect — same as every previous session.** (One earlier
  attempt this session showed a fully-clean `tsc --noEmit` because a
  stale, previously-populated `node_modules/.prisma/client` was still
  on disk from an earlier install in the same sandbox session before a
  clean re-install. Don't trust a clean Prisma-types result unless it
  follows a genuinely fresh `rm -rf node_modules && npm install`, as
  this one did.)
- **Two real bugs found and fixed by that tsc run**, same class of bug
  Phase 2 already hit once: `noUncheckedIndexedAccess` flags
  `ROLE_CREATION_RULES[actor.role]` (a `Record<Role, Role[]>` indexed by
  a variable) as possibly `undefined` even though the record is
  constructed to cover every `Role`. Fixed with the same `?? []`
  fallback Phase 2 used for the identical pattern, in
  `authorization.service.ts`'s `CREATE_LEADER`/`CREATE_PEER` cases.
  **After this fix, the only remaining `tsc --noEmit` errors are the
  `@prisma/client` ones above** — confirmed by re-running.
- `node node_modules/vitest/vitest.mjs run` — **15/15 passing**, both
  before and after the bug fix above (the bug wasn't something the
  mocked unit tests could catch — `noUncheckedIndexedAccess` is a
  type-level check, not a runtime one; this is worth remembering next
  session: passing tests don't mean `tsc --noEmit` is clean, run both).
  (Aside: `node_modules/.bin/vitest` needed `chmod +x` first — it was
  extracted from the zip without the executable bit; not a code issue,
  just how zip round-tripped file permissions. `npm install` in a normal
  non-zip environment should make the `.bin` shim work directly, but
  `node node_modules/vitest/vitest.mjs run` is a working fallback either
  way.)
- Frontend: confirmed by `grep` that nothing in `frontend/src` calls
  `GET /hierarchy` (only `/hierarchy/subtree`, `/leaders`, `/peers`,
  `/nodes/:id[/reactivate]` are used) — so the `GET /hierarchy`
  breaking-response-shape change is safe. Frontend `tsc`/`vite build`
  were **not** re-run this session since no frontend files were touched
  — Phase 2's own verification (§5b) still stands for that half of the
  repo.
- **Not verified, same gap as every prior session**: nothing was run
  against a live Postgres/Redis instance or through the real HTTP layer.
  `authorization.service.test.ts` mocks `hierarchy.repository` rather
  than hitting a database — it proves `canPerform`'s branching logic is
  correct given a known ancestor chain, not that the real recursive CTE
  produces that chain correctly for a live org (Phase 2's
  `docs/PHASE2_VERIFICATION.md` covers the CTEs themselves, at the raw
  SQL level, separately). **The next session with real Postgres/Redis
  access should**: run `npx prisma migrate dev`, start both stacks,
  register a `ROOT_LEADER`, build out a small tree (`A → B → {P1, C →
  P3}`), then specifically try to have `B` remove a node that isn't in
  `B`'s subgroup (e.g. a sibling leader's peer) and confirm the API
  actually returns `403 FORBIDDEN` — not just that the unit test says it
  should.

### 5d. Verification performed this session (backend, Phase 4 — presence)

- `npm install --ignore-scripts socket.io @socket.io/redis-adapter` in
  `backend/` — succeeded, resolved `@socket.io/redis-adapter@^8.3.0`.
  Same `--ignore-scripts` reasoning as every prior session (dodges
  Prisma's postinstall hitting the blocked `binaries.prisma.sh`).
- `npx tsc --noEmit` — **clean except the same standing `@prisma/client`
  errors every phase has hit** (confirmed by re-running
  `npx prisma generate` directly and getting the identical `403
  Forbidden` from `binaries.prisma.sh` documented since Phase 1 — this
  is environmental, not a Phase 4 regression). **Zero errors in any new
  Phase 4 file** (`config/socket.ts`, all of `modules/presence/`, the
  edited `index.ts`/`app.ts`) — the new code type-checks cleanly against
  the same (ungenerated) Prisma type stubs everything else has been
  living with since Phase 1.
- `npm test` (`vitest run`) — **28/28 passing**: the 13 new
  `presence.service.test.ts` tests plus the 15 pre-existing
  `authorization.service.test.ts` tests, unmodified and still green.
  The new tests cover: rejecting a removed/nonexistent actor's connect
  attempt without touching Redis state; broadcasting `ONLINE` on a
  first connection and on a stale→online transition; **not**
  broadcasting when a second device connects while already online;
  the broadcast audience containing the actor's ancestors + descendants
  (mocked `authorizationService.getVisibilityScope`); heartbeat being
  silent (no DB call, no broadcast); disconnect only going `OFFLINE`
  once the last tracked socket is gone; TTL expiry always broadcasting
  `OFFLINE`; and `getSnapshotForActor` correctly mixing `ONLINE`/
  `OFFLINE` entries and rejecting a removed actor.
  `presence.repository` and `../../config/prisma` and
  `../authorization/authorization.service` are all mocked (`vi.mock`) —
  same reasoning as every prior test file in this project: Prisma and
  Redis can't run in this sandbox. **This tests
  `presence.service.ts`'s branching/broadcast logic given known mock
  return values — it does not exercise real Redis TTL expiry, real
  Redis keyspace notifications, a real Socket.IO connection/handshake,
  or the `@socket.io/redis-adapter` actually relaying a broadcast
  between two server processes.** None of those have automated test
  coverage yet; they can only be checked by hand against a live stack
  (see the checklist below).
- **Not verified at all this session, and this is the single biggest gap
  to close before trusting Phase 4 in a real deployment**: nothing was
  run against a live Postgres/Redis instance, no real Socket.IO client
  ever connected to a real server, the Redis keyspace-expiry path was
  never observed actually firing, and multi-server broadcast (the
  literal point of the `@socket.io/redis-adapter` integration) was never
  exercised against two real server processes. **The next session with
  real Postgres/Redis access should, in order**:
  1. `docker compose up -d`, `npx prisma migrate dev`, start the backend
     normally (`npm run dev`), and confirm `GET /health` reports Redis
     connected.
  2. Connect a Socket.IO client by hand (e.g. `node -e` with
     `socket.io-client`, or a scratch HTML file) using a real access
     token from `/auth/login`, and confirm: `presence:snapshot` arrives
     on connect; sending `presence:heartbeat` every few seconds keeps
     `redis-cli GET presence:{userId}` alive past the 30s TTL; closing
     the client (or killing the process) causes
     `redis-cli GET presence:{userId}` to eventually return nothing and
     — critically — confirm `redis-cli SUBSCRIBE __keyevent@0__:expired`
     actually fires for that key (this is the one piece of this phase
     with no automated coverage and the most likely to silently not
     work in a given environment, since it depends on `CONFIG SET`
     succeeding).
  3. Connect a **second** user in the first user's visibility scope
     (e.g. their direct parent or a descendant) and confirm they receive
     a `presence:update` event when the first user connects/disconnects
     — and confirm a user in an **unrelated branch** does *not* receive
     it (the actual authorization-scoping claim this phase makes).
  4. If pursuing the multi-server claim specifically: run two backend
     processes on different ports against the same Redis, connect one
     client to each, and confirm a presence change on server A's socket
     produces a `presence:update` on server B's socket — this is the
     one thing that can't be verified any other way, since it's the
     entire reason `@socket.io/redis-adapter` was added.
  5. Only after the above: `GET /presence` by hand with a real Bearer
     token and sanity-check the response against what step 2-3 already
     showed via sockets.

---

## 6. Conventions to preserve

(Established in Phase 1, demonstrated again by hierarchy, authorization,
and now presence — follow this same shape for Phase 5's signaling
module.)

- Module shape: `*.routes.ts` → `*.controller.ts` (thin, `asyncHandler`)
  → `*.service.ts` (logic, re-fetches actor from DB, throws `AppError`)
  → `*.schemas.ts` (zod). Repository files (raw SQL/Redis) are their own
  layer when a service needs queries/commands the ORM's fluent API
  can't express well — `hierarchy.repository.ts` for raw SQL,
  `presence.repository.ts` for raw Redis, same pattern either way.
- **Never trust JWT claims for authorization** — every service function
  re-fetches the actor (`requireActiveActor` pattern, now duplicated a
  third time in `presence.service.ts` — see §4d for why that's
  intentional rather than an unshared abstraction).
- Add new `ErrorCode`s to the union in `common/errors.ts`, don't
  hand-roll status codes. (Phase 4 needed none — `presence.service.ts`
  reuses the existing `UNAUTHORIZED`/`USER_INACTIVE` codes.)
- Add schema fields with the feature that needs them, not speculatively
  — as done twice now (removal fields deferred out of Phase 1, added
  exactly when Phase 2 needed them). Phase 4 needed **no** Prisma schema
  changes at all — presence state lives entirely in Redis, per master
  spec §41's persistent/ephemeral split.
- **Redis is now functionally load-bearing, as of Phase 4** — presence
  correctness depends on it being reachable. It is still not the source
  of truth for anything persistent (that's still exclusively Postgres);
  it's ephemeral/derived state that can be safely lost and rebuilt from
  live Socket.IO connections reconnecting. If a future phase adds more
  Redis-backed ephemeral state (P2P leases in Phase 5, transient
  location in Phase 6), consider whether it needs its own key
  namespace/TTL convention distinct from `presence:*` — don't silently
  reuse presence's keys or TTL constant for an unrelated concern.
- **Decoupling pattern worth reusing**: `presence.service.ts` never
  imports `socket.io` — it emits on a plain `EventEmitter`
  (`presenceEvents`) and `presence.gateway.ts` is the only file that
  turns those into actual socket broadcasts. This is why presence logic
  has real unit test coverage without a running Socket.IO server. Phase
  5's P2P signaling will likely want the same split (a signaling
  *service* with its own events, a thin *gateway* that wires it to
  `io`) rather than writing `io.to(...).emit(...)` calls directly inside
  business logic.

---

## 7. What's next

**Immediate options, in order of what unblocks the most:**

1. ~~Integration-test the hierarchy module~~ — **done at the SQL level**,
   see `docs/PHASE2_VERIFICATION.md`. Still worth doing through the real
   TypeScript/HTTP layer once Prisma can run in a normal environment.
2. ~~Frontend hierarchy UI~~ — **done Phase 2**, see §4b. Still needs a
   real click-through against a live backend (§5b) — do that before
   assuming it's bug-free, only the type contract was verified.
3. ~~Phase 3 — Authorization~~ — **done**, see §4c. Same caveat as
   everything else so far: unit-tested with a mocked repository, never
   run against a live database or through the real HTTP layer (§5c).
4. ~~Phase 4 — Real-Time Presence~~ — **done this session**, see §4d.
   Backend only (no frontend presence UI yet — see item 6 below). Same
   standing caveat, now also true of this phase: unit-tested with
   mocked Redis/Postgres, never run against a live stack. **This one
   has an extra unverified piece the others didn't**: the actual
   multi-server Redis-adapter broadcast claim has literally never been
   observed working, because that requires two real server processes,
   not just one live database. See §5d's numbered checklist — do that
   before building anything else on top of presence.
5. **Phase 5 — WebRTC P2P is the actual next phase now** (master spec
   §47 Phase 5, §23-28): signaling, renewable P2P authorization leases,
   DataChannels, revocation events, reconnection, server relay fallback.
   Explicitly **do not** build the file-transfer protocol yet — that's
   Phase 9, and it's still blocked on a design the user hasn't shared
   (master spec §33, §54's non-negotiable list). Phase 4's Socket.IO
   infrastructure is directly reusable for signaling: reuse
   `authenticateSocket`'s pattern (or literally the same middleware) for
   any new gateway, reuse the personal `user:{id}` room convention for
   direct signaling delivery, and reuse the `EventEmitter`-decoupling
   pattern (§6) so P2P session logic stays unit-testable the same way
   presence turned out to be.
6. **No frontend presence UI exists yet.** Phase 4 was scoped
   backend-only to match master spec §47's own Phase 4 list (see §4d).
   A future session could add a Socket.IO client connection
   (`socket.io-client` isn't a frontend dependency yet — it would need
   adding), an online/offline indicator on `HierarchyNodeRow` (Phase
   2's existing hierarchy tree rows are the natural place — presence
   data and hierarchy data cover the same set of users, i.e. the
   caller's visibility scope), and a heartbeat loop tuned against
   `PRESENCE_TTL_SECONDS` (currently 30s, see §4d gap #4). This is not
   currently on the critical path to Phase 5 and could be done either
   before or after it — use judgment, or ask the user.
7. Also still open, not blocking Phase 5 but worth doing whenever there's
   a real Postgres/Redis/two-server environment available: the full
   end-to-end verification checklist in §5d (backend) and §5c's last
   bullet / §5b's click-through (earlier phases). Every session so far
   has verified logic in isolation (types, mocked units, hand-checked
   request/response contracts, one SQL-level integration check) but
   **nobody has yet run this app for real against a live stack, and
   nobody has ever run two server processes at once to verify the
   multi-server presence claim specifically.** That combination is the
   single biggest unknown-unknown risk in the project right now —
   worth prioritizing over new Phase 5 features if a normal
   (non-sandboxed) environment becomes available.

Do not start Phase 6+ before Phase 5 is solid, and don't treat Phase 4's
multi-server claim as verified until §5d's checklist has actually been
run once against two real processes.

---

## 8. Open questions / decisions made without explicit user confirmation

- **Resolved in Phase 2, still not confirmed by the user, now living in
  a new location:** `LEADER`s can create nested `LEADER`s (not just
  `PEER`s). If the user wants `ROOT_LEADER`-only leader creation
  instead, this is now a one-line change to `ROLE_CREATION_RULES` in
  `backend/src/modules/authorization/authorization.service.ts` (moved
  there from `hierarchy.service.ts` in Phase 3 — see §4c).
- No constraint on org size or max hierarchy depth yet — unbounded.
- No "invite" flow — creating a Leader/Peer sets their password directly
  via the creating leader; there's no email/invite-link step. Fine for
  now, worth flagging if this becomes a real product.
- **New this session:** `GET /hierarchy`'s response shape changed
  (`{nodes}` → `{self, ancestors, descendants}`) and its access rule
  changed (`ROOT_LEADER`-only → any active user). Confirmed safe against
  the current frontend (nothing calls it), but this was not something
  the user explicitly asked for — it followed directly from master spec
  §16 and Phase 2's own HANDOFF flagging it as a deliberate
  simplification to fix later. Worth a one-line mention to the user
  next time you're summarizing changes for them, in case they were
  relying on the old shape somewhere outside this repo (e.g. manual
  `curl`/Postman testing).
- **New this session (Phase 4):** `PRESENCE_TTL_SECONDS = 30` and the
  implied ~15s client heartbeat interval are both guesses, not numbers
  the user specified or that were validated against a real frontend
  heartbeat loop (none exists yet). Cheap to change
  (`presence.repository.ts`, one constant) — flag to the user if they
  have a specific latency/battery-life tradeoff in mind before a
  frontend heartbeat loop gets built against it.
- **New this session (Phase 4):** presence status is ONLINE/OFFLINE
  only — master spec §20's fuller vocabulary (CONNECTING/CONNECTED/
  DISCONNECTED, DISCOVERABLE/HIDDEN) was deliberately not implemented,
  reasoned through in §4d's `presence.types.ts` bullet. This wasn't
  explicitly confirmed with the user as the right scope for Phase 4 — it
  was inferred from master spec §47's own Phase 4 checklist (which
  doesn't mention those states) and from those states more naturally
  belonging to later phases. Worth a one-line mention if the user
  expected a richer presence model sooner.
- **New this session (Phase 4):** a user removed mid-session is not
  forcibly disconnected from an already-open Socket.IO connection — see
  §4d's "known gaps" #1 for the full reasoning. This is a real,
  user-facing security-adjacent gap (not just an implementation detail)
  and probably deserves an explicit conversation with the user about
  whether it's acceptable for now or needs to be pulled forward from
  Phase 8.

---

## 9. Non-negotiable principles (carried over from the master spec — do not violate these regardless of what phase you're implementing)

```
HIERARCHY DEFINES AUTHORITY.
AUTHORIZATION DEFINES VISIBILITY.
PRESENCE DEFINES AVAILABILITY.
NETWORK TOPOLOGY DEFINES COMMUNICATION PATH — it does not mirror hierarchy.
POSTGRESQL IS THE PERSISTENT SOURCE OF TRUTH. REDIS IS EPHEMERAL ONLY.
THE FRONTEND IS NEVER THE CONTROL-PLANE SECURITY BOUNDARY.
PHYSICAL PROXIMITY NEVER GRANTS AUTHORIZATION.
WEBRTC CONNECTIONS ARE NOT MAGICALLY SERVER-REVOCABLE ONCE ESTABLISHED.
REMOVAL IS EXPLICIT STATE, NEVER A PHYSICAL DELETE, NEVER A SILENT RE-PARENT.
CASCADING REMOVAL RECORDS ITS CAUSE (DIRECT vs GROUP_LEADER_REMOVED).
RESTORATION RESTORES OWNERSHIP, NOT AUTOMATICALLY THE WHOLE SUBTREE.
DO NOT INVENT THE DATA-TRANSFER PROTOCOL (PHASE 9) — THE USER IS DESIGNING
IT SEPARATELY AND WILL SHARE IT WHEN READY.
```

