import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { GraduationCap } from "lucide-react";

import { refreshAccessToken } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";
import { useGuestSessionStore } from "@/features/guest/guest-session-store";
import { restoreGuestSession } from "@/features/guest/guest-api";
import { Button } from "./ui/button.js";
import { FullscreenLoader } from "./ui/fullscreen-loader.js";

type Access = "checking" | "allowed" | "denied";

/**
 * Э12.6 — доступ к комнате урока для двух периметров: персонал с аккаунтом
 * (access-токен, восстанавливается через `/auth/refresh`) и гость-ученик
 * (httpOnly-кука, восстанавливается через `/guest/session`). При
 * перезагрузке страницы урока пробуем оба пути.
 */
export function RequireRoomAccess({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const guestSession = useGuestSessionStore((s) => s.session);

  const hasGuest = guestSession?.lessonId === id;
  const [access, setAccess] = useState<Access>(
    accessToken || hasGuest ? "allowed" : "checking",
  );

  useEffect(() => {
    if (accessToken || hasGuest) {
      setAccess("allowed");
      return;
    }
    let cancelled = false;
    (async () => {
      if (await refreshAccessToken()) {
        if (!cancelled) setAccess("allowed");
        return;
      }
      const restored = await restoreGuestSession();
      if (cancelled) return;
      setAccess(restored && restored.lessonId === id ? "allowed" : "denied");
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, hasGuest, id]);

  if (access === "checking") return <FullscreenLoader label="Проверяем доступ…" />;

  if (access === "denied") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
        <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 text-center shadow-lg">
          <span className="mx-auto mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-7" aria-hidden />
          </span>
          <h1 className="text-[22px] font-heavy tracking-tight">Нет доступа к уроку</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ученикам — откройте ссылку на урок заново (сессия могла истечь).
            Сотрудникам — войдите в платформу.
          </p>
          <Button asChild variant="secondary" size="lg" className="mt-5 w-full">
            <Link to="/login">Вход для сотрудников</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
