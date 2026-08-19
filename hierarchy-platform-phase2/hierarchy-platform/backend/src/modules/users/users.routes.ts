import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import * as usersController from "./users.controller";

export const usersRouter = Router();

usersRouter.get("/me", requireAuth, usersController.getMe);
