import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import * as presenceController from "./presence.controller";

export const presenceRouter = Router();

presenceRouter.use(requireAuth);

presenceRouter.get("/", presenceController.getSnapshot);
