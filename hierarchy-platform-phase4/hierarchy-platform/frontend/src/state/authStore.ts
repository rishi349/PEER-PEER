import { create } from "zustand";
import * as authApi from "../api/auth";
import { setAccessToken } from "../api/client";
import type { PublicUser } from "../types";

interface AuthState {
  user: PublicUser | null;
  /** True while the very first silent-refresh-on-load attempt is in flight. */
  isBootstrapping: boolean;
  isSubmitting: boolean;
  error: string | null;

  bootstrap: () => Promise<void>;
  register: (input: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<boolean>;
  login: (input: { email: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isBootstrapping: true,
  isSubmitting: false,
  error: null,

  // Runs once on app load: try to trade the httpOnly refresh cookie for a
  // fresh access token, so a hard refresh doesn't force a re-login.
  bootstrap: async () => {
    try {
      const { user, accessToken } = await authApi.refreshRequest();
      setAccessToken(accessToken);
      set({ user, isBootstrapping: false });
    } catch {
      setAccessToken(null);
      set({ user: null, isBootstrapping: false });
    }
  },

  register: async (input) => {
    set({ isSubmitting: true, error: null });
    try {
      const { user, accessToken } = await authApi.registerRequest(input);
      setAccessToken(accessToken);
      set({ user, isSubmitting: false });
      return true;
    } catch (err) {
      set({ isSubmitting: false, error: errorMessage(err) });
      return false;
    }
  },

  login: async (input) => {
    set({ isSubmitting: true, error: null });
    try {
      const { user, accessToken } = await authApi.loginRequest(input);
      setAccessToken(accessToken);
      set({ user, isSubmitting: false });
      return true;
    } catch (err) {
      set({ isSubmitting: false, error: errorMessage(err) });
      return false;
    }
  },

  logout: async () => {
    try {
      await authApi.logoutRequest();
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
