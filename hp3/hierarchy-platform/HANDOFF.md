# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this
> project up in a new session: read this whole file before touching
> code.** It tells you what exists, what was decided and why, what's
> verified, and exactly what to build next. The authoritative product
> spec is `claude_project_master_prompt_final.md` (the project's master
> prompt) — this document is the **engineering status report** against
> that spec, not a replacement for it.

Last updated: **Phase 3 — Authorization, complete.** Phases 1-3 are
done (backend + frontend for 1-2; Phase 3 is backend-only, as intended —
see §4c). Nothing from Phase 4 onward has been started.

**Continuity note:** this project is built inside an ephemeral sandbox
filesystem that does not persist between separate conversations. The
only durable copy is whatever zip the user has downloaded most recently
(now includes everything through Phase 3). **If you are a fresh agent
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
│       ├── modules/hierarchy/   backend/src/modules/hierarchy/ — see §4 below
│       ├── modules/authorization/ NEW — see §4c below
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
2. ~~Frontend hierarchy UI~~ — **done Phase 2**, see §4b. Still needs a
   real click-through against a live backend (§5b) — do that before
   assuming it's bug-free, only the type contract was verified.
3. ~~Phase 3 — Authorization~~ — **done this session**, see §4c. Same
   caveat as everything else so far: unit-tested with a mocked
   repository, never run against a live database or through the real
   HTTP layer (§5c).
4. **Phase 4 — Real-Time Presence is the actual next phase now**:
   Socket.IO + Redis adapter, presence, heartbeat/TTL, distributed
   presence across multiple server instances (master spec §21-22, §47
   Phase 4). Redis has been connected and health-checked since Phase 1
   but is still functionally unused (see `config/redis.ts`) — this is
   where that finally changes. No frontend presence UI exists yet
   either.
5. Also still open, not blocking Phase 4 but worth doing whenever there's
   a real Postgres/Redis environment available: the actual end-to-end
   click-through described in §5c's last bullet. Every session so far
   has verified logic in isolation (types, mocked units, hand-checked
   request/response contracts) but **nobody has yet run this app for
   real against a live database.** That's the single biggest
   unknown-unknown risk in the project right now — worth prioritizing
   over new features if a normal (non-sandboxed) environment becomes
   available before Phase 4 is finished.

Do not start Phase 5+ before Phase 4 is solid.

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

