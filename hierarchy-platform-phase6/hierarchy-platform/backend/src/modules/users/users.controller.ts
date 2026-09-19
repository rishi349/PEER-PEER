import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { AppError } from "../../common/errors";
import * as usersService from "./users.service";

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated");
  }
  const user = await usersService.getCurrentUser(req.user.id);
  res.status(200).json({ user });
});
