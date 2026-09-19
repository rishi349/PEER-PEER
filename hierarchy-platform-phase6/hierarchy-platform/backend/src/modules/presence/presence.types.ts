// Phase 4 — Real-Time Presence (master spec §21-22, §47 Phase 4).
//
// Scope note: master spec §20 lists a broader status vocabulary
// (ONLINE/OFFLINE/CONNECTING/CONNECTED/DISCONNECTED/REMOVED, plus
// DISCOVERABLE/HIDDEN). This module deliberately only implements
// ONLINE/OFFLINE, driven purely by Socket.IO connection + Redis TTL:
//   - CONNECTING/CONNECTED/DISCONNECTED describe a P2P *session's* state
//     (Phase 5 — WebRTC), not raw network presence. Do not conflate them
//     with this module's status.
//   - REMOVED is not a presence value at all here — a removed user's
//     socket can never establish presence in the first place (see
//     presence.gateway.ts's connect-time ACTIVE check), so "removed"
//     shows up simply as this user having no presence record (OFFLINE),
//     the same as anyone else who isn't connected. HierarchyNode.status
//     remains the authoritative source of "is this account REMOVED,"
//     not this module.
//   - DISCOVERABLE/HIDDEN is a future user-set visibility preference on
//     top of raw presence (radar-facing, Phase 7 territory). Not built
//     yet — do not invent it prematurely per master spec §54.
export type PresenceStatus = "ONLINE" | "OFFLINE";

/** Shape stored (as JSON) at the `presence:{userId}` Redis key. */
export interface PresenceRecord {
  status: PresenceStatus;
  /** ISO 8601 timestamp of the last connect/heartbeat that produced this record. */
  lastSeen: string;
}

/** One row of a presence snapshot, e.g. for GET /presence or presence:snapshot. */
export interface PresenceSnapshotEntry {
  userId: string;
  status: PresenceStatus;
  /** null when there is no Redis record at all (never connected, cleanly
   *  disconnected, or TTL-expired — all three read back identically). */
  lastSeen: string | null;
}

/**
 * Internal event shape emitted on presenceService.presenceEvents whenever
 * a user's status actually transitions (never on a silent heartbeat
 * renewal). `audience` is already resolved to the exact set of user ids
 * authorized to see this change (master spec §16) — presence.gateway.ts
 * only has to fan it out to Socket.IO rooms, it does no authorization
 * logic of its own.
 */
export interface PresenceChangedEvent {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
  audience: string[];
}
