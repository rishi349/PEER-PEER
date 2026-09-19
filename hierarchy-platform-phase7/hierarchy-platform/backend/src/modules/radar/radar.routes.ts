import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import * as radarController from "./radar.controller";

export const radarRouter = Router();

radarRouter.use(requireAuth);

radarRouter.get("/visible-users", radarController.getVisibleUsers);
