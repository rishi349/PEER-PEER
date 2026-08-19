# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this
> project up in a new session: read this whole file before touching
> code.** It tells you what exists, what was decided and why, what's
> verified, and exactly what to build next. The authoritative product
> spec is `claude_project_master_prompt_final.md` (the project's master
> prompt) — this document is the **engineering status report** against
> that spec, not a replacement for it.

Last updated: **Phase 2 — Hierarchy complete, backend and frontend.**
Nothing from Phase 3 onward has been started.

**Continuity note:** this project is built inside an ephemeral sandbox
filesystem that does not persist between separate conversations. The
only durable copy is whatever zip the user has downloaded most recently
(`hierarchy-platform-phase1.zip`, now updated to include everything
through Phase 2). **If you are a fresh agent session, you have no
filesystem access to this code unless the user re-uploads that zip.**
Ask for it if `/mnt/user-data/uploads` doesn't already have it.

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
├── README.md                  Setup instructions
├── docker-compose.yml          Local Postgres 16 + Redis 7
├── docs/PHASES.md              Phase checklist — keep current
├── HANDOFF.md                  This file
├── backend/
│   ├── prisma/schema.prisma    Organization, User, Session, HierarchyEvent
│   └── src/
│       ├── config/              env.ts, prisma.ts, redis.ts
│       ├── common/              errors.ts (AppError + ErrorCode union), asyncHandler.ts
│       ├── middleware/          requireAuth.ts, errorHandler.ts
│       ├── types/express.d.ts   req.user augmentation
│       ├── modules/auth/        register/login/refresh/logout + JWT helpers
│       ├── modules/users/       GET /users/me
│       ├── modules/hierarchy/   NEW — see §4 below
│       ├── app.ts               Express app assembly + /health
│       └── index.ts             entrypoint
└── frontend/
    └── src/
        ├── api/                  client.ts (fetch wrapper + silent refresh), auth.ts, hierarchy.ts (NEW)
        ├── state/                authStore.ts, hierarchyStore.ts (NEW) — both zustand
        ├── components/
        │   ├── AuthShell, Field, RolePill, RadarSweepBackground, ProtectedRoute   (Phase 1)
        │   └── hierarchy/        NEW — see §4b below
        ├── pages/                LoginPage, RegisterPage, DashboardPage (DashboardPage edited, see §4b)
        └── styles/               global.css (design tokens), forms.css
```

Frontend now has the Phase 2 hierarchy UI (§4b) wired into the
Dashboard. Auth pages (Login/Register) are untouched from Phase 1.

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
  own example of UI-convenience-vs-real-enforcement. Backend
  `ROLE_CREATION_RULES` is unchanged and is the actual boundary.

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

---

## 6. Conventions to preserve

(Unchanged from Phase 1, now demonstrated a second time by the hierarchy
module — follow this shape for Phase 3's authorization module too.)

- Module shape: `*.routes.ts` → `*.controller.ts` (thin, `asyncHandler`)
  → `*.service.ts` (logic, re-fetches actor from DB, throws `AppError`)
  → `*.schemas.ts` (zod). Repository files (raw SQL) are their own layer
  when a service needs queries Prisma's fluent API can't express well.
- **Never trust JWT claims for authorization** — every service function
  re-fetches the actor (`requireActiveActor` pattern). Phase 3's
  `canPerform(actor, action, target)` must do the same.
- Add new `ErrorCode`s to the union in `common/errors.ts`, don't
  hand-roll status codes.
- Add schema fields with the feature that needs them, not speculatively
  — as done twice now (removal fields deferred out of Phase 1, added
  exactly when Phase 2 needed them).
- Redis stays functionally unused until Phase 4.

---

## 7. What's next

**Immediate options, in order of what unblocks the most:**

1. ~~Integration-test the hierarchy module~~ — **done at the SQL level**,
   see `docs/PHASE2_VERIFICATION.md`. Still worth doing through the real
   TypeScript/HTTP layer once Prisma can run in a normal environment.
2. ~~Frontend hierarchy UI~~ — **done this session**, see §4b. Still
   needs a real click-through against a live backend (§5b) — do that
   before assuming it's bug-free, only the type contract was verified.
3. **Phase 3 — Authorization** (this is now the actual next phase): a
   `canPerform(actor, action, target)` service and the `GET /hierarchy`
   visibility scoping that Phase 2 deliberately punted (currently
   `ROOT_LEADER`-only; real branch isolation per §16 needs the general
   service, not another role gate). Once that lands, `getOrganizationTree`
   should stop being root-only and the frontend will need an equivalent
   "org view" alongside the existing "my subgroup" view — don't build
   that frontend piece before the backend visibility service exists.

Do not start Phase 4+ before Phase 3 is solid.

---

## 8. Open questions / decisions made without explicit user confirmation

- **Resolved this session, but not confirmed by the user:** `LEADER`s
  can create nested `LEADER`s (not just `PEER`s). If the user wants
  `ROOT_LEADER`-only leader creation instead, this is a one-line change
  to `ROLE_CREATION_RULES` in `hierarchy.service.ts`.
- No constraint on org size or max hierarchy depth yet — unbounded.
- No "invite" flow — creating a Leader/Peer sets their password directly
  via the creating leader; there's no email/invite-link step. Fine for
  now, worth flagging if this becomes a real product.

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

