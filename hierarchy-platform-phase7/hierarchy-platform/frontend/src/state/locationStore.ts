import { create } from "zustand";
import * as locationApi from "../api/location";
import type { LocationCoordinatesInput } from "../api/location";

interface LocationState {
  /** The confirmed server-side preference — not a local optimistic
   *  guess. Starts false (matches the backend's own default) so nothing
   *  ever calls navigator.geolocation before the real value loads. */
  sharingEnabled: boolean;
  isLoadingPreference: boolean;
  isSendingUpdate: boolean;
  lastUpdatedAt: string | null;
  error: string | null;

  fetchSharingPreference: () => Promise<void>;
  toggleSharing: (enabled: boolean) => Promise<boolean>;
  sendLocationUpdate: (coords: LocationCoordinatesInput) => Promise<void>;
  setGeolocationError: (message: string) => void;
  clearError: () => void;
}

// Same posture as hierarchyStore.ts: this store owns the API calls and
// server-confirmed state; useLocationSharing (the browser geolocation
// hook) only owns timing/permission concerns and calls sendLocationUpdate
// with whatever navigator.geolocation hands it. Nothing here ever
// invents or infers coordinates — this is purely a thin client over the
// backend's own opt-in gate and preference store (PHASE6_PLAN.md §2a).
export const useLocationStore = create<LocationState>((set) => ({
  sharingEnabled: false,
  isLoadingPreference: false,
  isSendingUpdate: false,
  lastUpdatedAt: null,
  error: null,

  fetchSharingPreference: async () => {
    set({ isLoadingPreference: true, error: null });
    try {
      const { enabled } = await locationApi.getSharingRequest();
      set({ sharingEnabled: enabled, isLoadingPreference: false });
    } catch (err) {
      set({ isLoadingPreference: false, error: errorMessage(err) });
    }
  },

  toggleSharing: async (enabled) => {
    set({ isLoadingPreference: true, error: null });
    try {
      const result = await locationApi.setSharingRequest(enabled);
      set({
        sharingEnabled: result.enabled,
        isLoadingPreference: false,
        // Clear the "last sent" readout immediately on turning sharing
        // off — the backend also proactively deletes the stored Redis
        // reading on the same call (location.service.ts's
        // setSharingEnabled), so this mirrors what the server just did.
        ...(result.enabled ? {} : { lastUpdatedAt: null }),
      });
      return true;
    } catch (err) {
      set({ isLoadingPreference: false, error: errorMessage(err) });
      return false;
    }
  },

  sendLocationUpdate: async (coords) => {
    // Only ever invoked by useLocationSharing while sharingEnabled is
    // true (the hook is gated on the same flag) — the backend
    // independently re-checks locationSharingEnabled too, so this is
    // not the only thing standing between a stray call and a rejected
    // update (master spec §15: never trust the client alone).
    set({ isSendingUpdate: true });
    try {
      const { updatedAt } = await locationApi.updateLocationRequest(coords);
      set({ isSendingUpdate: false, lastUpdatedAt: updatedAt, error: null });
    } catch (err) {
      set({ isSendingUpdate: false, error: errorMessage(err) });
    }
  },

  setGeolocationError: (message) => set({ error: message }),

  clearError: () => set({ error: null }),
}));

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
