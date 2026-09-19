import { apiRequest } from "./client";
import type { HierarchyNode } from "../types";

export interface CreateMemberInput {
  name: string;
  email: string;
  password: string;
}

export function getSubtreeRequest(): Promise<{ root: HierarchyNode; members: HierarchyNode[] }> {
  return apiRequest("/hierarchy/subtree");
}

export function createLeaderRequest(input: CreateMemberInput): Promise<{ node: HierarchyNode }> {
  return apiRequest("/hierarchy/leaders", { method: "POST", body: input });
}

export function createPeerRequest(input: CreateMemberInput): Promise<{ node: HierarchyNode }> {
  return apiRequest("/hierarchy/peers", { method: "POST", body: input });
}

export function removeNodeRequest(id: string): Promise<{ removedId: string; cascadedCount: number }> {
  return apiRequest(`/hierarchy/nodes/${id}`, { method: "DELETE" });
}

export function reactivateNodeRequest(id: string): Promise<{ node: HierarchyNode }> {
  return apiRequest(`/hierarchy/nodes/${id}/reactivate`, { method: "POST" });
}
