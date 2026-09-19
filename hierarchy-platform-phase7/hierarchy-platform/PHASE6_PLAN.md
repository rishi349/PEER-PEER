# PHASE 6 PLAN — Location

> **Status: planning only. No code has been written for this phase yet.**
> This document exists so any agent (or human) picking this project up —
> in this session or a future one — has the full reasoning behind Phase
> 6's design *before* implementation starts, the same way `HANDOFF.md`
> documents completed phases. Treat this as authoritative for Phase 6's
> intent until an actual `HANDOFF.md` §4f is written once the phase is
> built. If those two documents ever disagree, `HANDOFF.md` wins — it
> describes what was actually built, this describes what was planned.

Master spec reference: `claude_project_master_prompt_final.md`, Phase 6
is defined at §47:

```
## Phase 6 --- Location

Implement:
-   browser geolocation
-   privacy controls
-   location updates
-   stale location handling
-   Redis-backed transient location
```

Also directly governed by §19 (Radar Privacy), §20 (Discoverability and
Presence), §21 (Presence Infrastructure — Redis's role), and §41
(Consistency Rules — Postgres vs Redis split).

---

## 1. What Phase 6 is, and isn't

Phase 6 stores and exposes **where a user currently is**, scoped by
who's authorized to know. It is explicitly **not**:

- The Radar UI itself (distance/bearing math, range, filters, rendering
  — that's Phase 7, per §47's own split. Phase 6 only needs to produce
  data Phase 7 can consume without rework).
- A location *history* feature. Master spec §20: "Do not continuously
  store every GPS update in PostgreSQL." Location is ephemeral,
  Redis-only, same persistent/ephemeral split Presence (Phase 4) and
  P2P (Phase 5) already established for their own state.
- A change to who is *authorized* to see whom. Authorization stays
  exactly `authorizationService.getVisibilityScope` — Phase 6 adds a new
  kind of *data* (coordinates) gated by that existing scope, not a new
  *rule* for the scope itself.

---

## 2. Decisions made so far (confirmed with the user)

### 2a. Location sharing is opt-in, off by default

**Decision, confirmed with the user this session**: a user must
explicitly enable location sharing before any location data leaves
their device. Not automatic just because someone is in their
authorized visibility scope.

**Reasoning laid out for the user, and the basis for this choice**:

| | Automatic (follows visibility scope) | Explicit opt-in (chosen) |
|---|---|---|
| Consistency | Matches presence/P2P exactly | A genuinely different rule than presence |
| Privacy | Weaker — no way to be visible/online but not share location | Stronger — the one truly physical-safety-sensitive data point in this app |
| Master spec fit | §16/§19 govern *authorization to see*, never mention a location-specific consent step | §20 already lists `DISCOVERABLE`/`HIDDEN` as a presence-adjacent concept the spec deliberately left out of Phase 4 — an opt-in toggle is the natural home for that same idea, just applied to location instead |
| Complexity | Zero extra state | One boolean + one extra check — small |

The tie-breaker: location is qualitatively different from "online or
not." Leaking exact-position-derived data (even distance/bearing) by
default, purely because of hierarchy position, was judged the wrong
default for something with physical-safety implications. This is
flagged here (not buried in a code comment) specifically because it's a
product decision the user made deliberately, not something inferred
from the master spec — a future session should not "simplify" this back
to automatic without checking with the user first.

**Implication for the data model**: `User` (or a new `UserPreferences`-
shaped table/column) needs a `locationSharingEnabled` boolean,
Postgres-persisted (it's a durable setting, not ephemeral — contrast
with the location *reading* itself, which stays in Redis). Default
`false`. When `false`:
- The frontend should not even attempt to capture/send geolocation.
- The backend should reject a `location:update` from a user with
  sharing disabled (defense in depth — never trust the frontend to
  simply not send it, master spec §15).
- Any stored location reading for that user should be treated as absent
  by every read path, the same way an expired presence key reads as
  simply "offline" (§4d's established precedent) — don't distinguish
  "sharing is off" from "no recent reading" at the API surface; both
  just mean "no location available for this user right now."

### 2b. The server never returns raw coordinates to a requester

**Decision**: distance and bearing are computed **server-side** and are
the only location-derived values ever sent to anyone other than the
location's own owner. Exact latitude/longitude for another user is
never exposed over any API this phase adds.

**Reasoning**: master spec §17's radar pipeline explicitly ends at
`DISTANCE + BEARING → RADAR RENDERING`, never at raw coordinates, and
§19 puts the server in charge of exactly what location information gets
shared with which requester ("Never broadcast every user's raw location
to every connected client. The server should determine which location
information may be shared with which requester."). Computing
distance/bearing requires the server to hold both parties' exact
coordinates — so exact coordinates *are* stored (Redis, ephemeral, per
§20) — but nothing downstream of the server, for any *other* user's
data, ever needs or receives them. A user's own exact coordinates can
still be returned to that same user (e.g. for their own device's UI
confirmation), just never someone else's to a different requester.

**Implication**: the location Redis repository stores exact
coordinates. The service layer's read path for "give me location info
about user X, as requested by user Y" always converts to
distance+bearing before returning, using Y's own current coordinates as
the reference point — meaning that endpoint requires Y to also have a
current location reading (you can't compute distance from an unknown
point). If Y has no current location, that's a legitimate "distance
unavailable" case, not an error — should be modeled as such, not thrown
as an exception.

### 2c. Update cadence: ~20 seconds

**Decision**: the frontend should send a location update roughly every
20 seconds while location sharing is enabled — not on every possible
`watchPosition` callback (which can fire far more often and would be
wasteful), and not only on "significant movement" (simpler to implement
correctly, and avoids having to define what counts as "significant").
This sits in the middle of the range the user was offered ("every
15-30s (moderate)").

**Relationship to the location TTL**: following the Phase 4/5
precedent of giving each Redis-backed ephemeral concern its own
TTL/namespace rather than reusing another module's constant (documented
in `HANDOFF.md` §6), Phase 6 should define its own
`LOCATION_TTL_SECONDS`, sized to give roughly one missed update of
slack against the ~20s cadence — by the same reasoning Phase 4 used for
`PRESENCE_TTL_SECONDS = 30` (roughly 2x the expected update interval).
A reasonable starting value is **45-50s**, but — matching every prior
phase's own honesty about this — this is a guess pending a real
frontend loop to validate against, not a measured number.

### 2d. Both backend and a minimal frontend, this phase

**Decision**: unlike Phases 3-5 (backend/control-plane only), Phase 6
should include a minimal frontend slice this session. Confirmed with
the user on the basis that master spec §47's own Phase 6 list literally
opens with "browser geolocation" — something that only exists
client-side, unlike Phase 4/5's infrastructure (Socket.IO, Redis
adapters, authorization services) which had no meaningful frontend
component to build yet. Building backend-only for a phase whose first
listed item is a browser API would leave the phase's actual stated
scope half-done.

**Minimal, not full Phase 7 radar UI.** In scope for Phase 6's frontend:
a way to view/toggle the opt-in sharing preference (§2a), and the
`navigator.geolocation` capture + periodic send loop (§2c) wired to the
new backend endpoint(s). Out of scope: any spatial rendering, distance
display, or map-like UI — that's Phase 7's radar component tree (§38 of
the master spec), which Phase 6 should produce clean data for but not
attempt to visualize itself.

---

## 3. Proposed architecture (not yet built — for review before implementation starts)

Following the module shape established in Phases 2-5 (`HANDOFF.md` §6):

### Backend — `backend/src/modules/location/`

- `location.types.ts` — `Coordinates { latitude, longitude, accuracy? }`,
  `LocationRecord` (Redis JSON shape: coordinates + `updatedAt`),
  `DistanceBearingResult { distanceMeters, bearingDegrees }` or a
  `null`-shaped "unavailable" variant, `LocationChangedEvent` (for the
  same EventEmitter-decoupling pattern presence/P2P both use, if a
  push-on-update model is chosen — see open question in §4).
- `location.repository.ts` — Redis layer. Own namespace
  (`location:{userId}`), own TTL constant
  (`LOCATION_TTL_SECONDS`, §2c). Exact coordinates stored here only.
- `location.service.ts` — `updateLocation(actor, coords)` (rejects if
  `locationSharingEnabled` is false, per §2a defense-in-depth),
  `getDistanceAndBearing(requester, targetUserId)` (authorization-scoped
  via `getVisibilityScope`, converts to distance/bearing per §2b, never
  returns raw coordinates for anyone but the caller's own record),
  `setLocationSharingEnabled(actor, enabled)` (Postgres write — this one
  field is the exception to "Redis only," since it's a durable
  preference, not a reading).
- `location.gateway.ts` and/or `location.routes.ts` — **open question,
  see §4** below: whether location updates go over REST, Socket.IO, or
  both, mirroring the presence/P2P split debate.

### Prisma schema change

One new field on `User` (or a small related table if the user prefers
keeping preferences separate from the core hierarchy row):
`locationSharingEnabled Boolean @default(false)`. This is the only
schema change Phase 6 should need — everything else is Redis-ephemeral,
per §41.

### Frontend — minimal slice

- A geolocation capture hook (`useLocationSharing` or similar) wrapping
  `navigator.geolocation.watchPosition`/`getCurrentPosition`, gated
  entirely behind the opt-in toggle — should not call any browser
  geolocation API at all while sharing is disabled (both for privacy
  and because most browsers prompt for permission on first call, which
  should only happen after explicit opt-in, not on page load).
- A toggle UI (likely living near `HierarchyPanel` or in a new small
  settings area) calling the new `setLocationSharingEnabled` endpoint.
- The periodic ~20s send loop calling `updateLocation`.

---

## 4. Open questions to resolve before implementation starts

1. **REST vs. Socket.IO for `location:update`.** Presence uses
   Socket.IO for its live path with a REST snapshot fallback; P2P is
   Socket.IO-only (no REST at all, per `HANDOFF.md` §4e's reasoning that
   P2P is inherently real-time). Location sits in between: a ~20s
   interval isn't as latency-sensitive as P2P signaling, so a plain
   `POST /location` on a timer is simpler and arguably sufficient — but
   using the existing Socket.IO connection (already open for presence)
   would save a redundant HTTP round-trip on the same cadence. Leaning
   toward **REST for the update itself** (`POST /location`, simple,
   matches the "not everything needs to be Socket.IO" note added to
   `HANDOFF.md` §6 for P2P) but **Socket.IO for any live push** of
   distance/bearing changes to an authorized viewer, if a push model is
   wanted at all (see next question). Will confirm this shape before
   writing code, not assume it.
2. **Push vs. pull for reading someone else's distance/bearing.** Does
   an authorized viewer get pushed updates as the other person's
   location changes (à la presence's `presence:update`), or do they
   just poll `GET`-style whenever the (future, Phase 7) radar screen is
   open? Given Phase 7 doesn't exist yet, and push-without-a-consumer is
   speculative infrastructure, current lean is: **Phase 6 builds
   pull-only** (a request/response way to ask "what's my distance and
   bearing to user X right now"), and Phase 7 decides whether to add a
   push layer once there's an actual radar UI to drive it. This avoids
   guessing at Phase 7's needs prematurely (master spec §54: "do not
   over-engineer future functionality").
3. **Where does `locationSharingEnabled` live** — directly on `User`, or
   a separate one-row-per-user preferences table? Direct-on-`User` is
   simpler and matches how presence/removal metadata were added
   in-place in earlier phases; a separate table only pays off if more
   preferences are expected soon. Leaning toward directly on `User`
   unless the user has a reason to want it separated.
4. **Staleness threshold for display purposes.** Master spec §47 lists
   "stale location handling" explicitly. Given the ~20s update cadence
   and ~45-50s TTL (§2c), a location reading that still exists in Redis
   is by definition "not yet expired" — but should there be an
   intermediate "stale but not yet gone" state (e.g. last update was
   35s ago — technically present, but old enough to flag to a viewer),
   the way master spec §20 lists a stale-location UI indicator as a
   radar concern? Current lean: **Phase 6 includes `updatedAt` in every
   distance/bearing response so a caller (eventually Phase 7's radar)
   can decide what "stale" means and render accordingly** — the
   staleness *policy*/UI treatment belongs to Phase 7, but Phase 6 must
   expose the raw data needed to make that call.

---

## 5. Non-negotiables this phase must not violate

(Carried over from `HANDOFF.md` §9 — restated here with the ones most
directly relevant to Phase 6 called out first.)

```
PHYSICAL PROXIMITY NEVER GRANTS AUTHORIZATION.
LOCATION DEFINES SPATIAL POSITION — IT IS NOT AUTHORIZATION AND NOT PRESENCE.
THE SERVER DECIDES WHAT LOCATION INFORMATION IS SHARED WITH WHOM — NEVER
   BROADCAST RAW LOCATION TO EVERY CONNECTED CLIENT.
POSTGRESQL IS THE PERSISTENT SOURCE OF TRUTH. REDIS IS EPHEMERAL ONLY —
   DO NOT CONTINUOUSLY STORE GPS UPDATES IN POSTGRESQL.
THE FRONTEND IS NEVER THE CONTROL-PLANE SECURITY BOUNDARY — THE BACKEND
   MUST INDEPENDENTLY ENFORCE locationSharingEnabled, NOT JUST HIDE THE
   FRONTEND'S CAPTURE LOOP WHEN IT'S OFF.
```

---

## 6. What happens next

This document is the plan, not the build. Before writing any Phase 6
code:

1. Confirm (or adjust) the three open questions in §4 with the user.
2. Once confirmed, implementation should follow the exact module
   shape/verification rigor every prior phase used (see `HANDOFF.md`
   §6 conventions and §5's verification pattern: `tsc --noEmit`,
   `vitest run`, explicit "not verified" callouts for anything that
   needs a live stack).
3. After implementation, this document should be superseded by a new
   `HANDOFF.md` §4f ("Phase 6 — Location") written to the same standard
   as §4d/§4e, and this file can either be deleted or kept as a
   historical planning record — the next agent's job is to trust
   `HANDOFF.md` at that point, not this file.

---

## 7. Superseded — Phase 6 is now built

As anticipated in §6 above, this plan has been superseded by
`HANDOFF.md` §4f ("Phase 6 — Location (NEW this session)") and §5f (its
verification record), written once implementation was actually
complete. This file is kept as the historical planning record per its
own instructions, not deleted — if anything here and `HANDOFF.md`
disagree, `HANDOFF.md` wins, per this document's own header.
