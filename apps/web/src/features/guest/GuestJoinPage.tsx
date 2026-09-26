import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GraduationCap, Link2Off } from "lucide-react";

import { ApiError } from "@/shared/api-client";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { prefetchLessonStage } from "@/features/room/lazy-stage";
import { withRetry } from "@/shared/lazy-retry";
import { enterGuestLesson, fetchGuestLessonInfo } from "./guest-api.js";

const prefetchRoom = withRetry(() => import("@/features/room/RoomPage"));

const NAME_MAX = 80;

/**
 * Э12.6 — экран входа ученика по прямой ссылке (`/j/:token`). Вне `AppShell`
 * и `RequireAuth`: у ученика аккаунта нет (§0 план-ТЗ). Поток: карточка
 * урока → «Представьтесь» произвольным именем → комната (экран проверки
 * устройств живёт внутри `RoomPage`).
 */
export function GuestJoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const info = useAsync(() => fetchGuestLessonInfo(token), [token]);

  // Пока ученик вводит имя, в фоне качаем сам урок и доску: на медленной
  // сети к нажатию «Войти» они уже будут, и урок откроется сразу.
  useEffect(() => {
    prefetchRoom().catch(() => undefined);
    prefetchLessonStage();
  }, []);

  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !info.data) return;
    setError(null);
    setSubmitting(true);
    try {
      const session = await enterGuestLesson(token, trimmed, info.data.lessonTitle);
      navigate(`/lessons/${session.lessonId}/room`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти в урок");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 shadow-lg">
        {info.loading ? (
          <CenteredSpinner label="Загружаем урок…" />
        ) : info.error ? (
          <div className="flex flex-col items-center text-center">
            <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="text-[22px] font-heavy tracking-tight">Ссылка недействительна</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ссылка на урок устарела или введена с ошибкой. Попросите учителя прислать её заново.
            </p>
          </div>
        ) : info.data ? (
          <>
            <div className="mb-8 flex flex-col items-center text-center">
              <span className="mb-3.5 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCap className="size-7" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">Вход в урок</p>
              <h1 className="mt-1 text-[22px] font-heavy tracking-tight">
                {info.data.lessonTitle}
              </h1>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="guest-name">Как вас представить на уроке?</Label>
                <Input
                  id="guest-name"
                  autoComplete="name"
                  placeholder="Имя и фамилия"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={NAME_MAX}
                  aria-invalid={error != null}
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Учитель увидит это имя в списке участников и в заданиях.
                </p>
              </div>

              <PersonalDataConsent checked={consent} onChange={setConsent} />

              {error ? (
                <p className="text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="mt-1 w-full"
                loading={submitting}
                disabled={!name.trim() || !consent}
              >
                {submitting ? "Входим…" : "Продолжить"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              Дальше — быстрая проверка камеры и микрофона.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
