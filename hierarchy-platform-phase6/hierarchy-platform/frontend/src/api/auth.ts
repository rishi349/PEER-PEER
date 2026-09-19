import { apiRequest } from "./client";
import type { PublicUser } from "../types";

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

export function registerRequest(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/register", { method: "POST", body: input });
}

export function loginRequest(input: { email: string; password: string }): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/login", { method: "POST", body: input });
}

export function refreshRequest(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/refresh", { method: "POST" });
}

export function logoutRequest(): Promise<void> {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}

export function getMeRequest(): Promise<{ user: PublicUser }> {
  return apiRequest<{ user: PublicUser }>("/users/me");
}
