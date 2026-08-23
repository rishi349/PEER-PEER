import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { AppError } from "../../common/errors";
import * as presenceService from "./presence.service";

function requireActor(req: Request) {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated");
  return req.user;
}

// GET /presence — a REST fallback/initial-load snapshot for clients that
// haven't opened a Socket.IO connection yet (or want a one-off read).
// The live/push path is the socket "presence:snapshot" (on connect) and
// "presence:update" (on transition) events — see presence.gateway.ts.
export const getSnapshot = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const snapshot = await presenceService.getSnapshotForActor(actor);
  res.status(200).json(snapshot);
});
