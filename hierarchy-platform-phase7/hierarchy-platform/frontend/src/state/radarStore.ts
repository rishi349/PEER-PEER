import { create } from "zustand";
import * as radarApi from "../api/radar";
import type { RadarFilter, RadarSnapshot } from "../api/radar";

interface RadarState {
  filter: RadarFilter;
  /** Meters represented by the outermost ring — purely a client-side
   *  display setting (master spec §39's "range" control). The backend
   *  is never told about this: it already returns every authorized,
   *  role-filtered, ACTIVE user in scope regardless of distance
   *  (radar.service.ts never filters by distance itself) — range only
   *  changes how those same results are laid out/clipped on screen. */
  rangeMeters: number;
  snapshot: RadarSnapshot | null;
  selectedUserId: string | null;
  isLoading: boolean;
  error: string | null;

  setFilter: (filter: RadarFilter) => void;
  setRange: (rangeMeters: number) => void;
  selectUser: (userId: string | null) => void;
  fetchSnapshot: () => Promise<void>;
}

// PHASE6_PLAN.md §4 open question 2 ("does Radar need a push layer on
// top of location's pull-only endpoint, or is polling while the radar
// screen is open good enough") is resolved here in favor of polling —
// see RadarContainer.tsx, which owns the actual setInterval and calls
// fetchSnapshot on the same cadence every time the screen is open. No
// location.gateway.ts / Socket.IO surface was added to support this;
// HANDOFF.md §6 flagged this as the likely trigger for one, but a
// simple poll is the smaller, sufficient increment for this phase — see
// this repo's HANDOFF for the reasoning and the door left open for a
// push-based version later.
export const useRadarStore = create<RadarState>((set, get) => ({
  filter: "ALL",
  rangeMeters: 500,
  snapshot: null,
  selectedUserId: null,
  isLoading: false,
  error: null,

  setFilter: (filter) => {
    set({ filter, selectedUserId: null });
    void get().fetchSnapshot();
  },

  setRange: (rangeMeters) => set({ rangeMeters }),

  selectUser: (userId) => set({ selectedUserId: userId }),

  fetchSnapshot: async () => {
    const { filter } = get();
    set({ isLoading: true, error: null });
    try {
      const snapshot = await radarApi.getVisibleUsersRequest(filter);
      set({ snapshot, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: errorMessage(err) });
    }
  },
}));

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
