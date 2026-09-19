# Vantage — A Hierarchical Peer-to-Peer Coordination Platform

**Project overview and open design question, prepared for review.**

This document explains what the project is, why it's built the way it
is, what has been completed so far, and asks for guidance on one
specific, still-open architectural decision: **how data (messages and
files) should actually move between users once they're authorized to
communicate.** That last part — Phase 9 in the project's own roadmap —
is deliberately left undesigned in the codebase itself, precisely so it
can be decided with outside input rather than guessed at. This document
is written to be readable without needing to look at any code.

---

## 1. What the platform is

Think of an organization that has a clear chain of command — a disaster
response team, a security/patrol operation, an event-staffing
organization, or any group where some members lead subgroups of other
members, and where "who reports to whom" matters for both authority and
communication. Vantage is a platform for exactly that structure. It
combines four things that most existing tools only do separately:

1. **An organizational hierarchy** — a tree of leaders and their
   subgroups, with a formal notion of removal (including *cascading*
   removal, when a leader is removed their whole subgroup goes with
   them) and restoration, and a permanent audit trail explaining *why*
   any given person is no longer active.
2. **Role-based, position-based authorization** — what a user can see
   and do is derived strictly from their position in that hierarchy
   (their own leader, and their own subordinates), never from the
   client application, and never simply because two people happen to be
   physically close to each other.
3. **Real-time presence and proximity awareness** — who's currently
   online, and (only if they've explicitly opted in) roughly where they
   are relative to people they're authorized to see, shown on a
   radar-style display.
4. **Direct peer-to-peer communication** — once two authorized users
   want to talk, the platform tries to connect them *directly*
   (browser-to-browser, via WebRTC) rather than routing everything
   through a central server, while still keeping the server in full
   control of *who is allowed to connect to whom* and *for how long*.

The closest informal comparison: something like a cross between an
organizational chart with a strict chain-of-command, a "Find My
Friends"-style proximity radar, and a peer-to-peer chat/calling app —
but with the authorization and audit rigor of an enterprise access
control system, because the hierarchy and removal semantics are treated
as first-class, not an afterthought.

## 2. The core architectural idea

The single most important design decision in this project is keeping
four concepts strictly separate, even though it would be simpler (and
in many toy implementations, tempting) to conflate them:

```
HIERARCHY            →  who reports to whom (authority, ownership)
AUTHORIZATION        →  what a user may see or do (derived from hierarchy)
PRESENCE             →  is a user currently online (says nothing about permission)
LOCATION             →  where a user physically is (says nothing about permission)
NETWORK TOPOLOGY     →  how bytes actually move between two users
```

Two rules follow directly from this separation, and both are treated as
**non-negotiable** throughout the project:

- **Physical proximity never grants visibility.** Standing two meters
  from someone gives you no information about them unless the hierarchy
  already authorized you to see them. This is the opposite of most
  consumer "nearby" features, and is deliberate — it's the difference
  between a radar that shows your own team and a radar that shows every
  stranger nearby.
- **The frontend is never the security boundary.** Every permission
  check is re-derived on the server from the database, on every
  request, regardless of what the client claims about itself. The
  client can hide a button; it can never grant itself a permission.

### Control plane vs. data plane

The backend server and the actual peer-to-peer connection play very
different roles, and the project treats this distinction carefully:

```
                    SERVER  (control plane)
        identity · hierarchy · authorization
        presence coordination · signaling
        session authorization ("leases")
                  /                    \
          authorizes              authorizes
                /                        \
           Peer A  ←──────────────────→  Peer B
                     DIRECT CONNECTION
                       (data plane)
```

The server's job is to decide **who may talk to whom, and for how
long** — never to be a required intermediary for every byte exchanged.
Once two peers are authorized, the actual connection (video, audio,
messages, files — via WebRTC) can go directly between their browsers,
which is faster and doesn't force the server to carry bulk traffic for
every conversation in the organization.

This has an important, deliberately-acknowledged limitation that the
project does **not** try to paper over: once a direct peer-to-peer
connection is established, the server **cannot reach in and physically
terminate it**. The server can revoke *authorization* instantly (delete
the permission record, tell both sides "this is no longer allowed"),
and a well-behaved client will close the connection immediately — but a
malicious or broken client could technically ignore that signal and
keep an already-open connection alive. This is a known, inherent
property of how WebRTC works, not a bug in this project, and the system
is designed around that reality (short-lived, renewable authorization
"leases" that must be actively kept alive) rather than making a false
promise of instant physical disconnection.

### Persistent vs. ephemeral state

Two very different kinds of data exist in this system, and they're
stored very differently on purpose:

| | Examples | Storage | Lifetime |
|---|---|---|---|
| **Persistent, authoritative** | who's in the organization, roles, hierarchy structure, removal history | PostgreSQL | Forever (or until explicitly changed) |
| **Ephemeral, transient** | is a user online right now, their current GPS position, an active peer-to-peer session's authorization | Redis, with automatic expiry (TTL) | Seconds to minutes — expires automatically if not refreshed |

This split matters for privacy as much as performance: a user's exact
location, for example, is *never* written to the permanent database at
all — only the single most recent reading exists, temporarily, and it
disappears on its own within about a minute if not refreshed. There is
no location history to leak, subpoena, or accidentally retain.

## 3. What has been built so far

The project is being built in ten planned phases; six are complete.

| Phase | What it does | Status |
|---|---|---|
| 1. Foundation | Accounts, login, the base data model | ✅ Complete |
| 2. Hierarchy | The organization tree itself: creating leaders/members, removing them (with cascading removal through a whole subgroup), and restoring them — with every removal recording *why* (directly removed vs. removed because their leader was removed) | ✅ Complete |
| 3. Authorization | The rule engine deciding what any given user may see or do, enforced entirely server-side | ✅ Complete |
| 4. Real-Time Presence | Online/offline status, kept accurate across multiple server instances via Redis | ✅ Complete |
| 5. Peer-to-Peer Sessions | The authorization/signaling layer for direct WebRTC connections — session "leases" that must be renewed, and are revoked automatically if a user is removed | ✅ Complete (server side) |
| 6. Location | Opt-in location sharing; the server computes only distance-and-direction for an authorized viewer, never revealing exact coordinates to anyone but the person themself | ✅ Complete |
| 7. Radar | The actual visual radar screen consuming Phase 6's data | ⬜ Not started (next) |
| 8. Security Hardening | Per-device cryptographic identity, stronger session security | ⬜ Not started |
| 9. Data Transfer Protocol | **The actual messaging/file-transfer protocol that runs over the Phase 5 P2P sessions — this is the open question below.** | ⬜ **Deliberately not started** |
| 10. Testing & Deployment | End-to-end tests, containerized deployment | ⬜ Not started |

A few points worth highlighting for evaluation purposes:

- **The removal/restoration model is more rigorous than it might sound.**
  Removing a leader cascades to their entire subgroup, but restoring
  that leader does *not* automatically bring the subgroup back — the
  leader has to explicitly decide, member by member, what to restore.
  Every removal is permanently attributed to a specific cause and
  actor, and history is never overwritten, only appended to.
- **Nothing about location or presence is ever broadcast indiscriminately.**
  Every value returned by the server (an online/offline status, a
  distance-and-bearing reading) has already been filtered through the
  same authorization check used everywhere else in the system — there
  is exactly one place in the codebase that decides "who may see whom,"
  and every feature defers to it rather than growing its own copy of
  that logic.
- **Every phase has been verified with automated tests** (currently 76
  passing unit tests covering hierarchy logic, authorization rules,
  presence transitions, P2P session lifecycle, and location math), but
  **none of it has yet been run against a live, real Postgres/Redis
  deployment or a real browser pair** — the current environment this
  project is being developed in has network restrictions that prevent
  that. This is an explicitly tracked gap, not an oversight, and is the
  top priority once a normal development environment is available.

## 4. The open question: how should Phase 9 (data transfer) actually work?

This is where guidance would be most valuable.

Phases 1-6 deliberately built the *authorization and connection
scaffolding* — who may talk to whom, for how long, and how that
permission gets revoked — without yet deciding **the actual protocol
for moving messages and files across that connection.** The master
specification for this project explicitly forbids inventing that
protocol prematurely, precisely because it's a substantial design
decision with real trade-offs that deserves deliberate thought rather
than being bolted on as a side effect of an earlier phase.

### Constraints already locked in by Phases 1-6

Whatever Phase 9 design is chosen, it has to work within these already-
established facts:

- The server already provides a control-plane authorization layer
  ("this pair of users is currently allowed to communicate," renewable,
  revocable) — Phase 9 doesn't need to reinvent authorization, only
  decide how bytes move once authorization exists.
- Direct WebRTC connections are available but **not mandatory** for
  every pair — the system was designed so that not everything has to be
  strict peer-to-peer.
- A large group (e.g., a leader broadcasting to their whole subgroup)
  should **not** require a full-mesh of direct connections between every
  pair of participants — some form of server-assisted relay for large
  groups was anticipated from the start.
- An authorization "lease" being renewed is a *permission* concept, not
  a transfer-duration limit — a long file transfer must be able to
  outlive several lease renewals as long as authorization keeps being
  renewed. The transfer protocol and the authorization protocol are
  meant to be independent of each other.
- Location data's precedent (nothing sensitive persisted longer than
  necessary, ephemeral by default) suggests message/file *content*
  should probably follow a similarly conservative retention default —
  though this is exactly the kind of call this section is asking for
  guidance on.

### Candidate architectures

| | **A. Pure P2P (WebRTC only)** | **B. Server relay (store-and-forward)** | **C. Hybrid (P2P, fallback to relay)** | **D. Content-addressed / swarm** |
|---|---|---|---|---|
| **How it works** | Sender and receiver exchange data directly over a WebRTC DataChannel; files are split into chunks with a manifest for integrity/resumability | Sender uploads to the server, which stores it (temporarily or persistently) until the recipient downloads it | Attempt direct P2P first; if the peer is offline or the connection can't be established (NAT/firewall issues), transparently fall back to relaying through the server, using the same chunk/manifest format either way | Files are split into hash-identified chunks; if multiple recipients want the same file (e.g. a leader broadcasting to a subgroup), peers can share chunks with each other, not just with the original sender |
| **Works if recipient is offline** | ❌ No — both parties must be connected simultaneously | ✅ Yes — this is its main advantage | ✅ Yes, via the fallback path | ⚠️ Partial — depends on whether any peer with the data is online |
| **Large-file / scalability** | ⚠️ Fine for 1-to-1, poor for one-to-many (would need a separate relay for broadcasts anyway, per the "no full-mesh" constraint above) | ✅ Scales predictably, but every byte transits the server (bandwidth cost) | ✅ Best of both — direct when possible, server only when needed | ✅ Best for one-to-many distribution, since load spreads across peers |
| **Server ever sees message/file content** | ❌ Never (server only ever brokered the connection) | ✅ Always (server is a required intermediary) | ⚠️ Only for the relayed fraction of traffic | ⚠️ Depends on whether relay/seeding nodes are trusted peers or the server itself |
| **Fits the existing revocation model cleanly** | ✅ Yes — revoking the lease stops new transfers; an in-flight one is a known, accepted limitation (see §2 above) | ✅ Very cleanly — the server can refuse to hand over a stored file the instant authorization is revoked, even mid-transfer | ✅ Yes, with slightly more bookkeeping (need to know which path a given transfer used) | ⚠️ Harder — revoking one peer doesn't un-share chunks already distributed to others |
| **Implementation complexity** | Moderate (chunking, ACKs, resumability all need to be built by hand) | Low (this is a fairly standard upload/download pattern) | High (two code paths that need to behave identically from the application's point of view) | High (piece-selection logic, and arguably more machinery than a course-scoped project needs) |
| **Good fit if...** | Privacy/server-blindness to content is the top priority, and offline delivery isn't required | Guaranteed delivery and simplicity matter more than architectural purity, and the server is already a trusted party (it already runs authorization) | The project has time to build it properly and wants to demonstrate handling a real distributed-systems trade-off, not just pick one extreme | The project wants to explore large-scale broadcast distribution as its own research contribution |

*(A fifth option worth naming separately: **decoupling messages from
files.** Small, frequent messages could use one of the above patterns
tuned for low latency, while large file transfers use a different one
tuned for throughput/resumability — e.g., messages via a lightweight
relay "mailbox" for guaranteed delivery, files via option A or C. This
avoids forcing one architecture to be good at both very different
workloads.)*

### Questions that would help narrow this down

- **Does a message or file need to be deliverable if the recipient is
  offline right now?** If yes, pure P2P (Option A) is ruled out on its
  own; something with server-side storage (B, C, or a hybrid) becomes
  necessary.
- **Should the server ever be able to see the content being
  transferred** — whether for a compliance/audit reason, or is
  *preventing* that ("even the server operator can't read your
  messages") itself a stated goal of the platform? This has a large
  effect on whether relay-based options are acceptable at all, or
  whether end-to-end encryption needs to be layered on top of whichever
  transport is chosen.
- **What's the realistic scale** — is this mostly 1-to-1 communication,
  or does a leader routinely need to broadcast a large file to a
  20-person subgroup at once? The "no full-mesh WebRTC" constraint
  already established in this project means broadcast-heavy usage
  pushes meaningfully toward relay or swarm-style options.
- **How large do files realistically get?** Small text/image messages
  behave very differently from, say, multi-gigabyte video files, both
  in terms of which transport makes sense and whether resumability is a
  hard requirement.
- **Given the remaining project timeline, how much implementation risk
  is acceptable?** The hybrid and swarm options are the most
  architecturally interesting but also the most work; the relay-only
  option is the safest bet to finish cleanly but "spends" less of the
  P2P infrastructure already built in Phase 5.

**The ask:** given the trade-offs above, which of these directions (or
which combination — e.g., messages via relay, files via hybrid P2P) is
most appropriate to pursue for Phase 9, and are there additional
requirements (compliance, expected deployment context, evaluation
criteria for the course) that should weigh into that choice?

---

*For implementation-level detail on any of the above — exact API
shapes, database schema, test coverage, or what remains unverified — see
`HANDOFF.md`, the engineering continuity document maintained alongside
each phase.*
