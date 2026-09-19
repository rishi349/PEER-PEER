import type { HierarchyNode } from "../hierarchy/hierarchy.types";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as authorizationService from "../authorization/authorization.service";
import * as locationService from "../location/location.service";
import * as presenceService from "../presence/presence.service";
import type { PresenceStatus } from "../presence/presence.types";
import type { RadarFilter, RadarRelation, RadarSnapshot, RadarVisibleUser } from "./radar.types";

/**
 * How old a `location.updatedAt` reading may be before radar flags it as
 * stale (master spec §39's "stale-location indicator"), independent of
 * whether the underlying Redis key has actually expired yet
 * (LOCATION_TTL_SECONDS = 50, location.repository.ts). Chosen as
 * "a bit more than one missed ~20s update cycle" — the same reasoning
 * PHASE6_PLAN.md §2c already applied to the TTL itself, applied here one
 * layer up for a UI-facing signal rather than a Redis expiry. Same
 * standing "guess, not a measurement" caveat every TTL/interval constant
 * in this project carries (PRESENCE_TTL_SECONDS, P2P_LEASE_TTL_SECONDS,
 * LOCATION_TTL_SECONDS) — there is still no real frontend send loop to
 * validate it against.
 */
export const RADAR_STALE_LOCATION_SECONDS = 25;

/**
 * Same re-fetch-from-Postgres-rather-than-trust-the-token pattern every
 * other service in this codebase uses (master spec §15), duplicated
 * locally per the established convention (see presence.service.ts's/
 * location.service.ts's own copies of this exact comment).
 */
async function requireActiveActor(userId: string) {
  const actor = await prisma.user.findUnique({ where: { id: userId } });
  if (!actor) {
    throw new AppError("UNAUTHORIZED", "Actor no longer exists");
  }
  if (actor.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This account is no longer active");
  }
  return actor;
}

/**
 * Master spec §18's filter, applied to an already-authorized candidate
 * (this function is never given a chance to widen the set — only to
 * narrow it). ROOT_LEADER and LEADER both count as "LEADERS" — matches
 * §18's own worked example (for actor A, the LEADERS filter returns B
 * and C, which are LEADER-role nodes; a ROOT_LEADER encountered as
 * someone else's *ancestor* — e.g. B's own view of A — is exactly the
 * "direct parent/leader" §16 already groups with leadership, so it
 * belongs in the same bucket here too).
 */
function matchesFilter(node: HierarchyNode, filter: RadarFilter): boolean {
  switch (filter) {
    case "LEADERS":
      return node.role === "LEADER" || node.role === "ROOT_LEADER";
    case "PEERS":
      return node.role === "PEER";
    case "ALL":
      return true;
  }
}

function isStale(updatedAt: string): boolean {
  const ageSeconds = (Date.now() - new Date(updatedAt).getTime()) / 1000;
  return ageSeconds > RADAR_STALE_LOCATION_SECONDS;
}

/**
 * Master spec §17's full pipeline, minus the two steps ("AUTHENTICATION"
 * and "ACTIVE MEMBERSHIP") that requireActiveActor above already covers:
 *
 *   AUTHORIZED VISIBILITY SCOPE  → authorizationService.getVisibilityScope
 *   DISCOVERABILITY              → HierarchyNode.status === "ACTIVE" filter
 *                                   (a removed user is never discoverable,
 *                                   regardless of hierarchy position —
 *                                   master spec §20)
 *   ROLE FILTER                  → matchesFilter, above
 *   CURRENT PRESENCE             → presenceService.getSnapshotForActor
 *   LOCATION / DISTANCE+BEARING  → locationService.getDistanceAndBearing
 *   RADAR RENDERING              → left entirely to the frontend (master
 *                                   spec §38: calculations independent of
 *                                   rendering) — this function returns
 *                                   data, never pixels.
 *
 * Deliberately does NOT drop offline users or users with no location
 * reading from the result — master spec §39 lists "connection state"
 * and a "stale-location indicator" as things the radar UI itself shows,
 * which only makes sense if those users are still present in the
 * response for the frontend to render (greyed out, off to the side,
 * whatever the UI decides), not silently filtered out of it here.
 *
 * Known, deliberate performance tradeoff, not an oversight: this calls
 * locationService.getDistanceAndBearing once per candidate rather than
 * reimplementing its authorization/read logic inline. Each of those
 * calls re-derives the actor's own visibility scope internally
 * (requireVisibleTarget's own getVisibilityScope call) even though this
 * function already has that scope in hand — i.e. for N visible users
 * this does roughly N+1 pairs of recursive-CTE ancestor/descendant
 * queries instead of 1. This was a deliberate choice to reuse
 * location.service.ts's already-verified, encapsulated logic (its
 * repository docblock says "location.service.ts is the only caller" —
 * reaching into location.repository.ts directly from here would break
 * that layering) rather than duplicate its authorization/availability
 * branching a second time. Master spec §35's own priority order
 * ("Correctness is more important than premature performance
 * optimization... unless profiling demonstrates a need") is the
 * explicit justification. If a real deployment's org sizes make this
 * measurably slow, the fix is a new batched
 * `locationService.getDistanceAndBearingBatch(actor, targetIds)` that
 * derives the visibility scope once — not something to build
 * speculatively now.
 */
export async function getVisibleUsers(
  actor: AuthenticatedUser,
  filter: RadarFilter
): Promise<RadarSnapshot> {
  const freshActor = await requireActiveActor(actor.id);

  const { ancestors, descendants } = await authorizationService.getVisibilityScope({
    id: freshActor.id,
  });

  const candidates: Array<{ node: HierarchyNode; relation: RadarRelation }> = [
    ...ancestors.map((node) => ({ node, relation: "ANCESTOR" as const })),
    ...descendants.map((node) => ({ node, relation: "DESCENDANT" as const })),
  ].filter((c) => c.node.status === "ACTIVE" && matchesFilter(c.node, filter));

  // Presence for the whole (unfiltered) visibility scope is fetched once
  // via the existing snapshot endpoint's own logic — cheaper than N
  // individual reads, and matching HANDOFF.md §6's "reuse the existing
  // pattern" guidance rather than reaching into presence.repository.ts
  // directly (that file's own docblock reserves it for
  // presence.service.ts alone, same layering location.repository.ts
  // asks for).
  const presenceSnapshot = await presenceService.getSnapshotForActor(actor);
  const presenceByUserId = new Map<string, { status: PresenceStatus; lastSeen: string | null }>(
    presenceSnapshot.users.map((u) => [u.userId, { status: u.status, lastSeen: u.lastSeen }])
  );

  const users: RadarVisibleUser[] = await Promise.all(
    candidates.map(async ({ node, relation }) => {
      const location = await locationService.getDistanceAndBearing(actor, node.id);
      const presence = presenceByUserId.get(node.id) ?? { status: "OFFLINE" as const, lastSeen: null };

      return {
        id: node.id,
        name: node.name,
        role: node.role,
        relation,
        presence,
        location,
        stale: location.available ? isStale(location.updatedAt) : false,
      };
    })
  );

  return {
    self: { id: freshActor.id, name: freshActor.name, role: freshActor.role },
    filter,
    users,
  };
}
