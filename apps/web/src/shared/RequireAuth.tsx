import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { refreshAccessToken } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [checked, setChecked] = useState(accessToken !== null);

  useEffect(() => {
    if (accessToken) {
      setChecked(true);
      return;
    }
    refreshAccessToken().finally(() => setChecked(true));
  }, [accessToken]);

  if (!checked) return null;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
