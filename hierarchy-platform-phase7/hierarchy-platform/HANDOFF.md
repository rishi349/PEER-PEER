# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this
> project up in a new session: read this whole file before touching
> code.** It tells you what exists, what was decided and why, what's
> verified, and exactly what to build next. The authoritative product
> spec is `claude_project_master_prompt_final.md` (the project's master
> prompt) — this document is the **engineering status report** against
> that spec, not a replacement for it.
>
> **New:** `README_AGENT.md` (repo root) is a condensed, 2-minute
> version of this file — a full phase-by-phase status table (1 through
> 10) and an aggregated list of everything still pending, with pointers
> back into this file's detailed sections. Read it first if you just
> need orientation; come back here for the actual engineering detail.
> `README_PROJECT_OVERVIEW.md` (repo root) is a separate, non-
> implementation-level explanation of the whole project, written for a
> non-code audience (e.g. an academic advisor) — it also contains the
> project's open Phase 9 data-transfer-architecture question.

Last updated: **Phase 7 — Radar, complete (backend fully verified;
frontend built, type-checked, and production-built, but never opened in
a real browser — read §4g/§5g before trusting the UI half).**
Phases 1, 2, 6, and 7 are done backend+frontend; Phases 3, 4, and 5
remain backend-only, as intended for all three — see §4c, §4d, and §4e.
Phase 8 (Security Hardening) has not been started.

**Continuity note:** this project is built inside an ephemeral sandbox
filesystem that does not persist between separate conversations. The
only durable copy is whatever zip the user has downloaded most recently
(now includes everything through Phase 7). **If you are a fresh agent
session, you have no filesystem access to this code unless the user
re-uploads that zip.** Ask for it if `/mnt/user-data/uploads` doesn't
already have it.

**A note on trust, for whichever agent reads this next:** every claim in
§4g/§5g below (what was built, what was verified, what wasn't) was
checked directly against the actual files in this session — `tsc
--noEmit`, `vitest run`, and `npm run build`/`vite build` were all
actually executed, not assumed, and their real output is quoted in §5g.
This HANDOFF is written to the same standard as every prior phase's own
section (compare §4f/§5f) so this session's work can be trusted without
re-auditing it line-by-line — but **this phase's frontend half carries a
larger-than-usual gap: it has only ever been type-checked and
production-built, never actually run in a browser against a live
backend.** See §5g's checklist, and prioritize a real click-through of
Phase 7 before building anything else on top of it.

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
├── README_AGENT.md             NEW — condensed phase-status/pending-work orientation for
│                               the next agent; read this before this whole HANDOFF file
├── README_PROJECT_OVERVIEW.md  NEW — non-implementation-level project explanation + the
│                               open Phase 9 data-transfer-architecture question, written
│                               for a non-code reviewer (e.g. an academic advisor)
├── docker-compose.yml          Local Postgres 16 + Redis 7
├── docs/PHASES.md              Phase checklist — keep current
├── HANDOFF.md                  This file
├── PHASE6_PLAN.md               Phase 6 planning doc — decisions confirmed with the
│                                user before implementation; §6 there says it should be
│                                superseded by this HANDOFF now that Phase 6 is built,
│                                but kept as a historical record rather than deleted
├── backend/
│   ├── prisma/schema.prisma    Organization, User (now with locationSharingEnabled,
│   │                            Phase 6), Session, HierarchyEvent — unchanged by Phase 7
│   └── src/
│       ├── config/              env.ts, prisma.ts, redis.ts, socket.ts (wires up
│       │                        presence.gateway.ts + p2p.gateway.ts — location and
│       │                        radar both have no Socket.IO surface, see §4f/§4g)
│       ├── common/              errors.ts (AppError + ErrorCode union — unchanged by
│       │                        Phase 7, radar introduced no new error code, see §4g),
│       │                        asyncHandler.ts
│       ├── middleware/          requireAuth.ts, errorHandler.ts, socketAuth.ts
│       ├── types/express.d.ts   req.user augmentation (AuthenticatedUser)
│       ├── modules/auth/        register/login/refresh/logout + JWT helpers
│       ├── modules/users/       GET /users/me
│       ├── modules/hierarchy/   backend/src/modules/hierarchy/ — see §4 below
│       ├── modules/authorization/ canPerform/assertCanPerform — see §4c below. Location
│       │                        (§4f) and radar (§4g) both reuse getVisibilityScope
│       │                        directly rather than adding a new Action here
│       ├── modules/presence/    see §4d below
│       ├── modules/p2p/         see §4e below
│       ├── modules/location/    see §4f below
│       ├── modules/radar/       NEW — see §4g below
│       ├── app.ts               Express app assembly + /health, /presence, /hierarchy,
│       │                        /location, /radar (NEW §4g) — P2P still has no REST
│       │                        surface
│       └── index.ts             entrypoint — unchanged since Phase 4 (still creates an
│                                 http.Server + boots Socket.IO + the presence keyspace
│                                 listener; radar needed no new startup step either, it's
│                                 REST-only, see §4g)
└── frontend/
    └── src/
        ├── api/                  client.ts (fetch wrapper + silent refresh), auth.ts,
        │                        hierarchy.ts, location.ts, radar.ts (NEW §4g)
        ├── state/                authStore.ts, hierarchyStore.ts, locationStore.ts,
        │                        radarStore.ts (NEW §4g) — all zustand
        ├── hooks/                useLocationSharing.ts — the only hook so far; radar
        │                        needed none (its polling lives directly in
        │                        RadarContainer.tsx's own effect, see §4g)
        ├── components/
        │   ├── AuthShell, Field, RolePill, RadarSweepBackground, ProtectedRoute   (Phase 1)
        │   ├── hierarchy/        Phase 2 UI — see §4b below
        │   ├── location/         Phase 6 — LocationPanel (opt-in toggle + status only,
        │   │                    no spatial rendering — radar is the actual map view)
        │   └── radar/            NEW §4g — RadarContainer, RadarCanvas, RadarControls,
        │                        RadarRangeControl, RadarUserMarker, RadarUserDetails,
        │                        RadarLegend, radarMath.ts (pure calculations, no
        │                        rendering — master spec §38)
        ├── pages/                LoginPage, RegisterPage, DashboardPage (now also
        │                        has an "Open Radar" button, NEW §4g), RadarPage (NEW §4g)
        └── styles/               global.css (design tokens), forms.css
```

Frontend **was touched this session (Phase 7)** — following Phase 6's
own frontend work. Phases 3, 4, and 5 remained backend/control-plane
only (by design — see §4c/§4d/§4e); Phase 6 and now Phase 7 both touch
the frontend by design. New files are exactly the ones listed above:
`api/radar.ts`, `state/radarStore.ts`, the entire `components/radar/`
directory, `pages/RadarPage.tsx` (+`.css`), plus small edits to
`App.tsx` (new `/radar` route) and `pages/DashboardPage.tsx` (new "Open
Radar" button, and the now-built "Radar" card removed from the "Coming
up" roadmap grid). No other frontend file was touched. **Still no
frontend presence UI and no frontend WebRTC client** (no online/offline
dot on the hierarchy tree itself, no Socket.IO client connection, no
`RTCPeerConnection` anywhere — `socket.io-client` still isn't a frontend
dependency) — that gap is unrelated to Phase 7 and remains exactly as
described in §4d/§4e/§7. Radar's own presence data comes from a plain
REST poll (`GET /radar/visible-users`), not a live socket.

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

## 4f. Phase 6 — Location (NEW this session)

Built directly from `PHASE6_PLAN.md`, which the user had already
confirmed decisions in before this session started — this section
records what was actually built against that plan, not a re-derivation
of the reasoning (see `PHASE6_PLAN.md` itself for the full "why," it
remains the authoritative record of that reasoning per its own header).

### New module: `backend/src/modules/location/`

A separate module from `presence.*`, deliberately — see §7 item 6's
standing warning against folding the two together. Same layering
`presence`/`p2p` already established:

- **`location.types.ts`** — `Coordinates` (what the browser gives us),
  `LocationRecord` (the Redis JSON shape: exact coordinates +
  `updatedAt`), `LocationUnavailableReason`
  (`REQUESTER_LOCATION_UNAVAILABLE` | `TARGET_LOCATION_UNAVAILABLE`), and
  `DistanceBearingResult` — the only shape ever returned about *another*
  user (`{available:true, distanceMeters, bearingDegrees, updatedAt}` or
  `{available:false, reason}`). No raw coordinates ever appear in this
  type for anyone but the record's own owner.
- **`location.geo.ts`** — pure haversine distance + initial-bearing
  functions, no Redis/Postgres/auth dependency at all. Kept standalone
  specifically so it's directly unit-testable with zero mocks (8 tests,
  see §5f) — same separation-of-concerns instinct master spec §38 asks
  for on the frontend's radar math.
- **`location.repository.ts`** — raw Redis layer only. Own key namespace
  (`location:{userId}`), own TTL constant
  (`LOCATION_TTL_SECONDS = 50` — deliberately a third distinct number
  from presence's `PRESENCE_TTL_SECONDS` (30) and P2P's
  `P2P_LEASE_TTL_SECONDS` (45); sized against `PHASE6_PLAN.md` §2c's
  ~20s assumed client cadence, same "guess, not a measurement" caveat
  every prior phase's own TTL carries — see the constant's own comment).
  `writeLocation`/`readLocation`/`deleteLocation`; no "renew" operation
  exists separately from a write, unlike presence's heartbeat or P2P's
  lease renewal — every location update is itself a fresh reading, so
  there's nothing to renew independently.
- **`location.service.ts`** — the actual policy layer:
  - `updateLocation(actor, coords)` — re-fetches the actor fresh from
    Postgres (never trusts the token alone, same pattern every service
    in this codebase uses), throws `LOCATION_SHARING_DISABLED` if
    `locationSharingEnabled` is false **on the server's own fresh read**
    — this is the actual enforcement point for the opt-in rule, not just
    the frontend not calling it.
  - `setSharingEnabled(actor, enabled)` — the one Postgres *write* this
    phase needed (`User.locationSharingEnabled`, a durable preference,
    not an ephemeral reading — master spec §41). Turning sharing off
    also proactively calls `location.repository.ts`'s `deleteLocation` —
    defense in depth on top of `getDistanceAndBearing`'s own re-check,
    closing the window where a stale-but-not-yet-TTL-expired reading
    could otherwise still answer a query for someone who just opted out.
  - `getSharingEnabled(actor)` — trivial fresh-read passthrough, used by
    the frontend to load the toggle's real initial state (never assumed
    to start "on").
  - `getDistanceAndBearing(actor, targetUserId)` — the actual
    §17/§19-compliant read path. Authorization is **not** a new `Action`
    in `authorization.types.ts`; it directly reuses
    `authorizationService.getVisibilityScope(actor)` and checks
    `targetUserId` is in the union of the actor's own ancestors and
    descendants — exactly the same symmetric relation
    `presence.service.ts`'s `getAudience` already relies on (§7's own
    instruction was to reuse this *pattern*, not necessarily add a new
    policy case, and a read-only "am I allowed to see this person"
    question doesn't need one the way P2P's two-party negotiation did).
    Self-queries are rejected (`FORBIDDEN`) before any target lookup,
    same defensive-ordering convention `p2p.service.ts`'s
    `requestSession` uses for its own self-target check. Once
    authorized: if the target has sharing off, **or** has no current
    Redis reading, the result is `{available:false, reason:
    "TARGET_LOCATION_UNAVAILABLE"}` — deliberately the *same* reason for
    both cases, matching `PHASE6_PLAN.md` §2a's instruction never to let
    an API distinguish "sharing is off" from "no recent reading" (both
    just mean "nothing available right now" to the caller). If the
    *requester's own* reading is missing, that's the distinct
    `REQUESTER_LOCATION_UNAVAILABLE` reason — kept separate because it's
    actionable information specifically for the caller ("turn on your
    own sharing to see this"), not a privacy-sensitive fact about
    someone else. Only once both readings exist does this compute and
    return `{distanceMeters, bearingDegrees}` — the target's raw
    coordinates are read from Redis purely as a computation input and
    never appear anywhere in the returned value (confirmed by a test
    that `JSON.stringify`s the result and asserts neither `latitude` nor
    `longitude` appear in it — see §5f).
- **`location.schemas.ts`** — zod validation: `updateLocationSchema`
  (`latitude` [-90,90], `longitude` [-180,180], optional non-negative
  `accuracy`), `setSharingSchema` (`{enabled: boolean}`).
- **`location.controller.ts` / `location.routes.ts`** — thin REST layer,
  same `asyncHandler`/`requireActor` shape as `presence.controller.ts`.

### New API surface (mounted at `/location` in `app.ts`)

```
POST   /location                       — update own coordinates (rejects if sharing disabled)
GET    /location/sharing               — read own current opt-in preference
PATCH  /location/sharing               — toggle the opt-in preference
GET    /location/distance/:targetUserId — pull-only distance/bearing to an authorized target
```

**Deliberate departure from master spec §43's literal
`POST /presence/location` listing**: location got its own top-level
router rather than being nested under `/presence`, matching this
module's own separation from `presence.*` described above. §43's own
closing line ("do not blindly implement every endpoint above if the
existing architecture suggests a better design") is the basis for this,
same reasoning Phase 5 used to justify having no P2P REST surface at
all (§4e). Also **no Socket.IO surface was added this phase** — resolving
`PHASE6_PLAN.md` §4's two open questions in favor of the plan's own
leaning: REST for the ~20s-cadence update (not latency-sensitive enough
to need a socket), and a **pull-only** `GET /location/distance/:id`
rather than a push model, since there's no consumer for a push yet
(Phase 7's radar doesn't exist). Revisit this once Phase 7 starts, per
`PHASE6_PLAN.md` §4 open question 2 — don't assume pull-only is
permanent.

### New error code (`common/errors.ts`)

`LOCATION_SHARING_DISABLED` → 403. Thrown only by `updateLocation`'s
opt-in enforcement described above.

### Schema change (`backend/prisma/schema.prisma`)

One new field on `User`: `locationSharingEnabled Boolean @default(false)`.
Nothing else — every other piece of Phase 6 state is Redis-ephemeral, per
master spec §41 and `PHASE6_PLAN.md` §2a. **Not migrated this session**
— same standing `binaries.prisma.sh` block as every phase since Phase 1;
see §5f.

### Minimal frontend slice (NEW — unlike Phases 3-5, which were
backend-only by design; see `PHASE6_PLAN.md` §2d for why this phase is
different)

- **`frontend/src/api/location.ts`** — typed fetch wrappers for all four
  endpoints above, mirroring `api/hierarchy.ts`'s shape.
  `getDistanceRequest` is included but **not called by any UI yet** —
  Phase 7's radar is the actual consumer; included now so the frontend's
  typed surface matches the backend's from day one, same as
  `api/hierarchy.ts` already exposing endpoints not every one of which
  has a UI caller.
- **`frontend/src/state/locationStore.ts`** — zustand store owning the
  confirmed server-side `sharingEnabled` value (starts `false`, only
  ever flips once a real `PATCH /location/sharing` call succeeds — never
  a local optimistic guess) plus `lastUpdatedAt`/`isSendingUpdate`/error
  state. Same shape convention `hierarchyStore.ts` established.
- **`frontend/src/hooks/useLocationSharing.ts`** — the actual browser
  geolocation wiring. Takes the store's confirmed `sharingEnabled`
  boolean as its only input; while `false`, **it never touches
  `navigator.geolocation` at all** — no permission prompt, nothing — per
  `PHASE6_PLAN.md` §3's explicit instruction that the permission prompt
  should only ever happen after explicit opt-in. When enabled, calls
  `getCurrentPosition` immediately and then again every
  `UPDATE_INTERVAL_MS = 20_000`ms (`PHASE6_PLAN.md` §2c's cadence) via a
  plain `setInterval` — not `watchPosition` (would fire far more often
  than needed) and not a "significant movement" heuristic (harder to
  define/implement correctly, per the plan's own reasoning). Cleans up
  its interval on unmount or on `enabled` flipping back to `false`.
- **`frontend/src/components/location/LocationPanel.tsx` (+ `.css`)** —
  the actual settings UI: an on/off toggle switch, a one-line
  status description that changes based on state, and a "last sent Xs
  ago" readout with a small pulsing indicator while a send is in flight.
  Fetches the real preference on mount before rendering anything as
  "on." **No distance, no bearing, no map, no spatial rendering of any
  kind** — that's explicitly out of scope per `PHASE6_PLAN.md` §2d/§3;
  this panel's only job is the opt-in control plus visible confirmation
  that updates are actually being sent. Styled with the existing design
  tokens (`--surface`, `--signal`, `--border`, `--font-mono`, etc.) from
  `global.css` — no new tokens introduced.
- **Wired into `DashboardPage.tsx`**: `<LocationPanel />` added directly
  below `<HierarchyPanel />` in the main column. No other change to that
  file.

### Known gaps — read before extending this (deliberately not solved this phase)

- **No staleness indicator beyond the raw `updatedAt` timestamp.**
  `PHASE6_PLAN.md` §4 open question 4 deliberately left the "stale but
  not yet TTL-expired" UI treatment to Phase 7 — this phase only
  guarantees `updatedAt` is present in every successful
  `getDistanceAndBearing` result so a future radar can decide what
  "stale" means and render accordingly. `LocationPanel.tsx`'s own "last
  sent Xs ago" readout is a simple `Date.now()` diff computed at render
  time, not a live ticking clock — it only refreshes when the component
  re-renders for another reason (a new update landing, a send starting/
  finishing), which happens roughly every 20s anyway. Fine for this
  phase's minimal scope; would need an actual interval-driven re-render
  if a always-live ticking display becomes a requirement.
- **`LOCATION_TTL_SECONDS = 50` and the ~20s frontend cadence are both
  guesses**, same standing caveat every prior phase's own TTL/interval
  constant carries (`PRESENCE_TTL_SECONDS`, `P2P_LEASE_TTL_SECONDS`) —
  there is still no real, long-running frontend session to have observed
  either number against. See §8 for the explicit flag-to-user note.
- **No location history of any kind** — by design (master spec §20,
  `PHASE6_PLAN.md` §1). Only the single most recent reading exists,
  ephemeral, in Redis. Do not add a Postgres-backed history table later
  without re-confirming this is actually wanted; it was explicitly ruled
  out.
- **A user with sharing already on who is removed** (hierarchy removal,
  not opting out) is not specifically handled by this phase — their
  `locationSharingEnabled` flag stays `true` and their last Redis
  reading simply expires on its own TTL like any other. Nothing in this
  phase re-checks hierarchy `status` on a location read
  (`getDistanceAndBearing` does check the *target*'s `status === ACTIVE`
  via `requireVisibleTarget`, so a removed target is already correctly
  excluded — this gap is narrower than it might sound: it's specifically
  about whether removal should *also* proactively clear the Redis key
  the way opting out does, the same defense-in-depth cleanup
  `setSharingEnabled` performs). Worth revisiting alongside Phase 5's own
  P2P-revocation-on-removal bridge (`hierarchyEvents` → `p2p.gateway.ts`,
  §4e) as a template if the user wants removal to proactively purge
  location state too, rather than relying solely on the `status` check
  at read time plus the TTL to eventually clear it.

---

## 4g. Phase 7 — Radar (NEW this session)

Master spec §47's Phase 7 checklist: distance, bearing, radar UI,
leader/peer/all filters, range, orientation, parent/descendant
visibility, user selection. No `PHASE7_PLAN.md` was written before this
session (unlike Phase 6's `PHASE6_PLAN.md`) — the user's task
instruction was to complete Phase 7 directly, and Phase 6 had already
resolved the one major open architectural question (REST pull-only vs.
Socket.IO push, see below) enough that a separate planning doc wasn't
requested first. If the user wants that step reinstated for Phase 8,
say so explicitly next session.

### New module: `backend/src/modules/radar/`

Deliberately thin — this module owns no Redis namespace, no Postgres
column, and no new `Action` in `authorization.types.ts`. Its only job is
composition, per master spec §17's pipeline:

- **`radar.types.ts`** — `RadarFilter` (`"LEADERS" | "PEERS" | "ALL"`,
  master spec §18), `RadarRelation` (`"ANCESTOR" | "DESCENDANT"` — not
  required by any endpoint contract in the master spec, but cheap to
  include and immediately useful for a frontend that wants to render
  "your parent" differently from "someone in your subgroup" without
  re-deriving the relationship client-side), `RadarVisibleUser` (id,
  name, role, relation, presence, `location: DistanceBearingResult`
  reusing Phase 6's exact type, `stale: boolean`), and `RadarSnapshot`
  (`{self, filter, users}`).
- **`radar.schemas.ts`** — zod: `filter` query param, `z.enum(["LEADERS",
  "PEERS", "ALL"]).default("ALL")`.
- **`radar.service.ts`** — the only file with real logic:
  - `requireActiveActor` — same fifth-times-duplicated pattern every
    service in this codebase uses (see §6's own note on this).
  - `matchesFilter(node, filter)` — LEADERS matches `LEADER` **and**
    `ROOT_LEADER` roles, PEERS matches `PEER`, ALL matches everything.
    This wasn't spelled out character-for-character in master spec §18's
    worked example, but it's the only reading consistent with that
    example: for actor A, the LEADERS filter returns B and C (both
    `LEADER`-role), and §16's own visibility model already groups "your
    direct parent/leader" together conceptually regardless of whether
    that parent happens to be a `ROOT_LEADER` or a `LEADER`. See §8 for
    the explicit flag that this wasn't literally confirmed with the
    user.
  - `isStale(updatedAt)` — compares reading age against
    `RADAR_STALE_LOCATION_SECONDS = 25` (new constant, own comment
    explains the "guess, not a measurement" reasoning — same standing
    caveat every TTL/interval constant in this project carries).
  - `getVisibleUsers(actor, filter)` — the actual pipeline: fetch the
    fresh actor, call `authorizationService.getVisibilityScope` once for
    the candidate set (ancestors + descendants), filter out anything
    `status !== "ACTIVE"` (discoverability, master spec §20 — a removed
    user is never radar-visible regardless of hierarchy position) and
    anything not matching the role filter, then for the remaining set:
    call `presenceService.getSnapshotForActor(actor)` **once** and build
    a `userId → {status, lastSeen}` lookup map from it (rather than N
    individual presence reads), and call
    `locationService.getDistanceAndBearing(actor, candidate.id)` **once
    per candidate** (see the deliberate performance tradeoff below).
    Users with no presence entry at all default to `{status: "OFFLINE",
    lastSeen: null}` rather than throwing or omitting them.

**A deliberate, documented performance tradeoff, not an oversight**: the
per-candidate `getDistanceAndBearing` call means each candidate
re-derives the actor's own visibility scope internally a second time
(that function's own `requireVisibleTarget` calls
`authorizationService.getVisibilityScope` again) — for N visible users
this is roughly N+1 pairs of recursive-CTE ancestor/descendant queries
instead of 1. This was chosen specifically to reuse
`location.service.ts`'s already-verified, encapsulated authorization/
availability logic (its own repository's docblock reserves direct Redis
access for `location.service.ts` alone — reaching into
`location.repository.ts` from `radar.service.ts` would break that
layering) rather than duplicate that branching a second time inside
radar. Master spec §35's explicit priority order — "correctness is more
important than premature performance optimization... unless profiling
demonstrates a need" — is the justification. **If a real deployment's
org sizes ever make this measurably slow**, the fix is a new
`locationService.getDistanceAndBearingBatch(actor, targetIds)` that
derives the visibility scope once and loops only over Redis reads/pure
math internally — not something to build speculatively now, and not
something this session attempted.

Radar deliberately does **not** filter out offline users or users with
an unavailable location result from the response — master spec §39
explicitly lists "connection state" and a "stale-location indicator" as
things the *radar UI itself* shows, which only makes sense if those
users are still present in the data for the frontend to render
distinctly (greyed out, listed separately, whatever the UI decides), not
silently dropped by the backend before the frontend ever sees them.

- **`radar.controller.ts` / `radar.routes.ts`** — thin REST layer, same
  `asyncHandler`/`requireActor` shape as `presence.controller.ts`/
  `location.controller.ts`.

### New API surface (mounted at `/radar` in `app.ts`)

```
GET /radar/visible-users?filter=LEADERS|PEERS|ALL   — defaults to ALL if omitted
```

Matches master spec §43's literal listing verbatim (`GET
/radar/visible-users`) — unlike location (Phase 6) and P2P (Phase 5),
there was no reason to depart from the spec's own suggested path here:
this is a single, simple, pull-style read with one query-param filter,
exactly what a plain REST GET already handles well. **No Socket.IO
surface was added** — see the "5s poll, not a push" decision below.

### No new error code

Radar throws only `UNAUTHORIZED`/`USER_INACTIVE` (via
`requireActiveActor`, same as every other module) and a standard zod
`VALIDATION_ERROR` for a malformed `filter` value — no radar-specific
failure mode exists that isn't already one of these.

### No schema change

Radar reads Postgres (via `authorizationService.getVisibilityScope`) and
Redis (via `presenceService`/`locationService`) but owns no storage of
its own — zero new Prisma fields, zero new Redis namespaces. This is by
design (§6's "if Phase 7 or 8 add a fourth ephemeral concern, give it
its own namespace/TTL" note from Phase 6's own handoff turned out not to
apply — radar needed no ephemeral state of its own at all, only reads of
what other modules already maintain).

### Frontend — the full radar feature (NEW this session; contrast with

Phase 6's *minimal* toggle-only slice)

A dedicated `/radar` page, not another Dashboard panel — the master
spec's own product vision (§51: "Leaders open the radar") and component
list (§38) describe something closer to its own screen than a small
settings widget, and the visual real estate a proper SVG radar face
needs doesn't fit comfortably inside the Dashboard's existing card grid.

- **`frontend/src/api/radar.ts`** — typed fetch wrapper for the one
  endpoint, hand-mirroring `radar.types.ts`'s shapes exactly (including
  `DistanceBearingResult`, copied from `location.ts`'s existing
  equivalent type) — same no-shared-types-package convention every
  other `api/*.ts` file in this project follows.
- **`frontend/src/state/radarStore.ts`** — zustand store owning `filter`,
  a client-side-only `rangeMeters` (see `RadarRangeControl` below —
  **never sent to the backend**; the backend already returns everyone in
  the role-filtered visibility scope regardless of distance, so "range"
  only changes how those same results are laid out/clipped on screen),
  `snapshot`, `selectedUserId`, and loading/error state. `setFilter`
  triggers an immediate re-fetch; `RadarContainer` owns the actual
  polling interval, not the store.
- **`frontend/src/components/radar/radarMath.ts`** — pure, dependency-
  free calculations only, per master spec §38's explicit instruction to
  keep calculations independent of rendering (mirrors
  `location.geo.ts`'s same separation on the backend):
  - `getRadarPosition(distanceMeters, bearingDegrees, rangeMeters,
    orientationDegrees, radiusPx)` — the one calculation the backend
    deliberately doesn't do (master spec §17/§19 keep distance/bearing
    server-side, but converting those into a 2D screen point is
    inherently display-specific and range/orientation-dependent, so it
    lives on the client). Bearing 0°/north maps to "up" (negative y,
    since SVG y grows downward). A user beyond the current range is
    still placed — clamped to the outer ring with `clipped: true` —
    rather than hidden, so "someone is out there, past your current
    range" is visible instead of a silent disappearance.
  - `bearingToCompass` / `formatDistance` — small display-formatting
    helpers for `RadarUserDetails`.
  - **No unit tests were written for this** — unlike `location.geo.ts`,
    which got 8 dedicated vitest tests, there is no test runner
    configured for `frontend/` at all (checked `package.json` — only
    `tsc`/`vite` scripts exist; this predates Phase 7 and wasn't
    something this session was asked to add). `radarMath.ts` was kept
    pure and dependency-free specifically so it *could* be unit-tested
    the moment a frontend test runner exists — treat "add a frontend
    test runner, then backfill tests for `radarMath.ts` and
    `location`-adjacent frontend logic" as a reasonable, low-risk future
    task, not something this session skipped carelessly.
  - No device-compass/orientation input exists yet — every caller passes
    a hardcoded `ORIENTATION_DEGREES = 0` (north-up). Kept as a real
    parameter on `getRadarPosition` rather than removed, so wiring up a
    real orientation source later only means changing that one constant
    in `RadarCanvas.tsx`, not the math function's signature.
- **`frontend/src/components/radar/`** — the rest of master spec §38's
  component list:
  - `RadarContainer.tsx` — owns the fetch-on-mount + 5s
    `setInterval`-based poll (see the push-vs-poll decision below),
    composes everything else, and renders a separate "Off radar" list
    for any visible user whose `location.available` is `false` (can't be
    placed spatially, but is still authorized/discoverable — listed
    rather than dropped).
  - `RadarCanvas.tsx` — the actual SVG: three concentric range rings, a
    rotating CSS-animated sweep wedge, a center "YOU" marker, and one
    `RadarUserMarker` per user with an available location.
  - `RadarUserMarker.tsx` — a single positioned dot + label; makes zero
    distance/bearing/authorization decisions of its own, purely renders
    the `RadarPosition` it's handed. Dimmed (lower opacity) when a
    user's presence is `OFFLINE` or their location is `stale`; a dashed
    stroke plus `clipped` styling for anyone placed beyond the current
    range.
  - `RadarControls.tsx` — the LEADERS/PEERS/ALL toggle (master spec
    §18/§39's "Show: [ Leaders | Peers | All ]").
  - `RadarRangeControl.tsx` — the range slider (master spec §39's
    "Range: 500m"), 100m-2000m in 100m steps.
  - `RadarUserDetails.tsx` — the selected-user panel: relation (your
    leader / in your subgroup), connection state + last-seen, and either
    a formatted distance+compass-direction or the *specific* unavailable
    reason (surfaced verbatim from the backend's own two reasons —
    `REQUESTER_LOCATION_UNAVAILABLE` gets "turn on your own sharing,"
    `TARGET_LOCATION_UNAVAILABLE` gets "they aren't sharing" — never
    invented client-side wording for a server-decided fact, master spec
    §41).
  - `RadarLegend.tsx` — role-color + offline/stale legend, using the
    existing `--role-root`/`--role-leader`/`--role-peer` design tokens
    from `global.css`, no new tokens introduced.
- **`frontend/src/pages/RadarPage.tsx` (+`.css`)** — the new page.
  **Deliberately reuses `DashboardPage.css`'s existing
  `.dashboard`/`.dashboard__topbar`/`.dashboard__brand`/
  `.dashboard__signout` classes** (imported directly into
  `RadarPage.tsx`) rather than duplicating the topbar chrome in a new
  file — a pragmatic reuse decision for page-level layout, not a
  violation of the module-separation convention that applies to
  business logic; every prior phase's own CSS files (`LocationPanel.css`,
  `HierarchyPanel.css`) are genuinely separate components with their own
  concerns, whereas this is literally the same page shell reused twice.
  If a third page-with-topbar shows up in Phase 8+, consider extracting
  a proper shared `AppShell` component instead of a third reuse of
  `DashboardPage.css`.
- **`App.tsx`**: new `/radar` route, `<ProtectedRoute>`-gated same as
  `/dashboard`.
- **`DashboardPage.tsx`**: an "Open Radar" button added to the topbar
  (styled with the `--signal` accent to stand out from "Sign out"), and
  the now-obsolete "Radar / Phase 7" card removed from the "Coming up"
  roadmap grid (matching how Phase 2/6 quietly stopped listing
  Hierarchy/Location once those were actually built — "Presence" and
  "P2P sessions" stay listed since Phases 4/5 still have no frontend
  surface at all).

### The push-vs-poll decision (`PHASE6_PLAN.md` §4 open question 2, now resolved)

Phase 6 explicitly left open whether Radar would need a live Socket.IO
push layer on top of Location's pull-only `GET /location/distance/:id`,
or whether polling while the radar screen is open would be sufficient.
**Resolved this session in favor of polling** — `RadarContainer.tsx`
calls `GET /radar/visible-users` on mount and then every
`POLL_INTERVAL_MS = 5000`ms while mounted, clearing the interval on
unmount. No `radar.gateway.ts`, no `radarEvents` emitter, no new
Socket.IO surface at all was added. This was a judgment call, not
something explicitly re-confirmed with the user first — see §8. 5s was
chosen as deliberately shorter than presence's 30s TTL or location's
~20s update cadence (a screen the user is actively looking at can afford
a tighter loop than a background heartbeat), but, like every other
interval constant in this project, it's a guess, not a measurement.

### Known gaps — read before extending this (deliberately not solved this phase)

- **The frontend has never been run in a real browser** — see the "not
  verified" note in §5g below; this is the single largest gap this phase
  introduces, larger than any individual logic gap.
- **No device-compass/orientation input** — `ORIENTATION_DEGREES` is
  hardcoded to `0` (north-up) in `RadarCanvas.tsx`. Master spec §39
  lists "orientation" as a radar UI control; this session interpreted
  that as "the math should support it" (which it does — `orientation` is
  a real parameter of `getRadarPosition`) rather than "build a compass
  input this phase," since there's no compass/gyroscope wiring anywhere
  else in the project yet and master spec §54 discourages
  over-engineering ahead of an actual requirement.
- **No "zoom" control**, despite master spec §39 listing it alongside
  range/orientation. `RadarRangeControl`'s range slider covers the same
  practical need (rescaling what's visible) that a separate zoom control
  would — a genuinely independent "zoom" (magnifying a sub-region of the
  face without changing which real-world distance the outer ring
  represents) wasn't implemented, since no other part of this project
  has a concrete requirement for it yet. Easy to add to `RadarCanvas.tsx`
  as a `viewBox`-scaling factor if a future session needs it.
- **The N+1-visibility-scope-derivation performance tradeoff** described
  above under `radar.service.ts` — correct, but not the fastest possible
  implementation. See that section for the exact fix
  (`getDistanceAndBearingBatch`) if it's ever needed.
- **No radar-specific rate limiting or backoff** on the 5s poll — if a
  user opens the radar page and walks away, the poll keeps running every
  5s until they navigate away or close the tab. Matches the simplicity
  of every other interval in this project (presence heartbeat, location
  update loop) but worth a `visibilitychange`-based pause if battery/
  bandwidth ever becomes a real concern.

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

### 5f. Verification performed this session (backend + frontend, Phase 6 — Location)

- `npm install --ignore-scripts` in `backend/` — **fresh install this
  session**, same reasoning as every prior phase (dodges Prisma's
  postinstall hitting the blocked `binaries.prisma.sh`). No new backend
  npm dependencies were needed — Phase 6 only uses `zod` (already a
  dependency), the existing shared `prisma`/`redis` clients, and Express
  — `backend/package.json` is unchanged.
- `npx prisma generate` — re-run directly to confirm the standing
  limitation is still environmental and not something this session's
  schema change made worse: identical `403 Forbidden` from
  `binaries.prisma.sh` as every phase since Phase 1.
- `npx tsc --noEmit` (backend) — **15 errors, all the same standing
  `@prisma/client`-types-unavailable class every phase has had**, plus
  exactly one new file joining that pre-existing list for the same
  reason: `location.service.ts` (imports Prisma's `User` type, same as
  `p2p.service.ts` did in Phase 5). **Zero errors of any other kind** in
  any new or edited Phase 6 file — `location.types.ts`,
  `location.repository.ts`, `location.geo.ts`, `location.schemas.ts`,
  `location.controller.ts`, `location.routes.ts`, both new test files,
  and the edited `app.ts`/`common/errors.ts`/`schema.prisma` all
  type-check cleanly against the same (ungenerated) Prisma stubs
  everything else has been living with since Phase 1. (One real,
  self-inflicted type error was caught and fixed *during* this session,
  not left in: `location.geo.ts`'s pure math functions were initially
  typed against `location.types.ts`'s `Coordinates`, whose optional
  `accuracy?: number` doesn't structurally match `LocationRecord`'s
  nullable `accuracy: number | null` — fixed by giving the geo module
  its own minimal `LatLon` interface with only the two fields the math
  actually needs, avoiding an awkward cast at every call site.)
- `node node_modules/vitest/vitest.mjs run` (backend) — **76/76
  passing**: 25 new tests (17 in `location.service.test.ts`, 8 in
  `location.geo.test.ts`) plus all 51 pre-existing tests (18 P2P, 13
  presence, 20 authorization) unmodified and still green, confirming
  nothing in Phase 6 touched shared code paths those depend on. The new
  service tests cover: `updateLocation` rejecting a removed/nonexistent
  actor and — the actual opt-in enforcement claim — rejecting an
  active-but-sharing-disabled actor with `LOCATION_SHARING_DISABLED`
  before ever calling `writeLocation`; `setSharingEnabled` persisting to
  Postgres and calling `deleteLocation` only when turning sharing *off*
  (not on); `getSharingEnabled` reflecting a fresh Postgres read;
  `getDistanceAndBearing` rejecting self-queries before any target
  lookup, rejecting a nonexistent/other-org/inactive target, rejecting a
  target outside the requester's visibility scope (the actual
  cross-branch-isolation claim, mirroring `presence`/`p2p`'s own
  equivalent tests) without ever touching Redis, returning
  `TARGET_LOCATION_UNAVAILABLE` for both a sharing-disabled target and a
  sharing-enabled-but-no-reading target (confirming these really are
  indistinguishable at the API level, per `PHASE6_PLAN.md` §2a),
  returning `REQUESTER_LOCATION_UNAVAILABLE` when only the requester's
  own reading is missing, and — the actual "never leaks raw coordinates"
  claim — computing a correct distance/bearing from two known
  coordinate pairs (checked against the textbook ~111.2km-per-degree-
  of-latitude figure) and asserting via `JSON.stringify` that neither
  `latitude` nor `longitude` appears anywhere in the returned value.
  `location.geo.test.ts` exercises the pure math directly with real
  coordinates and no mocks: identity (zero distance to self), the same
  ~111.2km reference figure, symmetry regardless of argument order, and
  all four cardinal bearings (N/E/S/W) each landing at the expected
  0/90/180/270. `prisma`, `authorization.service`, and
  `location.repository` are all mocked (`vi.mock`) in the service test
  file — same reasoning as every prior test file: Prisma and Redis can't
  run in this sandbox. **This tests `location.service.ts`'s
  branching/authorization/availability logic given known mock return
  values — it does not exercise real Redis TTL expiry on a
  `location:{userId}` key, a real Postgres write of
  `locationSharingEnabled`, or a real browser actually granting
  geolocation permission and sending a real request through this code.**
- `npm install --ignore-scripts` + `npx tsc --noEmit` (frontend) —
  **clean, zero errors**, including all new Phase 6 files
  (`api/location.ts`, `state/locationStore.ts`,
  `hooks/useLocationSharing.ts`, `components/location/LocationPanel.tsx`)
  and the edited `pages/DashboardPage.tsx`. No new frontend npm
  dependencies were needed — Phase 6's frontend uses only React/zustand,
  both already dependencies.
- `npx vite build` (frontend) — **clean production build**, no errors or
  warnings beyond npm's own unrelated audit noise.
- **Not verified at all this session** — the same standing gap every
  phase has had, now specifically for Phase 6: nothing was run against a
  live Postgres/Redis stack, so `locationSharingEnabled` has never
  actually been migrated onto a real `User` row or toggled through a
  real `PATCH /location/sharing` call; no `location:{userId}` Redis key
  has ever actually been written, read, or observed expiring after its
  50s TTL; and no real browser has ever granted geolocation permission
  and driven `useLocationSharing`'s interval loop against a live
  backend. **The next session with real Postgres/Redis/browser access
  should, in order** (this extends §5d's/§5e's own checklists — their
  earlier steps, migrate/boot/confirm `/health`, still apply first):
  1. Run `npx prisma migrate dev` for real and confirm the new
     `locationSharingEnabled` column lands with its `false` default on
     existing rows.
  2. Log in as two users who are authorized to see each other per §16
     (e.g. a leader and their own peer). Confirm `GET /location/sharing`
     returns `{enabled: false}` for both before anything else happens.
  3. As user A, `PATCH /location/sharing {enabled: true}`, then
     `POST /location` with real coordinates. Confirm
     `redis-cli GET location:{A's id}` actually holds the JSON record
     with a ~50s TTL (`redis-cli TTL location:{A's id}`).
  4. As user B, call `GET /location/distance/{A's id}` and confirm it
     returns `{available: false, reason: "REQUESTER_LOCATION_UNAVAILABLE"}`
     (B hasn't sent their own location yet) — then have B also opt in
     and `POST /location`, and confirm the same call now returns a real
     `{available: true, distanceMeters, bearingDegrees, updatedAt}` with
     a sane distance for whatever coordinates were used.
  5. As user A, `PATCH /location/sharing {enabled: false}` and confirm
     `redis-cli GET location:{A's id}` returns nothing immediately (the
     proactive-delete-on-opt-out behavior), **and** that user B's
     subsequent `GET /location/distance/{A's id}` now returns
     `{available: false, reason: "TARGET_LOCATION_UNAVAILABLE"}`.
  6. Try `GET /location/distance/:id` between two users who are **not**
     authorized to see each other (unrelated branches) and confirm it
     correctly rejects with `FORBIDDEN` — the actual visibility-scope
     claim, exercised for real rather than at the mocked-unit level.
  7. Only after the above: open the actual frontend, log in, and click
     the `LocationPanel` toggle in a real browser. Confirm the
     permission prompt appears **only** at that click (not on page
     load), and that `POST /location` requests actually appear (browser
     devtools network tab) roughly every 20s while the toggle stays on,
     stopping immediately when toggled back off.

---

### 5g. Verification performed this session (backend + frontend, Phase 7 — Radar)

- `rm -rf node_modules && npm install --ignore-scripts` in `backend/` —
  **fresh install this session**, same reasoning as every prior phase.
  No new backend npm dependencies were needed — `radar.*` only uses
  `zod` (already a dependency) and the existing `authorization`/
  `presence`/`location` services — `backend/package.json` is unchanged.
- `npx prisma generate` — re-run directly to confirm the standing
  limitation is still purely environmental: identical `403 Forbidden`
  from `binaries.prisma.sh` as every phase since Phase 1 (`Failed to
  fetch sha256 checksum at
  https://binaries.prisma.sh/all_commits/.../libquery_engine.so.node.gz.sha256
  - 403 Forbidden`).
- `npx tsc --noEmit` (backend) — **16 errors, all the same standing
  `@prisma/client`-types-unavailable class every phase has had**
  (confirmed via `grep -c "error TS"` → 16, and every single one matches
  `error TS2305: Module "@prisma/client" has no exported member ...`),
  plus exactly one new file joining that pre-existing list for the same
  reason: `radar.types.ts` (imports Prisma's `Role` type, same as
  `hierarchy.types.ts`/`authorization.service.ts` already did). **Zero
  errors of any other kind** in any new or edited Phase 7 backend file
  — `radar.types.ts`, `radar.schemas.ts`, `radar.service.ts`,
  `radar.controller.ts`, `radar.routes.ts`, `radar.service.test.ts`, and
  the edited `app.ts` all type-check cleanly against the same
  (ungenerated) Prisma stubs everything else has been living with since
  Phase 1. (One real, self-inflicted type error was caught and fixed
  *during* this session: `radar.service.test.ts`'s `ACTOR` fixture was
  initially cast `as never` for convenience — matching a shortcut seen
  elsewhere in the codebase — but that made a later
  `{ ...ACTOR, status: "REMOVED" }` spread fail to type-check; fixed by
  giving `ACTOR` a real inferred object type instead of casting away its
  shape.)
- `node node_modules/vitest/vitest.mjs run` (backend) — **92/92
  passing**: 16 new tests in `radar.service.test.ts` plus all 76
  pre-existing tests (25 location, 18 P2P, 13 presence, 20
  authorization) unmodified and still green, confirming nothing in
  Phase 7 touched shared code paths those depend on. The new tests
  cover: rejecting a nonexistent/removed actor **before** calling
  `getVisibilityScope` at all; including an ancestor with
  `relation: "ANCESTOR"` and a descendant with `relation: "DESCENDANT"`
  (the actual parent-visibility/descendant-visibility claims); returning
  zero users when the visibility scope itself is empty (confirming radar
  adds no authorization logic of its own beyond what
  `authorization.service.test.ts` already independently verifies);
  excluding a `REMOVED`-status user even though they're still present in
  the returned ancestor/descendant list (the actual discoverability
  claim); each of LEADERS/PEERS/ALL returning the correct role subset
  from a fixture containing all three roles, and the response's `filter`
  field echoing back what was requested; presence being attached from a
  matching snapshot entry, and defaulting to `{status: "OFFLINE",
  lastSeen: null}` when no entry exists for a user at all; an
  unavailable location result being passed through untouched with
  `stale: false`; a fresh location reading marked `stale: false` and one
  older than `RADAR_STALE_LOCATION_SECONDS` marked `stale: true`; and
  `getDistanceAndBearing` being called exactly once per visible
  candidate with the real actor token (confirming the per-candidate
  reuse pattern the "known gaps" section above describes, rather than,
  say, silently batching or skipping some candidates).
  `prisma`, `authorization.service`, `presence.service`, and
  `location.service` are all mocked (`vi.mock`) in the test file — same
  reasoning as every prior test file: Prisma and Redis can't run in this
  sandbox. **This tests `radar.service.ts`'s own composition/filtering/
  staleness logic given known mock return values — it does not exercise
  a real recursive-CTE hierarchy query, a real Redis presence/location
  read, or a real HTTP round trip through `GET
  /radar/visible-users`.**
- `rm -rf node_modules && npm install` (frontend) — fresh install. No new
  frontend npm dependencies were needed — Phase 7's frontend uses only
  React/zustand/react-router-dom, all already dependencies.
- `npx tsc --noEmit` (frontend) — **clean, zero errors**, including all
  new Phase 7 files (`api/radar.ts`, `state/radarStore.ts`, the entire
  `components/radar/` directory, `pages/RadarPage.tsx`) and the edited
  `App.tsx`/`pages/DashboardPage.tsx`.
- `npm run build` (i.e. `tsc -b && vite build`) (frontend) — **clean
  production build, zero errors or warnings** beyond npm's own unrelated
  audit noise: `100 modules transformed` (up from 77 after Phase 6),
  `dist/assets/index-*.js` at 198.27 kB (62.85 kB gzipped),
  `dist/assets/index-*.css` at 20.09 kB (4.00 kB gzipped).
- **Not verified at all this session — and this is a materially bigger
  gap than usual, not just the standing "no live Postgres/Redis" caveat
  every phase has had.** Nothing in Phase 7's frontend has ever been
  rendered in an actual browser:
  - `getRadarPosition`'s trigonometry (bearing → angle → x/y, with the
    y-axis flip for SVG's downward-growing coordinate system) has never
    been checked against a real distance/bearing pair to confirm markers
    land in visually sane positions — a sign error here would type-check
    perfectly and still be wrong.
  - The 5s poll in `RadarContainer.tsx` has never been observed actually
    firing, updating the canvas, or being cleaned up correctly on
    unmount.
  - Nobody has clicked a `RadarUserMarker`, confirmed the details panel
    populates correctly, changed the LEADERS/PEERS/ALL filter and
    confirmed a re-fetch actually happens, or dragged the range slider
    and confirmed markers rescale/clip as expected.
  - The "Off radar" list, the empty-state message, and the loading state
    have never been visually confirmed.
  - `GET /radar/visible-users` has never actually been called by a real
    browser against a real running backend — only unit-tested at the
    service layer (mocked) on the backend side, and only type-checked on
    the frontend side.

  **The next session with real Postgres/Redis/browser access should, in
  order** (this extends §5d's/§5e's/§5f's own checklists — their earlier
  steps, migrate/boot/confirm `/health`, and Phase 6's own location
  checklist, still apply first — radar has nothing to show without at
  least one user having opted into and sent a real location update):
  1. Log in as two or more users who are authorized to see each other
     (e.g. a leader and their own peer, or a root leader and a leader
     two levels down), with at least one of them a `LEADER`/`ROOT_LEADER`
     and at least one a `PEER`, so all three filter values return
     something different to look at.
  2. Have each of them opt into location sharing and send at least one
     real `POST /location` (§5f's own checklist, steps 2-4) — radar has
     nothing meaningful to show without this.
  3. `curl` (or Postman) `GET /radar/visible-users?filter=ALL` directly
     as one of them and manually confirm the JSON shape matches
     `RadarSnapshot` exactly, including a sane `distanceMeters` for
     whatever coordinates were used and a `stale: false` for a reading
     just sent.
  4. Open the actual frontend, log in, click "Open Radar," and confirm
     the canvas renders a marker for the other authorized user, roughly
     in a sane direction/distance given the coordinates used.
  5. Change the LEADERS/PEERS/ALL filter and confirm both the visible
     markers *and* the "Off radar" list update correctly.
  6. Click a marker and confirm `RadarUserDetails` populates with the
     right name, role, relation, connection state, and distance/bearing.
  7. Wait through at least two 5s poll cycles (open the browser's network
     tab) and confirm `GET /radar/visible-users` is actually being
     re-called on schedule, and that a presence change (e.g. the other
     user's socket disconnecting) is reflected within one or two poll
     cycles.
  8. Turn off one user's location sharing (`PATCH /location/sharing
     {enabled: false}`) mid-session and confirm that user moves from the
     radar canvas into the "Off radar" list on the next poll, rather than
     lingering with a stale position.
  9. Confirm a user in an unrelated branch (not an ancestor/descendant of
     the logged-in user) never appears anywhere in the radar response,
     regardless of physical proximity — the actual master spec §19
     privacy claim, exercised for real.

---

## 6. Conventions to preserve

(Established in Phase 1, demonstrated again by hierarchy, authorization,
presence, P2P, location, and now radar — follow this same shape for
Phase 8.)

- Module shape: `*.routes.ts` → `*.controller.ts` (thin, `asyncHandler`)
  → `*.service.ts` (logic, re-fetches actor from DB, throws `AppError`)
  → `*.schemas.ts` (zod). Repository files (raw SQL/Redis) are their own
  layer when a service needs queries/commands the ORM's fluent API
  can't express well — `hierarchy.repository.ts` for raw SQL,
  `presence.repository.ts`/`p2p.repository.ts`/`location.repository.ts`
  for raw Redis, same pattern either way. **Not every module needs
  `*.routes.ts`/`*.controller.ts`** — `p2p` (Phase 5) has neither, since
  its entire surface is Socket.IO events handled directly in
  `p2p.gateway.ts`; don't force a REST layer onto a module that doesn't
  need one just to match the shape exactly (see §4e's "No new REST
  endpoints" note). **Location (Phase 6) went the other way** — REST
  only, no gateway/Socket.IO surface at all (§4f) — for the same reason
  in reverse: its ~20s-cadence update and pull-only read don't need a
  persistent connection, so a `*.gateway.ts` would be unused ceremony.
  **Radar (Phase 7) also has `*.routes.ts`/`*.controller.ts` but
  deliberately no `*.repository.ts` at all** — the first module of the
  six built so far with zero storage of its own; it only reads through
  other modules' service-layer APIs (`authorizationService`,
  `presenceService`, `locationService`), never touching Postgres or
  Redis directly. Match what the module's actual communication/storage
  pattern needs, not a fixed template. Location's `location.geo.ts`
  (pure math with zero infra dependency, kept separate from
  `location.service.ts` specifically so it's unit-testable without
  mocking anything) has its frontend mirror in Phase 7's
  `frontend/src/components/radar/radarMath.ts` — same separation
  instinct, same reasoning, just on the client this time since that's
  where master spec §38 says the distance/bearing-to-screen-position
  calculation belongs.
- **Never trust JWT claims for authorization** — every service function
  re-fetches the actor (`requireActiveActor` pattern, now duplicated a
  sixth time in `radar.service.ts` — see presence.service.ts's original
  justification for why this stays a small per-module copy rather than a
  shared helper).
- Add new `ErrorCode`s to the union in `common/errors.ts`, don't
  hand-roll status codes, and **only add the ones you actually throw** —
  Phase 4 needed none (reused `UNAUTHORIZED`/`USER_INACTIVE`); Phase 5
  added exactly one (`LEASE_EXPIRED`); Phase 6 also added exactly one
  (`LOCATION_SHARING_DISABLED`) despite master spec §44 not listing a
  location-specific code at all — added because it's a genuinely new
  failure mode (a real request rejected for an opt-in reason) that
  doesn't map cleanly onto any existing code, not because the spec's
  list demanded it. **Phase 7 (radar) needed zero new codes** — it has
  no failure mode that isn't already `UNAUTHORIZED`/`USER_INACTIVE`
  (actor preconditions) or a standard zod `VALIDATION_ERROR` (bad
  `filter` value).
- Add schema fields with the feature that needs them, not speculatively
  — as done four times now (removal fields deferred out of Phase 1,
  added exactly when Phase 2 needed them; Phase 4 needed zero Prisma
  changes; Phase 5 also needed zero; Phase 6 needed exactly one new
  field, `User.locationSharingEnabled` — a durable *preference*, not the
  location reading itself, which stays Redis-only per master spec §41,
  same persistent/ephemeral split every phase has kept; Phase 7 needed
  zero — radar owns no storage of its own at all, see §4g).
- **Redis carries three independent ephemeral concerns, each with its
  own namespace and TTL** — `presence:*` (30s TTL, liveness),
  `p2p:lease:*`/`p2p:leases:byUser:*` (45s TTL, authorization), and
  `location:*` (50s TTL, spatial position — see §4f's
  `location.repository.ts` bullet for the reasoning behind that specific
  number). **Still exactly three after Phase 7** — radar reads all three
  through their owning services but introduces no fourth namespace of
  its own (§4g). If Phase 8 adds a fourth ephemeral concern, give it its
  own distinct namespace/TTL too, don't silently reuse any of the
  existing three for an unrelated concern.
- **Decoupling pattern (EventEmitter → gateway), used twice, is the
  house style for anything Socket.IO-broadcast — but location (Phase 6)
  and radar (Phase 7) both deliberately don't use it.**
  `presenceEvents`/`p2pEvents`/`hierarchyEvents` all exist because
  *something* needs to turn a service-layer domain event into a live
  push to connected sockets. Location has no push surface at all
  (§4f — pull-only by design, per `PHASE6_PLAN.md` §4), and Phase 6's
  own handoff flagged radar as the likely trigger for finally needing
  one — **that question is now resolved, in favor of polling**: radar
  polls `GET /radar/visible-users` every 5s from the frontend
  (`RadarContainer.tsx`) rather than adding a `radar.gateway.ts`/
  `radarEvents` emitter (§4g). If a future session finds 5s polling too
  slow or too chatty, *that's* the point where radar would need its own
  emitter and gateway — don't add one before there's a concrete reason,
  per master spec §54's "don't over-engineer future functionality."
- **Shared Socket.IO connection-auth, centralized since Phase 5**: don't
  put `io.use(authenticateSocket)` inside an individual gateway's
  register function — it lives once, in `config/socket.ts`'s
  `initSocketIO`, via `middleware/socketAuth.ts`'s exported
  `authenticateSocket` + `AuthenticatedSocket` type. Every gateway
  (`registerPresenceHandlers`, `registerP2PHandlers`, and whatever a
  future gateway adds) just types its `io.on("connection", ...)`
  callback as `(socket: AuthenticatedSocket) => ...` and reads
  `socket.data.user` directly — no per-gateway auth registration needed
  or wanted. Not touched since Phase 5 — Phase 6 added no gateway, and
  neither did Phase 7 (§4g's push-vs-poll note above).

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
6. ~~Phase 6 — Location~~ — **done this session**, see §4f. Backend +
   minimal frontend (the first frontend work since Phase 2 — Phases 3-5
   were backend-only by design, Phase 6 wasn't, per `PHASE6_PLAN.md`
   §2d). Same standing caveat as every phase so far: unit-tested with
   mocked Postgres/Redis, never run against a live stack — and this
   phase adds a *new* kind of never-yet-observed claim on top of that:
   no real browser has ever actually granted geolocation permission and
   sent a real request through this code. See §5f's numbered checklist
   — especially its step 7 (opening a real browser) — before assuming
   the frontend capture loop actually behaves correctly outside a
   mocked test.
7. ~~Phase 7 — Radar~~ — **done this session**, see §4g. Backend fully
   unit-tested (92/92 passing project-wide); frontend built, type-
   checked, and production-built. **This phase carries a bigger-than-
   usual verification gap**: unlike every phase before it, the frontend
   half has never been opened in a real browser at all — see §5g's
   numbered checklist, and prioritize running it for real before
   building anything else on top of the radar UI specifically.
8. **Phase 8 — Security Hardening is the actual next phase now** (master
   spec §47 Phase 8): device identity (public key registered per device,
   private key never leaving the device, master spec §29-30), Web Crypto
   where appropriate (no custom cryptography — §28, §42), device
   revocation, stronger session security, audit logs, and P2P session
   hardening. This phase has more genuinely open design surface than
   Phases 3-7 did (key storage strategy, revocation UX, audit log
   schema) — consider writing a `PHASE8_PLAN.md` and getting it
   confirmed with the user before implementation, the way `PHASE6_PLAN.md`
   was handled, rather than proceeding directly the way Phase 7 did.
   Concrete candidates already flagged from earlier phases belong here
   rather than being new discoveries — see §8's Phase 4/5 entries on a
   removed user's socket not being force-closed, and the P2P revocation
   broadcast being a request rather than a guarantee.
9. **No frontend presence UI and no frontend WebRTC client exist yet.**
   Phase 4 and Phase 5 were both scoped backend-only to match master
   spec §47's own per-phase lists (see §4d/§4e), and neither Phase 6's
   nor Phase 7's own frontend work touched this gap — `LocationPanel` is
   a settings toggle, and radar's presence data comes from a REST poll
   (§4g), not a live socket. A future session could add: a Socket.IO
   client connection (`socket.io-client` isn't a frontend dependency
   yet), an online/offline indicator on `HierarchyNodeRow` (presence
   data and hierarchy data cover the same set of users), a heartbeat
   loop tuned against `PRESENCE_TTL_SECONDS` (§4d gap #4), and — for
   P2P — actual `RTCPeerConnection` wiring that calls
   `p2p:request-session`/`p2p:renew-session`/`p2p:signal` and reacts to
   `p2p:session-revoked` by closing the connection (§4e). Not on the
   critical path to Phase 8, and could be done before, after, or
   interleaved with it — use judgment, or ask the user.
10. Also still open, not blocking Phase 8 but worth doing whenever
    there's a real Postgres/Redis/browser environment available: the
    full end-to-end verification checklists in §5c/§5d/§5e/§5f/§5g
    (backend) and §5b's click-through (frontend). Every session so far
    has verified logic in isolation (types, mocked units, hand-checked
    request/response contracts, one SQL-level integration check) but
    **nobody has yet run this app for real against a live stack, nobody
    has ever run two server processes at once to verify the
    multi-server presence claim, nobody has ever run two real Socket.IO
    clients at once to verify P2P signaling or revocation, nobody has
    ever opened a real browser to exercise Phase 6's geolocation loop,
    and nobody has ever opened a real browser to exercise Phase 7's
    radar UI at all.** That combination is the single biggest
    unknown-unknown risk in the project right now — worth prioritizing
    over new Phase 8 features if a normal (non-sandboxed) environment
    becomes available. If such an environment becomes available, doing
    §5e's checklist before §5d's before §5f's before §5g's is the more
    urgent order: presence's worst-case failure mode (a stale online
    indicator) is a UX annoyance, P2P revocation's worst-case failure
    mode (a removed user's session silently not being revoked) is
    closer to a security gap, location's own worst-case failure modes
    (§5f's checklist) sit in between, and radar's own checklist (§5g) is
    the most purely functional/UI-correctness-focused of the four — no
    sharp security edge of its own beyond what location/presence/
    authorization already guarantee, but the most likely to have a
    plain rendering bug nobody's caught yet.

Do not start Phase 9 before Phase 8 is solid — and Phase 9 remains
blocked regardless of how solid Phase 8 is, per master spec §33/§54 and
this file's own §9 below (the user is designing Phase 9's data-transfer
protocol separately; do not invent it preemptively). Don't treat Phase
4's multi-server claim, Phase 5's revocation-bridge claim, Phase 6's
opt-in-enforcement/TTL-expiry claims, or Phase 7's radar-rendering
claims as verified until §5d's, §5e's, §5f's, and §5g's checklists have
actually been run once against real, live processes and a real browser.

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
- **New this session (Phase 6):** unlike most of the entries in this
  section, the *big* Phase 6 decisions (opt-in default-off sharing,
  server-only distance/bearing, no raw-coordinate exposure) were already
  explicitly confirmed with the user before this session started — see
  `PHASE6_PLAN.md` §2 for the record of that. What follows are the
  smaller implementation details this session still had to decide on its
  own, within that already-confirmed frame:
  - `LOCATION_TTL_SECONDS = 50` and the ~20s frontend send cadence are
    both guesses, not numbers the user specified or validated against a
    real frontend loop — exactly the same standing caveat
    `PRESENCE_TTL_SECONDS`/`P2P_LEASE_TTL_SECONDS` already carry from
    Phases 4-5. Cheap to change (`location.repository.ts`'s constant,
    `useLocationSharing.ts`'s `UPDATE_INTERVAL_MS`) — flag to the user
    if they have a specific battery-life/freshness tradeoff in mind.
  - `PHASE6_PLAN.md` §4's two open questions were resolved in favor of
    the plan's own stated lean (REST-only, pull-only, no push layer) —
    the plan explicitly flagged these as leans to *confirm* before
    writing code, not final decisions. This session proceeded with the
    lean rather than stopping to re-confirm, on the basis that the user's
    task instruction was to complete Phase 6 using the plan "as is."
    Worth a one-line check-in with the user if Phase 7's radar turns out
    to need a push model — that would mean adding a `location:*`
    Socket.IO surface that doesn't exist yet, not just consuming what's
    already there.
  - A hierarchy-removed user's `locationSharingEnabled` flag and any
    live Redis reading are **not** proactively cleared on removal the
    way `setSharingEnabled(false)` clears them on an explicit opt-out —
    see §4f's "known gaps" for the full reasoning (the *read* path
    already correctly excludes removed users via the existing
    `status === ACTIVE` check, so this isn't a visibility leak, only a
    "how long does stale state linger in Redis after removal" question).
    This mirrors the same category of decision Phase 5 made explicit for
    P2P-lease-revocation-on-removal, just not wired up the same way for
    location — worth revisiting together if the user wants removal to
    proactively purge location state too.
- **New this session (Phase 7):** unlike Phase 6, no `PHASE7_PLAN.md`
  was written and confirmed with the user before implementation — this
  session proceeded directly from the master spec's own Phase 7
  checklist, on the basis that the user's task instruction was to
  complete Phase 7 directly. Every decision below was therefore made
  unilaterally within that instruction, not pre-confirmed the way
  Phase 6's `PHASE6_PLAN.md` decisions were:
  - **The LEADERS radar filter includes both `LEADER` and `ROOT_LEADER`
    roles.** Master spec §18's worked example supports this reading (for
    actor A, LEADERS returns B and C, both `LEADER`-role), but the spec
    never explicitly states what should happen when a `ROOT_LEADER`
    shows up as someone else's ancestor and that someone applies the
    LEADERS filter — this session's reading was "yes, include them,
    they're still a leader-type relationship." One-line change if the
    user wants ROOT_LEADER excluded from the LEADERS bucket:
    `matchesFilter` in `radar.service.ts`.
  - **Radar resolves `PHASE6_PLAN.md` §4 open question 2 in favor of
    polling, not a Socket.IO push layer** — see §4g's own "push-vs-poll"
    section for the full reasoning. `POLL_INTERVAL_MS = 5000` is a
    guess, not a number the user specified or validated against a real
    client, same standing caveat every interval constant in this
    project carries. Cheap to change
    (`RadarContainer.tsx`'s constant) — flag to the user if they have a
    specific latency/bandwidth tradeoff in mind, or if 5s polling turns
    out to feel too slow/too chatty once actually used.
  - **`RADAR_STALE_LOCATION_SECONDS = 25`** (in `radar.service.ts`) is
    likewise a guess, chosen relative to `LOCATION_TTL_SECONDS = 50` and
    the ~20s location-update cadence Phase 6 already established — not
    validated against a real client.
  - **Radar was built as a dedicated `/radar` page, not a Dashboard
    panel** — a judgment call based on master spec §51's product vision
    ("Leaders open the radar") reading more like a distinct screen than
    a settings widget, and not something the user was asked to confirm
    first. Easy to fold back into the Dashboard as a panel if the user
    would prefer that instead — `RadarContainer` itself doesn't assume
    it's the only thing on the page.
  - **`RadarPage.tsx` reuses `DashboardPage.css`'s topbar classes
    directly** (imports the file) rather than duplicating or extracting
    a shared layout component — a pragmatic shortcut flagged in §4g,
    worth revisiting with a proper shared `AppShell` if a third
    page-with-topbar is added in Phase 8+.

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
LOCATION SHARING IS OPT-IN AND OFF BY DEFAULT — NEVER AUTOMATIC JUST BECAUSE
SOMEONE IS WITHIN A USER'S HIERARCHY VISIBILITY SCOPE (PHASE6_PLAN.md §2a).
THE SERVER NEVER RETURNS ANOTHER USER'S RAW COORDINATES — ONLY COMPUTED
DISTANCE/BEARING, TO AN AUTHORIZED REQUESTER, NEVER BY PROXIMITY ALONE.
WEBRTC CONNECTIONS ARE NOT MAGICALLY SERVER-REVOCABLE ONCE ESTABLISHED.
P2P AUTHORIZATION LEASES ARE NOT FILE-TRANSFER TIMEOUTS OR CONNECTION-DURATION LIMITS.
REMOVAL IS EXPLICIT STATE, NEVER A PHYSICAL DELETE, NEVER A SILENT RE-PARENT.
CASCADING REMOVAL RECORDS ITS CAUSE (DIRECT vs GROUP_LEADER_REMOVED).
RESTORATION RESTORES OWNERSHIP, NOT AUTOMATICALLY THE WHOLE SUBTREE.
DO NOT INVENT THE DATA-TRANSFER PROTOCOL (PHASE 9) — THE USER IS DESIGNING
IT SEPARATELY AND WILL SHARE IT WHEN READY.
```

