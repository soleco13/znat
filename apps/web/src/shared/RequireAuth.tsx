import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { refreshAccessToken, setGuestMode } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";
import { FullscreenLoader } from "./ui/fullscreen-loader.js";

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [checked, setChecked] = useState(accessToken !== null);

  useEffect(() => {
    // Периметр сотрудника — гостевой режим api-клиента тут точно не нужен
    // (мог остаться взведённым, если из урока-по-ссылке ушли не через
    // «Выйти», а прямым переходом по URL).
    setGuestMode(false);
    if (accessToken) {
      setChecked(true);
      return;
    }
    refreshAccessToken().finally(() => setChecked(true));
  }, [accessToken]);

  if (!checked) return <FullscreenLoader label="Проверяем вход…" />;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
