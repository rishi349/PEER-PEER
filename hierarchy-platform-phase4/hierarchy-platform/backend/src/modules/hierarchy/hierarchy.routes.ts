import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import * as hierarchyController from "./hierarchy.controller";

export const hierarchyRouter = Router();

hierarchyRouter.use(requireAuth);

hierarchyRouter.post("/leaders", hierarchyController.createLeader);
hierarchyRouter.post("/peers", hierarchyController.createPeer);
hierarchyRouter.get("/subtree", hierarchyController.getSubtree);
hierarchyRouter.get("/ancestors", hierarchyController.getAncestors);
hierarchyRouter.get("/", hierarchyController.getVisibilityScope);
hierarchyRouter.delete("/nodes/:id", hierarchyController.removeNode);
hierarchyRouter.post("/nodes/:id/reactivate", hierarchyController.reactivateNode);
