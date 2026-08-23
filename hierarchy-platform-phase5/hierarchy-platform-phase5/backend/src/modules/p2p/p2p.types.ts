// Phase 5 — WebRTC P2P (master spec §23-28, §31-33, §47 Phase 5).
//
// Scope note, read before extending this: this module is the **control
// plane** only (master spec §23) — session authorization leases and
// signaling relay. It never touches an actual RTCPeerConnection or
// DataChannel; those exist entirely in the browser, peer-to-peer,
// outside anything this backend can see or control once established
// (§24, §27). This backend's job is: decide who is *authorized* to
// attempt a connection, relay the offer/answer/ICE-candidate messages
// needed to establish one, and revoke that authorization when it should
// no longer hold — not to implement WebRTC itself.

/**
 * The three WebRTC signaling message kinds this backend relays without
 * inspecting. `data` is opaque to the server on purpose — its shape is
 * whatever the browser's WebRTC API produced (an `RTCSessionDescriptionInit`
 * for offer/answer, an `RTCIceCandidateInit` for ice-candidate) and this
 * backend has no business parsing or validating WebRTC internals.
 */
export type SignalKind = "offer" | "answer" | "ice-candidate";

export interface SignalPayload {
  kind: SignalKind;
  data: unknown;
}

/**
 * Shape stored (as JSON) at the `p2p:lease:{sorted-pair}` Redis key.
 * `userA`/`userB` are always canonically sorted (lexicographically),
 * never "caller"/"callee" — see p2p.repository.ts's `pairId`. This
 * means either participant can independently renew the same lease.
 */
export interface P2PLeaseRecord {
  userA: string;
  userB: string;
  /** Who originally requested the session — preserved across renewals,
   *  purely informational (not re-checked by anything). */
  initiatedBy: string;
  /** ISO timestamp of the original request — preserved across renewals. */
  createdAt: string;
  /** ISO timestamp of the most recent request/renewal. */
  renewedAt: string;
  /** ISO timestamp this lease will expire if not renewed again.
   *  Informational only — Redis's own key TTL is what actually enforces
   *  expiry (master spec §25's "short-lived and renewable"), not this
   *  field. Included so a client can show/plan around it without a
   *  separate round-trip. */
  expiresAt: string;
}

/** Why a lease stopped being valid — carried on the broadcast so a
 *  client can distinguish "the other person hung up" from "they were
 *  removed from the org" without guessing. */
export type P2PRevocationReason = "CLOSED_BY_PARTICIPANT" | "NODE_REMOVED";

/**
 * Emitted on `p2pEvents` when a *new* lease is granted (a fresh
 * `requestSession`, not a renewal — mirrors presence.service.ts's
 * connect-broadcasts / heartbeat-is-silent asymmetry). p2p.gateway.ts
 * pushes this to both participants' rooms so the callee's client learns
 * a session was just authorized without polling.
 */
export interface P2PSessionAuthorizedEvent {
  userA: string;
  userB: string;
  initiatedBy: string;
  leaseId: string;
  expiresAt: string;
}

/**
 * Emitted on `p2pEvents` whenever a lease is torn down — explicitly by
 * a participant, or because `hierarchy.service.ts` marked one of the
 * two users REMOVED (master spec §26). p2p.gateway.ts pushes this to
 * both participants' rooms; a compliant client is expected to close its
 * RTCPeerConnection immediately on receiving it (§26 point 6) — this
 * backend cannot force that (§27), it can only ask.
 */
export interface P2PSessionRevokedEvent {
  userA: string;
  userB: string;
  reason: P2PRevocationReason;
  /** The user id that caused the revocation — the closing participant
   *  for CLOSED_BY_PARTICIPANT, or whichever of userA/userB was just
   *  marked REMOVED for NODE_REMOVED (always one of the two, since
   *  leases are only ever looked up by a participant's own id — see
   *  p2p.service.ts's revokeSessionsForUser). */
  revokedBy: string;
}
