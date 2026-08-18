# HANDOFF — Hierarchical P2P Coordination Platform ("Vantage")

> **If you are a Claude agent (or any other engineer) picking this project
> up in a new session: read this whole file before touching code.** It
> tells you what exists, what was decided and why, what's verified, and
> exactly what to build next. The authoritative product spec is
> `claude_project_master_prompt_final.md` (the project's master prompt) —
> this document is the **engineering status report** against that spec,
> not a replacement for it.

Last updated: **Phase 1 — Foundation, complete.** Nothing from Phase 2
onward has been started.

---

## 1. How to orient yourself in 60 seconds

1. Read `docs/PHASES.md` for the phase-by-phase checklist (source of
   truth for status — keep it updated as you go).
2. Read §6 below ("Conventions") before writing any new code — it
   encodes decisions you should not silently redo differently.
3. Read §7 ("What's next") for the concrete next increment.
4. Do **not** regenerate the whole app. The master prompt is explicit:
   build incrementally, inspect before changing, smallest coherent
   increment, explain before implementing.

---

## 2. What actually exists right now

```
hierarchy-platform/
├── README.md                 Setup instructions
├── docker-compose.yml         Local Postgres 16 + Redis 7
├── docs/PHASES.md             Phase checklist — keep current
├── HANDOFF.md                 This file
├── backend/
│   ├── prisma/schema.prisma   Organization, User, Session models
│   └── src/
│       ├── config/            env.ts (zod-validated), prisma.ts, redis.ts
│       ├── common/             errors.ts (AppError), asyncHandler.ts
│       ├── middleware/         requireAuth.ts, errorHandler.ts
│       ├── types/express.d.ts  req.user augmentation
│       ├── modules/auth/       register/login/refresh/logout + JWT helpers
│       ├── modules/users/      GET /users/me
│       ├── app.ts              Express app assembly + /health
│       └── index.ts            entrypoint
└── frontend/
    └── src/
        ├── api/                 client.ts (fetch wrapper + silent refresh), auth.ts
        ├── state/authStore.ts   zustand store
        ├── components/          AuthShell, Field, RolePill, RadarSweepBackground,
        │                        ProtectedRoute
        ├── pages/                LoginPage, RegisterPage, DashboardPage
        └── styles/               global.css (design tokens), forms.css
```

Everything above is real, installed, and was type-checked / built in the
sandbox that authored it (see §5). It is **not** running anywhere
persistent — this was built in an ephemeral container. The only durable
copy is whatever zip the user downloaded
(`hierarchy-platform-phase1.zip`, and now an updated one with this file
in it). **If you are a fresh agent session, you have no filesystem access
to prior work unless the user re-uploads that zip.** Ask for it if it's
not already in `/mnt/user-data/uploads`.

---

## 3. What Phase 1 actually implements

**Auth & identity**
- `POST /auth/register` — creates a brand-new `Organization` **and** its
  `ROOT_LEADER` user in one transaction. This is currently the *only* way
  to create a user — there is no invite/create-under-a-parent flow yet.
- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /users/me` (behind `requireAuth`)
- Access token: short-lived JWT (default 15m), returned in the JSON body,
  kept **in memory only** on the frontend (never localStorage).
- Refresh token: JWT in an **httpOnly, sameSite=lax cookie** scoped to
  `/auth`, default 7 days. Each refresh **rotates** the token: the old
  `Session` row is marked `revokedAt`, a new one is created. If a refresh
  token is presented whose hash doesn't match the session's current
  `refreshTokenHash` (i.e. reuse of an already-rotated token), the whole
  session is revoked defensively.
- Passwords hashed with bcrypt (12 rounds).

**Data model (Postgres via Prisma)** — `backend/prisma/schema.prisma`
- `Organization(id, name, ...)`
- `User(id, organizationId, parentId, name, email, passwordHash, role, status, ...)`
  - `role`: `ROOT_LEADER | LEADER | PEER`
  - `status`: `ACTIVE | REMOVED` — **the enum exists, but nothing sets it
    to `REMOVED` yet.** No removal logic exists. `parentId` is a
    self-relation but nothing ever sets it to non-null yet either — every
    user created so far is a root.
  - Deliberately **excluded** so far: `removalReason`, `removedBy`,
    `removedBecauseOf`, `removedAt` (arrive with Phase 2's removal
    feature, per the master spec's cascading-removal model in its §5-14).
- `Session(id, userId, refreshTokenHash, expiresAt, revokedAt, ...)`

**Explicitly not built**: hierarchy mutation beyond root creation,
removal/cascading removal, restoration, reassignment, authorization
scoping (`canPerform`), presence, heartbeats, location, radar, WebRTC
signaling/leases, device identity, the data-transfer protocol (Phase 9 —
**the user said they'll describe this design later; do not invent it**).

---

## 4. Frontend design system (so Phase 2+ UI stays consistent)

Working product name: **Vantage**. Visual direction: dark "command deck"
theme that foreshadows the Radar feature (master spec §17-19) even
though Radar itself doesn't exist until Phase 7 — a slow rotating sweep
+ range rings sit behind the auth screens as the one deliberate
decorative flourish.

- Colors (CSS vars in `frontend/src/styles/global.css`): `--bg`,
  `--surface`, `--signal` (teal, used for presence/success — will double
  as the "online" radar color), and three **role colors** that double as
  future radar-marker colors: `--role-root` (coral/red), `--role-leader`
  (amber), `--role-peer` (teal).
- Type: display = Space Grotesk, body = Inter, mono = IBM Plex Mono
  (mono is used specifically for machine-truth values: ids, emails,
  timestamps — keep that convention for hierarchy paths, device ids,
  etc. in later phases).
- Component conventions: colocated `.css` files per component (no
  Tailwind, no CSS-in-JS — plain CSS with variables). `RolePill` already
  exists and should be reused (not reimplemented) anywhere a role badge
  is needed. The Dashboard's "Coming up" panel grid
  (`DashboardPage.tsx`) is a deliberate roadmap placeholder — replace
  each panel with the real feature as its phase lands, don't just delete
  it.

---

## 5. Verification performed (and a real caveat)

In the sandbox that built this:
- `backend`: `npm install` ✅. `npx tsc --noEmit` is clean **except** two
  errors caused by `@prisma/client`'s types being unavailable —
  `prisma generate` could not download its query-engine binary because
  `binaries.prisma.sh` is not on that sandbox's network allowlist. This
  is an environment restriction, not a code defect. **The first thing to
  do in any environment with normal internet access is
  `cd backend && npx prisma generate` (or `npx prisma migrate dev`,
  which runs it automatically) — then re-check `tsc --noEmit` is fully
  clean before assuming otherwise.**
- `frontend`: `npm install` ✅, `npx tsc --noEmit` ✅ clean, `npx vite
  build` ✅ succeeds (178 KB JS bundle, gzip 57.7 KB).
- **Not verified**: nothing was run against a live Postgres/Redis
  instance (none available in that sandbox). The auth flow's logic was
  reviewed carefully but not integration-tested end-to-end. Treat that as
  the first thing to actually exercise once you have Docker/Postgres
  available — `docker compose up -d` then hit `/auth/register` and
  confirm a row lands in `users` and `organizations`.
- No automated tests exist yet (no `*.test.ts` files). `vitest` is in
  `backend/package.json` devDependencies but unused so far.

---

## 6. Conventions to preserve (don't silently redo these differently)

- **Module shape**: each backend module = `*.routes.ts` → `*.controller.ts`
  (thin, uses `asyncHandler`) → `*.service.ts` (business logic, talks to
  Prisma) → `*.schemas.ts` (zod input validation). Follow this for the
  Phase 2 `hierarchy` module.
- **Errors**: throw `AppError(code, message)` from services/controllers;
  never hand-roll `res.status(...).json(...)` for error paths. Add new
  codes to the `ErrorCode` union in `common/errors.ts` (the master spec's
  §44 list has several — `NODE_NOT_FOUND`, `INVALID_HIERARCHY_OPERATION`,
  `INVALID_PARENT`, etc. — that Phase 2 will need and Phase 1
  deliberately didn't add yet).
- **Never trust the access token's claims for authorization decisions**
  beyond raw identity — `users.service.ts`'s `getCurrentUser` re-reads
  from Postgres on purpose. Any `canPerform(actor, action, target)` logic
  in Phase 3 must do the same: look up current hierarchy state fresh, not
  from the JWT payload.
- **Schema migrations**: add fields with the feature that needs them
  (see how removal fields were deliberately deferred out of Phase 1's
  `User` model) rather than speculatively. Keep the reasoning as a schema
  comment, as already done.
- **Redis**: connected and health-checked, but must stay functionally
  unused until Phase 4. Don't reach for it early as a shortcut.
- Follow master spec §48's workflow for every new increment: inspect →
  explain briefly → implement smallest coherent increment → typecheck →
  summarize → update `docs/PHASES.md`.

---

## 7. What's next: Phase 2 — Hierarchy (not started)

Concrete next increment, per the master spec §47 Phase 2 and its
Authorization-adjacent groundwork:

- `POST /hierarchy/leaders` and `POST /hierarchy/peers` — an
  authenticated `ROOT_LEADER`/`LEADER` creates a new user under
  themselves (`parentId` = actor's id). Needs a `hierarchy.schemas.ts`
  validating role + name/email/password, and a `canCreateUnder(actor)`
  check that at minimum enforces: actor is `ACTIVE`, actor's role can
  manage the target role (a `PEER` cannot create anyone).
- `GET /hierarchy/subtree`, `GET /hierarchy/ancestors` — recursive CTEs
  against Postgres per master spec §35 (no materialized paths/closure
  tables yet — correctness over premature optimization).
- `DELETE /hierarchy/nodes/:id` — **this is the big one**: cascading
  removal per master spec §6-9. Requires adding `removalReason`,
  `removedBy`, `removedBecauseOf`, `removedAt` to `User` (migration), and
  writing the recursive "mark subtree REMOVED, tag direct target as
  `DIRECT` and everyone beneath as `GROUP_LEADER_REMOVED` with
  `removedBecauseOf` = the directly-removed node" logic. Must not
  physically delete rows or re-parent anyone (non-negotiable, master spec
  §42/§52).
- `POST /hierarchy/nodes/:id/reactivate` — ownership-based restoration
  (master spec §11-12): reactivating a node does **not** cascade to its
  descendants; the reactivated node's owner decides subtree-by-subtree.
- Frontend: replace the Dashboard's "Hierarchy" roadmap panel with an
  actual tree view once the above lands.

Do not start Phase 3 (authorization scoping) or beyond until Phase 2 is
solid and the user has confirmed it.

---

## 8. Non-negotiable principles (carried over from the master spec — do not violate these regardless of what phase you're implementing)

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

---

## 9. Open questions for the user (worth asking before Phase 2, not assuming)

- Should `LEADER`s be allowed to create other `LEADER`s under themselves
  (nested leaders, per master spec's example hierarchy in §3), or only
  `ROOT_LEADER` can mint leaders in v1?
- Any constraint on org size / max depth for v1, or truly unbounded?
