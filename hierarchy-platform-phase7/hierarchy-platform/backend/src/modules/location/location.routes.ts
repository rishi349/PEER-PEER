import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import * as locationController from "./location.controller";

export const locationRouter = Router();

locationRouter.use(requireAuth);

locationRouter.post("/", locationController.updateLocation);
locationRouter.get("/sharing", locationController.getSharing);
locationRouter.patch("/sharing", locationController.setSharing);
locationRouter.get("/distance/:targetUserId", locationController.getDistanceAndBearing);
