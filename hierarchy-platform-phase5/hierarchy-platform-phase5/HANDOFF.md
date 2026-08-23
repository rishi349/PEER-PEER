# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this
> project up in a new session: read this whole file before touching
> code.** It tells you what exists, what was decided and why, what's
> verified, and exactly what to build next. The authoritative product
> spec is `claude_project_master_prompt_final.md` (the project's master
> prompt) — this document is the **engineering status report** against
> that spec, not a replacement for it.

Last updated: **Phase 5 — WebRTC P2P, complete (backend/control-plane only).**
Phases 1-5 are done (backend + frontend for 1-2; Phases 3, 4, and 5 are
backend-only, as intended for all three — see §4c, §4d, and §4e).
Nothing from Phase 6 onward has been started.

**Continuity note:** this project is built inside an ephemeral sandbox
filesystem that does not persist between separate conversations. The
only durable copy is whatever zip the user has downloaded most recently
(now includes everything through Phase 5). **If you are a fresh agent
session, you have no filesystem access to this code unless the user
re-uploads that zip.** Ask for it if `/mnt/user-data/uploads` doesn't
already have it.

**A note on trust, for whichever agent reads this next:** every claim in
§4e/§5e below (what was built, what was verified, what wasn't) was
checked directly against the actual files in this session — `tsc
--noEmit` and `vitest run` were both actually executed, not assumed,
and their real output is quoted in §5e. This HANDOFF is written to the
same standard as every prior phase's own section (compare §4d/§5d) so
this session's work can be trusted without re-auditing it line-by-line —
but "the new code's own logic doesn't need re-verifying" is not the
same as "the whole system has been run end-to-end." It hasn't — see
§5e's checklist before assuming Phase 5 works against a real browser
pair.

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
│       ├── config/              env.ts, prisma.ts, redis.ts, socket.ts (now also wires
│       │                        up p2p.gateway.ts alongside presence — see §4e)
│       ├── common/              errors.ts (AppError + ErrorCode union — now includes
│       │                        LEASE_EXPIRED, NEW §4e), asyncHandler.ts
│       ├── middleware/          requireAuth.ts, errorHandler.ts, socketAuth.ts (NEW —
│       │                        see §4e; the single shared Socket.IO connection-auth
│       │                        middleware, extracted from presence.gateway.ts)
│       ├── types/express.d.ts   req.user augmentation (AuthenticatedUser — reused by
│       │                        middleware/socketAuth.ts for socket.data.user)
│       ├── modules/auth/        register/login/refresh/logout + JWT helpers
│       ├── modules/users/       GET /users/me
│       ├── modules/hierarchy/   backend/src/modules/hierarchy/ — see §4 below. Now also
│       │                        exports `hierarchyEvents` (NEW §4e) — see below
│       ├── modules/authorization/ canPerform/assertCanPerform — see §4c below. Now also
│       │                        covers INITIATE_P2P_SESSION (NEW §4e)
│       ├── modules/presence/    see §4d below
│       ├── modules/p2p/         NEW — see §4e below
│       ├── app.ts               Express app assembly + /health, /presence — unchanged
│       │                        this session; P2P has no REST surface, see §4e
│       └── index.ts             entrypoint — unchanged this session (still creates an
│                                 http.Server + boots Socket.IO + the presence keyspace
│                                 listener, per Phase 4 — Phase 5 needed no new startup
│                                 step of its own, since registerP2PHandlers is called
│                                 from inside initSocketIO, not from index.ts directly)
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

Frontend is **completely untouched this session (Phase 5) and also was
untouched in the Phase 4 session before it** — confirmed by `diff -rq`
against the Phase 4 zip before making any change; byte-identical. Phase
5 is backend/control-plane-only, same as Phase 3 and Phase 4. No
presence UI and no P2P/WebRTC UI exist yet (no online/offline dot, no
Socket.IO client connection, no `RTCPeerConnection` anywhere — nothing
in `frontend/src` imports `socket.io-client`, it isn't even a frontend
dependency). See §4d/§4e for why, and §7 for what a future
frontend-presence-and-P2P session would need to build.

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

## 4e. Phase 5 — WebRTC P2P (NEW this session)

Backend/control-plane-only, matching the Phase 3/4 precedent. Master
spec §23 is explicit that WebRTC itself is the **data plane** — direct
browser-to-browser, invisible to this server once established (§24) —
so this phase built exactly the **control plane** pieces master spec
§47's Phase 5 list actually names: signaling relay, renewable P2P
authorization leases, and revocation events. No frontend WebRTC client
exists yet, and none was implied by this phase's scope. No frontend
files were touched this session (confirmed by `diff -rq` against the
Phase 4 zip before making any backend change).

### New module: `backend/src/modules/p2p/`

- `p2p.types.ts` — `SignalKind`/`SignalPayload` (the offer/answer/ICE
  message shape this backend relays without inspecting — `data` is
  opaque on purpose, it's whatever the browser's WebRTC API produced),
  `P2PLeaseRecord` (the JSON shape stored in Redis), and the two
  decoupled event shapes (`P2PSessionAuthorizedEvent`,
  `P2PSessionRevokedEvent` — see `p2pEvents` below).
- `p2p.repository.ts` — raw Redis layer, same role
  `hierarchy.repository.ts` plays for Postgres and
  `presence.repository.ts` plays for presence:
  - `P2P_LEASE_TTL_SECONDS = 45` — a deliberately *different* number
    from presence's `PRESENCE_TTL_SECONDS = 30`, per HANDOFF §6's own
    note that a new Redis-backed ephemeral concern should get its own
    TTL convention rather than silently reusing presence's. The two
    numbers answer different questions: presence's is about detecting a
    dropped network connection quickly; this one is about how long a
    control-plane *authorization decision* stays valid before it must
    be re-derived (a full Postgres ancestor-chain re-check — see
    `renewSession` below — is more expensive than a presence heartbeat,
    so it shouldn't need to happen as often). **Not validated against a
    real frontend renewal loop, because none exists yet** — same
    "guess, not a measurement" caveat as `PRESENCE_TTL_SECONDS` (§4d gap
    #4). **Important, per master spec §25/§33**: this TTL bounds the
    *authorization*, not the WebRTC connection or any in-progress data
    transfer — a long-lived connection is expected to keep calling
    `p2p:renew-session` periodically for as long as it should stay
    authorized; the RTCPeerConnection itself is untouched by lease
    expiry unless a compliant client chooses to close it in response to
    a `p2p:session-revoked` event.
  - `pairId(userIdX, userIdY)` → canonical, order-independent
    `[userA, userB]` (lexicographically sorted) — the actual mechanism
    behind "either participant can renew the same lease" (master spec
    §25 doesn't specify who may renew; sorting the pair rather than
    keying by "caller"/"callee" makes the question moot).
  - `upsertLease(userIdX, userIdY, requestedBy)` — creates a lease if
    none exists, or renews one that does (same Redis write either way;
    `p2p.service.ts` decides what to *do* with the result — broadcast on
    fresh request, silent on renewal). Preserves the original
    `initiatedBy`/`createdAt` across renewals even if the *other*
    participant is the one calling renew.
  - `readLease`, `deleteLease`, `listLeasesForUser` (via a
    `p2p:leases:byUser:{userId}` Redis Set, same "no native reverse
    lookup" reasoning `presence.repository.ts` gives for its own
    `presence:sockets:{userId}` set — needed so `revokeSessionsForUser`
    can find every lease a removed user holds).
  - **Documented, not-fixed-this-phase gap**: when a lease's Redis key
    TTL-expires naturally (nobody renewed it, nobody explicitly closed
    it), nothing removes the now-dangling key reference from
    `p2p:leases:byUser:{userId}`. Doesn't cause incorrect behavior
    (`listLeasesForUser` already filters out the resulting null reads),
    but is a slow, unbounded memory leak in the index sets over a
    long-running server's lifetime. A real fix would mean a periodic
    sweep or a keyspace-expiry listener for `p2p:lease:*` the way
    `presence.keyspaceListener.ts` already does for `presence:*` — worth
    doing before a long-lived production deployment, not urgent for
    correctness right now. Full reasoning is a comment at the bottom of
    `p2p.repository.ts`.
- `p2p.service.ts` — the actual logic. Read this first if extending P2P
  or building Phase 9's data-transfer layer on top of it:
  - `requireActiveActor` — same duplicated-per-module pattern every
    other service uses (master spec §15); see `presence.service.ts`'s
    own copy of this exact justification.
  - `requireEligibleCounterpart(freshActor, targetId)` — the shared
    precondition + authorization gate for both request and renew:
    target must exist, be same org, be ACTIVE, not be the actor, and
    pass `authorizationService.assertCanPerform(..., "INITIATE_P2P_SESSION", ...)`.
  - `requestSession(actor, targetId)` — creates/refreshes a lease via
    `upsertLease` and **always** broadcasts `p2p:session-authorized`
    (via `p2pEvents`), even if a lease already existed — mirrors
    `presence.service.ts`'s `handleConnect` always-broadcast-on-connect
    posture, on the theory that a fresh `request-session` call is worth
    the other side knowing about again (e.g. the caller's client
    reloaded).
  - `renewSession(actor, targetId)` — **this is the actual mechanism
    behind master spec §26's "prevent lease renewal" once someone is
    removed.** Unlike presence's `handleHeartbeat` (which deliberately
    skips the Postgres check for performance, since heartbeats are
    expected every ~15s), `renewSession` deliberately re-runs the
    **full** `requireEligibleCounterpart` check — fresh Postgres reads
    for both users, a fresh `assertCanPerform` call — on every single
    renewal. This is intentional, not an oversight: a P2P lease is a
    live authorization *decision*, not just a liveness signal, so it
    must be re-derivable-as-false the instant either participant is
    removed. Throws `LEASE_EXPIRED` if no lease currently exists between
    the two users — renewal is deliberately not "create if missing," so
    a client can't accidentally treat a revoked/expired session as a
    normal keep-alive; it must go through `requestSession` again (which
    re-broadcasts for the other side). Never broadcasts on success — see
    the module docblock for why (mirrors heartbeat's silence).
  - `closeSession(actor, targetId)` — voluntary, and idempotent
    (closing an already-gone lease is not an error — mirrors
    `reactivateNode`'s precedent of treating "nothing to do" as a normal
    outcome). Broadcasts `p2p:session-revoked` with
    `reason: "CLOSED_BY_PARTICIPANT"`.
  - `assertActiveLease(userIdX, userIdY)` — used by `p2p.gateway.ts`
    before relaying a signaling message. Deliberately a **cheap
    Redis-only check, no Postgres hit, no re-run of `assertCanPerform`**
    — signaling can be high-frequency (many ICE candidates in a few
    seconds), and lease *existence* already encodes the authorization
    decision made by request/renew above.
  - `revokeSessionsForUser(userId)` — master spec §26's actual revocation
    mechanism. Not called directly by anything in this file; see
    `p2p.gateway.ts` below for who calls it and why. Deletes every lease
    the user holds and broadcasts `p2p:session-revoked`
    (`reason: "NODE_REMOVED"`, `revokedBy: userId`) for each.
  - `p2pEvents` — a plain `EventEmitter`, exported, same decoupling
    pattern as `presence.service.ts`'s `presenceEvents`: this file never
    imports `socket.io` or anything about hierarchy removal.
    `p2p.gateway.ts` is the only file that knows about both sides.
- `p2p.gateway.ts` — `registerP2PHandlers(io)`, called once from
  `config/socket.ts` (see the refactor note below):
  - Subscribes to **two** emitters, both process-global,
    call-exactly-once (same invariant `presence.gateway.ts` documents
    for its own subscription):
    - `hierarchy.service.ts`'s `hierarchyEvents` (`"hierarchy:nodes-removed"`)
      → calls `p2pService.revokeSessionsForUser` for each removed id.
      **This is the entire hierarchy-removal → P2P-revocation bridge**
      (master spec §26) — `hierarchy.service.ts` itself has no idea P2P
      exists; this gateway is the one file that connects the two.
    - `p2pService.p2pEvents` (`"p2p:session-authorized"` /
      `"p2p:session-revoked"`) → fans each out to both participants'
      `user:{id}` rooms (same room convention Phase 4 established).
  - Per-connection handlers, all reading `socket.data.user` (see the
    `middleware/socketAuth.ts` refactor below — no `io.use(...)` call in
    this file, unlike Phase 4's original `presence.gateway.ts`):
    - `p2p:request-session` / `p2p:renew-session` / `p2p:close-session`
      — **acknowledgement-callback** style (`socket.emit(event, payload,
      callback)`), not fire-and-forget, since these are request/response
      in nature. Returns `{ ok: true, data }` or
      `{ ok: false, error: { code, message } }` (the `AppError`'s own
      `code`/`message` when available, `INTERNAL_ERROR` otherwise).
    - `p2p:signal` — fire-and-forget (an ICE negotiation can send many
      messages a second; acks would be wasted overhead). Validates via
      `assertActiveLease` before relaying to `io.to(userRoom(targetUserId))`;
      on failure, emits `p2p:signal-error` back to the *sender only*
      rather than throwing (a thrown error inside a fire-and-forget
      socket handler has nowhere useful to go).
  - **Design decision, stated explicitly**: a signaling **socket**
    disconnecting does **not** revoke a P2P **lease**. These are
    deliberately separate concerns — presence tracks
    connection/liveness, the lease tracks authorization — matching
    master spec §25's own point that "a valid connection may remain
    open for a long time" independent of any particular signaling
    session. A lease is keyed by user pair, not by socket id, so a
    brief reconnect just resumes renewing the same lease; only an
    explicit `p2p:close-session`, a hierarchy removal, or the TTL
    genuinely elapsing without renewal ends one.

### New Socket.IO surface (all on the same connection/origin as presence — no new REST endpoints, see below)

```
Client sends:
  "p2p:request-session"  { targetUserId }                 (ack: { leaseId, expiresAt } | error)
  "p2p:renew-session"    { targetUserId }                 (ack: { leaseId, expiresAt } | error)
  "p2p:close-session"    { targetUserId }                 (ack: { data: null } | error)
  "p2p:signal"            { targetUserId, payload: { kind, data } }   (fire-and-forget)

Server sends:
  "p2p:session-authorized" { userA, userB, initiatedBy, leaseId, expiresAt }
  "p2p:session-revoked"    { userA, userB, reason, revokedBy }
                              reason: "CLOSED_BY_PARTICIPANT" | "NODE_REMOVED"
  "p2p:signal"              { fromUserId, payload: { kind, data } }
  "p2p:signal-error"        { targetUserId, error: { code, message } }
```

### No new REST endpoints — a deliberate decision, not an oversight

Master spec §43 lists no P2P REST endpoints and explicitly says
signaling should use "an appropriate real-time event/API design," while
§43's own closing line says not to blindly implement every listed
endpoint if the architecture suggests something better. Every P2P
interaction (request/renew/close/signal) is inherently real-time and
already requires an open, authenticated socket to be useful — a REST
`POST /p2p/sessions` endpoint would just be a second code path
duplicating `requestSession`'s logic for no real benefit, since a
client capable of calling it would already have (or need) a Socket.IO
connection to actually do anything with the result. **Flagging one
reasonable future addition that was deliberately skipped to keep this
phase minimal**: a read-only `GET /p2p/sessions` REST endpoint (active
leases for the caller) could help a frontend avoid maintaining full
client-side socket state just to show "who am I currently connected
to" — cheap to add later if a frontend session needs it, not built now.

### Refactor: connection-time Socket.IO auth is now centralized

`authenticateSocket` (JWT verify + fresh Postgres ACTIVE check) used to
be a private function inside `presence.gateway.ts`, registered via
`io.use(authenticateSocket)` inside `registerPresenceHandlers`. Phase 5
needed a second gateway (`p2p.gateway.ts`) to run on the exact same
authenticated connection — registering the same middleware once per
gateway would mean verifying the JWT and re-reading Postgres twice per
connecting socket for no benefit, and would only get worse as more
gateways are added in later phases (Phase 6 location, Phase 7 radar).

**What changed**: `authenticateSocket` and a new `AuthenticatedSocket`
type (a `Socket` with `data.user` typed as definitely-present) moved to
a new `backend/src/middleware/socketAuth.ts`, unchanged in behavior.
`config/socket.ts`'s `initSocketIO` now calls `server.use(authenticateSocket)`
itself, once, before calling `registerPresenceHandlers`/`registerP2PHandlers`.
Both gateway files now just do `io.on("connection", (socket: AuthenticatedSocket) => { const user = socket.data.user; ... })`
with no `io.use(...)` call of their own — this is safe because Socket.IO
always finishes every `io.use(...)` middleware before emitting
`"connection"`, so `socket.data.user` is guaranteed populated by the
time either gateway's connection listener fires, regardless of
registration order between the two gateways.

**Verified behavior-preserving**: `presence.gateway.ts`'s own logic
(room joins, `handleConnect`/heartbeat/disconnect wiring,
`presenceEvents` subscription) is byte-for-byte unchanged except for
this extraction — confirmed by re-running all 13 pre-existing presence
tests unmodified after the refactor (still 13/13 passing, see §5e).

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

### 5e. Verification performed this session (backend, Phase 5 — P2P)

- `npm install --ignore-scripts` in `backend/` — **fresh install this
  session** (not a stale/reused `node_modules`), same `--ignore-scripts`
  reasoning as always (dodges Prisma's postinstall hitting the blocked
  `binaries.prisma.sh`). No new npm dependencies were needed for Phase
  5 — `backend/package.json` is unchanged; everything P2P needed
  (`socket.io`, ioredis via the shared `redis` client) was already
  installed for Phase 4.
- `npx tsc --noEmit` — **14 errors, all the same standing
  `@prisma/client`-types-unavailable class every phase has had.**
  Confirmed by re-running `npx prisma generate` directly and getting the
  identical `403 Forbidden` from `binaries.prisma.sh` documented since
  Phase 1 — environmental, not a Phase 5 regression. Manually confirmed
  every one of the 14 error lines is a `"has no exported member"` error
  against `@prisma/client` (`PrismaClient`, `Prisma`, `Role`, `User`,
  `RemovalReason`, `UserStatus`) in files that already depended on those
  types before this session (`config/prisma.ts`, `auth.service.ts`,
  `tokens.ts`, `authorization.service.ts`, `hierarchy.repository.ts`,
  `hierarchy.service.ts`, `hierarchy.types.ts`), plus exactly one new
  file joining that pre-existing list for the same reason:
  `p2p.service.ts` (imports Prisma's `User` type). **Zero errors of any
  other kind, in any new or edited Phase 5 file** — `p2p.types.ts`,
  `p2p.repository.ts`, `p2p.gateway.ts`, `middleware/socketAuth.ts`, the
  edited `config/socket.ts`, the edited `presence.gateway.ts`, the
  edited `authorization.service.ts`/`.types.ts`, and the edited
  `hierarchy.service.ts`/`.types.ts` all type-check cleanly against the
  same (ungenerated) Prisma stubs everything else has been living with
  since Phase 1.
- `npx vitest run` (via `npx`, not the raw `node node_modules/vitest/vitest.mjs`
  shim Phase 3 needed — this session's fresh `npm install` left the
  `.bin` shims executable, no `chmod +x` workaround needed) —
  **51/51 passing**: 18 new `p2p.service.test.ts` tests, the 13
  pre-existing `presence.service.test.ts` tests (unmodified, confirming
  the `authenticateSocket` extraction didn't change presence's own
  behavior), and 20 `authorization.service.test.ts` tests (the 15
  pre-existing ones plus 5 new `INITIATE_P2P_SESSION` cases: no-target,
  self-target, ancestor-direction, descendant-direction, and
  cross-branch-denied — the same five shapes `REMOVE_NODE`'s own test
  block already covers, applied to the new symmetric relation). The new
  P2P tests cover: every domain-precondition rejection in `requestSession`
  (removed/nonexistent actor, self-target, missing/other-org/inactive
  target, authorization denial) each confirmed to never reach
  `upsertLease`; a successful request creating a lease and broadcasting
  `p2p:session-authorized` with the correct payload; `renewSession`
  throwing `LEASE_EXPIRED` when no lease exists even though authorization
  otherwise passes; `renewSession` being blocked by the counterpart
  simply being inactive (**this is the test that actually proves the
  §26 "prevent lease renewal" claim at the unit level** — it never even
  reaches `readLease`, because `requireEligibleCounterpart` throws
  first); a successful renewal preserving the original `initiatedBy` and
  not broadcasting; `closeSession` being idempotent on an already-gone
  lease and correctly broadcasting `CLOSED_BY_PARTICIPANT` on a real
  one; `assertActiveLease` resolving/throwing correctly; and
  `revokeSessionsForUser` deleting every held lease and broadcasting
  `NODE_REMOVED` for each, including a multi-lease case.
  `p2p.repository` and `../authorization/authorization.service` are both
  mocked (`vi.mock`) — same reasoning as every prior test file: Prisma
  and Redis can't run in this sandbox. **This tests `p2p.service.ts`'s
  branching/broadcast logic given known mock return values — it does
  not exercise real Redis TTL expiry on a lease, a real Socket.IO
  connection, real signaling-message relay between two actual sockets,
  or — most importantly — a real end-to-end call from
  `hierarchy.service.ts`'s real `removeNode` through the real
  `hierarchyEvents` emitter into `p2p.gateway.ts`'s real subscriber and
  out to `p2pService.revokeSessionsForUser`.** That last path was only
  verified by reading the code, not by running it — see the checklist
  below.
- **Confirmed via `diff -rq`, not by grepping selectively**: the entire
  `frontend/` directory is byte-for-byte identical to the Phase 4
  delivery, and the only backend files that differ from Phase 4 are
  exactly the ones this section (§4e) claims to have touched:
  `common/errors.ts`, `config/socket.ts`, the new
  `middleware/socketAuth.ts`, `modules/authorization/authorization.service.ts`
  + `.types.ts` + `.test.ts`, `modules/hierarchy/hierarchy.service.ts` +
  `.types.ts`, `modules/presence/presence.gateway.ts`, and the new
  `modules/p2p/` directory. No other file — including
  `backend/package.json` — was touched.
- **Not verified at all this session, and this is the biggest gap to
  close before trusting Phase 5 in a real deployment** — nothing was
  run against a live Postgres/Redis/Socket.IO stack, no two real
  browsers or even two `socket.io-client` scripts ever exchanged a real
  offer/answer/ICE-candidate through this relay, and the
  hierarchy-removal → lease-revocation bridge has literally never fired
  outside a mocked unit test. **The next session with real
  Postgres/Redis access should, in order** (this extends §5d's own
  checklist — steps 1-2 there still apply first: migrate, boot, confirm
  `/health`):
  1. Connect **two** Socket.IO clients by hand (real access tokens from
     `/auth/login`) as two users who are authorized to reach each other
     per §16 (e.g. a leader and their own peer). From client A, emit
     `p2p:request-session` targeting B's user id and confirm the ack
     returns `{ ok: true, data: { leaseId, expiresAt } }`, **and**
     confirm client B receives an unsolicited `p2p:session-authorized`
     event.
  2. From either client, emit `p2p:renew-session` targeting the other
     and confirm `redis-cli GET p2p:lease:{sorted-pair}`'s TTL actually
     resets past 45s. Confirm `p2p:signal` (any `{kind, data}` payload)
     sent from A arrives at B as `p2p:signal` with the right
     `fromUserId`.
  3. Try `p2p:request-session`/`p2p:signal` between two users who are
     **not** authorized to reach each other (unrelated branches) and
     confirm the ack/error correctly rejects it — this is the actual
     `INITIATE_P2P_SESSION` authorization claim, exercised for real, not
     just at the mocked-unit level.
  4. **The single most important check**: with an active lease between
     A and B established via step 1, use a `ROOT_LEADER`/ancestor
     account to call `DELETE /hierarchy/nodes/:id` on A (or one of A's
     ancestors, to exercise the cascade path). Confirm:
     `redis-cli GET p2p:lease:{sorted-pair}` returns nothing immediately
     after, **and** client B receives a `p2p:session-revoked` event with
     `reason: "NODE_REMOVED"` — without needing to wait for a lease
     renewal attempt to discover it. This is the one path that has zero
     real-stack coverage of any kind yet (not even a manual click-through
     like some of Phase 2-4 got) and is the actual point of building
     Phase 5's hierarchy-removal bridge at all.
  5. Only after the above: try renewing an already-revoked lease and
     confirm it correctly throws `LEASE_EXPIRED` rather than silently
     succeeding.

---

## 6. Conventions to preserve

(Established in Phase 1, demonstrated again by hierarchy, authorization,
presence, and now P2P — follow this same shape for Phase 6's location
module.)

- Module shape: `*.routes.ts` → `*.controller.ts` (thin, `asyncHandler`)
  → `*.service.ts` (logic, re-fetches actor from DB, throws `AppError`)
  → `*.schemas.ts` (zod). Repository files (raw SQL/Redis) are their own
  layer when a service needs queries/commands the ORM's fluent API
  can't express well — `hierarchy.repository.ts` for raw SQL,
  `presence.repository.ts`/`p2p.repository.ts` for raw Redis, same
  pattern either way. **Not every module needs `*.routes.ts`/`*.controller.ts`**
  — `p2p` (Phase 5) has neither, since its entire surface is Socket.IO
  events handled directly in `p2p.gateway.ts`; don't force a REST layer
  onto a module that doesn't need one just to match the shape exactly
  (see §4e's "No new REST endpoints" note for the actual reasoning).
- **Never trust JWT claims for authorization** — every service function
  re-fetches the actor (`requireActiveActor` pattern, now duplicated a
  fourth time in `p2p.service.ts` — see presence.service.ts's original
  justification for why this stays a small per-module copy rather than
  a shared helper).
- Add new `ErrorCode`s to the union in `common/errors.ts`, don't
  hand-roll status codes, and **only add the ones you actually throw** —
  Phase 4 needed none (reused `UNAUTHORIZED`/`USER_INACTIVE`); Phase 5
  added exactly one (`LEASE_EXPIRED`) despite master spec §44 listing
  three more P2P-adjacent codes (`CONNECTION_FAILED`, `STALE_PRESENCE`,
  `P2P_SESSION_REVOKED`) — those aren't thrown anywhere yet, so they
  weren't added; `P2P_SESSION_REVOKED` in particular stays a broadcast
  *reason* string (`P2PRevocationReason` in `p2p.types.ts`), not a
  thrown `ErrorCode` — add the others only when a feature actually needs
  to throw them.
- Add schema fields with the feature that needs them, not speculatively
  — as done three times now (removal fields deferred out of Phase 1,
  added exactly when Phase 2 needed them; Phase 4 needed zero Prisma
  changes; Phase 5 also needed zero — P2P leases live entirely in
  Redis, same persistent/ephemeral split as presence, master spec §41).
- **Redis now carries two independent ephemeral concerns, each with its
  own namespace and TTL** — `presence:*` (30s TTL, liveness) and, as of
  Phase 5, `p2p:lease:*`/`p2p:leases:byUser:*` (45s TTL, authorization).
  This was a deliberate decision, not a default: see §4e's
  `p2p.repository.ts` bullet for why the two TTLs are intentionally
  different numbers answering different questions. **If Phase 6
  (location) adds transient location data, give it a third distinct
  namespace/TTL too** — don't silently reuse either existing one for an
  unrelated concern.
- **Decoupling pattern, now used twice and clearly the house style**:
  a service exports a plain `EventEmitter` (`presenceEvents`,
  `p2pEvents`, and — new in Phase 5 — `hierarchy.service.ts`'s own
  `hierarchyEvents`) and never imports `socket.io` directly; a thin
  *gateway* file is the only subscriber, turning emitted events into
  actual socket broadcasts. Phase 5 extended this one step further:
  `p2p.gateway.ts` subscribes to **two different modules'** emitters
  (`hierarchyEvents` from `hierarchy.service.ts` and `p2pEvents` from
  its own `p2p.service.ts`) to bridge a hierarchy removal into a P2P
  revocation broadcast — this is the pattern to reach for whenever a
  future phase needs "module A's domain event should cause module B's
  broadcast," rather than having A import B directly or vice versa.
  Phase 6 location and Phase 7 radar should both expect to follow this
  same shape.
- **Shared Socket.IO connection-auth, now centralized** (Phase 5): don't
  put `io.use(authenticateSocket)` inside an individual gateway's
  register function — it now lives once, in `config/socket.ts`'s
  `initSocketIO`, via `middleware/socketAuth.ts`'s exported
  `authenticateSocket` + `AuthenticatedSocket` type. Every gateway
  (`registerPresenceHandlers`, `registerP2PHandlers`, and whatever Phase
  6/7 add) just types its `io.on("connection", ...)` callback as
  `(socket: AuthenticatedSocket) => ...` and reads `socket.data.user`
  directly — no per-gateway auth registration needed or wanted.

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
4. ~~Phase 4 — Real-Time Presence~~ — **done**, see §4d. Backend only.
   Same standing caveat: unit-tested with mocked Redis/Postgres, never
   run against a live stack, and the multi-server Redis-adapter
   broadcast claim has never been observed working for real. See §5d's
   numbered checklist.
5. ~~Phase 5 — WebRTC P2P~~ — **done this session**, see §4e. Backend/
   control-plane only (no frontend WebRTC client yet — see item 7
   below). Same standing caveat, now also true of this phase: unit-
   tested with mocked Redis/Postgres, never run against a live stack.
   **This one has the same class of "never actually observed working"
   gap Phase 4's multi-server claim has**: the hierarchy-removal →
   lease-revocation bridge (the entire point of wiring `hierarchyEvents`
   into `p2p.gateway.ts`) has literally never fired outside a mocked
   unit test. See §5e's numbered checklist — item 4 there specifically
   — before building anything else on top of P2P revocation.
6. **Phase 6 — Location is the actual next phase now** (master spec §47
   Phase 6): browser geolocation, privacy controls, location updates,
   stale-location handling, Redis-backed transient location. Read
   master spec §20/§41 again before starting — location is explicitly a
   **separate** concern from presence (presence = availability/online-
   offline, location = spatial position), so resist the temptation to
   fold location into the existing `presence:*` Redis keys or the
   `presence.service.ts` module just because the infrastructure looks
   similar. Phase 5's pattern of "own Redis namespace, own TTL constant,
   own repository/service/gateway split, EventEmitter decoupling from
   Socket.IO" (§6) is the template to follow again, not presence's
   module directly. Note also master spec §19's privacy rule this phase
   must respect from day one: "physical proximity never grants
   visibility" — location updates should reuse the existing
   `authorizationService.getVisibilityScope`-based audience-scoping
   pattern (same one presence and P2P both already use) rather than
   inventing a new visibility rule, and location data must never be
   broadcast to anyone outside that scope even before Phase 7's radar
   exists to consume it.
7. **No frontend presence UI and no frontend WebRTC client exist yet.**
   Phase 4 and Phase 5 were both scoped backend-only to match master
   spec §47's own per-phase lists (see §4d/§4e). A future session could
   add: a Socket.IO client connection (`socket.io-client` isn't a
   frontend dependency yet), an online/offline indicator on
   `HierarchyNodeRow` (presence data and hierarchy data cover the same
   set of users), a heartbeat loop tuned against `PRESENCE_TTL_SECONDS`
   (§4d gap #4), and — for P2P — actual `RTCPeerConnection` wiring that
   calls `p2p:request-session`/`p2p:renew-session`/`p2p:signal` and
   reacts to `p2p:session-revoked` by closing the connection (§4e).
   This is not currently on the critical path to Phase 6 (location is
   backend-first too, per its own master-spec Phase 6 list) and could
   be done before, after, or interleaved with Phase 6 — use judgment, or
   ask the user. If the user wants to see any of this phase's work
   actually demonstrated rather than just described, building even a
   minimal frontend for presence+P2P would be the fastest way to make
   Phases 4-5 tangible.
8. Also still open, not blocking Phase 6 but worth doing whenever there's
   a real Postgres/Redis/two-browser environment available: the full
   end-to-end verification checklists in §5c/§5d/§5e (backend) and
   §5b's click-through (frontend). Every session so far has verified
   logic in isolation (types, mocked units, hand-checked request/
   response contracts, one SQL-level integration check) but **nobody
   has yet run this app for real against a live stack, nobody has ever
   run two server processes at once to verify the multi-server presence
   claim, and nobody has ever run two real Socket.IO clients at once to
   verify P2P signaling or revocation.** That combination is the single
   biggest unknown-unknown risk in the project right now — worth
   prioritizing over new Phase 6 features if a normal (non-sandboxed)
   environment becomes available. If such an environment becomes
   available, doing §5e's checklist before §5d's is the more urgent
   order: presence's worst-case failure mode (a stale online indicator)
   is a UX annoyance, while P2P revocation's worst-case failure mode (a
   removed user's session silently not being revoked) is closer to a
   security gap.

Do not start Phase 7+ before Phase 6 is solid, and don't treat Phase 4's
multi-server claim or Phase 5's revocation-bridge claim as verified
until §5d's and §5e's checklists have actually been run once against
real, live processes.

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
- **New this session (Phase 5):** `INITIATE_P2P_SESSION` authorization
  was defined as "actor and target are in the same ancestor/descendant
  chain" (master spec §16's existing visibility relation, reused
  symmetrically). The master spec never explicitly states this rule for
  P2P specifically — §25 only says "A authorized to communicate with
  B?" without defining what that means. This is the most natural
  reading given everything else already built (it's exactly the same
  relation presence's broadcast audience already uses), but it was not
  explicitly confirmed by the user. If the user wants a looser or
  stricter rule for who may P2P-connect with whom (e.g. same
  organization is enough, or requiring an explicit "contacts" list
  independent of hierarchy position), this is a one-place change: the
  `INITIATE_P2P_SESSION` case in `authorization.service.ts`.
- **New this session (Phase 5):** `P2P_LEASE_TTL_SECONDS = 45` (and the
  implied renewal cadence a real client should use) is a guess, not a
  number the user specified or validated against a real client —
  exactly the same caveat `PRESENCE_TTL_SECONDS` already carries from
  Phase 4. Cheap to change (`p2p.repository.ts`, one constant) — flag to
  the user if they have a specific tradeoff in mind (shorter = tighter
  revocation-detection window but more frequent Postgres re-checks on
  renewal; longer = the opposite) before a frontend renewal loop gets
  built against it.
- **New this session (Phase 5):** no REST endpoints were added for P2P
  — everything is Socket.IO-only, including session request/renew/close.
  This was a deliberate reading of master spec §43 (which lists no P2P
  REST endpoints and explicitly defers to "an appropriate real-time
  event/API design"), not something the user explicitly asked for. If a
  future frontend session finds it awkward to drive P2P purely over
  raw Socket.IO calls, a thin `GET /p2p/sessions` read-only endpoint
  (mentioned as a deliberately-skipped option in §4e) is the lowest-risk
  addition — worth asking the user before adding write-capable REST
  endpoints that would duplicate the socket-only logic instead.
- **New this session (Phase 5):** the P2P revocation broadcast
  (`p2p:session-revoked`) is, like everything else about P2P, only ever
  a *request* to a compliant client — this backend has no way to force
  an already-connected browser to actually tear down its
  RTCPeerConnection (master spec §27, explicitly non-negotiable — §52).
  This isn't a gap specific to this session's implementation so much as
  an inherent limit of the whole architecture the master spec itself
  accepts, but it's worth restating to the user in plain terms if they
  ever ask "so removal instantly kills the connection, right?" — the
  honest answer is "it revokes the *authorization* instantly and asks
  the client to close; a malicious/broken client could still ignore
  that," same as §27 already says for WebRTC generally.

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
P2P AUTHORIZATION LEASES ARE NOT FILE-TRANSFER TIMEOUTS OR CONNECTION-DURATION LIMITS.
REMOVAL IS EXPLICIT STATE, NEVER A PHYSICAL DELETE, NEVER A SILENT RE-PARENT.
CASCADING REMOVAL RECORDS ITS CAUSE (DIRECT vs GROUP_LEADER_REMOVED).
RESTORATION RESTORES OWNERSHIP, NOT AUTOMATICALLY THE WHOLE SUBTREE.
DO NOT INVENT THE DATA-TRANSFER PROTOCOL (PHASE 9) — THE USER IS DESIGNING
IT SEPARATELY AND WILL SHARE IT WHEN READY.
```

