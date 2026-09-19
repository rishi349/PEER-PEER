import type { User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../common/errors";
import type { AuthenticatedUser } from "../../types/express";
import * as authorizationService from "../authorization/authorization.service";
import { haversineDistanceMeters, initialBearingDegrees } from "./location.geo";
import * as locationRepo from "./location.repository";
import type { Coordinates, DistanceBearingResult } from "./location.types";

/**
 * Same re-fetch-from-Postgres-rather-than-trust-the-token pattern every
 * other service in this codebase uses (master spec §15), duplicated
 * locally rather than imported — matches the established convention
 * (see presence.service.ts's/p2p.service.ts's own copies of this exact
 * comment). `locationSharingEnabled` lives on this same row, so the
 * fresh read here is also what makes the opt-in check in updateLocation
 * below trustworthy — a stale/cached actor could never be used to bypass
 * it.
 */
async function requireActiveActor(userId: string): Promise<User> {
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
 * Domain-precondition + authorization gate for reading someone else's
 * location. Unlike p2p.service.ts's requireEligibleCounterpart (which
 * checks INITIATE_P2P_SESSION, a dedicated Action), this reuses
 * authorizationService.getVisibilityScope directly — the same "own
 * ancestors + own descendants" relation presence.service.ts's
 * getAudience already relies on (master spec §16) — rather than adding a
 * new Action to authorization.types.ts. HANDOFF.md §7 item 6 explicitly
 * asks for this module to reuse the visibility-scope *pattern*, and a
 * read-only "am I allowed to see this person" question doesn't need its
 * own named policy decision the way a two-party P2P negotiation does.
 */
async function requireVisibleTarget(freshActor: User, targetId: string): Promise<User> {
  if (targetId === freshActor.id) {
    throw new AppError("FORBIDDEN", "You cannot query your own distance/bearing");
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.organizationId !== freshActor.organizationId) {
    throw new AppError("NODE_NOT_FOUND", "User not found");
  }
  if (target.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "This user is not currently active");
  }

  const { ancestors, descendants } = await authorizationService.getVisibilityScope({ id: freshActor.id });
  const visible = [...ancestors, ...descendants].some((u) => u.id === target.id);
  if (!visible) {
    throw new AppError("FORBIDDEN", "You are not authorized to view this user's location");
  }

  return target;
}

/**
 * Master spec §20's opt-in privacy control (PHASE6_PLAN.md §2a): a user
 * must explicitly enable sharing before any coordinates leave their
 * device. This function is the actual enforcement point, not just the
 * frontend's capture loop being gated — a removed-sharing user whose
 * client somehow still sends an update (bug, tampering, stale client
 * state) gets rejected here regardless of what the frontend did or
 * didn't do (master spec §15's "never trust the client," applied here
 * the same way handleConnect re-checks ACTIVE status rather than trusting
 * a still-valid token).
 */
export async function updateLocation(
  actor: AuthenticatedUser,
  coords: Coordinates
): Promise<{ updatedAt: string }> {
  const freshActor = await requireActiveActor(actor.id);

  if (!freshActor.locationSharingEnabled) {
    throw new AppError(
      "LOCATION_SHARING_DISABLED",
      "Enable location sharing before sending location updates"
    );
  }

  const record = await locationRepo.writeLocation(freshActor.id, coords);
  return { updatedAt: record.updatedAt };
}

/**
 * Toggles the durable preference (Postgres — this is the one Phase 6
 * write that isn't Redis-ephemeral, since it's a setting, not a reading;
 * PHASE6_PLAN.md §2a). Turning sharing off also proactively deletes any
 * Redis reading that still exists (location.repository.ts's
 * deleteLocation) — defense in depth on top of getDistanceAndBearing's
 * own re-check below, not the only thing preventing a stale read.
 */
export async function setSharingEnabled(
  actor: AuthenticatedUser,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  const freshActor = await requireActiveActor(actor.id);

  await prisma.user.update({
    where: { id: freshActor.id },
    data: { locationSharingEnabled: enabled },
  });

  if (!enabled) {
    await locationRepo.deleteLocation(freshActor.id);
  }

  return { enabled };
}

export async function getSharingEnabled(actor: AuthenticatedUser): Promise<{ enabled: boolean }> {
  const freshActor = await requireActiveActor(actor.id);
  return { enabled: freshActor.locationSharingEnabled };
}

/**
 * Master spec §17/§19's "server computes distance+bearing, never hands
 * out raw coordinates" rule, made real. Requires the requester (`actor`)
 * to be authorized to see `targetUserId` at all (requireVisibleTarget
 * above) — physical proximity plays no part in that decision, only
 * hierarchy position (master spec §19: "physical proximity never grants
 * visibility"). Once authorization passes, this reads exact coordinates
 * for both users purely as a server-side computation input; neither
 * party's raw lat/lon is ever included in the returned value.
 *
 * Two distinct "no data" outcomes are modeled as data, not thrown
 * (PHASE6_PLAN.md §2b) — see DistanceBearingResult's own docblock for
 * why REQUESTER_LOCATION_UNAVAILABLE and TARGET_LOCATION_UNAVAILABLE are
 * kept separate. TARGET_LOCATION_UNAVAILABLE additionally covers "target
 * has location sharing turned off" — deliberately not distinguished from
 * "sharing is on but no recent reading exists," per that same docblock.
 */
export async function getDistanceAndBearing(
  actor: AuthenticatedUser,
  targetUserId: string
): Promise<DistanceBearingResult> {
  const freshActor = await requireActiveActor(actor.id);
  const target = await requireVisibleTarget(freshActor, targetUserId);

  if (!target.locationSharingEnabled) {
    return { available: false, reason: "TARGET_LOCATION_UNAVAILABLE" };
  }

  const targetLocation = await locationRepo.readLocation(target.id);
  if (!targetLocation) {
    return { available: false, reason: "TARGET_LOCATION_UNAVAILABLE" };
  }

  const requesterLocation = await locationRepo.readLocation(freshActor.id);
  if (!requesterLocation) {
    return { available: false, reason: "REQUESTER_LOCATION_UNAVAILABLE" };
  }

  return {
    available: true,
    distanceMeters: haversineDistanceMeters(requesterLocation, targetLocation),
    bearingDegrees: initialBearingDegrees(requesterLocation, targetLocation),
    updatedAt: targetLocation.updatedAt,
  };
}
