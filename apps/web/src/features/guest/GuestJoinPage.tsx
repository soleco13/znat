import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Link2Off, WifiOff } from "lucide-react";

import { ApiError, apiFetch, hasStaffSession, setGuestMode } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { PersonalDataConsent } from "@/shared/PersonalDataConsent";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { StatusScreen } from "@/shared/ui/status-screen";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { prefetchLessonStage } from "@/features/room/lazy-stage";
import { warmChunk } from "@/shared/chunk-warmup";
import { enterGuestLesson, fetchGuestLessonInfo } from "./guest-api.js";
import { useGuestSessionStore } from "./guest-session-store.js";

// Только докачка, без `import()`: оборванный `import()` браузер запоминает,
// и страница урока потом не открылась бы до перезагрузки.
const prefetchRoom = () => warmChunk("src/features/room/RoomPage.tsx");

const NAME_MAX = 80;

/** Ссылка точно не годится — сервер урок по ней не нашёл. Всё остальное (сеть, 502 на деплое, 429) — временный сбой. */
const isDeadLink = (err: unknown) => err instanceof ApiError && err.status === 404;

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

/** Карточка урока с тихими повторами: на сбое связи или перезапуске сервера ученик не должен видеть «ссылка недействительна». */
async function fetchLessonInfoWithRetry(token: string, deadLink: { current: boolean }) {
  deadLink.current = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchGuestLessonInfo(token);
    } catch (err) {
      if (isDeadLink(err)) {
        deadLink.current = true;
        throw err;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw err;
      console.warn("guest join: lesson info failed, retrying", err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Учитель или админ этого урока, уже вошедший в браузере, — id урока; иначе
 * `null` и обычный гостевой вход. Ошибки (сеть, чужой урок) тоже ведут к
 * гостевой форме: она работает и без аккаунта.
 */
async function resolveStaffLesson(token: string): Promise<string | null> {
  if (!(await hasStaffSession())) return null;
  const role = useAuthStore.getState().user?.role;
  if (role !== "admin" && role !== "teacher") return null;
  try {
    setGuestMode(false);
    const res = await apiFetch<{ lessonId: string }>(`/j/${encodeURIComponent(token)}/staff`);
    return res.lessonId;
  } catch {
    return null;
  }
}

/**
 * Э12.6 — экран входа ученика по прямой ссылке (`/j/:token`). Вне `AppShell`
 * и `RequireAuth`: у ученика аккаунта нет (§0 план-ТЗ). Поток: карточка
 * урока → «Представьтесь» произвольным именем → комната (экран проверки
 * устройств живёт внутри `RoomPage`).
 */
export function GuestJoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const deadLink = useRef(false);
  const info = useAsync(() => fetchLessonInfoWithRetry(token, deadLink), [token]);
  const [checkingStaff, setCheckingStaff] = useState(true);

  // Учитель открыл ссылку своего урока вне приложения — входит учителем, а не учеником.
  useEffect(() => {
    let cancelled = false;
    void resolveStaffLesson(token).then((lessonId) => {
      if (cancelled) return;
      if (lessonId) {
        useGuestSessionStore.getState().clearSession();
        navigate(`/lessons/${lessonId}/room`, { replace: true });
      } else {
        setCheckingStaff(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  // Пока ученик вводит имя, в фоне качаем урок, а за ним — доску и задания.
  // Именно по очереди: параллельно доска (~725 КБ) делила бы медленный канал
  // с уроком (~350 КБ), и урок открывался бы позже.
  useEffect(() => {
    void prefetchRoom().finally(() => prefetchLessonStage());
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
    <StatusScreen>
        {info.loading || checkingStaff ? (
          <CenteredSpinner label="Загружаем урок…" />
        ) : info.error && !deadLink.current ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WifiOff aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Не удалось открыть урок</EmptyTitle>
              <EmptyDescription>Проверьте интернет и попробуйте ещё раз.</EmptyDescription>
            </EmptyHeader>
            <Button size="lg" className="mt-4 w-full" onClick={info.reload}>
              Повторить
            </Button>
          </Empty>
        ) : info.error ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Link2Off aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Ссылка недействительна</EmptyTitle>
              <EmptyDescription>
                Ссылка на урок устарела или введена с ошибкой. Попросите учителя прислать её заново.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : info.data ? (
          <>
            <div className="mb-7">
              <p className="text-sm text-muted-foreground">Вход в урок</p>
              <h1 className="mt-1 text-2xl font-heavy tracking-tight">{info.data.lessonTitle}</h1>
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
    </StatusScreen>
  );
}
