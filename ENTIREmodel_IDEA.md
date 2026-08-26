# Hierarchical Peer-to-Peer Coordination Platform --- ENTIRE_PROJECT_IDEA

## Project Role

You are the principal software architect, senior full-stack engineer,
distributed-systems engineer, and security engineer for this project.

Help me build a production-quality, portfolio-worthy hierarchical
peer-to-peer coordination platform.

This is **not** a simple CRUD application and not just a chat
application.

The core of the project is:

1.  Hierarchical organization and authority
2.  Role-based permissions
3.  Real-time presence
4.  Peer-to-peer communication
5.  Location/proximity awareness
6.  A radar interface for authorized discovery
7.  Strong server-side authorization
8.  Secure P2P session management
9.  Distributed ephemeral state
10. A clean, modular architecture

The project will be built incrementally. Do not attempt to generate the
entire application in one step.

------------------------------------------------------------------------

# 1. Core Architectural Model

The system has three separate concepts:

``` text
HIERARCHY
    ↓
defines authority and ownership

AUTHORIZATION
    ↓
defines what a user may do and discover

NETWORK TOPOLOGY
    ↓
defines how communication happens
```

Also keep these concepts separate:

``` text
HIERARCHY ≠ NETWORK TOPOLOGY

PROXIMITY ≠ AUTHORIZATION

PRESENCE ≠ AUTHORIZATION
```

The hierarchy determines authority.

Authorization determines visibility and permitted actions.

Presence determines whether a user is currently available.

Location determines spatial position.

The P2P/network layer determines how data is transported.

------------------------------------------------------------------------

# 2. User Roles

Initially use only three roles:

``` text
ROOT_LEADER
LEADER
PEER
```

Do not introduce additional roles unless there is a concrete
requirement.

## ROOT_LEADER

The root authority of an organization.

Has authority over the complete organization subject to system rules.

## LEADER

Owns/manages a subgroup.

Can manage authorized users within that subgroup.

A leader can have:

-   peers
-   subordinate leaders
-   nested subgroups

## PEER

A normal member of a subgroup.

A peer does not automatically receive management authority.

------------------------------------------------------------------------

# 3. Hierarchy Model

Represent the organization as a tree.

Example:

``` text
ROOT A
├── LEADER B
│   ├── PEER P1
│   ├── PEER P2
│   └── LEADER C
│       └── PEER P3
└── LEADER D
    └── PEER P4
```

Every user/node should have a clear logical parent.

Conceptually:

``` text
User:
    id
    name
    role
    parentId
    organizationId
    status
    createdAt
    updatedAt
```

Additional fields can be introduced when required.

The system must be able to determine:

-   parent
-   direct children
-   ancestors
-   descendants
-   subtree
-   hierarchy depth
-   root
-   ownership scope
-   management scope
-   visibility scope

------------------------------------------------------------------------

# 4. Subgroup Ownership

Every leader owns a logical subgroup.

Example:

``` text
A
└── B
    ├── P1
    ├── P2
    └── C
        └── P3
```

B owns the subgroup containing:

``` text
B
P1
P2
C
P3
```

B's authority is still constrained by A's authority above B.

The hierarchy therefore works as delegated authority:

``` text
A
 ↓
B owns/manages subgroup
 ↓
C may own/manage nested subgroup
```

A leader can only perform operations allowed by both:

1.  Their role
2.  Their position in the hierarchy
3.  The permissions delegated to them by the hierarchy

------------------------------------------------------------------------

# 5. Removal Model

Removal is a **first-class state**.

Do not infer removal only by checking whether an ancestor is inactive.

A node should have an explicit status such as:

``` text
ACTIVE
REMOVED
```

Additional states may be introduced later if genuinely needed.

------------------------------------------------------------------------

# 6. Leader Removal --- Cascading Subgroup Removal

This is a fundamental product rule.

If a leader is removed, the **entire subgroup owned by that leader is
removed**.

Example:

``` text
A
└── B
    ├── P1
    ├── P2
    └── C
        └── P3
```

If A directly removes B:

``` text
A
└── B [REMOVED]
    ├── P1 [REMOVED]
    ├── P2 [REMOVED]
    └── C [REMOVED]
        └── P3 [REMOVED]
```

Every member of B's subgroup receives an explicit `REMOVED` state.

Do not physically delete these users.

Preserve their identities and hierarchy relationships.

------------------------------------------------------------------------

# 7. Removal Reason

Every removed user must have information explaining **why they were
removed**.

At minimum support:

``` text
DIRECT
GROUP_LEADER_REMOVED
```

### DIRECT

The user themselves was directly removed by an authorized leader.

Example:

``` text
B [REMOVED]

reason:
    DIRECT

removedBy:
    A
```

### GROUP_LEADER_REMOVED

The user was removed because their subgroup leader was removed.

Example:

``` text
P1 [REMOVED]

reason:
    GROUP_LEADER_REMOVED

removedBecauseOf:
    B

removedBy:
    A
```

This distinction must be stored explicitly rather than reconstructed
later by walking the hierarchy.

------------------------------------------------------------------------

# 8. Removal Metadata

A removed node should conceptually have:

``` text
status
removalReason
removedBy
removedAt
removedBecauseOf
```

Example:

``` text
P1

status:
    REMOVED

removalReason:
    GROUP_LEADER_REMOVED

removedBecauseOf:
    B

removedBy:
    A

removedAt:
    timestamp
```

For directly removed B:

``` text
B

status:
    REMOVED

removalReason:
    DIRECT

removedBecauseOf:
    null

removedBy:
    A

removedAt:
    timestamp
```

Use the database/service design that best supports this model.

------------------------------------------------------------------------

# 9. Removal UI

The hierarchy UI should display a visible removal tag.

Example:

``` text
Leader B [REMOVED]
    ├── Peer 1 [REMOVED]
    ├── Peer 2 [REMOVED]
    └── Leader C [REMOVED]
```

The user should be able to click the removal tag/details.

The UI should show information such as:

``` text
Removal Details

User: Peer 1

Status:
REMOVED

Reason:
Group leader removed

Removed because of:
Leader B

Removed by:
Leader A

Removed at:
<timestamp>
```

For a direct removal:

``` text
Removal Details

User: Leader B

Status:
REMOVED

Reason:
Direct removal

Removed by:
Leader A

Removed at:
<timestamp>
```

The backend must provide the authoritative removal metadata.

The frontend must not invent or infer the reason.

------------------------------------------------------------------------

# 10. Preserve the Hierarchy After Removal

When B is removed:

``` text
A
└── B [REMOVED]
    ├── P1 [REMOVED]
    ├── P2 [REMOVED]
    └── C [REMOVED]
        └── P3 [REMOVED]
```

Do NOT:

-   delete B
-   delete P1/P2/C/P3
-   automatically change all their parent relationships
-   silently re-parent descendants

The hierarchy remains available as historical structure.

This is important for:

-   auditability
-   restoration
-   ownership
-   displaying removal reasons
-   understanding why a subgroup disappeared

------------------------------------------------------------------------

# 11. Restoration Model

Restoration is **not automatic for the entire subtree**.

If A restores B:

``` text
A
└── B [ACTIVE]
    ├── P1 [REMOVED]
    ├── P2 [REMOVED]
    └── C [REMOVED]
        └── P3 [REMOVED]
```

B becomes active again and regains ownership/authority over B's
subgroup.

However, B's removed descendants remain removed until the appropriate
owner decides to restore them.

This is intentional.

------------------------------------------------------------------------

# 12. Ownership-Based Restoration

When B is restored:

``` text
A
└── B [ACTIVE]
    ├── P1 [REMOVED]
    ├── P2 [REMOVED]
    └── C [REMOVED]
```

B now has the authority to decide which members of B's subgroup should
be restored.

For example:

``` text
B restores P1
B keeps P2 removed
B restores C
```

Result:

``` text
A
└── B [ACTIVE]
    ├── P1 [ACTIVE]
    ├── P2 [REMOVED]
    └── C [ACTIVE]
        └── P3 [REMOVED]
```

Then C becomes the owner of its own subgroup again.

C may decide whether P3 should be restored, subject to the hierarchy's
permissions.

Therefore:

``` text
A restores B
        ↓
B regains subgroup ownership
        ↓
B decides what to restore
        ↓
C may be restored
        ↓
C regains subgroup ownership
        ↓
C decides what to restore
```

------------------------------------------------------------------------

# 13. Restoration and Removal History

Do not destroy removal history when a user is restored.

The system should preserve an audit trail showing:

``` text
B:
    removed by A
    reason DIRECT
    restored by A
    timestamp

P1:
    removed because B was removed
    later restored by B
```

If a user is removed again later, create a new removal event/history
entry.

Do not overwrite historical events.

------------------------------------------------------------------------

# 14. Reassignment

Reassignment is different from restoration.

A previously removed user may eventually be moved to a different
subgroup through an explicit authorized operation.

Example:

``` text
C originally belonged to B.

B was removed.

A decides C should join D.
```

This should be an explicit operation:

``` text
REASSIGN C → D
```

Do not silently re-parent users.

Reassignment should be:

-   authorized
-   explicit
-   auditable

Do not implement reassignment until required, but design the hierarchy
service so it can support it later.

------------------------------------------------------------------------

# 15. Authorization Model

Authorization is always server-side.

Conceptually:

``` text
canPerform(actor, action, target)
```

The server checks:

1.  authenticated identity
2.  actor status
3.  actor role
4.  actor's hierarchy position
5.  target's hierarchy position
6.  ownership relationship
7.  requested action
8.  any additional permission rules

Never trust:

-   frontend role
-   frontend user ID
-   frontend hierarchy
-   frontend visibility
-   client-provided permissions

The frontend may hide UI controls.

The backend remains the actual security boundary for the control plane.

------------------------------------------------------------------------

# 16. Visibility Model

Visibility should support both upward and downward coordination.

By default, a user may discover:

1.  their direct parent/leader
2.  their authorized descendants

Do not automatically expose unrelated branches.

Example:

``` text
          A
        /   \
       B     C
      / \
    P1  P2
```

B can discover:

``` text
A
P1
P2
```

B cannot automatically discover:

``` text
C
```

merely because C is nearby.

This provides upward coordination with the parent while preserving
branch isolation.

------------------------------------------------------------------------

# 17. Radar

The Radar is a core product feature.

It displays authorized, discoverable users spatially relative to the
current user.

The radar uses:

-   hierarchy
-   authorization
-   discoverability
-   role
-   presence
-   location
-   distance
-   bearing

The radar must NOT start by finding every nearby user.

Correct pipeline:

``` text
CURRENT USER
    ↓
AUTHENTICATION
    ↓
ACTIVE MEMBERSHIP
    ↓
AUTHORIZED VISIBILITY SCOPE
    ↓
DISCOVERABILITY
    ↓
ROLE FILTER
    ↓
CURRENT PRESENCE
    ↓
LOCATION
    ↓
DISTANCE + BEARING
    ↓
RADAR RENDERING
```

------------------------------------------------------------------------

# 18. Radar Role Filters

The leader can choose:

``` text
LEADERS
PEERS
ALL
```

The filter is applied after authorization/visibility is established.

Example:

``` text
A
├── B
│   ├── P1
│   └── P2
└── C
    └── P3
```

For A:

### LEADERS

``` text
B
C
```

### PEERS

``` text
P1
P2
P3
```

### ALL

``` text
B
C
P1
P2
P3
```

For B:

Default visible relationships:

``` text
A
P1
P2
```

If B has an authorized subordinate leader C:

``` text
B can see:
A
C
P1
P2
```

The exact role-filter result must respect the established visibility
scope.

Unrelated branches must not appear.

------------------------------------------------------------------------

# 19. Radar Privacy

Physical proximity never grants visibility.

Example:

``` text
Unauthorized user
        +
    2 meters away
        ↓
     NOT VISIBLE
```

The user must first be authorized/discoverable.

Only then does location determine radar position.

Never broadcast every user's raw location to every connected client.

The server should determine which location information may be shared
with which requester.

------------------------------------------------------------------------

# 20. Discoverability and Presence

A user should have an appropriate presence/discoverability state.

Conceptually:

``` text
ONLINE
OFFLINE
CONNECTING
CONNECTED
DISCONNECTED
REMOVED
```

and potentially:

``` text
DISCOVERABLE
HIDDEN
```

Do not expose location for:

-   removed users
-   unauthorized users
-   hidden users
-   stale/offline users beyond the configured policy

Location is ephemeral data.

Do not continuously store every GPS update in PostgreSQL.

------------------------------------------------------------------------

# 21. Presence Infrastructure

Use Redis for distributed ephemeral state.

Redis should handle:

-   presence
-   heartbeats
-   last-seen
-   transient location
-   temporary discovery state
-   Socket.IO multi-node coordination
-   pub/sub
-   short-lived P2P authorization leases

PostgreSQL remains authoritative for persistent state.

Conceptually:

``` text
                 PostgreSQL
              persistent state
                     │
              ┌──────┴──────┐
              │             │
          Server A       Server B
              │             │
              └──────┬──────┘
                     │
                   Redis
              ephemeral state
```

If Peer 1 is connected to Server A and Peer 2 to Server B, both must
still be able to receive relevant presence/events.

------------------------------------------------------------------------

# 22. Presence Heartbeats

Use a TTL/heartbeat mechanism.

Conceptually:

``` text
Client
  ↓ heartbeat
Redis TTL refreshed
  ↓
User considered online
```

If the heartbeat expires:

``` text
TTL expires
    ↓
presence becomes stale/offline
    ↓
event generated
    ↓
radar updates
```

Do not rely only on clean disconnect events.

------------------------------------------------------------------------

# 23. P2P Architecture

Use a hybrid architecture.

The backend is primarily the **control plane**.

It handles:

-   authentication
-   authorization
-   hierarchy
-   membership
-   permissions
-   presence coordination
-   discovery
-   signaling
-   P2P session authorization
-   audit events

WebRTC is the **data plane** for suitable direct communication.

Conceptually:

``` text
                 SERVER
              CONTROL PLANE
               /        \
        signaling      signaling
           ↓               ↓
        Peer A          Peer B
           \               /
            \             /
             \           /
              WEBRTC P2P
               DATA PLANE
```

Do not assume all communication must be P2P.

------------------------------------------------------------------------

# 24. Important WebRTC Security Limitation

A WebRTC DataChannel is direct between endpoints.

Once established:

``` text
A <──────── WebRTC ────────> B
```

the backend is not necessarily carrying those packets.

Therefore:

> The backend cannot magically reach into an already-established WebRTC
> connection and physically terminate it.

Do not claim otherwise.

The system must instead use layered P2P session authorization.

------------------------------------------------------------------------

# 25. P2P Session Authorization Lease

A P2P connection should have an application-level authorization lease.

Example:

``` text
A → Server:
"I want to connect to B."

Server checks:
- A active?
- B active?
- A authorized to communicate with B?
- any policy restrictions?

        ↓

YES

        ↓

P2P session authorization issued
```

The lease should be **short-lived and renewable**.

Important:

> The lease is NOT a file-transfer timeout and NOT a maximum WebRTC
> connection duration.

A valid connection may remain open for a long time.

The lease only means:

> "This connection remains authorized as long as authorization is
> periodically renewed."

------------------------------------------------------------------------

# 26. P2P Revocation

When A removes B:

``` text
B → REMOVED
B's subgroup → REMOVED
```

The server should:

1.  revoke relevant P2P authorization leases
2.  reject new signaling attempts
3.  reject new P2P authorization requests
4.  publish a revocation event
5.  notify connected clients
6.  cause compliant clients to immediately close affected WebRTC
    channels
7.  prevent lease renewal

Conceptually:

``` text
NODE_REMOVED
      ↓
P2P_SESSION_REVOKED
      ↓
client closes WebRTC
      ↓
lease cannot renew
      ↓
new connection rejected
```

------------------------------------------------------------------------

# 27. Important P2P Security Limitation

A malicious client can ignore an application-level revocation event.

Therefore do not claim:

``` text
server revokes authorization
=
existing WebRTC transport is physically impossible to use
```

That is false.

The realistic security model is:

-   server controls authorization
-   server blocks new connections
-   server blocks lease renewal
-   compliant clients close immediately
-   short-lived leases limit authorization freshness
-   optional application-level encryption/key rotation can provide
    stronger protection for future data
-   server relay is available when strict server control is required

A fully compromised endpoint can still retain data it already received.

Do not claim any mechanism can make a compromised endpoint forget
previously received information.

------------------------------------------------------------------------

# 28. P2P Session Encryption --- Future Layer

For sensitive data, the architecture should allow short-lived
application session keys.

Conceptually:

``` text
authorization
     ↓
session establishment
     ↓
temporary session key
     ↓
encrypted application data
     ↓
key rotation
```

Do not implement custom cryptography.

Use Web Crypto or well-reviewed cryptographic libraries.

Do not add complex cryptographic protocols to the MVP unless required.

------------------------------------------------------------------------

# 29. Multi-Device Identity

A user account is not necessarily equal to one browser/device.

Support the concept of:

``` text
User
├── Device A
│   ├── deviceId
│   └── publicKey
└── Device B
    ├── deviceId
    └── publicKey
```

For the initial web implementation:

-   generate a device-bound key where appropriate
-   keep the private key on the device
-   register only the public key with the server
-   do not store raw private keys in localStorage
-   treat a new device as a new device identity
-   associate authenticated sessions with devices

Future options can include:

-   WebAuthn/passkeys
-   device pairing
-   encrypted backup/recovery

Do not require a seed phrase unless the product explicitly becomes
self-custodial.

------------------------------------------------------------------------

# 30. Authentication vs Cryptographic Identity

Do not confuse:

``` text
Application authentication
```

with:

``` text
Device cryptographic identity
```

Authentication answers:

> Who is this user?

Cryptographic identity answers:

> Which trusted device/key is communicating?

They are separate concepts.

------------------------------------------------------------------------

# 31. Network Topology

Do not force P2P topology to mirror the hierarchy.

Example hierarchy:

``` text
A
|
B
|
P1
```

Possible network topology:

``` text
A ←→ B
A ←→ P1
B ←→ P1
```

or:

``` text
A ←→ B
B ←→ P1
```

The correct topology depends on communication needs.

Hierarchy defines authority.

Network topology defines communication paths.

------------------------------------------------------------------------

# 32. P2P Scalability

Do not build an unconditional full-mesh WebRTC network.

WebRTC should primarily be used for:

-   one-to-one communication
-   small groups
-   low-latency direct interactions

Large broadcasts should be able to use server-relayed communication.

Example:

``` text
Leader
   ↓
Server relay
   ↓
Authorized recipients
```

The server must still enforce authorization before relaying.

Do not choose an arbitrary connection-count threshold without testing.

Keep the architecture configurable.

------------------------------------------------------------------------

# 33. Data Transfer Scope for the Initial Architecture

The detailed application-level data-transfer protocol is **not yet fully
specified**.

Do not invent a large file-transfer protocol prematurely.

The current architecture only establishes:

-   WebRTC as a possible direct transport
-   server-relayed transport as a fallback
-   authorization before communication
-   renewable P2P authorization
-   revocation semantics
-   separation between control plane and data plane

When we later implement actual data transfer, design it as a separate
layer.

That future layer may include:

-   messages
-   files
-   chunking
-   acknowledgements
-   checksums/integrity
-   resumable transfers
-   transfer state
-   encryption
-   bandwidth management
-   WebRTC vs relay selection

Do not let the current authorization lease become a file-transfer
duration limit.

A long-running file transfer must be able to continue across lease
renewals while authorization remains valid.

------------------------------------------------------------------------

# 34. Database

Use PostgreSQL for persistent state.

Potential tables:

``` text
users
organizations
devices
sessions
hierarchy_events
audit_events
```

Users should support:

``` text
id
organizationId
parentId
role
status
createdAt
updatedAt
```

Removal information can be stored directly on the user/node if
appropriate and/or represented through an immutable audit/event history.

The service layer should hide storage details so hierarchy
representation can evolve later.

------------------------------------------------------------------------

# 35. Hierarchy Query Strategy

Initially use PostgreSQL recursive CTEs where appropriate.

Do not immediately add:

-   materialized paths
-   closure tables
-   duplicated ancestor arrays

unless profiling demonstrates a need.

However, keep the hierarchy service abstract enough to support a future
optimization.

Correctness is more important than premature performance optimization.

------------------------------------------------------------------------

# 36. Event-Driven Design

Use explicit domain events.

Examples:

``` text
USER_CREATED
USER_JOINED
USER_LEFT
LEADER_CREATED
PEER_ADDED
NODE_REMOVED
NODE_REACTIVATED
NODE_REASSIGNED
ROLE_CHANGED
DEVICE_REGISTERED
DEVICE_REVOKED
LOCATION_UPDATED
PRESENCE_UPDATED
P2P_SESSION_CREATED
P2P_SESSION_REVOKED
PEER_CONNECTED
PEER_DISCONNECTED
```

Example removal flow:

``` text
NODE_REMOVED
      ↓
hierarchy updated
      ↓
subtree marked REMOVED
      ↓
removal metadata assigned
      ↓
authorization changes
      ↓
presence visibility changes
      ↓
P2P leases revoked
      ↓
clients notified
      ↓
radar updates
```

For cascading removal, preserve the correct cause:

``` text
B:
    DIRECT
    removedBy = A

P1:
    GROUP_LEADER_REMOVED
    removedBecauseOf = B
    removedBy = A

C:
    GROUP_LEADER_REMOVED
    removedBecauseOf = B
    removedBy = A
```

------------------------------------------------------------------------

# 37. Frontend Architecture

Separate:

-   UI components
-   domain state
-   API state
-   hierarchy state
-   presence state
-   P2P state
-   radar calculations
-   WebRTC implementation

Do not put WebRTC logic directly into visual components.

Do not put authorization logic only into UI conditionals.

Example:

``` text
if (user.role === "LEADER") {
    showRemoveButton()
}
```

is only a UI convenience.

The backend must still independently check:

``` text
canRemove(actor, target)
```

------------------------------------------------------------------------

# 38. Radar Component Architecture

Separate the radar into components such as:

``` text
RadarContainer
RadarCanvas / RadarSVG
RadarControls
RadarUserMarker
RadarUserDetails
RadarRangeControl
RadarLegend
```

Keep calculations independent from rendering.

Example:

``` text
getDistance(origin, target)

getBearing(origin, target)

getRadarPosition(
    origin,
    target,
    range,
    orientation
)
```

Return:

``` text
x
y
distance
bearing
```

Unit-test the calculations independently.

------------------------------------------------------------------------

# 39. Radar UI

The radar should support:

-   Leaders/Peers/All filter
-   range
-   zoom
-   orientation
-   user markers
-   distance
-   direction
-   role indicator
-   connection state
-   stale-location indicator
-   user selection

Conceptually:

``` text
-----------------------------------
              RADAR

       ● Leader C

                 ● Peer 2

                    YOU

      ● Peer 1

                    ● Root A

Show: [ Leaders | Peers | All ]
Range: 500m
-----------------------------------
```

------------------------------------------------------------------------

# 40. Failure Handling

Handle:

-   server disconnect
-   Redis failure
-   WebRTC failure
-   stale presence
-   stale location
-   peer leaving
-   peer reconnecting
-   hierarchy changes during active connections
-   user removal during active P2P session
-   duplicate requests
-   simultaneous hierarchy changes
-   unauthorized requests
-   stale clients
-   multiple devices
-   signaling failure

Never assume perfect connectivity.

------------------------------------------------------------------------

# 41. Consistency Rules

PostgreSQL is authoritative for:

-   user identity
-   hierarchy
-   roles
-   membership
-   persistent authorization
-   removal state

Redis handles:

-   presence
-   heartbeat
-   transient location
-   Socket.IO coordination
-   temporary P2P leases
-   other ephemeral state

The frontend is never authoritative.

------------------------------------------------------------------------

# 42. Security Rules

Never trust the client.

Never expose private keys.

Never send raw location to unauthorized users.

Never claim WebRTC can be magically server-revoked.

Never claim short-lived leases alone provide absolute P2P termination.

Never use custom cryptography.

Never let proximity override authorization.

Never let frontend filtering substitute for server-side authorization.

Never physically delete hierarchy users merely because they were
removed.

Never silently re-parent descendants.

Never automatically restore a removed subtree when its leader is
restored.

------------------------------------------------------------------------

# 43. API Design

Potential APIs include:

``` text
POST /auth/register
POST /auth/login
POST /auth/logout

GET /users/me

GET /hierarchy
GET /hierarchy/subtree
GET /hierarchy/ancestors

POST /hierarchy/leaders
POST /hierarchy/peers

DELETE /hierarchy/nodes/:id

POST /hierarchy/nodes/:id/reactivate
POST /hierarchy/nodes/:id/reassign

GET /presence
POST /presence/location

GET /radar/visible-users
```

WebRTC signaling should use an appropriate real-time event/API design.

Do not blindly implement every endpoint above if the existing
architecture suggests a better design.

------------------------------------------------------------------------

# 44. Error Handling

Use structured errors.

Examples:

``` text
UNAUTHORIZED
FORBIDDEN
USER_NOT_FOUND
NODE_NOT_FOUND
INVALID_HIERARCHY_OPERATION
ALREADY_EXISTS
USER_INACTIVE
INVALID_ROLE
INVALID_PARENT
CONNECTION_FAILED
STALE_PRESENCE
P2P_SESSION_REVOKED
LEASE_EXPIRED
```

Never expose sensitive internal errors.

------------------------------------------------------------------------

# 45. Observability

Log important events such as:

-   authentication events
-   hierarchy changes
-   removal/restoration
-   authorization failures
-   P2P connection lifecycle
-   P2P revocation
-   important errors

Do not log:

-   private keys
-   sensitive tokens
-   unnecessary location history
-   secrets

------------------------------------------------------------------------

# 46. Testing Requirements

## Hierarchy

Test:

-   parent/child
-   ancestors
-   descendants
-   subtree
-   nested leaders
-   removal
-   cascading removal
-   removal reason
-   restoration
-   ownership restoration
-   reassignment

## Removal

Given:

``` text
A
└── B
    ├── P1
    └── C
        └── P2
```

If A directly removes B:

Verify:

``` text
B = REMOVED
P1 = REMOVED
C = REMOVED
P2 = REMOVED
```

Verify:

``` text
B.reason = DIRECT

P1.reason = GROUP_LEADER_REMOVED
P1.removedBecauseOf = B

C.reason = GROUP_LEADER_REMOVED
C.removedBecauseOf = B
```

Verify that hierarchy relationships remain intact.

## Restoration

Verify:

``` text
A restores B
```

results in:

``` text
B = ACTIVE
P1 = REMOVED
C = REMOVED
P2 = REMOVED
```

Verify B regains subgroup authority.

Verify B can restore authorized descendants.

Verify restoring C gives C authority over its subgroup.

## Authorization

Test:

-   valid leader action
-   invalid leader action
-   cross-branch access
-   privilege escalation
-   removed-user access
-   parent visibility
-   descendant visibility
-   unrelated branch isolation

## Radar

Test:

-   parent visibility
-   descendant visibility
-   leader filter
-   peer filter
-   all filter
-   unauthorized nearby user
-   stale location
-   offline user
-   removed user

## P2P

Test:

-   authorized connection
-   unauthorized connection
-   lease creation
-   lease renewal
-   lease expiration
-   lease revocation
-   new connection after revocation
-   compliant client disconnect
-   signaling rejection after revocation
-   relay fallback

## Presence

Test:

-   heartbeat
-   TTL expiration
-   multi-server presence
-   Redis coordination
-   stale state

------------------------------------------------------------------------

# 47. Development Phases

## Phase 1 --- Foundation

Implement:

-   repository structure
-   frontend
-   backend
-   TypeScript
-   PostgreSQL
-   Prisma
-   Redis
-   authentication
-   user model
-   roles

## Phase 2 --- Hierarchy

Implement:

-   root leader
-   leaders
-   peers
-   parent relationships
-   hierarchy queries
-   subgroup ownership
-   removal
-   cascading removal
-   removal reasons
-   removal UI
-   restoration
-   ownership restoration

## Phase 3 --- Authorization

Implement:

-   permission service
-   subtree authorization
-   parent visibility
-   descendant visibility
-   role authorization
-   secure APIs

## Phase 4 --- Real-Time Presence

Implement:

-   Socket.IO
-   Redis adapter
-   presence
-   heartbeat
-   TTL
-   distributed presence

## Phase 5 --- WebRTC P2P

Implement:

-   signaling
-   connection authorization
-   renewable P2P leases
-   DataChannels
-   revocation events
-   reconnection
-   server relay fallback

Do NOT yet build a complicated file-transfer protocol unless explicitly
requested.

## Phase 6 --- Location

Implement:

-   browser geolocation
-   privacy controls
-   location updates
-   stale location handling
-   Redis-backed transient location

## Phase 7 --- Radar

Implement:

-   distance
-   bearing
-   radar UI
-   leader filter
-   peer filter
-   all filter
-   parent visibility
-   descendant visibility
-   range
-   orientation
-   user selection

## Phase 8 --- Security Hardening

Implement:

-   device identity
-   Web Crypto where appropriate
-   device revocation
-   stronger session security
-   audit logs
-   P2P session hardening

## Phase 9 --- Detailed Data Transfer

Only when this phase is explicitly started, design the application-level
data-transfer protocol.

Potential future features:

-   messaging
-   large file transfer
-   chunking
-   acknowledgements
-   integrity checks
-   resumability
-   transfer state
-   encryption
-   bandwidth management
-   P2P/relay selection

Do not prematurely invent this protocol during earlier phases.

## Phase 10 --- Testing and Deployment

Implement:

-   unit tests
-   integration tests
-   E2E tests
-   failure testing
-   Docker deployment
-   production configuration
-   observability

------------------------------------------------------------------------

# 48. Development Workflow

This project must be built incrementally.

Before implementing a significant feature:

1.  Inspect the existing repository.
2.  Understand the current architecture.
3.  Identify affected modules.
4.  Explain the proposed implementation briefly.
5.  Implement the smallest coherent increment.
6.  Run tests.
7.  Run type checking.
8.  Run linting if available.
9.  Fix errors.
10. Summarize what changed.
11. Update documentation if architecture changed.

Do not generate the entire application in one response.

Do not rewrite working architecture unnecessarily.

Do not introduce libraries without a concrete reason.

Do not create duplicate abstractions.

------------------------------------------------------------------------

# 49. Vibe-Coding Behavior

I may give short instructions such as:

``` text
build the radar
add leader removal
implement WebRTC
add filtering
make the hierarchy interactive
fix this
```

Interpret them within the complete architecture.

Always inspect the current implementation before making significant
changes.

Preserve working behavior.

Make minimal, coherent changes.

If an existing abstraction already solves the problem, extend it rather
than creating a duplicate.

------------------------------------------------------------------------

# 50. When Requirements Change

When I introduce a new feature:

1.  Determine which architectural layer it belongs to.
2.  Check whether it conflicts with existing rules.
3.  Identify security implications.
4.  Identify data-model implications.
5.  Reuse existing abstractions.
6.  Explain important tradeoffs.
7.  Update documentation where appropriate.
8.  Implement incrementally.

If a new requirement contradicts a fundamental architecture/security
rule, do not silently implement it.

Explain the conflict and propose the safest design.

------------------------------------------------------------------------

# 51. Product Vision

The final application should feel like a real distributed coordination
platform.

A user logs in and sees:

-   identity
-   role
-   hierarchy position
-   connection state
-   authorized members

Leaders manage their authorized subgroups.

Peers communicate through P2P where appropriate.

Users establish real-time presence.

Leaders open the radar.

The radar allows:

``` text
LEADERS
PEERS
ALL
```

A user can see their direct parent and authorized descendants by
default.

Physical proximity only determines spatial placement after
authorization.

If a leader is removed:

``` text
leader → REMOVED
entire owned subgroup → REMOVED
```

Each removed user has a clear reason:

``` text
DIRECT
or
GROUP_LEADER_REMOVED
```

Clicking the removal tag reveals:

-   who removed them
-   why they were removed
-   which leader caused the cascading removal
-   when the removal occurred

If the removed leader is later restored:

``` text
leader → ACTIVE
```

their subgroup does **not** automatically return.

The restored leader becomes the owner again and decides which
members/subgroups to restore.

This preserves hierarchical ownership.

P2P communication is direct where appropriate, but the server remains
authoritative for control-plane authorization.

Large communication groups can use server relay.

Presence uses Redis.

Persistent hierarchy uses PostgreSQL.

Detailed file/message transfer protocols will be designed separately
when needed.

------------------------------------------------------------------------

# 52. Non-Negotiable Principles

Always preserve these:

``` text
HIERARCHY DEFINES AUTHORITY.

SUBGROUP OWNERSHIP DEFINES DELEGATED MANAGEMENT.

AUTHORIZATION DEFINES VISIBILITY.

PRESENCE DEFINES AVAILABILITY.

LOCATION DEFINES SPATIAL POSITION.

NETWORK TOPOLOGY DEFINES COMMUNICATION PATH.

P2P IS A DATA-PLANE MECHANISM, NOT THE AUTHORITY SYSTEM.

POSTGRESQL IS THE PERSISTENT SOURCE OF TRUTH.

REDIS HANDLES EPHEMERAL/DISTRIBUTED STATE.

THE FRONTEND IS NEVER THE CONTROL-PLANE SECURITY BOUNDARY.

PHYSICAL PROXIMITY NEVER GRANTS AUTHORIZATION.

WEBRTC CONNECTIONS ARE NOT MAGICALLY REVOCABLE BY THE SERVER.

P2P AUTHORIZATION LEASES ARE NOT FILE-TRANSFER TIMEOUTS.

LARGE GROUP COMMUNICATION MUST NOT REQUIRE FULL-MESH WEBRTC.

REMOVAL IS EXPLICIT STATE.

CASCADING REMOVAL RECORDS ITS CAUSE.

REMOVAL DOES NOT DELETE THE HIERARCHY.

REMOVAL DOES NOT AUTOMATICALLY RE-PARENT DESCENDANTS.

RESTORATION RESTORES OWNERSHIP, NOT AUTOMATICALLY THE WHOLE SUBTREE.

REASSIGNMENT AND RESTORATION ARE DIFFERENT OPERATIONS.

A USER ACCOUNT MAY HAVE MULTIPLE DEVICE IDENTITIES.

DO NOT INVENT THE DETAILED DATA-TRANSFER PROTOCOL UNTIL THAT PHASE IS STARTED.
```

------------------------------------------------------------------------

# 53. Priority Order

When making architectural decisions, prioritize:

1.  Security
2.  Correct authorization
3.  Correct hierarchy semantics
4.  Data consistency
5.  Privacy
6.  P2P reliability
7.  Scalability
8.  Maintainability
9.  Performance
10. UI polish

Never sacrifice security, privacy, hierarchy correctness, or consistency
merely to make implementation easier.

------------------------------------------------------------------------

# 54. Final Instruction

Treat this as a serious distributed-systems engineering project.

Build the smallest correct version first.

Do not over-engineer future functionality.

However, keep the architecture extensible enough to eventually support:

-   larger organizations
-   multiple organizations
-   richer permissions
-   multi-device identity
-   stronger end-to-end encryption
-   offline operation
-   distributed event synchronization
-   mobile clients
-   enterprise deployments
-   robust large-file transfer

Do not implement these future capabilities until required.

At every point, reason about:

``` text
WHO IS THIS USER?
        ↓
WHERE ARE THEY IN THE HIERARCHY?
        ↓
WHO OWNS THEIR SUBGROUP?
        ↓
WHAT ARE THEY AUTHORIZED TO DO?
        ↓
WHO ARE THEY AUTHORIZED TO DISCOVER?
        ↓
WHO IS CURRENTLY PRESENT?
        ↓
HOW SHOULD COMMUNICATION HAPPEN?
        ↓
HOW SHOULD THE RADAR VISUALIZE IT?
```

Build the project around these principles.
