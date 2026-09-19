import { create } from "zustand";
import * as hierarchyApi from "../api/hierarchy";
import type { CreateMemberInput } from "../api/hierarchy";
import type { HierarchyNode } from "../types";

interface HierarchyState {
  root: HierarchyNode | null;
  members: HierarchyNode[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;

  fetchSubtree: () => Promise<void>;
  addMember: (role: "LEADER" | "PEER", input: CreateMemberInput) => Promise<boolean>;
  removeMember: (id: string) => Promise<boolean>;
  reactivateMember: (id: string) => Promise<boolean>;
  clearError: () => void;
}

// Mutations always refetch the subtree from the server afterwards rather
// than patching client state by hand — hierarchy correctness (cascading
// removal, restoration ordering) is server-authoritative (master spec
// §15/§41), and org sizes at this stage make a refetch cheap. Do not
// start reconstructing cascade effects client-side.
export const useHierarchyStore = create<HierarchyState>((set, get) => ({
  root: null,
  members: [],
  isLoading: false,
  isMutating: false,
  error: null,

  fetchSubtree: async () => {
    set({ isLoading: true, error: null });
    try {
      const { root, members } = await hierarchyApi.getSubtreeRequest();
      set({ root, members, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: errorMessage(err) });
    }
  },

  addMember: async (role, input) => {
    set({ isMutating: true, error: null });
    try {
      if (role === "LEADER") {
        await hierarchyApi.createLeaderRequest(input);
      } else {
        await hierarchyApi.createPeerRequest(input);
      }
      await get().fetchSubtree();
      set({ isMutating: false });
      return true;
    } catch (err) {
      set({ isMutating: false, error: errorMessage(err) });
      return false;
    }
  },

  removeMember: async (id) => {
    set({ isMutating: true, error: null });
    try {
      await hierarchyApi.removeNodeRequest(id);
      await get().fetchSubtree();
      set({ isMutating: false });
      return true;
    } catch (err) {
      set({ isMutating: false, error: errorMessage(err) });
      return false;
    }
  },

  reactivateMember: async (id) => {
    set({ isMutating: true, error: null });
    try {
      await hierarchyApi.reactivateNodeRequest(id);
      await get().fetchSubtree();
      set({ isMutating: false });
      return true;
    } catch (err) {
      set({ isMutating: false, error: errorMessage(err) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
