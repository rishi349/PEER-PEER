# Phase 2 verification — cascading removal & restoration

**Status: the SQL logic has been integration-tested against a real
PostgreSQL instance and passed every case.** The TypeScript service
layer wrapping this SQL (`hierarchy.service.ts`) has **not** been
executed directly — see the caveat at the bottom.

## Why this exists

`prisma generate`/`migrate` cannot run in the sandbox that built this
project (network allowlist blocks `binaries.prisma.sh` — see
`HANDOFF.md` §5), which also means the actual `PrismaClient` can't
execute anything, even with a real Postgres available. To still get
real signal on the highest-risk part of Phase 2 — the recursive CTEs
and the cascading removal/restoration transactions — this test applies
a hand-written SQL schema (`prisma/manual_test_schema.sql`, kept in
sync with `schema.prisma` by hand) to a real local Postgres, then runs
the **literal SQL strings** used in `hierarchy.repository.ts` and
`hierarchy.service.ts` directly via `psql`.

This is not a substitute for running the real thing through Prisma —
do that as the first step in any environment that can reach the
internet normally (`npx prisma migrate dev`, then re-run these same
checks through the actual API, ideally as real `vitest` integration
tests per master spec §46).

## Test tree

Exactly the tree from master spec §46's own worked example:

```
A (ROOT_LEADER)
└── B (LEADER)
    ├── P1 (PEER)
    └── C (LEADER)
        └── P2 (PEER)
```

## Cases run and results

1. **`getDescendants('B')`** (the exact CTE from `hierarchy.repository.ts`)
   → returned `{P1, C, P2}`. ✅ Correct — matches spec's expected
   descendant set exactly.

2. **`getAncestors('P2')`** → returned `[C (depth 1), B (depth 2), A
   (depth 3)]`, correctly ordered nearest-parent-first. ✅

3. **Cascading removal**: removed B as actor A. Result: `B` →
   `REMOVED`/`DIRECT`/`removedBy=A`; `C`, `P1`, `P2` all →
   `REMOVED`/`GROUP_LEADER_REMOVED`/`removedBecauseOf=B`. ✅ Matches
   spec §46's verification block exactly.

4. **Restoration does not cascade**: reactivated B. Result: `B` →
   `ACTIVE`, removal fields cleared; `C`, `P1`, `P2` **remained
   REMOVED**. ✅ Confirms §11's core rule.

5. **Ownership-based restoration ordering**: with C still `REMOVED`,
   checked whether P2 (child of C) would be allowed to reactivate → the
   parent-status guard correctly evaluates to `false`. Reactivated C
   (allowed — its parent B is `ACTIVE`). Re-checked the same guard for
   P2 → now `true`. Reactivated P2. ✅ Confirms §12's top-down
   restoration ordering is enforced, not just documented.

6. **Removal history is never overwritten**: with P1 already `REMOVED`
   (tagged `removedBy=SOMEONE_ELSE`, an old timestamp, to simulate a
   distinct historical event) and B re-removed a second time (after
   being restored), the cascade's `WHERE status = 'ACTIVE'` clause
   correctly **excluded P1** from being re-tagged — P1's original
   `removedBy`/`removedAt` were untouched, while C and P2 (which were
   `ACTIVE` at that point) picked up the new removal. ✅ Confirms §13's
   "do not overwrite historical events" rule.

## Caveat — what this does NOT verify

- The TypeScript service functions themselves (`removeNode`,
  `reactivateNode`, `createMember`, etc.) were never executed — only
  the SQL they contain, copied out by hand and run via `psql`. A bug in
  the *TypeScript* glue around correct SQL (wrong variable passed,
  wrong condition on an `if`, etc.) would not be caught by this.
- The HTTP layer (routes, controllers, `requireAuth`, zod validation)
  was not exercised at all.
- The `HierarchyEvent` audit-log inserts were not tested here (they're
  straightforward single-row inserts, lower risk, but still untested).
- Real next step once Prisma can run: either `npx prisma migrate dev`
  and manually re-walk this exact scenario through the actual
  `/hierarchy/*` HTTP endpoints, or better, turn this into real
  `vitest` tests per master spec §46's test matrix.

## How to reproduce

```bash
# Postgres + Redis running locally (docker compose up -d, or local install)
psql -h localhost -U hierarchy -d hierarchy_platform \
  -f backend/prisma/manual_test_schema.sql
psql -h localhost -U hierarchy -d hierarchy_platform \
  -f backend/prisma/manual_test_seed.sql
# then run the queries/updates listed in cases 1-6 above
```
