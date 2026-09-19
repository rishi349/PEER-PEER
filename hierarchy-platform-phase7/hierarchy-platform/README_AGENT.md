# START HERE — Continuation Guide for the Next Agent

> **Read this file first. Then read `HANDOFF.md` in full before touching
> any code.** This file is a condensed map — every claim in it is backed
> by a specific `HANDOFF.md` section, which has the actual reasoning,
> the actual verification output, and the actual known gaps. This file
> exists because a fresh agent (or a human) needs a 2-minute answer to
> "what phase are we on and what's actually left," which `HANDOFF.md`'s
> full ~2400 lines don't surface at a glance.

## Document map — which file answers which question

| Question | File |
|---|---|
| What phase are we on, what's left? | **This file**, §1 below |
| What was actually built, in engineering detail, for phase N? | `HANDOFF.md` §4/§4b/§4c/§4d/§4e/§4f/§4g |
| What was verified for phase N, and what wasn't? | `HANDOFF.md` §5/§5b/§5c/§5d/§5e/§5f/§5g |
| What conventions/patterns must new code follow? | `HANDOFF.md` §6 |
| What decisions were made without the user explicitly confirming them? | `HANDOFF.md` §8 |
| What are the absolute rules that can never be violated? | `HANDOFF.md` §9 |
| What does the *product* need to do, and why? | `claude_project_master_prompt_final.md` (the master spec — authoritative, this is the actual product requirements document) |
| How was Phase 6 specifically planned before it was built? | `PHASE6_PLAN.md` (historical record; superseded by `HANDOFF.md` §4f — use it as a *template* for writing a similar plan doc before Phase 8/9, not as a source of undone work) |
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
| 7 | Radar (distance/bearing UI, filters, range, orientation) | ✅ Done, fully verified | ✅ Built, type-checked + production-built, **never opened in a real browser** | Complete — see caveat | `HANDOFF.md` §4g, §5g |
| 8 | Security Hardening (device identity, Web Crypto, device revocation) | ⬜ Not started | ⬜ Not started | **Next up** | master spec §47 |
| 9 | Detailed Data Transfer (messaging, file transfer protocol) | ⬜ **Deliberately not started** | ⬜ **Deliberately not started** | **Blocked — do not invent this.** The user is designing this separately (see `README_PROJECT_OVERVIEW.md`'s open question to their advisor) and master spec §33/§54/§9 explicitly forbid inventing it prematurely. | master spec §33 |
| 10 | Testing & Deployment (E2E, Docker, prod config) | ⬜ Not started | ⬜ Not started | Pending | master spec §47 |

**"Backend-only by design" (Phases 3-5)** is not a gap — master spec
§47's own per-phase checklist for those three phases lists no frontend
work. Phase 6 broke that pattern deliberately because its own checklist
opens with "browser geolocation," a client-side-only capability
(`PHASE6_PLAN.md` §2d explains the reasoning). **Phase 7 needed real
frontend work and got it** (a full radar UI, master spec §38-39) — but
unlike every phase before it, that UI has only been type-checked and
production-built, not actually run. Treat "Phase 7 frontend: done" as
"done pending a first real click-through," not "done and observed
working."

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

**B. No frontend exists yet for standalone presence or P2P.** Phases 4
and 5 are backend-only (by design, per master spec §47), so there is no
online/offline indicator on the hierarchy tree itself, no direct
Socket.IO client connection (`socket.io-client` isn't a frontend
dependency), and no `RTCPeerConnection` anywhere in the frontend.
Phase 7's radar *does* surface presence data (each visible user's
ONLINE/OFFLINE status), but only indirectly — it polls
`GET /radar/visible-users` every 5s rather than opening a live socket,
so there is still no real-time push-based presence UI anywhere in the
app. See `HANDOFF.md` §7 item 8.

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
`LOCATION_TTL_SECONDS = 50`, `RADAR_STALE_LOCATION_SECONDS = 25`, and
the corresponding client-side heartbeat/renewal/update/poll intervals
were all chosen by reasoning ("roughly 2x the expected client
interval"), never validated against a real running client. Cheap to
change, but don't treat them as tuned — see `HANDOFF.md` §8 for the
specific numbers and where each constant lives.

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

**G. Phase 7's frontend radar UI has never been opened in a real
browser.** Every prior phase's frontend work (Phase 2's hierarchy UI,
Phase 6's location toggle) at least had this same gap, but Phase 7 adds
a genuinely new kind of unverified surface on top of it: `getRadarPosition`
(the SVG placement math) has never been confirmed to place a marker in a
sane spot for a real distance/bearing pair, the 5s poll loop has never
been observed actually running, and nobody has clicked a marker, changed
the filter, or dragged the range slider against real data. See
`HANDOFF.md` §5g for the specific next-session checklist — this is now
the single most useful thing to verify with a real browser, ahead of
starting Phase 8.

## 3. Immediate next step: verify Phase 7, then Phase 8 — Security Hardening

**Before writing any Phase 8 code**, spend a session (or the start of
one) actually clicking through Phase 7's radar UI against a real
backend — `HANDOFF.md` §5g has the specific numbered checklist. This
project has never once been run against a live Postgres/Redis stack or
a real browser (item A above), and Phase 7 is the first UI complex
enough (SVG math, polling, multi-part filter/range/selection state) that
"type-checks and builds" is meaningfully weaker evidence of correctness
than it was for Phase 2's or Phase 6's simpler UIs. This isn't optional
polish — a wrong sign in `getRadarPosition`'s angle math, for instance,
would type-check fine and still put every marker on the wrong side of
the screen.

Once that's done (or if the user explicitly wants to proceed without a
live environment yet again, matching how every phase so far has
proceeded), Phase 8 per master spec §47 needs: device identity (public
key registered per device, private key never leaving the device),
Web Crypto where appropriate (no custom cryptography — master spec §28,
§42), device revocation, stronger session security, audit logs, and P2P
session hardening. Several concrete candidates already flagged from
earlier phases belong here rather than being new discoveries:

- A removed user's already-open Socket.IO connection isn't forcibly
  closed (item C above / `HANDOFF.md` §4d gap #1, §8).
- The P2P revocation broadcast is a request a compliant client honors,
  not a guarantee (`HANDOFF.md` §4e, §8) — master spec §27 says this is
  inherent to WebRTC, not fixable, but Phase 8's "stronger session
  security" could still add real-time server relay as a strict-mode
  fallback per master spec §32.
- Multi-device identity (master spec §29-30) doesn't exist at all yet —
  every session so far has treated "user" and "browser session" as the
  same thing.

**Write a `PHASE8_PLAN.md`** the same way `PHASE6_PLAN.md` was written
before starting — lay out the proposed architecture and flag open
questions, get it confirmed before implementation starts. This has been
the working pattern for both phases that needed a plan doc so far
(Phase 6 explicitly, Phase 7 implicitly via this file's own §1
description at the time) and Phase 8 has more open design surface
(key storage, revocation UX, audit log schema) than either of those did.

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
