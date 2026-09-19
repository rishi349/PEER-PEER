import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { AppError } from "../../common/errors";
import { setSharingSchema, updateLocationSchema } from "./location.schemas";
import * as locationService from "./location.service";

function requireActor(req: Request) {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated");
  return req.user;
}

// PHASE6_PLAN.md §4 open question 1, resolved: REST for the update
// itself (a ~20s interval isn't latency-sensitive the way P2P signaling
// is), pull-only for reading someone else's distance/bearing (no push
// layer built this phase — see getDistanceAndBearing below and
// PHASE6_PLAN.md §4 open question 2). This is a deliberate departure
// from master spec §43's literal `POST /presence/location` listing —
// folding location into the presence router/module was explicitly
// rejected (HANDOFF.md §7 item 6), and §43's own closing line says not
// to blindly implement every listed endpoint if the architecture
// suggests something better.

export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const input = updateLocationSchema.parse(req.body);
  const result = await locationService.updateLocation(actor, input);
  res.status(200).json(result);
});

export const getSharing = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const result = await locationService.getSharingEnabled(actor);
  res.status(200).json(result);
});

export const setSharing = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const input = setSharingSchema.parse(req.body);
  const result = await locationService.setSharingEnabled(actor, input.enabled);
  res.status(200).json(result);
});

export const getDistanceAndBearing = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const targetUserId = req.params.targetUserId as string;
  const result = await locationService.getDistanceAndBearing(actor, targetUserId);
  res.status(200).json(result);
});
