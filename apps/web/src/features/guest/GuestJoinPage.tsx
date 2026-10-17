import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { DoorClosed, Link2Off, WifiOff } from "lucide-react";
import { lessonJoinCodeSchema } from "@school/shared";

import { ApiError, apiFetch, hasStaffSession, setGuestMode } from "@/shared/api-client";
import { useAuthStore } from "@/shared/auth-store";
import { useAsync } from "@/shared/hooks/use-async";
import { Button } from "@/shared/ui/button";
import { CenteredSpinner } from "@/shared/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { StatusScreen } from "@/shared/ui/status-screen";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { warmChunk } from "@/shared/chunk-warmup";
import { isReloadOf, shouldRejoinViaLink, writeJoinDefaults, readJoinDefaults, writeRejoinState } from "@/features/room/rejoin-state";
import { DeviceCheckScreen, type DeviceCheckResult } from "@/features/room/DeviceCheckScreen";
import { enterGuestLesson, fetchGuestLessonInfo, fetchKnockStatus, knockGuestLesson, restoreGuestSession } from "./guest-api.js";
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
 * Короткая ссылка урока `/<код>` (2026-10-11). Маршрут `/:token` в корне
 * ловит любой одиночный сегмент, которого нет среди статических маршрутов
 * (их React Router ставит выше динамических), поэтому экран входа — только
 * для строки в формате кода; прочие адреса, как и раньше, ничего не рисуют.
 */
export function ShortJoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  return lessonJoinCodeSchema.safeParse(token).success ? <GuestJoinPage /> : null;
}

/**
 * Э12.6 — экран входа ученика по прямой ссылке (`/<код>` или `/j/:token`). Вне `AppShell`
 * и `RequireAuth`: у ученика аккаунта нет (§0 план-ТЗ). Поток: карточка
 * урока → «Представьтесь» произвольным именем → комната (экран проверки
 * устройств живёт внутри `RoomPage`).
 */
export function GuestJoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  // Ссылка, по которой вошли (`/<код>` или `/j/<token>`): комната покажет её
  // в адресной строке вместо `/lessons/<uuid>/room`.
  const { pathname: linkPath } = useLocation();
  const navigate = useNavigate();
  const deadLink = useRef(false);
  const info = useAsync(() => fetchLessonInfoWithRetry(token, deadLink), [token]);
  const [checkingStaff, setCheckingStaff] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // F5 на уроке: в адресной строке комната держит эту ссылку (RoomPage).
      // Гость этого урока уже вошёл (кука) — сразу обратно в комнату, без
      // повторного ввода имени. Гость — раньше staff, как в RequireRoomAccess.
      if (isReloadOf(linkPath)) {
        const restored = await restoreGuestSession();
        if (cancelled) return;
        if (restored && restored !== "unavailable") {
          if (shouldRejoinViaLink(restored.lessonId, linkPath)) {
            navigate(`/lessons/${restored.lessonId}/room`, { replace: true, state: { joinPath: linkPath } });
            return;
          }
          // Сессия другого урока — к этой ссылке не относится.
          useGuestSessionStore.getState().clearSession();
          setGuestMode(false);
        }
      }
      // Учитель открыл ссылку своего урока вне приложения — входит учителем, а не учеником.
      const lessonId = await resolveStaffLesson(token);
      if (cancelled) return;
      if (lessonId) {
        useGuestSessionStore.getState().clearSession();
        navigate(`/lessons/${lessonId}/room`, { replace: true, state: { joinPath: linkPath } });
      } else {
        setCheckingStaff(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, linkPath, navigate]);

  // Пока ученик вводит имя, в фоне качаем только сам урок (страница урока,
  // LiveKit). Доску и задания — уже в уроке, после подключения звука и видео
  // (`RoomPage`): на медленной сети их ~575 КБ делили канал со входом и
  // стартом медиа — на 3G вход по «Войти» шёл 4–6 с вместо ~2 с (замер
  // 2026-10-05). Если доска или задание уже на экране, их кусок грузится сразу.
  useEffect(() => {
    void prefetchRoom();
  }, []);

  const [name, setName] = useState("");
  // Имя с прошлого входа (любой урок, этот браузер) — в поле, его можно поменять.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !info.data) return;
    prefilled.current = true;
    if (info.data.rememberedName) setName((cur) => cur || info.data!.rememberedName!);
  }, [info.data]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Комната ожидания: вход закрыт — ждём, пока учитель впустит. */
  const [waiting, setWaiting] = useState<"pending" | "denied" | null>(null);
  const knockRef = useRef<{ id: string; name: string } | null>(null);

  /** Шаг входа: имя → проверка устройств → (вход закрыт? ждём учителя) → урок. */
  const [step, setStep] = useState<"name" | "devices">("name");
  const checkedRef = useRef<DeviceCheckResult | null>(null);
  const [joinDefaults] = useState(readJoinDefaults);

  /** В комнату — сразу в урок: проверка устройств уже пройдена. */
  function goToRoom(lessonId: string, result: DeviceCheckResult) {
    writeRejoinState(lessonId, {
      mic: result.micEnabled,
      cam: result.camEnabled,
      micId: result.micChoice,
      camId: result.camChoice,
      spkId: result.spkDeviceId,
    });
    navigate(`/lessons/${lessonId}/room`, {
      replace: true,
      state: { joinPath: linkPath, deviceCheck: { at: Date.now(), result } },
    });
  }

  // Имя введено — проверка устройств; закрыт ли вход, выясняется после неё.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!info.data) return;
    setError(null);
    setStep("devices");
  }

  async function onDevicesChecked(result: DeviceCheckResult) {
    // Имя необязательно (2026-10-15): пустое — сервер подпишет «Ученик N».
    const trimmed = name.trim();
    if (!info.data) return;
    checkedRef.current = result;
    writeJoinDefaults({
      mic: result.micToggle,
      cam: result.camToggle,
      micId: result.micChoice,
      camId: result.camChoice,
      spkId: result.spkDeviceId,
      micGranted: result.micGranted,
      camGranted: result.camGranted,
    });
    setError(null);
    setSubmitting(true);
    try {
      const session = await enterGuestLesson(token, trimmed, info.data.lessonTitle);
      goToRoom(session.lessonId, result);
    } catch (err) {
      // Вход закрыт — не отказ, а комната ожидания: учитель увидит запрос.
      if (err instanceof ApiError && err.code === "lesson_entry_locked") {
        await askToEnter(trimmed);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Не удалось войти в урок");
      setStep("name");
      setSubmitting(false);
    }
  }

  async function askToEnter(trimmed: string) {
    try {
      const { knockId } = await knockGuestLesson(token, trimmed);
      knockRef.current = { id: knockId, name: trimmed };
      setWaiting("pending");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось попросить учителя впустить");
      setStep("name");
    } finally {
      setSubmitting(false);
    }
  }

  // Ждём решения: опрос раз в 2 с (он же — «страница ещё открыта» для сервера).
  // Закрыл страницу — запрос у учителя пропадёт сам.
  useEffect(() => {
    if (waiting !== "pending" || !info.data) return;
    const lessonTitle = info.data.lessonTitle;
    let stopped = false;
    const tick = async () => {
      const knock = knockRef.current;
      if (stopped || !knock) return;
      try {
        const { status } = await fetchKnockStatus(token, knock.id);
        if (stopped) return;
        if (status === "denied") {
          setWaiting("denied");
          return;
        }
        if (status === "admitted") {
          stopped = true;
          const session = await enterGuestLesson(token, knock.name, lessonTitle, knock.id);
          // Устройства проверены до ожидания — впущенный сразу попадает в урок.
          if (checkedRef.current) goToRoom(session.lessonId, checkedRef.current);
          else navigate(`/lessons/${session.lessonId}/room`, { replace: true, state: { joinPath: linkPath } });
        }
      } catch (err) {
        // Запроса больше нет (сервер перезапустился) — попросим заново.
        if (err instanceof ApiError && err.status === 404 && knockRef.current) {
          await askToEnter(knockRef.current.name);
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting, info.data, token, navigate, linkPath]);

  // Проверка устройств — до входа: закрыт ли урок, узнаём уже после неё.
  if (info.data && !checkingStaff && step === "devices" && waiting === null && !submitting) {
    return (
      <DeviceCheckScreen
        lessonTitle={info.data.lessonTitle}
        defaultCameraOn={joinDefaults?.cam ?? false}
        defaultMicOn={joinDefaults?.mic ?? true}
        saved={joinDefaults}
        onContinue={(r) => void onDevicesChecked(r)}
      />
    );
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
        ) : info.data && waiting === "pending" ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DoorClosed aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Ждём, когда учитель впустит</EmptyTitle>
              <EmptyDescription>
                Вход в урок «{info.data.lessonTitle}» закрыт. Учитель видит, что вы хотите войти. Не закрывайте эту
                страницу — как только он впустит, вы окажетесь в уроке.
              </EmptyDescription>
            </EmptyHeader>
            <CenteredSpinner label="Ожидаем…" />
          </Empty>
        ) : info.data && waiting === "denied" ? (
          <Empty className="p-0 md:p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DoorClosed aria-hidden />
              </EmptyMedia>
              <EmptyTitle as="h1">Учитель не впустил вас в урок</EmptyTitle>
              <EmptyDescription>Если это ошибка, попросите ещё раз.</EmptyDescription>
            </EmptyHeader>
            <Button
              size="lg"
              className="mt-4 w-full"
              onClick={() => void askToEnter(knockRef.current?.name ?? name.trim())}
            >
              Попросить ещё раз
            </Button>
          </Empty>
        ) : info.data && step === "devices" ? (
          <CenteredSpinner label="Входим…" />
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
                />
                <p className="text-xs text-muted-foreground">
                  Учитель увидит это имя в списке участников и в заданиях. Можно не вводить — подпишем «Ученик» с
                  номером.
                </p>
              </div>

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
              >
                {submitting ? "Входим…" : "Продолжить"}
              </Button>

              {/* Согласие — нажатием «Продолжить» (решение владельца 2026-10-15), без галочки. */}
              <p className="text-xs text-muted-foreground">
                Нажимая «Продолжить», вы даёте согласие на обработку персональных данных в соответствии с{" "}
                <Link to="/privacy" target="_blank" className="font-medium text-primary hover:underline">
                  политикой обработки персональных данных
                </Link>
                .
              </p>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              Дальше — быстрая проверка камеры и микрофона.
            </p>
          </>
        ) : null}
    </StatusScreen>
  );
}
