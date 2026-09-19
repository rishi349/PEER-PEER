import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../state/authStore";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  if (isBootstrapping) return null; // brief flash-free wait while /auth/refresh resolves
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
