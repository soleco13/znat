import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { refreshAccessTokenDetailed, setGuestMode } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";
import { FullscreenLoader } from "./ui/fullscreen-loader.js";

const RETRY_MS = 3000;

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [checked, setChecked] = useState(accessToken !== null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    // Периметр сотрудника — гостевой режим api-клиента тут точно не нужен
    // (мог остаться взведённым, если из урока-по-ссылке ушли не через
    // «Выйти», а прямым переходом по URL).
    setGuestMode(false);
    if (accessToken) {
      setChecked(true);
      return;
    }
    // Сервер недоступен (деплой, обрыв сети) — это не «вход не выполнен»:
    // ждём и пробуем снова, а не отправляем на страницу логина.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      void refreshAccessTokenDetailed().then((outcome) => {
        if (cancelled) return;
        if (outcome === "unavailable") {
          setUnavailable(true);
          timer = setTimeout(attempt, RETRY_MS);
          return;
        }
        setChecked(true);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken]);

  if (!checked)
    return <FullscreenLoader label={unavailable ? "Сервер недоступен, переподключаемся…" : "Проверяем вход…"} />;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
