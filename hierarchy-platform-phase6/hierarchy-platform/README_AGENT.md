# START HERE — Continuation Guide for the Next Agent

> **Read this file first. Then read `HANDOFF.md` in full before touching
> any code.** This file is a condensed map — every claim in it is backed
> by a specific `HANDOFF.md` section, which has the actual reasoning,
> the actual verification output, and the actual known gaps. This file
> exists because a fresh agent (or a human) needs a 2-minute answer to
> "what phase are we on and what's actually left," which `HANDOFF.md`'s
> full ~1900 lines don't surface at a glance.

## Document map — which file answers which question

| Question | File |
|---|---|
| What phase are we on, what's left? | **This file**, §1 below |
| What was actually built, in engineering detail, for phase N? | `HANDOFF.md` §4/§4b/§4c/§4d/§4e/§4f |
| What was verified for phase N, and what wasn't? | `HANDOFF.md` §5/§5b/§5c/§5d/§5e/§5f |
| What conventions/patterns must new code follow? | `HANDOFF.md` §6 |
| What decisions were made without the user explicitly confirming them? | `HANDOFF.md` §8 |
| What are the absolute rules that can never be violated? | `HANDOFF.md` §9 |
| What does the *product* need to do, and why? | `claude_project_master_prompt_final.md` (the master spec — authoritative, this is the actual product requirements document) |
| How was Phase 6 specifically planned before it was built? | `PHASE6_PLAN.md` (historical record; superseded by `HANDOFF.md` §4f — use it as a *template* for writing a similar plan doc before Phase 7/8/9, not as a source of undone work) |
| What's the big-picture idea, for someone outside this codebase? | `README_PROJECT_OVERVIEW.md` (written for a non-implementation audience — e.g. an advisor reviewing the project) |

---

## 1. Phase status at a glance

| # | Phase | Backend | Frontend | Status | Detail |
|---|---|---|---|---|---|
| 1 | Foundation (auth, users, base schema) | ✅ Done | ✅ Done | Complete | `HANDOFF.md` §3 |
| 2 | Hierarchy (tree, removal, cascading removal, restoration) | ✅ Done | ✅ Done | Complete | `HANDOFF.md` §4, §4b |
| 3 | Authorization (`canPerform`, visibility scope) | ✅ Done | — (backend-only by design) | Complete | `HANDOFF.md` §4c |
| 4 | Real-Time Presence (Redis + Socket.IO) | ✅ Done | — (backend-only by design) | Complete | `HANDOFF.md` §4d |
| 5 | WebRTC P2P (signaling, leases, revocation) | ✅ Done (control-plane only) | — (backend-only by design) | Complete | `HANDOFF.md` §4e |
| 6 | Location (opt-in sharing, server-computed distance/bearing) | ✅ Done | ✅ Done (minimal toggle UI) | Complete | `HANDOFF.md` §4f |
| 7 | Radar (distance/bearing UI, filters, range, orientation) | ⬜ Not started | ⬜ Not started | **Next up** | `HANDOFF.md` §7 item 7 |
| 8 | Security Hardening (device identity, Web Crypto, device revocation) | ⬜ Not started | ⬜ Not started | Pending | master spec §47 |
| 9 | Detailed Data Transfer (messaging, file transfer protocol) | ⬜ **Deliberately not started** | ⬜ **Deliberately not started** | **Blocked — do not invent this.** The user is designing this separately (see `README_PROJECT_OVERVIEW.md`'s open question to their advisor) and master spec §33/§54/§9 explicitly forbid inventing it prematurely. | master spec §33 |
| 10 | Testing & Deployment (E2E, Docker, prod config) | ⬜ Not started | ⬜ Not started | Pending | master spec §47 |

**"Backend-only by design" (Phases 3-5)** is not a gap — master spec
§47's own per-phase checklist for those three phases lists no frontend
work. Phase 6 broke that pattern deliberately because its own checklist
opens with "browser geolocation," a client-side-only capability
(`PHASE6_PLAN.md` §2d explains the reasoning). Phase 7 will need real
frontend work (a whole radar UI, master spec §38-39) — don't assume it
can stay backend-only like 3-5 did.

## 2. What's pending, concretely (not just "later phases")

This is the aggregate of every "not verified" / "known gap" callout
across `HANDOFF.md` §5-§9, in one place, so nothing gets lost between
sessions:

**A. Never run against a live stack, at all, ever.** Every phase so far
(1 through 6) has been verified with `tsc --noEmit`, `vitest run`
against mocked Postgres/Redis, and (where a frontend existed) `vite
build`. **Nobody has ever run this application against a real
PostgreSQL + Redis instance.** This is the single largest risk in the
project — not a specific bug, but the fact that an entire class of bugs
(migration issues, real Redis TTL/keyspace-notification behavior, real
Socket.IO multi-node broadcast, real WebRTC signaling between two
browsers, real `navigator.geolocation` behavior) has zero real-world
coverage. `HANDOFF.md` §5d/§5e/§5f each have a **numbered checklist**
for exactly what to click through once a real environment is available
— run those before trusting the corresponding phase.

**B. No frontend exists yet for presence or P2P.** Phases 4 and 5 are
backend-only (by design, per master spec §47), so there is no
online/offline indicator, no Socket.IO client connection
(`socket.io-client` isn't even a frontend dependency), and no
`RTCPeerConnection` anywhere in the frontend. This isn't blocking Phase
7, but it means Phase 7's radar will be the first frontend surface that
needs live presence data — building a presence indicator may end up
being a Phase 7 prerequisite in practice, even though it's nominally
"Phase 4 leftover work." See `HANDOFF.md` §7 item 8.

**C. A user removed mid-session is not forcibly disconnected.** An
already-open Socket.IO connection or WebRTC session survives a
hierarchy removal until it naturally disconnects, renews, or the access
token expires — only *new* connections/renewals are blocked immediately.
This is a real, user-facing, security-adjacent gap, not just an
implementation nicety. Flagged for the user in `HANDOFF.md` §8; probably
worth an explicit conversation about whether it's acceptable until Phase
8 or needs to be pulled forward.

**D. Several timing constants are guesses, not measurements.**
`PRESENCE_TTL_SECONDS = 30`, `P2P_LEASE_TTL_SECONDS = 45`,
`LOCATION_TTL_SECONDS = 50`, and the corresponding client-side
heartbeat/renewal/update intervals were all chosen by reasoning ("roughly
2x the expected client interval"), never validated against a real
running client. Cheap to change, but don't treat them as tuned — see
`HANDOFF.md` §8 for the specific numbers and where each constant lives.

**E. Phase 9 (data transfer) is intentionally undesigned.** This is not
an oversight — master spec §33/§54 and the project's own non-negotiable
principles (§9) explicitly forbid inventing a file-transfer/messaging
protocol before this phase is deliberately started, because the user
wants to make that design decision with outside input first (see
`README_PROJECT_OVERVIEW.md`). **Do not sketch, scaffold, or partially
implement Phase 9 "just in case" — wait for an explicit go-ahead.**

**F. One known Redis memory-leak-on-natural-TTL-expiry gap in P2P**
(harmless, documented, not fixed) — `p2p:leases:byUser:{id}` index sets
can accumulate stale entries when a lease expires via TTL rather than
explicit close. See `HANDOFF.md` §4e for the specific mechanism and why
it wasn't fixed (low severity, self-correcting on next lookup).

## 3. Immediate next step: Phase 7 — Radar

Per master spec §47, Phase 7 needs: distance/bearing consumption (**already
built** — `GET /location/distance/:targetUserId` from Phase 6 returns
exactly `{distanceMeters, bearingDegrees, updatedAt}` or a typed
"unavailable" reason, with authorization already enforced server-side),
a radar UI (master spec §38-39's component breakdown —
`RadarContainer`/`RadarCanvas`/`RadarControls`/`RadarUserMarker`/etc.,
calculations kept independent of rendering and unit-tested on their
own), leader/peer/all role filters, range, zoom, orientation, and user
selection.

**Before writing code**, per this project's own working style
(`claude_project_master_prompt_final.md` §48-50): write a
`PHASE7_PLAN.md` the same way `PHASE6_PLAN.md` was written — lay out the
proposed architecture, flag any open questions (the biggest one carried
over from Phase 6: does Radar need a live push layer via Socket.IO on
top of Phase 6's pull-only `GET /location/distance/:id`, or is polling
while the radar screen is open sufficient? See `PHASE6_PLAN.md` §4 open
question 2 — this was deliberately left for Phase 7 to decide, not
guessed at prematurely), and get it confirmed before implementation
starts.

## 4. Standing environment limitation (not a code bug)

`npx prisma generate` cannot reach `binaries.prisma.sh` from this
sandbox (`403 Forbidden`) — confirmed fresh in every single phase so
far, including this one. This means `@prisma/client`'s generated types
(`User`, `Role`, `RemovalReason`, `UserStatus`, `PrismaClient`, etc.)
are never actually available, and `tsc --noEmit` will always show a
class of `"has no exported member"` errors against `@prisma/client` no
matter what phase you're on. **This is expected.** The verification
discipline every phase has followed: run `tsc --noEmit`, confirm the
*only* errors are this exact class, confirm no *new* file joins that
error list for a different reason, and treat that as a clean pass. If
`tsc --noEmit` ever shows an error that *isn't* an unresolved
`@prisma/client` export, that's real and must be fixed. Do the same for
`npx vitest run` (mocked Postgres/Redis, no live services needed) and,
if a frontend change was made, `npx vite build`.

## 5. Working protocol (carried over from every prior session)

1. Trust the previous phase's `HANDOFF.md` blindly — do not re-verify
   Phases 1 through N-1's implementation before starting phase N. This
   is a deliberate project convention, not laziness: re-checking wastes
   the exact budget that should go toward the new phase and its own
   verification.
2. Read the master spec's section for the phase you're building before
   writing code.
3. Build the smallest coherent increment — don't build ahead into a
   later phase "while you're in there" (Phase 9 is the sharpest example
   of why: it's explicitly blocked, see §2E above).
4. Run `tsc --noEmit`, `vitest run`, and (if frontend touched) `vite
   build`. Quote the real output in the handoff, don't summarize from
   memory.
5. Update `HANDOFF.md` (new `§4x`/`§5x` pair), `docs/PHASES.md` (the
   phase table + narrative), and this file's §1 table before finishing.
6. Package the whole repo as a new zip and present it — a file written
   but never presented is not accessible to the user on mobile.
