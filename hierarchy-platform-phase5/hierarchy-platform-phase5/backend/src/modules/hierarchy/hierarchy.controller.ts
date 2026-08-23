import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { AppError } from "../../common/errors";
import { createMemberSchema } from "./hierarchy.schemas";
import * as hierarchyService from "./hierarchy.service";

function requireActor(req: Request) {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated");
  return req.user;
}

export const createLeader = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const input = createMemberSchema.parse(req.body);
  const node = await hierarchyService.createMember(actor, "LEADER", input);
  res.status(201).json({ node });
});

export const createPeer = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const input = createMemberSchema.parse(req.body);
  const node = await hierarchyService.createMember(actor, "PEER", input);
  res.status(201).json({ node });
});

export const getSubtree = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const subtree = await hierarchyService.getMySubtree(actor);
  res.status(200).json(subtree);
});

export const getAncestors = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const ancestors = await hierarchyService.getMyAncestors(actor);
  res.status(200).json({ ancestors });
});

// Phase 3: this used to be a ROOT_LEADER-only full-org dump
// (getOrganizationTree). It's now the general visibility-scope endpoint
// (master spec §16) — available to any authenticated user, scoped to
// their own ancestors + subtree. See hierarchy.service.ts's
// getVisibilityScope for the reasoning.
export const getVisibilityScope = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const scope = await hierarchyService.getVisibilityScope(actor);
  res.status(200).json(scope);
});

export const removeNode = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const result = await hierarchyService.removeNode(actor, req.params.id as string);
  res.status(200).json(result);
});

export const reactivateNode = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const node = await hierarchyService.reactivateNode(actor, req.params.id as string);
  res.status(200).json({ node });
});
