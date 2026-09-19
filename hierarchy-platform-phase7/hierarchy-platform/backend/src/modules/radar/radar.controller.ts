import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { AppError } from "../../common/errors";
import { radarQuerySchema } from "./radar.schemas";
import * as radarService from "./radar.service";

function requireActor(req: Request) {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated");
  return req.user;
}

// Master spec §43 lists `GET /radar/visible-users` verbatim — unlike
// location (Phase 6) and P2P (Phase 5), there was no reason to depart
// from the literal spec here: this is a single, cacheable-by-nothing,
// pull-style read with a simple query-param filter, which is exactly
// what a plain REST GET is for.
export const getVisibleUsers = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const { filter } = radarQuerySchema.parse(req.query);
  const snapshot = await radarService.getVisibleUsers(actor, filter);
  res.status(200).json(snapshot);
});
