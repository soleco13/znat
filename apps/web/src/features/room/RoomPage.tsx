import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useMaybeRoomContext,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionQuality, ConnectionState, RoomEvent, Track, VideoPresets, type RoomOptions } from "livekit-client";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Disc,
  Hand,
  LayoutGrid,
  Link as LinkIcon,
  Lock,
  LockOpen,
  LogOut,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MoreHorizontal,
  PenLine,
  Pin,
  Presentation,
  Search,
  Send,
  Settings,
  SignalLow,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ChatMessage,
  ClientMediaSettings,
  Deck,
  DeckProgressEvent,
  JoinLessonResponse,
  LessonMode,
  LessonSummary,
  MediaConnection,
  ParticipantSnapshot,
  ServerRoomMessage,
} from "@school/shared";

import { cn } from "@/lib/utils";
import { ApiError, apiFetch } from "@/shared/api-client";
import { errorFields, track } from "@/shared/telemetry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { useGuestSessionStore } from "@/features/guest/guest-session-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Skeleton } from "@/shared/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty";
import { StatusScreen } from "@/shared/ui/status-screen";
import { toast } from "@/shared/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { UserAvatar } from "@/shared/ui/avatar";
import { markRoleOf, participantColorKey } from "@/shared/ui/role-mark";
import { SimpleTooltip, TooltipProvider } from "@/shared/ui/tooltip";
import { DeckPanel } from "../decks/DeckPanel.js";
import { listLessonActivities } from "../materials/activity-api.js";
import { ActivityStage, Board, LessonActivityPanel, prefetchLessonStage } from "./lazy-stage.js";
import { RecordingPanel } from "../recordings/RecordingPanel.js";
import { playRecordingSound } from "./recording-sound.js";
import { playParticipantSound } from "./participant-sound.js";
import { SelfCameraButton } from "./CameraControls.js";
import { toScreenShareEncoding, toVideoEncoding, toVideoResolution } from "./media-quality.js";
import { DeviceCheckScreen, type DeviceCheckResult } from "./DeviceCheckScreen.js";
import { DeviceSettingsModal } from "./DeviceSettingsModal.js";
import { formatClock, participantsCount } from "./format.js";
import { ScreenShareAutoPip, type ScreenShareAutoPipHandle } from "./ScreenShareAutoPip.js";
import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";
import { useRoomIdentity } from "./use-room-identity.js";
import { useWakeLock } from "./use-wake-lock.js";
import { RoomHotkeys } from "./RoomHotkeys.js";
import { useIsNarrowViewport, useIsPhoneLandscape, useMinViewportWidth } from "./use-narrow-viewport.js";
import { SelfMicButton } from "./MicControls.js";
import { MicSync } from "./MicSync.js";
import { ParticipantMenu } from "./ParticipantMenu.js";
import { ScreenShareStatusBar, SelfScreenShareButton } from "./ScreenShareControls.js";
import { RoomVideoGrid } from "./RoomVideoGrid.js";
import { ScreenShareTile } from "./ScreenShareTile.js";
import { useRoomSocket } from "./useRoomSocket.js";
import { usePresenceGrace } from "./use-presence-grace.js";
import { notifyAnnotationsUpdated } from "../materials/annotations-events.js";
import { VideoSubscriptionManager } from "./VideoSubscriptions.js";
import { Loader } from "@/shared/ui/loader";
import { BrandMark } from "@/shared/ui/brand-mark";
import { PoorLinkMediaAdapter } from "./PoorLinkMedia.js";
import { MEDIA_CONNECT_OPTIONS, MEDIA_RECONNECT_POLICY, MediaRecovery } from "./MediaRecovery.js";
import { clearRejoinState, readRejoinState, writeRejoinState } from "./rejoin-state.js";
import { MediaTelemetry, reportLiveKitConnectionFailed } from "./MediaTelemetry.js";
import { MediaDeviceErrorNotice } from "./media-device-errors.js";

// Э5.1/Э5.2 — см. подробные комментарии ниже у <LiveKitRoom>. 720p + simulcast,
// adaptiveStream/dynacast включены явно (в livekit-client по умолчанию off).
// Дефолт на время, пока `clientMediaSettings` ещё не загружены (см. `buildRoomOptions`).
const FALLBACK_ROOM_OPTIONS: RoomOptions = {
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  audioCaptureDefaults: { noiseSuppression: true },
  publishDefaults: { simulcast: true },
  adaptiveStream: true,
  dynacast: true,
  reconnectPolicy: MEDIA_RECONNECT_POLICY,
};

/**
 * Параметры школы (запрос 2026-09-14 «выставить битрейт») — битрейт камеры
 * задаётся только тут: `video={...}` у `<LiveKitRoom>` (ниже) принимает
 * лишь `VideoCaptureOptions` (разрешение/устройство), не битрейт —
 * `publishDefaults.videoEncoding` в `RoomOptions` это единственное место,
 * откуда его можно применить к ПЕРВОЙ публикации камеры при входе (ручной
 * повторный тогл — `CameraControls.tsx`, туда битрейт тоже передаётся
 * отдельно). Вызывается ПОСЛЕ `if (!media) return` (см. ниже) — на этот
 * момент `clientMediaSettings` уже загружены тем же ответом `join()`, что
 * и `media`.
 */
function buildRoomOptions(settings: ClientMediaSettings | null): RoomOptions {
  if (!settings) return FALLBACK_ROOM_OPTIONS;
  return {
    videoCaptureDefaults: { resolution: toVideoResolution(settings.cameraResolution, settings.cameraFps) },
    // Тот же дефолт, что ниже в `audio={...}` — нужен здесь ОТДЕЛЬНО, потому
    // что ручной повторный тогл микрофона (`MicControls.tsx`) вызывает
    // `setMicrophoneEnabled` без options и падает на этот дефолт комнаты, а
    // не на пропы первого коннекта.
    audioCaptureDefaults: {
      noiseSuppression: settings.noiseSuppressionEnabled,
      channelCount: settings.micHighQuality ? 2 : undefined,
    },
    publishDefaults: {
      simulcast: true,
      videoEncoding: toVideoEncoding(settings.cameraFps, settings.cameraBitrateKbps),
    },
    adaptiveStream: true,
    dynacast: true,
    reconnectPolicy: MEDIA_RECONNECT_POLICY,
  };
}

/**
 * Уведомления урока — всплывающие плашки по центру сверху, поверх стейджа
 * (sonner, `position: "top-center"`), исчезают сами. Раньше это были полосы
 * над сеткой камер: занимали место в сетке и висели, пока их не закроют.
 */
const ROOM_TOAST = { position: "top-center" as const, duration: 6000 };

/** Сколько держится пузырь нового сообщения на плитке автора. */
const CHAT_BUBBLE_MS = 5_000;

/** Ошибка действия в уроке (права, режим, чат…) — плашкой, одна за раз. */
function showRoomError(message: string) {
  toast.error(message, { ...ROOM_TOAST, id: "room-error" });
}

/**
 * Второстепенные данные урока (чат, презентации, задания) — с повторами: на
 * мобильной сети один оборванный запрос оставлял пустой чат или список
 * презентаций, неотличимый от «их нет». После последней неудачи — в лог.
 */
async function loadWithRetry<T>(load: () => Promise<T>, what: string, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await load();
    } catch (err) {
      // 403/404 — повтор не поможет.
      const final = i >= attempts || (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429);
      if (final) {
        track("client_error", { area: "room_load", what, ...errorFields(err) });
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000 * i));
    }
  }
}

/** Сколько переподключение должно длиться, чтобы показать ученику оверлей. */
const RECONNECT_OVERLAY_DELAY_MS = 20_000;

type SocketStatusLike = "connecting" | "connected" | "reconnecting" | "closed";
type DrawerMode = "tools" | "people" | "chat";

const STATUS_LABEL: Record<SocketStatusLike, string> = {
  connecting: "Подключение…",
  connected: "На связи",
  reconnecting: "Переподключение…",
  closed: "Нет связи",
};

const STATUS_TONE: Record<SocketStatusLike, string> = {
  connecting: "bg-warn-light text-[#b45309]",
  connected: "bg-success-light text-success",
  reconnecting: "bg-warn-light text-[#b45309]",
  closed: "bg-danger-light text-danger",
};

/** Э6.4, §5.3 ТЗ. */
const LESSON_MODE_LABEL: Record<LessonMode, string> = {
  lecture: "Лекция",
  discussion: "Обсуждение",
  assignment: "Работа над заданием",
  spotlight: "У доски",
};

const ROLE_LABEL: Record<string, string> = {
  teacher: "учитель",
  admin: "админ",
  methodist: "методист",
};

const DRAWER_TABS: { key: DrawerMode; label: string }[] = [
  { key: "people", label: "Участники" },
  { key: "chat", label: "Чат" },
  { key: "tools", label: "Материалы" },
];

const MENU_CONTENT = "w-[280px] rounded-lg p-1.5 shadow-lg";
const MENU_ITEM = "h-9 gap-2.5 rounded-md px-2.5 text-sm [&>svg]:text-muted-foreground";
const MENU_LABEL = "px-2.5 pb-1 pt-2 text-xs font-semibold text-text-3";
const ICON_BTN =
  "relative flex size-11 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-3 hover:text-foreground [&_svg]:size-5";

type PermissionKey = "canDraw" | "canSpeak" | "canShareScreen" | "canPublishVideo";

const REMOVED_SCREEN = {
  title: "Вас удалили из урока",
  text: "Учитель удалил вас из урока. Если это ошибка — напишите учителю.",
};

const LINK_ROTATED_SCREEN = {
  title: "Ссылка на урок изменилась",
  text: "Учитель выдал новую ссылку на урок. Попросите её у учителя и войдите заново.",
};

/** Отказ во входе, который повтором не исправить, — экран вместо «Повторить». */
function blockedScreenFor(err: unknown): { title: string; text: string } | null {
  if (err instanceof ApiError && err.code === "guest_link_rotated") return LINK_ROTATED_SCREEN;
  // Гостевая сессия истекла — повтором не войти, нужна ссылка заново.
  if (err instanceof ApiError && err.status === 401 && err.code === "invalid_guest_session") {
    return { title: "Нужно войти заново", text: "Откройте ссылку на урок ещё раз — так вы вернётесь в урок." };
  }
  if (!(err instanceof ApiError) || err.status !== 403) return null;
  switch (err.code) {
    case "removed_from_lesson":
      return REMOVED_SCREEN;
    case "lesson_entry_locked":
      return { title: "Вход в урок закрыт", text: "Учитель закрыл вход. Попросите его открыть вход и обновите страницу." };
    case "lesson_full":
      return { title: "В уроке нет мест", text: err.message };
    default:
      return null;
  }
}

export function RoomPage() {
  const { id: lessonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const identity = useRoomIdentity();
  const guestSession = useGuestSessionStore((s) => s.session);
  const isGuest = identity?.kind === "guest";

  const selfId = identity?.id;
  const [leftAsGuest, setLeftAsGuest] = useState(false);

  // Э12.7 §6.3/§6.4 — одна боковая панель (три вкладки) и что показано на
  // стейдже (плитки участников / доска). Демонстрация экрана переключает
  // стейдж сама (см. `StageContent`).
  const [drawer, setDrawer] = useState<null | DrawerMode>(null);
  const [stageView, setStageView] = useState<"people" | "board" | "activity">("people");
  // Э12 полировка: авторитетное «людям/доска» с сервера — держим отдельно от
  // `stageView`, чтобы закрытие задания знало, куда вернуться (не всегда «people»).
  const [sharedStage, setSharedStage] = useState<"people" | "board">("people");
  const [activeTool, setActiveTool] = useState<null | "deck" | "activity" | "recording" | "class">(
    null,
  );
  const toggleDrawer = (mode: DrawerMode) => setDrawer((cur) => (cur === mode ? null : mode));

  useEffect(() => {
    if (drawer !== "tools") setActiveTool(null);
  }, [drawer]);

  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);
  const [lessonMode, setLessonMode] = useState<LessonMode>("lecture");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  /** Ключ идемпотентности последнего отправляемого текста (`sendChat`). */
  const chatSendRef = useRef<{ body: string; id: string } | null>(null);
  /** Отправленные, но ещё не подтверждённые сервером сообщения — видны бледными. */
  const [chatPending, setChatPending] = useState<{ id: string; body: string }[]>([]);
  const [chatSeen, setChatSeen] = useState(0);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [deckStatuses, setDeckStatuses] = useState<Record<string, DeckProgressEvent>>({});
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [reviewSignal, setReviewSignal] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  /** Войти нельзя и повтор не поможет: удалили из урока, вход закрыт, урок полон. */
  const [blocked, setBlocked] = useState<{ title: string; text: string } | null>(null);
  const [entryLocked, setEntryLocked] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ParticipantSnapshot | null>(null);
  const [media, setMedia] = useState<MediaConnection | null>(null);
  const [clientMediaSettings, setClientMediaSettings] = useState<ClientMediaSettings | null>(null);
  // Перезагрузка вкладки посреди урока — сразу обратно в урок, с теми же
  // устройствами и тем, что было включено (см. `rejoin-state.ts`).
  const [rejoin] = useState(readRejoinState);
  const [deviceCheckDone, setDeviceCheckDone] = useState(rejoin !== null);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(rejoin?.micId ?? null);
  const [camDeviceId, setCamDeviceId] = useState<string | null>(rejoin?.camId ?? null);
  const [spkDeviceId, setSpkDeviceId] = useState<string | null>(rejoin?.spkId ?? null);
  const [joinMicEnabled, setJoinMicEnabled] = useState(rejoin ? rejoin.mic : true);
  const [joinCamEnabled, setJoinCamEnabled] = useState(rejoin ? rejoin.cam : true);
  const [lessonTitle, setLessonTitle] = useState<string | null>(null);
  const [lessonJoinPath, setLessonJoinPath] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Э10-звук: baseline «прошлое состояние записи» на текущее подключение
  // сокета. `null` — ещё не знаем (только что подключились) — в этом
  // случае `recording_status` может быть просто синхронизацией уже идущей
  // записи для вошедшего участника, а не реальным стартом/стопом, и звук
  // играть не нужно. Сбрасывается на каждый `presence` — тот шлётся ровно
  // раз при (пере)подключении, раньше самого первого `recording_status`
  // (см. `rooms/ws.ts`).
  const recordingActivePrevRef = useRef<boolean | null>(null);
  // Авто-PiP на время демонстрации — см. `ScreenShareAutoPip`/`ScreenShareControls`.
  const pipRef = useRef<ScreenShareAutoPipHandle>(null);
  // Пользовательский баг (2026-09-14): учитель/админ перехватил лок демонстрации
  // (`rooms/service.ts#claimScreenShare`) — прежний держатель обязан сам
  // остановить СВОЙ трек (`ScreenShareControls.tsx`, эффект на этот счётчик).
  const [screenSharePreempted, setScreenSharePreempted] = useState(0);
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  // Сигналы входа/выхода — только учителю: ученику 30 сигналов о входе
  // одноклассников ни к чему (частоту ограничивает `playParticipantSound`).
  const soundsRef = useRef(false);
  /** Учитель вручную проверил ответ — плеер ученика перечитывает задание. */
  const [gradedSignal, setGradedSignal] = useState(0);
  /** Свежие сообщения по автору — пузырь на его плитке у учителя (~5 с). */
  const [chatBubbles, setChatBubbles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const bubbleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const showChatBubble = useCallback((authorId: string, body: string) => {
    const text = body.length > 140 ? `${body.slice(0, 139)}…` : body;
    setChatBubbles((prev) => new Map(prev).set(authorId, text));
    const timers = bubbleTimersRef.current;
    const old = timers.get(authorId);
    if (old) clearTimeout(old);
    timers.set(
      authorId,
      setTimeout(() => {
        timers.delete(authorId);
        setChatBubbles((prev) => {
          if (!prev.has(authorId)) return prev;
          const next = new Map(prev);
          next.delete(authorId);
          return next;
        });
      }, CHAT_BUBBLE_MS),
    );
  }, []);
  useEffect(() => {
    const timers = bubbleTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoLayout, setVideoLayout] = useState<"grid" | "speaker">("grid");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isNarrowViewport = useIsNarrowViewport();
  const phoneLandscape = useIsPhoneLandscape();
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }

  // Таймер именно ЭТОЙ сессии подключения (не `scheduledAt` урока — демо-уроки
  // датированы в прошлом), сбрасывается при переприсоединении. Сами секунды
  // тикают в `ElapsedClock`: раньше счётчик жил здесь, и вся страница урока со
  // всеми плитками перерисовывалась раз в секунду.
  const [sessionStartedAt, setSessionStartedAt] = useState(() => Date.now());
  useEffect(() => {
    if (media) setSessionStartedAt(Date.now());
  }, [media]);

  const isTeacher = identity?.role === "teacher" || identity?.role === "admin";
  soundsRef.current = isTeacher;

  const handleMessage = useCallback((message: ServerRoomMessage) => {
    switch (message.type) {
      case "presence":
        recordingActivePrevRef.current = null;
        setParticipants(message.participants);
        break;
      case "participant_joined":
        if (soundsRef.current && message.participant.userId !== selfIdRef.current) playParticipantSound("joined");
        setParticipants((prev) => [
          ...prev.filter((p) => p.userId !== message.participant.userId),
          message.participant,
        ]);
        break;
      case "participant_updated":
        setParticipants((prev) =>
          prev.some((p) => p.userId === message.participant.userId)
            ? prev.map((p) => (p.userId === message.participant.userId ? message.participant : p))
            : [...prev, message.participant],
        );
        break;
      case "participant_left":
        if (soundsRef.current && message.userId !== selfIdRef.current) playParticipantSound("left");
        setParticipants((prev) => prev.filter((p) => p.userId !== message.userId));
        break;
      case "participant_removed":
        if (message.userId === selfIdRef.current) {
          setBlocked(message.reason === "link_rotated" ? LINK_ROTATED_SCREEN : REMOVED_SCREEN);
          break;
        }
        if (soundsRef.current) playParticipantSound("left");
        setParticipants((prev) => prev.filter((p) => p.userId !== message.userId));
        break;
      case "entry_locked":
        setEntryLocked(message.locked);
        break;
      case "permissions_updated":
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === message.userId ? { ...p, permissions: message.permissions } : p,
          ),
        );
        break;
      case "hand_raised":
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === message.userId
              ? {
                  ...p,
                  handRaised: message.raised,
                  // Старый сервер времени не присылает — порядок тогда по приходу события.
                  handRaisedAt: message.raised ? (message.raisedAt ?? p.handRaisedAt ?? new Date().toISOString()) : null,
                }
              : p,
          ),
        );
        break;
      case "microphones_muted":
        if (selfIdRef.current && message.userIds.includes(selfIdRef.current)) {
          toast("Учитель выключил ваш микрофон", { ...ROOM_TOAST, id: "room-teacher-mic", duration: 4000, icon: <MicOff className="size-4 text-muted-foreground" /> });
        }
        break;
      case "participant_pinned":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, pinned: message.pinned } : p)),
        );
        break;
      case "chat_message":
        // После переподключения история уже могла подтянуть это сообщение.
        setChat((prev) => (prev.some((m) => m.id === message.message.id) ? prev : [...prev, message.message]));
        if (soundsRef.current && message.message.authorId && message.message.authorId !== selfIdRef.current) {
          showChatBubble(message.message.authorId, message.message.body);
        }
        break;
      case "lesson_mode":
        setLessonMode(message.mode);
        break;
      case "deck_status":
        setDeckStatuses((prev) => ({ ...prev, [message.deck.deckId]: message.deck }));
        break;
      case "activity_started":
        setActiveActivityId(message.activityId);
        // §7.3 ТЗ: выданный материал сразу выходит на стейдж (плитки — в ленту).
        setStageView("activity");
        break;
      case "stage_changed":
        // Э12 полировка: доска/плитки теперь общие на весь класс. Пока идёт
        // задание, стейдж «activity» этим сообщением не перебивается —
        // сервер шлёт его независимо, но участник вернётся к нужному виду
        // сам, когда закроет задание (см. onClose у ActivityStage/Board).
        setSharedStage(message.stage);
        setStageView((v) => (v === "activity" ? v : message.stage));
        break;
      case "activity_reviewed":
        setReviewSignal((n) => n + 1);
        break;
      case "activity_graded":
        setGradedSignal((n) => n + 1);
        break;
      case "recording_status": {
        const prev = recordingActivePrevRef.current;
        if (prev !== null && prev !== message.active) playRecordingSound(message.active);
        // Предупреждение о записи — всем, и при старте, и при входе в урок,
        // где запись уже идёт; дальше о ней напоминает иконка в шапке.
        if (message.active && prev !== true) {
          toast("Идёт запись урока", { ...ROOM_TOAST, id: "room-recording", icon: <Disc className="size-4 text-destructive" /> });
        }
        recordingActivePrevRef.current = message.active;
        setRecordingActive(message.active);
        break;
      }
      case "screen_share_preempted":
        if (message.userId === selfIdRef.current) setScreenSharePreempted((n) => n + 1);
        break;
      case "annotations_updated":
        if (message.userId === selfIdRef.current) notifyAnnotationsUpdated(message.activityId);
        break;
      case "error":
        showRoomError(message.message);
        break;
    }
  }, [showChatBubble]);

  // Сервер удаляет участника после ~90 с молчания (телефон заснул, сеть
  // пропала) и закрывает его сокет кодом 4003. Входим заново тем же POST
  // /join — без этого клиент бесконечно переподключался, оставаясь вне урока.
  // До первого успешного входа не дублируем штатный `attemptJoin`.
  const joinedRef = useRef(false);
  /** Участник сам вышел из урока — никаких повторных входов. */
  const leftRef = useRef(false);
  const rejoinAfterEviction = useCallback(async () => {
    if (!lessonId || !joinedRef.current || leftRef.current) return;
    await apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" }).catch((err) => {
      const screen = blockedScreenFor(err);
      if (screen) setBlocked(screen);
      throw err;
    });
  }, [lessonId]);

  const status = useRoomSocket(
    lessonId ?? "",
    handleMessage,
    // Только после успешного /join: у гостя (без запроса токена) сокет
    // успевал раньше входа, сервер закрывал его 4003, а повтор делал второй
    // /join (E2E-тест 2026-10-04).
    deviceCheckDone && media !== null && !blocked && !leftAsGuest,
    isGuest ? "guest" : "staff",
    undefined,
    rejoinAfterEviction,
  );

  // Оверлей переподключения — только если WS уже был `connected` хотя бы
  // раз: на самом первом подключении место занимает экран загрузки.
  const everConnectedRef = useRef(false);
  // Оверлей «связь прервалась» — только при настоящем обрыве. Короткие
  // переподключения служебного канала на мобильной сети частые, видео и звук
  // под ними не прерываются — перекрывать урок из-за них не нужно.
  const [longReconnect, setLongReconnect] = useState(false);
  // Тот же человек вошёл в урок с другой вкладки/устройства — здесь LiveKit
  // отключил медиа. Раньше плитки просто гасли, без объяснения.
  const [mediaTakenOver, setMediaTakenOver] = useState(false);
  const [mediaResumeSignal, setMediaResumeSignal] = useState(0);
  useEffect(() => {
    if (status !== "reconnecting") {
      setLongReconnect(false);
      return;
    }
    const timer = setTimeout(() => setLongReconnect(true), RECONNECT_OVERLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);
  if (status === "connected") everConnectedRef.current = true;

  const attemptJoin = useCallback(() => {
    if (!lessonId) return;
    setJoinFailed(false);
    apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" })
      .then((data) => {
        joinedRef.current = true;
        setParticipants(data.participants);
        setLessonMode(data.lessonMode);
        setMedia(data.media);
        setClientMediaSettings(data.clientMediaSettings);
        setSharedStage(data.stage);
        setStageView((v) => (v === "activity" ? v : data.stage));
        setEntryLocked(data.entryLocked);
      })
      .catch((err) => {
        const screen = blockedScreenFor(err);
        if (screen) setBlocked(screen);
        else setJoinFailed(true);
      });
  }, [lessonId]);

  useEffect(() => {
    if (!lessonId || !deviceCheckDone) return;
    attemptJoin();
  }, [lessonId, deviceCheckDone, attemptJoin]);

  // `onError` входит в зависимости эффекта подключения `useLiveKitRoom`:
  // новая функция на каждом рендере заново вызывала `room.connect()`. Пока
  // комната подключена, это пустой вызов, но во время переподключения LiveKit
  // (обрыв связи от ~15 с) он заменял восстановление новой сессией без
  // камеры и микрофона — ученик оставался в уроке без звука и видео
  // (E2E-тест 2026-10-04). Поэтому колбэки — только стабильные.
  const handleLiveKitError = useCallback(
    (err: Error) => reportLiveKitConnectionFailed(lessonId ?? "", err, "initial"),
    [lessonId],
  );

  // Вошли в урок (`/join` ответил). Всё второстепенное — после этого: на
  // медленной сети эти запросы делили бы канал с самим входом. Доска и
  // задания — ещё позже, после подключения медиа (`PrefetchStageWhenMediaUp`).
  const joined = media !== null;

  // История чата — при входе и после каждого переподключения соединения
  // урока: пока оно было разорвано, новые сообщения не приходили и терялись
  // молча. Сливаем по id, чтобы не сбить счётчик непрочитанных.
  const chatLoadedRef = useRef(false);
  const socketConnected = status === "connected";
  useEffect(() => {
    if (!lessonId || !joined || !socketConnected) return;
    let cancelled = false;
    loadWithRetry(() => apiFetch<{ items: ChatMessage[] }>(`/lessons/${lessonId}/chat`), "chat")
      .then((data) => {
        if (cancelled) return;
        const fetched = [...data.items].reverse();
        if (!chatLoadedRef.current) {
          chatLoadedRef.current = true;
          setChat(fetched);
          setChatSeen(fetched.length);
          return;
        }
        setChat((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const missed = fetched.filter((m) => !known.has(m.id));
          if (missed.length === 0) return prev;
          return [...prev, ...missed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lessonId, joined, socketConnected]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatPending.length, drawer]);

  useEffect(() => {
    if (drawer === "chat") setChatSeen(chat.length);
  }, [drawer, chat.length]);

  useEffect(() => {
    if (!lessonId) return;
    // Гость формы `LessonSummary` не видит (§1.4 план-ТЗ) — имя урока берём
    // из гостевой сессии (загружено на экране входа / восстановлено по куке).
    if (isGuest) {
      setLessonTitle(guestSession?.lessonTitle ?? null);
      return;
    }
    loadWithRetry(() => apiFetch<LessonSummary>(`/lessons/${lessonId}`), "lesson")
      .then((l) => {
        setLessonTitle(l.title);
        setLessonJoinPath(l.joinPath);
      })
      .catch(() => undefined);
  }, [lessonId, isGuest, guestSession?.lessonTitle]);

  const copyJoinLink = useCallback(() => {
    if (!lessonJoinPath) return;
    navigator.clipboard
      .writeText(`${window.location.origin}${lessonJoinPath}`)
      .then(() => toast.success("Ссылка для учеников скопирована"))
      .catch(() => toast.error("Не удалось скопировать ссылку"));
  }, [lessonJoinPath]);

  const refreshDecks = useCallback(() => {
    if (!lessonId) return;
    loadWithRetry(() => apiFetch<{ decks: Deck[] }>(`/lessons/${lessonId}/decks`), "decks")
      .then((data) => setDecks(data.decks))
      .catch(() => undefined);
  }, [lessonId]);

  // Презентации — маршрут персонала; гость получал 401 на каждом входе.
  useEffect(() => {
    if (joined && !isGuest) refreshDecks();
  }, [refreshDecks, joined, isGuest]);

  useEffect(() => {
    if (!lessonId || !joined) return;
    loadWithRetry(() => listLessonActivities(lessonId), "activities")
      .then((data) => {
        const latest = data.items[0];
        if (!latest) return;
        setActiveActivityId((prev) => prev ?? latest.id);
        // F5 посреди задания: раньше ученик оказывался на сетке камер и
        // искал задание в «Материалах». Ответы при этом не терялись.
        if (rejoin?.act) setStageView("activity");
      })
      .catch(() => undefined);
  }, [lessonId, joined, rejoin]);

  useEffect(() => {
    if (joined) writeRejoinState({ act: stageView === "activity" });
  }, [joined, stageView]);

  const refetchedDecksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = Object.values(deckStatuses).filter(
      (ev) =>
        ev.status === "ready" &&
        ev.slideCount > 0 &&
        !decks.some(
          (d) => d.id === ev.deckId && (d.slides.length > 0 || d.renderMode === "pdf"),
        ) &&
        !refetchedDecksRef.current.has(ev.deckId),
    );
    if (pending.length > 0) {
      for (const ev of pending) refetchedDecksRef.current.add(ev.deckId);
      refreshDecks();
    }
  }, [deckStatuses, decks, refreshDecks]);

  const self = participants.find((p) => p.userId === selfId);

  // Учитель дал или забрал слово — ученику короткая плашка: иначе он не
  // понимает, почему микрофон вдруг стал недоступен или снова доступен.
  const selfCanSpeak = self?.permissions.canSpeak;
  const canSpeakPrevRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = canSpeakPrevRef.current;
    canSpeakPrevRef.current = selfCanSpeak;
    if (isTeacher || prev === undefined || selfCanSpeak === undefined || prev === selfCanSpeak) return;
    toast(selfCanSpeak ? "Учитель дал вам слово — можно включить микрофон" : "Учитель выключил ваш микрофон", {
      ...ROOM_TOAST,
      id: "room-teacher-mic",
      duration: 4000,
      icon: selfCanSpeak ? <Mic className="size-4 text-primary" /> : <MicOff className="size-4 text-muted-foreground" />,
    });
  }, [selfCanSpeak, isTeacher]);

  // Экран не гаснет, пока участник на уроке (см. `useWakeLock`).
  useWakeLock(media !== null && !leftAsGuest && blocked === null);

  function leaveRoom() {
    if (!lessonId) return;
    // До запроса: пока /leave идёт, сервер может закрыть соединение урока, и
    // повторный вход (`rejoinAfterEviction`) не должен успеть сработать.
    leftRef.current = true;
    clearRejoinState();
    // Не ждём ответа: на плохой связи (и в оверлее «Связь прервалась», где
    // сети нет вовсе) кнопка «Выйти» до 30 с ничего не делала. `keepalive`
    // доносит запрос и после ухода со страницы; не дошёл — сервер сам
    // уберёт участника по молчанию.
    void apiFetch(`/lessons/${lessonId}/leave`, { method: "POST", keepalive: true }).catch(() => undefined);
    if (isGuest) {
      // У гостя нет /lessons и личного кабинета — показываем экран выхода.
      // Гостевую сессию в памяти НЕ очищаем: `RequireRoomAccess` видел
      // «сессии нет», восстанавливал её по куке и пускал обратно, а
      // соединение урока под экраном выхода переподключалось и снова входило
      // в урок — ученик «возвращался» (2026-09-26). Соединение урока
      // выключается по `leftAsGuest` (см. `useRoomSocket` ниже).
      setLeftAsGuest(true);
      return;
    }
    navigate("/lessons");
  }

  async function toggleHand() {
    if (!lessonId || !self) return;
    const raised = !self.handRaised;
    await apiFetch(`/lessons/${lessonId}/hand-raise`, {
      method: "POST",
      body: JSON.stringify({ raised }),
    }).catch(() => showRoomError(raised ? "Не удалось поднять руку — попробуйте ещё раз" : "Не удалось опустить руку"));
  }

  async function togglePermission(userId: string, key: PermissionKey, value: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ [key]: value }),
    }).catch((e) => showRoomError(e instanceof Error ? e.message : "Не удалось изменить права"));
  }

  async function muteParticipant(userId: string) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/mute`, { method: "POST" }).catch(() =>
      showRoomError("Не удалось заглушить участника"),
    );
  }

  /** Опустить руку одному ученику или всем (без `userId`). */
  async function lowerHands(userId?: string) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/hands/lower`, {
      method: "POST",
      body: JSON.stringify(userId ? { userId } : {}),
    }).catch(() => showRoomError(userId ? "Не удалось опустить руку" : "Не удалось опустить руки"));
  }

  async function muteAll() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/mute-all`, { method: "POST" }).catch(() =>
      showRoomError("Не удалось заглушить всех участников"),
    );
  }

  async function removeParticipant(userId: string) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/remove`, { method: "POST" }).catch((e) =>
      showRoomError(e instanceof Error ? e.message : "Не удалось удалить участника"),
    );
  }

  async function toggleEntryLocked() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/entry`, {
      method: "PATCH",
      body: JSON.stringify({ locked: !entryLocked }),
    }).catch(() => showRoomError(entryLocked ? "Не удалось открыть вход" : "Не удалось закрыть вход"));
  }

  /** Э6.3, §5.3 ТЗ. */
  async function togglePin(userId: string, pinned: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }).catch(() => showRoomError("Не удалось закрепить участника"));
  }

  /** Э6.4, §5.3 ТЗ. */
  async function changeLessonMode(mode: LessonMode) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }).catch(() => showRoomError("Не удалось изменить режим урока"));
  }

  /**
   * Э12 полировка — учитель переключает доску/плитки для всего класса разом.
   * Как и `changeLessonMode`: не выставляем стейдж локально сразу, ждём
   * своего же эхо `stage_changed` по WS — так self и остальные участники
   * обновляются одинаково, без риска разойтись с сервером.
   */
  async function changeLessonStage(stage: "people" | "board") {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    }).catch(() => showRoomError("Не удалось переключить стейдж"));
  }
  const toggleBoard = () => changeLessonStage(stageView === "board" ? "people" : "board");

  /** Э3.8. */
  async function toggleDrawForAll(canDraw: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/draw-all`, {
      method: "POST",
      body: JSON.stringify({ canDraw }),
    }).catch(() => showRoomError("Не удалось изменить право рисования"));
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!lessonId || !chatDraft.trim()) return;
    const body = chatDraft;
    setChatDraft("");
    // Повтор того же текста после ошибки — с тем же ключом: если первый запрос
    // на самом деле дошёл (ответ потерялся), сервер вернёт его, а не создаст второе.
    const pending = chatSendRef.current;
    const clientMessageId = pending && pending.body === body ? pending.id : crypto.randomUUID();
    chatSendRef.current = { body, id: clientMessageId };
    setChatPending((prev) => (prev.some((m) => m.id === clientMessageId) ? prev : [...prev, { id: clientMessageId, body }]));
    await apiFetch<ChatMessage>(`/lessons/${lessonId}/chat`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId }),
    })
      .then((message) => {
        if (chatSendRef.current?.id === clientMessageId) chatSendRef.current = null;
        // Своё сообщение — из ответа, не дожидаясь эха по каналу урока: пока
        // тот переподключается, текст пропадал из поля и нигде не появлялся,
        // и его отправляли ещё раз.
        setChat((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      })
      .catch((err: unknown) => {
        // Текст возвращаем в поле, если человек ещё не начал новое сообщение.
        setChatDraft((draft) => draft || body);
        showRoomError(
          err instanceof ApiError && err.code === "chat_rate_limited"
            ? "Слишком много сообщений подряд — подождите несколько секунд"
            : "Сообщение не отправлено",
        );
      })
      .finally(() => setChatPending((prev) => prev.filter((m) => m.id !== clientMessageId)));
  }

  const openSettings = () => setSettingsOpen(true);
  const openRecording = () => {
    setDrawer("tools");
    setActiveTool("recording");
  };

  // Короткий разрыв канала урока у ученика не убирает его из шапки, сетки и
  // списка — см. `usePresenceGrace`.
  const presence = usePresenceGrace(participants);
  const connectedCount = presence.participants.filter((p) => p.connected).length;
  const aloneOnStage = media !== null && stageView === "people" && connectedCount <= 1;
  // Очередь рук — по времени подъёма (у записей без времени — по входу).
  const raisedHands = participants
    .filter((p) => p.handRaised && p.connected && p.userId !== selfId)
    .sort((a, b) => (a.handRaisedAt ?? a.joinedAt).localeCompare(b.handRaisedAt ?? b.joinedAt));

  // Поднятая рука — учителю плашка на каждого нового поднявшего (не висит:
  // сам список поднятых рук остаётся в «Участниках»).
  const handsSeenRef = useRef<Set<string>>(new Set());
  const raisedKey = raisedHands.map((p) => p.userId).join(",");
  useEffect(() => {
    const now = new Set(raisedKey ? raisedKey.split(",") : []);
    if (isTeacher) {
      for (const id of now) {
        if (handsSeenRef.current.has(id)) continue;
        const p = raisedHands.find((x) => x.userId === id);
        if (!p) continue;
        toast(`${p.fullName} поднял(а) руку`, {
          ...ROOM_TOAST,
          id: `hand-${id}`,
          duration: 8000,
          icon: <Hand className="size-4 text-primary" />,
          action: p.permissions.canSpeak
            ? { label: "Участники", onClick: () => setDrawer("people") }
            : { label: "Дать слово", onClick: () => void togglePermission(id, "canSpeak", true) },
        });
      }
    }
    handsSeenRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем только на смену набора поднявших
  }, [raisedKey, isTeacher]);
  const unreadChat = drawer === "chat" ? 0 : Math.max(0, chat.length - chatSeen);
  // Планового времени у урока по сути нет (постоянная комната) — только число участников.
  const headerMeta = participantsCount(connectedCount);
  const shareVisible =
    media !== null &&
    Boolean(lessonId) &&
    (isTeacher || Boolean(self?.permissions.canShareScreen)) &&
    clientMediaSettings?.screenShareEnabled !== false;

  // ── Панель «Участники» ────────────────────────────────────────────────
  const peopleListProps: PeopleListProps = {
    participants: presence.participants,
    reconnectingIds: presence.reconnectingIds,
    selfId,
    isTeacher,
    hasMedia: media !== null,
    query: peopleQuery,
    onTogglePermission: togglePermission,
    onMute: muteParticipant,
    onTogglePin: togglePin,
    onRemove: setRemoveTarget,
  };

  const peoplePanel = (sheet: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex shrink-0 flex-col gap-2 border-b border-border py-2.5", sheet ? "px-4" : "px-3")}>
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3"
            aria-hidden
          />
          <Input
            value={peopleQuery}
            onChange={(e) => setPeopleQuery(e.target.value)}
            placeholder="Найти участника"
            aria-label="Найти участника"
            className="h-9 pl-9 text-sm"
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-text-3">
            В уроке · {connectedCount}
          </span>
          {isTeacher && media ? (
            <button
              type="button"
              onClick={muteAll}
              className="h-7 rounded-full border border-border bg-card px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
            >
              Заглушить всех
            </button>
          ) : null}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {isTeacher && raisedHands.length > 0 ? (
          <HandsQueue
            hands={raisedHands}
            onGiveWord={(id) => void togglePermission(id, "canSpeak", true)}
            onLower={(id) => void lowerHands(id)}
            onLowerAll={() => void lowerHands()}
          />
        ) : null}
        {media ? <LivePeopleList {...peopleListProps} /> : <PeopleList {...peopleListProps} />}
      </ScrollArea>
    </div>
  );

  // ── Панель «Чат» ──────────────────────────────────────────────────────
  const chatPanel = (sheet: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {chat.length === 0 && chatPending.length === 0 ? (
        <Empty className="min-h-0 px-7 py-8 md:px-7 md:py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquare aria-hidden />
            </EmptyMedia>
            <EmptyTitle className="text-[15px] font-semibold">Сообщений пока нет</EmptyTitle>
            <EmptyDescription className="text-[13px]">
              Напишите вопрос — его увидит весь класс. Учитель отвечает, не прерывая объяснение.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className={cn("flex flex-col gap-3 py-3.5", sheet ? "px-4" : "px-3")}>
            {chat.map((m, i) => {
              const prev = chat[i - 1];
              const continued = prev !== undefined && prev.authorName === m.authorName && prev.userId === m.userId;
              return (
                <div key={m.id} className={cn("flex flex-col gap-[3px]", continued && "-mt-2")}>
                  {continued ? null : (
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{m.authorName}</span>
                      <span className="shrink-0 text-[11.5px] text-text-3">{formatClock(m.createdAt)}</span>
                    </span>
                  )}
                  <span
                    className={cn(
                      "self-start whitespace-pre-wrap break-words bg-surface-2 text-sm text-foreground [text-wrap:pretty]",
                      sheet ? "rounded-xl px-[11px] py-[9px]" : "rounded-[10px] px-2.5 py-2",
                    )}
                  >
                    {m.body}
                  </span>
                </div>
              );
            })}
            {chatPending.map((m) => (
              <div key={m.id} className="flex flex-col items-start gap-[3px]">
                <span
                  className={cn(
                    "whitespace-pre-wrap break-words bg-surface-2 text-sm text-foreground opacity-60 [text-wrap:pretty]",
                    sheet ? "rounded-xl px-[11px] py-[9px]" : "rounded-[10px] px-2.5 py-2",
                  )}
                >
                  {m.body}
                </span>
                <span className="text-[11.5px] text-text-3">Отправляется…</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>
      )}
      <form
        onSubmit={sendChat}
        className={cn(
          "flex shrink-0 gap-2 border-t border-border",
          sheet ? "px-4 pb-[max(22px,env(safe-area-inset-bottom))] pt-3" : "p-2.5",
        )}
      >
        <Input
          value={chatDraft}
          onChange={(e) => setChatDraft(e.target.value)}
          placeholder="Сообщение классу…"
          aria-label="Сообщение классу"
          maxLength={2000}
          className={cn("text-sm", sheet ? "h-11 rounded-xl" : "h-[38px]")}
        />
        <Button
          type="submit"
          size="icon"
          className={cn("shrink-0", sheet ? "size-11 rounded-xl" : "size-[38px] rounded-[10px]")}
          aria-label="Отправить"
        >
          <Send aria-hidden />
        </Button>
      </form>
    </div>
  );

  // ── Панель «Материалы» ────────────────────────────────────────────────
  // «Доска» — переключатель стейджа для ВСЕГО урока, поэтому только учителю;
  // ученику из строк ниже доступно только задание.
  const toolRows: {
    key: "board" | "deck" | "activity" | "recording" | "class";
    icon: LucideIcon;
    label: string;
    hint?: ReactNode;
    show: boolean;
    onClick: () => void;
    on?: boolean;
  }[] = [
    {
      key: "board",
      icon: PenLine,
      label: "Доска",
      hint: stageView === "board" ? "открыта для класса" : "рисование и слайды",
      show: isTeacher,
      onClick: toggleBoard,
      on: stageView === "board",
    },
    {
      key: "deck",
      icon: Presentation,
      label: "Презентация",
      hint: decks.length > 0 ? `${decks.length} загружено` : "загрузить .pptx / .pdf",
      show: Boolean(lessonId && isTeacher),
      onClick: () => setActiveTool("deck"),
    },
    {
      key: "activity",
      icon: ClipboardList,
      label: isTeacher ? "Задание классу" : "Задание",
      hint: activeActivityId
        ? stageView === "activity"
          ? "на экране"
          : "открыть на экране"
        : isTeacher
          ? "выдать и проверить"
          : "выполнить задание урока",
      show: Boolean(lessonId),
      onClick: () => {
        if (activeActivityId && !isTeacher) {
          setStageView("activity");
          setDrawer(null);
        } else {
          setActiveTool("activity");
        }
      },
      on: Boolean(activeActivityId) && stageView === "activity",
    },
    {
      key: "recording",
      icon: Disc,
      label: "Запись урока",
      hint: recordingActive ? (
        <>
          идёт запись · <ElapsedClock since={sessionStartedAt} />
        </>
      ) : (
        "начать запись"
      ),
      show: Boolean(lessonId && isTeacher),
      onClick: () => setActiveTool("recording"),
      on: recordingActive,
    },
    {
      key: "class",
      icon: SlidersHorizontal,
      label: "Управление классом",
      hint: "режим урока, микрофоны, рисование",
      show: isTeacher,
      onClick: () => setActiveTool("class"),
    },
  ];

  const toolBody =
    activeTool === "deck" && lessonId ? (
      <DeckPanel
        lessonId={lessonId}
        isTeacher={isTeacher}
        decks={decks}
        statuses={deckStatuses}
        onChanged={refreshDecks}
      />
    ) : activeTool === "activity" && lessonId ? (
      <LessonActivityPanel
        lessonId={lessonId}
        isTeacher={isTeacher}
        activeActivityId={activeActivityId}
        onShowOnStage={
          activeActivityId
            ? () => {
                setStageView("activity");
                setDrawer(null);
              }
            : undefined
        }
      />
    ) : activeTool === "recording" && lessonId ? (
      <RecordingPanel
        lessonId={lessonId}
        recordingActive={recordingActive}
        onActiveChange={setRecordingActive}
      />
    ) : activeTool === "class" ? (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-text-2">Режим урока</span>
          <Select value={lessonMode} onValueChange={(v) => changeLessonMode(v as LessonMode)}>
            <SelectTrigger className="h-10 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LESSON_MODE_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {media ? (
          <Button variant="secondary" size="sm" onClick={muteAll}>
            Заглушить всех
          </Button>
        ) : null}
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => toggleDrawForAll(true)}>
            Рисовать всем
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => toggleDrawForAll(false)}>
            Запретить
          </Button>
        </div>
      </div>
    ) : null;

  const activeToolLabel = toolRows.find((r) => r.key === activeTool)?.label ?? "";

  const toolsPanel = activeTool ? (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={() => setActiveTool(null)}
        className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {activeToolLabel}
      </button>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">{toolBody}</div>
      </ScrollArea>
    </div>
  ) : (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-1 p-2.5">
        {toolRows
          .filter((r) => r.show)
          .map(({ key, icon: Icon, label, hint, onClick, on }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className="flex items-center gap-3 rounded-lg px-2.5 py-[11px] text-left transition-colors hover:bg-surface-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
                {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
              </span>
              {on ? (
                <Badge variant="green" className="shrink-0">
                  вкл
                </Badge>
              ) : (
                <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
              )}
            </button>
          ))}
      </div>
    </ScrollArea>
  );

  const drawerBody = (sheet: boolean, handle = sheet) => (
    <div className="flex h-full min-h-0 flex-col">
      {sheet ? (
        <>
          {handle ? (
            <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
              <span className="h-1 w-[38px] rounded-full bg-border" />
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 pb-2.5 pt-1.5">
            <SheetTitle className="min-w-0 truncate text-base font-bold">
              {DRAWER_TABS.find((t) => t.key === drawer)?.label ?? ""}
            </SheetTitle>
            <div role="tablist" className="ml-auto flex shrink-0 gap-1">
              {DRAWER_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={drawer === key}
                  onClick={() => setDrawer(key)}
                  className={cn(
                    "inline-flex h-[30px] items-center rounded-full px-3 text-[12.5px] font-semibold transition-colors",
                    drawer === key ? "bg-primary text-primary-foreground" : "bg-surface-2 text-text-2",
                  )}
                >
                  {label}
                  {key === "people" ? ` ${connectedCount}` : ""}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div role="tablist" className="flex shrink-0 gap-1 border-b border-border p-2.5">
          {DRAWER_TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={drawer === key}
              onClick={() => setDrawer(key)}
              className={cn(
                "inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13.5px] font-semibold transition-colors",
                drawer === key ? "bg-primary-light text-primary" : "text-text-2 hover:bg-surface-2",
              )}
            >
              {label}
              {key === "chat" && unreadChat > 0 ? (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                  {unreadChat}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {drawer === "people" ? peoplePanel(sheet) : null}
        {drawer === "chat" ? chatPanel(sheet) : null}
        {drawer === "tools" ? toolsPanel : null}
      </div>
    </div>
  );

  // ── Стейдж ────────────────────────────────────────────────────────────
  const soloCard = aloneOnStage ? (
    <div className="flex shrink-0 flex-col items-start justify-center gap-3 rounded-lg border border-border bg-card p-4 shadow-xs md:min-w-0 md:flex-1 md:gap-3.5 md:p-8">
      <span className="hidden size-10 items-center justify-center rounded-md border border-border text-foreground md:flex">
        <Users className="size-5" aria-hidden />
      </span>
      <span className="text-base font-heavy tracking-[-.02em] md:text-xl">
        {isTeacher ? "Вы пока один в уроке" : "Вы пока одни в уроке"}
      </span>
      <span className="hidden text-sm text-text-2 [text-wrap:pretty] md:block">
        {isTeacher
          ? "Отправьте ученикам ссылку — они войдут без установки приложений. Урок уже идёт."
          : "Урок продолжится, как только подключатся остальные. Пока можно проверить микрофон и камеру."}
      </span>
      <div className="flex flex-wrap gap-2">
        {isTeacher && lessonJoinPath ? (
          <Button onClick={copyJoinLink}>
            <LinkIcon aria-hidden />
            Скопировать ссылку
          </Button>
        ) : null}
        <Button variant="secondary" className="hidden md:inline-flex" onClick={openSettings}>
          <SlidersHorizontal aria-hidden />
          Проверить устройства
        </Button>
      </div>
      {isTeacher && lessonJoinPath ? (
        <span className="hidden max-w-full truncate text-[12.5px] text-text-3 md:block">
          {window.location.host}
          {lessonJoinPath}
        </span>
      ) : null}
    </div>
  ) : null;

  const stageArea = (
    <>
      {media ? (
        <StageContent
          view={stageView}
          activityId={activeActivityId}
          participants={presence.participants}
          reconnectingIds={presence.reconnectingIds}
          selfId={selfId}
          mode={lessonMode}
          lessonId={lessonId}
          canDraw={self?.permissions.canDraw ?? false}
          decks={decks}
          isTeacher={isTeacher}
          reviewSignal={reviewSignal}
          gradedSignal={gradedSignal}
          bubbles={chatBubbles}
          videoLayout={videoLayout}
          onLayoutChange={setVideoLayout}
          onShowAll={() => setDrawer("people")}
          solo={soloCard}
          onScreenShareStopped={() => pipRef.current?.close()}
          onActivityClose={() => setStageView(sharedStage)}
          onBoardClose={isTeacher ? () => changeLessonStage("people") : undefined}
        />
      ) : stageView === "board" && lessonId ? (
        <div className="min-h-0 flex-1">
          <Board
            lessonId={lessonId}
            canDraw={self?.permissions.canDraw ?? false}
            decks={decks}
            onClose={isTeacher ? () => changeLessonStage("people") : undefined}
          />
        </div>
      ) : joinFailed ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <StageBanner tone="error" icon={AlertTriangle} action={{ label: "Повторить", onClick: attemptJoin }}>
            Не удалось войти в урок — проверьте соединение.
          </StageBanner>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5">
          {/* `flex-wrap` вместо `grid md:grid-cols-3` — плитки сами переносятся
              на новую строку по реально доступной ширине стейджа (та сужается
              открытой боковой панелью), а не держат фиксированное число колонок
              по ширине всего вьюпорта, иначе на планшете они вылезали за край. */}
          <div className="flex w-full max-w-[644px] flex-wrap justify-center gap-2.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-video w-[150px] shrink-0 grow-0 rounded-2xl sm:w-[200px]" />
            ))}
          </div>
          <span className="flex items-center gap-2.5 text-sm text-text-2">
            <Loader className="size-[18px] text-primary" />
            Подключаем звук и видео…
          </span>
        </div>
      )}
    </>
  );

  // ── Меню ──────────────────────────────────────────────────────────────
  const lessonModeSub = (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={MENU_ITEM}>
        <SlidersHorizontal aria-hidden />
        Режим урока
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-56 rounded-lg p-1.5 shadow-lg">
          {Object.entries(LESSON_MODE_LABEL).map(([value, label]) => (
            <DropdownMenuItem
              key={value}
              className={MENU_ITEM}
              onSelect={() => changeLessonMode(value as LessonMode)}
            >
              <Check className={cn(lessonMode === value ? "opacity-100" : "opacity-0")} aria-hidden />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );

  const recordingItem = (
    <DropdownMenuItem className={MENU_ITEM} onSelect={openRecording}>
      <Disc aria-hidden />
      <span className="flex-1">{recordingActive ? "Остановить запись" : "Запись урока"}</span>
      {recordingActive ? (
        <span className="inline-flex h-5 items-center rounded-full bg-danger-light px-2 text-[11.5px] font-semibold text-danger">
          идёт
        </span>
      ) : null}
    </DropdownMenuItem>
  );

  const classMenuItems = isTeacher ? (
    <>
      <DropdownMenuLabel className={cn(MENU_LABEL, "pt-2.5")}>Класс</DropdownMenuLabel>
      {media ? (
        <DropdownMenuItem className={MENU_ITEM} onSelect={muteAll}>
          <MicOff aria-hidden />
          Заглушить всех
        </DropdownMenuItem>
      ) : null}
      {lessonModeSub}
      <DropdownMenuItem className={MENU_ITEM} onSelect={() => toggleDrawForAll(true)}>
        <PenLine aria-hidden />
        Разрешить рисовать всем
      </DropdownMenuItem>
      <DropdownMenuItem className={MENU_ITEM} onSelect={toggleEntryLocked}>
        {entryLocked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
        {entryLocked ? "Открыть вход" : "Закрыть вход"}
      </DropdownMenuItem>
    </>
  ) : null;

  const cameraButton = (variant: RoomControlVariant) =>
    isTeacher ? (
      <SelfCameraButton
        variant={variant}
        onOpenSettings={variant === "pill" ? openSettings : undefined}
        maxResolution={
          clientMediaSettings
            ? toVideoResolution(clientMediaSettings.cameraResolution, clientMediaSettings.cameraFps)
            : undefined
        }
        encoding={
          clientMediaSettings
            ? toVideoEncoding(clientMediaSettings.cameraFps, clientMediaSettings.cameraBitrateKbps)
            : undefined
        }
      />
    ) : (
      <SelfCameraButton
        variant={variant}
        onOpenSettings={variant === "pill" ? openSettings : undefined}
        maxResolution={VideoPresets.h360.resolution}
        disabled={!self?.permissions.canPublishVideo}
        disabledReason="Камеру включает учитель — поднимите руку"
      />
    );

  const micButton = (variant: RoomControlVariant) => (
    <SelfMicButton
      variant={variant}
      onOpenSettings={variant === "pill" ? openSettings : undefined}
      disabled={!self?.permissions.canSpeak}
      disabledReason="Микрофон выключил учитель — поднимите руку"
    />
  );

  const drawerIconButton = (mode: DrawerMode, label: string, Icon: LucideIcon, badge?: ReactNode) => (
    <SimpleTooltip content={mode === "chat" ? `${label} · C` : label} side="top">
      <button
        type="button"
        data-hotkey={mode === "chat" ? "C" : undefined}
        onClick={() => toggleDrawer(mode)}
        aria-pressed={drawer === mode}
        aria-label={label}
        className={cn(ICON_BTN, drawer === mode && "bg-surface-3 text-foreground")}
      >
        <Icon aria-hidden />
        {badge}
      </button>
    </SimpleTooltip>
  );

  // Пункты меню урока — общие для шапки телефона и колонки альбомной раскладки.
  const lessonMenuItems = (
    <>
      <DropdownMenuLabel className={MENU_LABEL}>Урок</DropdownMenuLabel>
      {!isTeacher ? (
        <DropdownMenuItem className={MENU_ITEM} onSelect={() => setDrawer("people")}>
          <Users aria-hidden />
          <span className="flex-1">Участники</span>
          <span className="text-xs text-text-3">{connectedCount}</span>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem className={MENU_ITEM} onSelect={() => setDrawer("tools")}>
        <ClipboardList aria-hidden />
        Материалы урока
      </DropdownMenuItem>
      {isTeacher ? (
        <DropdownMenuItem className={MENU_ITEM} onSelect={toggleBoard}>
          <PenLine aria-hidden />
          {stageView === "board" ? "Закрыть доску" : "Открыть доску"}
        </DropdownMenuItem>
      ) : null}
      {isTeacher ? recordingItem : null}
      {isTeacher && lessonJoinPath ? (
        <DropdownMenuItem className={MENU_ITEM} onSelect={copyJoinLink}>
          <LinkIcon aria-hidden />
          Пригласить
        </DropdownMenuItem>
      ) : null}
      {media ? (
        <DropdownMenuItem className={MENU_ITEM} onSelect={openSettings}>
          <Settings aria-hidden />
          Настройки устройств
        </DropdownMenuItem>
      ) : null}
      {classMenuItems}
    </>
  );

  // ── Телефон в альбомной ориентации ───────────────────────────────────────
  // Сцена во всю высоту, кнопки колонкой справа: шапка и два ряда кнопок
  // снизу оставляли сцене треть экрана высотой 375–390 px.
  const landscapeControls = phoneLandscape ? (
    <nav
      aria-label="Управление уроком"
      className="flex w-16 shrink-0 flex-col items-center justify-center gap-2 overflow-y-auto py-2 pl-1 pr-[max(8px,env(safe-area-inset-right))] [scrollbar-width:none]"
    >
      {media ? micButton("rail") : null}
      {media ? cameraButton("rail") : null}
      {isTeacher ? (
        <RoomControlButton
          variant="rail"
          tone="action"
          active={drawer === "people"}
          activeIcon={Users}
          inactiveIcon={Users}
          activeLabel="Участники"
          inactiveLabel="Участники"
          badge={raisedHands.length || undefined}
          onToggle={() => toggleDrawer("people")}
        />
      ) : (
        <RoomControlButton
          variant="rail"
          tone="action"
          active={self?.handRaised ?? false}
          activeIcon={Hand}
          inactiveIcon={Hand}
          activeLabel="Опустить руку"
          inactiveLabel="Поднять руку"
          hotkey="H"
          onToggle={toggleHand}
        />
      )}
      <RoomControlButton
        variant="rail"
        tone="action"
        active={drawer === "chat"}
        activeIcon={MessageSquare}
        inactiveIcon={MessageSquare}
        activeLabel="Чат"
        inactiveLabel="Чат"
        hotkey="C"
        badge={unreadChat}
        onToggle={() => toggleDrawer("chat")}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Меню урока"
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-foreground transition-colors hover:bg-surface-2 [&_svg]:size-[21px]"
          >
            <MoreHorizontal aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="left" className={cn(MENU_CONTENT, "max-h-[calc(100dvh-16px)] overflow-y-auto")}>
          {lessonMenuItems}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={leaveRoom}
        aria-label="Выйти из урока"
        title="Выйти из урока"
        className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90 [&_svg]:size-5"
      >
        <LogOut aria-hidden />
      </button>
    </nav>
  ) : null;

  const content = (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Шапка — десктоп */}
      {phoneLandscape ? null : (
      <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:flex">
        <BrandMark className="size-[30px] text-primary" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-bold leading-tight tracking-[-.02em]">
            {lessonTitle ?? "Урок"}
          </span>
          <span className="truncate text-xs leading-tight text-muted-foreground">{headerMeta}</span>
        </span>
        <StatusPill status={status} />
        <MediaLinkPill hidden={status !== "connected"} />
        {recordingActive ? <RecordingIcon /> : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isTeacher && lessonJoinPath ? (
            <Button variant="secondary" className="h-9 rounded-[10px] px-3.5 text-[13.5px]" onClick={copyJoinLink}>
              <LinkIcon aria-hidden />
              Пригласить
            </Button>
          ) : null}
          {media ? (
            <SimpleTooltip content="Настройки устройств" side="bottom">
              <button
                type="button"
                onClick={openSettings}
                aria-label="Настройки"
                className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                <Settings className="size-[18px]" aria-hidden />
              </button>
            </SimpleTooltip>
          ) : null}
        </div>
      </header>

      )}

      {/* Шапка — телефон */}
      {phoneLandscape ? null : (
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-[max(8px,env(safe-area-inset-top))] md:hidden">
        <BrandMark className="size-[26px] text-primary" />
        <span className="min-w-0 truncate text-[13.5px] font-bold">{lessonTitle ?? "Урок"}</span>
        <StatusPill status={status} compact />
        <MediaLinkPill hidden={status !== "connected"} compact />
        {recordingActive ? <RecordingIcon /> : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Меню урока"
              className="ml-auto flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-surface-3"
            >
              <MoreHorizontal className="size-[18px]" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={MENU_CONTENT}>
            {lessonMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      )}

      <div className="relative flex min-h-0 flex-1">
        {drawer && !phoneLandscape ? (
          <aside className="hidden w-[340px] shrink-0 flex-col border-r border-border bg-card md:flex">
            {drawerBody(false)}
          </aside>
        ) : null}

        {/* `Sheet` затемняет весь экран своим оверлеем независимо от CSS-классов
            содержимого — монтируем его только на узком вьюпорте. */}
        {isNarrowViewport || phoneLandscape ? (
          <Sheet open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)}>
            <SheetContent
              side={phoneLandscape ? "right" : "bottom"}
              aria-describedby={undefined}
              className={cn(
                "flex flex-col gap-0 border-0 p-0 [&>button:first-of-type]:hidden",
                phoneLandscape
                  ? "w-[min(360px,60vw)] pr-[env(safe-area-inset-right)] shadow-[-8px_0_24px_rgba(16,24,40,.18)] sm:max-w-none"
                  : "h-[min(560px,80dvh)] rounded-t-3xl shadow-[0_-8px_24px_rgba(16,24,40,.18)]",
              )}
            >
              {drawerBody(true, !phoneLandscape)}
            </SheetContent>
          </Sheet>
        ) : null}

        <main
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto",
            phoneLandscape
              ? "py-2 pl-[max(8px,env(safe-area-inset-left))] pr-1"
              : "px-3 md:gap-3 md:p-3.5",
          )}
        >
          {phoneLandscape ? (
            <div className="pointer-events-none absolute left-[max(12px,env(safe-area-inset-left))] top-3 z-30 flex items-center gap-1.5">
              <StatusPill status={status} compact />
              <MediaLinkPill hidden={status !== "connected"} compact />
              {recordingActive ? <RecordingIcon /> : null}
            </div>
          ) : null}
          {stageArea}
        </main>
        {landscapeControls}
      </div>

      {/* Футер — десктоп */}
      {phoneLandscape ? null : (
      <footer className="hidden h-[76px] shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4 md:flex">
        {/* Слева — кнопки-меню (участники/чат/материалы/⋯): были у кнопки
            «Выйти» справа, пользователь попросил поменять местами с
            таймером (2026-09-23). В отличие от таймера — навигационные,
            видны всегда, а не только от `xl`. */}
        <div className="flex min-w-[200px] shrink-0 items-center gap-1.5">
          {drawerIconButton(
            "people",
            "Участники",
            Users,
            <span className="absolute -right-px -top-px flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-3 px-[5px] text-[11px] font-bold text-text-2">
              {connectedCount}
            </span>,
          )}
          {drawerIconButton(
            "chat",
            "Чат",
            MessageSquare,
            unreadChat > 0 ? (
              <span className="absolute -right-px -top-px flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-[5px] text-[11px] font-bold text-primary-foreground">
                {unreadChat}
              </span>
            ) : null,
          )}
          {drawerIconButton("tools", "Материалы урока", ClipboardList)}
          <DropdownMenu modal={false}>
            <SimpleTooltip content="Ещё" side="top">
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Ещё" className={ICON_BTN}>
                  <MoreHorizontal aria-hidden />
                </button>
              </DropdownMenuTrigger>
            </SimpleTooltip>
            <DropdownMenuContent align="start" side="top" sideOffset={10} className={MENU_CONTENT}>
              <DropdownMenuLabel className={MENU_LABEL}>Урок</DropdownMenuLabel>
              {isTeacher ? recordingItem : null}
              <DropdownMenuItem
                className={MENU_ITEM}
                onSelect={() => setVideoLayout((l) => (l === "grid" ? "speaker" : "grid"))}
              >
                <LayoutGrid aria-hidden />
                Вид: {videoLayout === "grid" ? "сетка" : "докладчик"}
              </DropdownMenuItem>
              <DropdownMenuItem className={MENU_ITEM} onSelect={toggleFullscreen}>
                {isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
                {isFullscreen ? "Выйти из полноэкранного" : "На весь экран"}
              </DropdownMenuItem>
              {classMenuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* `overflow-x-auto` — страховка: если кнопки (mic/camera/share/
            board) всё же не помещаются (очень узкий `md`-планшет), группа
            скроллится сама в своих границах вместо наезда на соседние
            секции футера, а не расползается по всей ширине без ограничений. */}
        <div className="flex min-w-0 items-center gap-2.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {!isTeacher ? (
            <RoomControlButton
              variant="pill"
              tone="action"
              active={self?.handRaised ?? false}
              activeIcon={Hand}
              inactiveIcon={Hand}
              activeLabel="Опустить руку"
              inactiveLabel="Поднять руку"
              hotkey="H"
              onToggle={toggleHand}
            />
          ) : null}
          {media ? micButton("pill") : null}
          {media ? cameraButton("pill") : null}
          {shareVisible || isTeacher ? <span className="mx-0.5 h-8 w-px shrink-0 bg-border" aria-hidden /> : null}
          {shareVisible && lessonId ? (
            <SelfScreenShareButton
              variant="pill"
              lessonId={lessonId}
              preemptedSignal={screenSharePreempted}
              priority={isTeacher}
              encoding={
                clientMediaSettings
                  ? toScreenShareEncoding(
                      clientMediaSettings.screenShareResolution,
                      clientMediaSettings.screenShareFps,
                      clientMediaSettings.screenShareBitrateKbps,
                    )
                  : undefined
              }
              onScreenShareStarted={() => void pipRef.current?.open()}
              onScreenShareStopped={() => pipRef.current?.close()}
            />
          ) : null}
          {isTeacher ? (
            <RoomControlButton
              variant="pill"
              tone="action"
              active={stageView === "board"}
              activeIcon={PenLine}
              inactiveIcon={PenLine}
              activeLabel="Доска"
              inactiveLabel="Доска"
              onToggle={toggleBoard}
            />
          ) : null}
        </div>

        {/* Справа — таймер (был слева, поменялся местами с кнопками-меню
            выше) и «Выйти». Таймер по-прежнему скрыт ниже `xl` — необязательная
            информация, а не навигация. */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="hidden items-center gap-2.5 xl:flex">
            <span className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-3 text-[12.5px] font-semibold tabular-nums text-text-2">
              <Clock className="size-3.5" aria-hidden />
              <ElapsedClock since={sessionStartedAt} />
            </span>
            <span className="truncate text-[12.5px] text-text-3">
              Режим: {LESSON_MODE_LABEL[lessonMode].toLowerCase()}
            </span>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={leaveRoom}
            className="h-11 gap-2 rounded-full px-[18px] text-[15px] font-semibold [&_svg]:size-[19px]"
          >
            <LogOut aria-hidden />
            Выйти
          </Button>
        </div>
      </footer>

      )}

      {/* Футер — телефон */}
      {phoneLandscape ? null : (
      <footer className="flex shrink-0 flex-col gap-2.5 px-3 pb-[max(20px,env(safe-area-inset-bottom))] pt-3.5 md:hidden">
        <div className="flex items-stretch gap-2">
          {media ? micButton("tile") : null}
          {media ? cameraButton("tile") : null}
          {isTeacher ? (
            <RoomControlButton
              variant="tile"
              tone="action"
              active={drawer === "people"}
              activeIcon={Users}
              inactiveIcon={Users}
              activeLabel="Участники"
              inactiveLabel="Участники"
              onToggle={() => toggleDrawer("people")}
            />
          ) : (
            <RoomControlButton
              variant="tile"
              tone="action"
              active={self?.handRaised ?? false}
              activeIcon={Hand}
              inactiveIcon={Hand}
              activeLabel="Опустить руку"
              inactiveLabel="Поднять руку"
              caption="Рука"
              hotkey="H"
              onToggle={toggleHand}
            />
          )}
          <RoomControlButton
            variant="tile"
            tone="action"
            active={drawer === "chat"}
            activeIcon={MessageSquare}
            inactiveIcon={MessageSquare}
            activeLabel="Чат"
            inactiveLabel="Чат"
            hotkey="C"
            badge={unreadChat}
            onToggle={() => toggleDrawer("chat")}
          />
        </div>
        <button
          type="button"
          onClick={leaveRoom}
          className="flex h-12 items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-card text-[15px] font-semibold text-destructive transition-colors hover:bg-destructive/5"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Выйти из урока
        </button>
      </footer>
      )}

      {media ? <DeviceSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} /> : null}

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{removeTarget?.fullName}» из урока?</AlertDialogTitle>
            <AlertDialogDescription>
              Ученик сразу выйдет из урока и не сможет вернуться с этого устройства. Войти по ссылке
              заново под другим именем он сможет, пока вход не закрыт.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) void removeParticipant(removeTarget.userId);
                setRemoveTarget(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mediaTakenOver ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6">
          <div
            role="alertdialog"
            aria-live="assertive"
            className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-lg"
          >
            <h2 className="text-lg font-bold tracking-tight">Урок открыт в другом окне</h2>
            <p className="text-sm text-text-2 [text-wrap:pretty]">
              Вы вошли в этот урок с другой вкладки или устройства, поэтому здесь звук и видео выключены.
            </p>
            <Button
              className="h-9 px-3.5 text-sm"
              onClick={() => {
                setMediaTakenOver(false);
                setMediaResumeSignal((n) => n + 1);
              }}
            >
              Продолжить здесь
            </Button>
          </div>
        </div>
      ) : null}

      {/* Только WS-канал (`status`), НЕ LiveKit-медиа — оно продолжает
          работать под оверлеем, урок не прерывается. */}
      {status === "reconnecting" && longReconnect && everConnectedRef.current ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6">
          <div
            role="alertdialog"
            aria-live="assertive"
            className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-lg"
          >
            <Loader className="size-8 text-warning" />
            <h2 className="text-lg font-bold tracking-tight">Связь прервалась — переподключаемся</h2>
            <p className="text-sm text-text-2 [text-wrap:pretty]">
              Урок продолжается. Вы вернётесь автоматически, выходить не нужно.
            </p>
            <Button variant="secondary" className="h-9 px-3.5 text-sm" onClick={leaveRoom}>
              Выйти из урока
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (blocked) {
    return (
      <StatusScreen>
        <Empty className="p-0 md:p-0">
          <EmptyHeader>
            <EmptyTitle as="h1">{blocked.title}</EmptyTitle>
            <EmptyDescription>{blocked.text}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </StatusScreen>
    );
  }

  if (leftAsGuest) {
    return (
      <StatusScreen>
        <Empty className="p-0 md:p-0">
          <EmptyHeader>
            <EmptyTitle as="h1">Вы вышли из урока</EmptyTitle>
            <EmptyDescription>Если вышли случайно — вернитесь, урок продолжается.</EmptyDescription>
          </EmptyHeader>
          {/* Гостевая сессия этого урока (кука) ещё жива: перезагрузка снова
              проверит её на сервере (удалён, вход закрыт, ссылка сменилась —
              покажет причину) и откроет проверку устройств. Чужой урок так не
              открыть: доступ решает кука, а не id в адресе. */}
          <Button className="h-11 px-5 text-[15px]" onClick={() => window.location.reload()}>
            Вернуться в урок
          </Button>
        </Empty>
      </StatusScreen>
    );
  }

  if (!deviceCheckDone) {
    return (
      <DeviceCheckScreen
        lessonTitle={lessonTitle}
        defaultCameraOn={isTeacher}
        onContinue={(r: DeviceCheckResult) => {
          setMicDeviceId(r.micDeviceId);
          setCamDeviceId(r.camDeviceId);
          setSpkDeviceId(r.spkDeviceId);
          setJoinMicEnabled(r.micEnabled);
          setJoinCamEnabled(r.camEnabled);
          writeRejoinState({
            mic: r.micEnabled,
            cam: r.camEnabled,
            micId: r.micDeviceId,
            camId: r.camDeviceId,
            spkId: r.spkDeviceId,
          });
          setDeviceCheckDone(true);
        }}
      />
    );
  }

  if (!media) return <TooltipProvider>{content}</TooltipProvider>;

  return (
    <TooltipProvider>
      <LiveKitRoom
        serverUrl={media.url}
        token={media.token}
        connect
        options={buildRoomOptions(clientMediaSettings)}
        connectOptions={MEDIA_CONNECT_OPTIONS}
        audio={
          self?.permissions.canSpeak && joinMicEnabled
            ? {
                deviceId: micDeviceId ?? undefined,
                // Параметры школы (§10.10 ТЗ) — мягкий дефолт «высокое
                // качество звука» (стерео); участник не переопределяет
                // явно, но выбор устройства (deviceId) остаётся его.
                channelCount: clientMediaSettings?.micHighQuality ? 2 : undefined,
                // Шумоподавление — клиентский DSP-фильтр браузера, по
                // умолчанию включено школой (см. school-settings.ts).
                noiseSuppression: clientMediaSettings?.noiseSuppressionEnabled ?? true,
              }
            : false
        }
        // Э5.1/Э5.4/Э6.1 — см. историю в git; логика неизменна. joinCamEnabled —
        // Э11: с каким состоянием камеры участник нажал «Присоединиться».
        // Ученику — если учитель разрешил камеру (настройка урока): включённая
        // на экране проверки камера раньше молча оставалась выключенной.
        video={
          joinCamEnabled && (isTeacher || self?.permissions.canPublishVideo)
            ? {
                resolution: !isTeacher
                  ? VideoPresets.h360.resolution
                  : clientMediaSettings
                    ? toVideoResolution(clientMediaSettings.cameraResolution, clientMediaSettings.cameraFps)
                    : VideoPresets.h720.resolution,
                deviceId: camDeviceId ?? undefined,
              }
            : false
        }
        // Разрыв аудио не показываем баннером — состояние видно на самой
        // кнопке микрофона, плюс индикатор связи в шапке. Обрыв, который
        // LiveKit не пережил сам, чинит `MediaRecovery` ниже.
        onError={handleLiveKitError}
      >
        {lessonId ? <MediaTelemetry lessonId={lessonId} /> : null}
        <MediaDeviceErrorNotice />
        <RoomHotkeys />
        <ApplyAudioOutput deviceId={spkDeviceId} />
        <MicSync enabled={self?.permissions.canSpeak ?? false} />
        <VideoSubscriptionManager participants={participants} mode={lessonMode} />
        <PoorLinkMediaAdapter />
        <PrefetchStageWhenMediaUp />
        {lessonId ? (
          <MediaRecovery
            lessonId={lessonId}
            restoreCamera={(participant) =>
              isTeacher && clientMediaSettings
                ? participant.setCameraEnabled(
                    true,
                    {
                      resolution: toVideoResolution(clientMediaSettings.cameraResolution, clientMediaSettings.cameraFps),
                      deviceId: camDeviceId ?? undefined,
                    },
                    { videoEncoding: toVideoEncoding(clientMediaSettings.cameraFps, clientMediaSettings.cameraBitrateKbps) },
                  )
                : participant.setCameraEnabled(true, {
                    resolution: isTeacher ? VideoPresets.h720.resolution : VideoPresets.h360.resolution,
                    deviceId: camDeviceId ?? undefined,
                  })
            }
            onRejoined={(data) => setParticipants(data.participants)}
            onBlocked={(err) => {
              const screen = blockedScreenFor(err);
              if (screen) setBlocked(screen);
              return screen !== null;
            }}
            onTakenOver={() => setMediaTakenOver(true)}
            resumeSignal={mediaResumeSignal}
            initialWanted={rejoin ? { camera: rejoin.cam, microphone: rejoin.mic } : undefined}
            onWantedChange={(w) => {
              writeRejoinState({ cam: w.camera, mic: w.microphone });
              // `audio`/`video` у `<LiveKitRoom>` применяются при каждом новом
              // подключении (вход заново в `MediaRecovery`, «Продолжить
              // здесь»). С выбором экрана проверки там выключенный за урок
              // микрофон или камера включались сами.
              setJoinMicEnabled(w.microphone);
              setJoinCamEnabled(w.camera);
            }}
          />
        ) : null}
        {clientMediaSettings?.pipEnabled !== false ? (
          <ScreenShareAutoPip
            ref={pipRef}
            participants={participants}
            selfId={selfId}
            lessonId={lessonId}
            isTeacher={isTeacher}
            handRaised={self?.handRaised ?? false}
            onToggleHand={toggleHand}
            onLeave={leaveRoom}
          />
        ) : null}
        {content}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </TooltipProvider>
  );
}

/**
 * Метка связи — только когда со связью что-то не так. «На связи» не
 * показываем: это обычное состояние, метка лишь мозолила глаза.
 */
function StatusPill({ status, compact = false }: { status: SocketStatusLike; compact?: boolean }) {
  if (status === "connected") return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold",
        compact ? "h-[22px] gap-[5px] px-2 text-[11px]" : "ml-2 h-[26px] gap-1.5 px-2.5 text-xs",
        STATUS_TONE[status],
      )}
    >
      <span
        className={cn(
          "rounded-full bg-current",
          compact ? "size-[5px]" : "size-1.5",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Сколько медиа должно быть без связи, чтобы показать метку (короткий джиттер — не повод). */
const MEDIA_PILL_DELAY_MS = 4000;
/** Первое подключение медиа на нормальной сети — 1–3 с; дольше — пора сказать. */
const MEDIA_FIRST_CONNECT_PILL_DELAY_MS = 12_000;

/**
 * Доска и задания докачиваются заранее (`prefetchLessonStage`), но только когда
 * звук и видео уже подключились: на медленной сети ~575 КБ кусков иначе
 * делили канал с `/join`, подключением LiveKit и первыми секундами медиа.
 * Только наблюдение за состоянием комнаты — на подключение LiveKit не
 * влияет. Если доска или задание уже на экране, их кусок грузится сам, не
 * дожидаясь этого. Если медиа так и не подключилось, куски загрузятся по
 * требованию при показе.
 */
function PrefetchStageWhenMediaUp() {
  const room = useMaybeRoomContext();
  useEffect(() => {
    if (!room) return;
    const update = () => {
      if (room.state !== ConnectionState.Connected) return;
      room.off(RoomEvent.ConnectionStateChanged, update);
      prefetchLessonStage();
    };
    room.on(RoomEvent.ConnectionStateChanged, update);
    update();
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, update);
    };
  }, [room]);
  return null;
}

/**
 * Звук и видео сейчас не идут: LiveKit переподключается или отключился, а
 * канал урока при этом жив. Раньше в этом состоянии не было видно ничего —
 * кнопка «Микрофон» горела, а собеседника не было слышно до ~50 с
 * (E2E 2026-10-04, профиль 64 кбит/с). Метка — только по фактическому
 * состоянию комнаты LiveKit; когда канал урока тоже рвётся, место занимает
 * `StatusPill`. Если медиа не подключилось с самого входа (UDP закрыт,
 * медленная сеть), метка появляется позже и говорит «подключаем», а не
 * «восстанавливаем» — плитки с аватарами без звука иначе выглядели как урок,
 * в котором просто все молчат.
 */
function MediaLinkPill({ hidden, compact = false }: { hidden: boolean; compact?: boolean }) {
  const room = useMaybeRoomContext();
  const [down, setDown] = useState<null | "connecting" | "restoring">(null);
  useEffect(() => {
    if (!room) return;
    let everConnected = room.state === ConnectionState.Connected;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (room.state === ConnectionState.Connected) {
        everConnected = true;
        if (timer) clearTimeout(timer);
        timer = null;
        setDown(null);
        return;
      }
      if (timer) return;
      const kind = everConnected ? "restoring" : "connecting";
      timer = setTimeout(
        () => setDown(kind),
        everConnected ? MEDIA_PILL_DELAY_MS : MEDIA_FIRST_CONNECT_PILL_DELAY_MS,
      );
    };
    room.on(RoomEvent.ConnectionStateChanged, update);
    update();
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, update);
      if (timer) clearTimeout(timer);
    };
  }, [room]);
  if (!down || hidden) return null;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold",
        compact ? "h-[22px] gap-[5px] px-2 text-[11px]" : "ml-2 h-[26px] gap-1.5 px-2.5 text-xs",
        STATUS_TONE.reconnecting,
      )}
    >
      <span className={cn("rounded-full bg-current", compact ? "size-[5px]" : "size-1.5")} />
      {down === "connecting" ? "Подключаем звук и видео…" : "Восстанавливаем звук и видео…"}
    </span>
  );
}

/** Минуты:секунды с `since`; тикает сам, не перерисовывая страницу урока. */
function ElapsedClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`}</>;
}

/** Идёт запись: спокойная иконка в стиле проекта вместо красной пилюли. */
function RecordingIcon() {
  return (
    <SimpleTooltip content="Идёт запись урока" side="bottom">
      <span role="status" className="flex size-7 shrink-0 items-center justify-center rounded-[9px] text-destructive">
        <Disc className="size-[17px]" aria-hidden />
        <span className="sr-only">Идёт запись урока</span>
      </span>
    </SimpleTooltip>
  );
}

function StageBanner({
  tone,
  icon: Icon,
  children,
  action,
}: {
  tone: "info" | "warn" | "error";
  icon: LucideIcon;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13.5px] text-foreground shadow-xs",
      )}
    >
      <Icon
        className={cn(
          "size-[17px] shrink-0",
          tone === "info" && "text-primary",
          tone === "warn" && "text-warning",
          tone === "error" && "text-destructive",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 [text-wrap:pretty]">{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="h-[30px] shrink-0 rounded-[9px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Поднятые руки по порядку: учитель видит, кто первый, кто следующий и кому
 * слово уже дано. Опустить можно одну руку или все сразу.
 */
function HandsQueue({
  hands,
  onGiveWord,
  onLower,
  onLowerAll,
}: {
  hands: ParticipantSnapshot[];
  onGiveWord: (userId: string) => void;
  onLower: (userId: string) => void;
  onLowerAll: () => void;
}) {
  const smallBtn =
    "h-7 shrink-0 rounded-full border border-border bg-card px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2";
  return (
    <section aria-label="Поднятые руки" className="mx-2 mt-2 flex flex-col gap-1 rounded-[10px] border border-border bg-surface-2 p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-2">
          <Hand className="size-3.5 text-warning" aria-hidden />
          Руки · {hands.length}
        </span>
        <button type="button" onClick={onLowerAll} className={smallBtn}>
          Опустить все
        </button>
      </div>
      <ol className="flex flex-col gap-0.5">
        {hands.map((p, i) => (
          <li key={p.userId} className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5">
            <span className="w-5 shrink-0 text-center text-[13px] font-bold tabular-nums text-text-2">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.fullName}</span>
            {p.permissions.canSpeak ? (
              <span className="shrink-0 text-xs text-text-2">слово дано</span>
            ) : (
              <button type="button" onClick={() => onGiveWord(p.userId)} className={smallBtn}>
                Дать слово
              </button>
            )}
            <SimpleTooltip content="Опустить руку">
              <button
                type="button"
                onClick={() => onLower(p.userId)}
                aria-label={`Опустить руку: ${p.fullName}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-2 [&_svg]:size-4"
              >
                <X aria-hidden />
              </button>
            </SimpleTooltip>
          </li>
        ))}
      </ol>
    </section>
  );
}

type PeopleListProps = {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  isTeacher: boolean;
  hasMedia: boolean;
  query: string;
  micOffIds?: Set<string>;
  reconnectingIds?: ReadonlySet<string>;
  weakIds?: Set<string>;
  onTogglePermission: (userId: string, key: PermissionKey, value: boolean) => void;
  onMute: (userId: string) => void;
  onTogglePin: (userId: string, pinned: boolean) => void;
  onRemove: (participant: ParticipantSnapshot) => void;
};

/** Список участников с живым состоянием микрофона/связи из LiveKit (только внутри `<LiveKitRoom>`). */
function LivePeopleList(props: PeopleListProps) {
  const roomParticipants = useParticipants();
  const micOffIds = new Set(
    roomParticipants.filter((p) => !p.isMicrophoneEnabled).map((p) => p.identity),
  );
  const weakIds = new Set(
    roomParticipants
      .filter(
        (p) =>
          p.connectionQuality === ConnectionQuality.Poor ||
          p.connectionQuality === ConnectionQuality.Lost,
      )
      .map((p) => p.identity),
  );
  return <PeopleList {...props} micOffIds={micOffIds} weakIds={weakIds} />;
}

function PeopleList({
  participants,
  selfId,
  isTeacher,
  hasMedia,
  query,
  micOffIds,
  reconnectingIds,
  weakIds,
  onTogglePermission,
  onMute,
  onTogglePin,
  onRemove,
}: PeopleListProps) {
  const { id: lessonId } = useParams<{ id: string }>();
  const q = query.trim().toLowerCase();
  const rows = participants
    .filter((p) => !q || p.fullName.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.userId === selfId) return -1;
      if (b.userId === selfId) return 1;
      if (a.handRaised !== b.handRaised) return a.handRaised ? -1 : 1;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

  if (rows.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-muted-foreground">Никого не нашли</p>;
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2.5 pt-1.5">
      {rows.map((p) => {
        const isSelf = p.userId === selfId;
        const weak = weakIds?.has(p.userId) ?? false;
        const roleLabel = p.kind === "staff" && p.role ? ROLE_LABEL[p.role] : undefined;
        const hint = isSelf
          ? isTeacher
            ? "вы · ведёт урок"
            : "вы"
          : !p.connected
            ? "не в уроке"
            : reconnectingIds?.has(p.userId)
              ? "переподключается…"
              : p.handRaised
              ? "поднял(а) руку"
              : weak
                ? "плохая связь"
                : null;
        return (
          <div
            key={p.userId}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] p-2 transition-colors hover:bg-surface-2",
              !p.connected && "opacity-60",
            )}
          >
            <UserAvatar colorKey={participantColorKey(p, lessonId)} role={markRoleOf(p.kind, p.role)} size={32} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">{p.fullName}</span>
                {roleLabel ? (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-primary-light px-[7px] text-[11px] font-semibold text-primary">
                    {roleLabel}
                  </span>
                ) : null}
                {p.handRaised ? <Hand className="size-3.5 shrink-0 text-warning" aria-label="Поднята рука" /> : null}
                {p.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label="Закреплён" /> : null}
              </span>
              {hint ? <span className="truncate text-xs text-text-3">{hint}</span> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-text-3">
              {p.connected && micOffIds?.has(p.userId) ? (
                <MicOff className="size-[15px]" aria-label="Микрофон выключен" />
              ) : null}
              {weak ? <SignalLow className="size-[15px] text-warning" aria-label="Плохая связь" /> : null}
              {isTeacher && !isSelf ? (
                <ParticipantMenu
                  participant={p}
                  hasMedia={hasMedia}
                  onTogglePermission={onTogglePermission}
                  onMute={onMute}
                  onTogglePin={onTogglePin}
                  onRemove={onRemove}
                />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** С этой ширины окна у ученика с заданием камеры стоят рейлом справа от учебника. */
const STUDENT_RAIL_MIN_WIDTH = 1360;

/**
 * Э12.7 §6.2 — контент стейджа при активном LiveKit (использует `useTracks`).
 *  - активная демонстрация экрана показывается поверх плиток И доски;
 *  - явно выданное задание (`view === "activity"`) демонстрацией НЕ перебиваем;
 *  - плитки: рядом с демонстрацией/доской/заданием — лентой, иначе сеткой.
 */
function StageContent({
  view,
  activityId,
  participants,
  reconnectingIds,
  selfId,
  mode,
  lessonId,
  canDraw,
  decks,
  isTeacher,
  reviewSignal,
  gradedSignal,
  bubbles,
  videoLayout = "grid",
  onLayoutChange,
  onShowAll,
  solo,
  onScreenShareStopped,
  onActivityClose,
  onBoardClose,
}: {
  view: "people" | "board" | "activity";
  activityId: string | null;
  participants: ParticipantSnapshot[];
  reconnectingIds: ReadonlySet<string>;
  selfId: string | undefined;
  mode: LessonMode;
  lessonId: string | undefined;
  canDraw: boolean;
  decks: Deck[];
  isTeacher: boolean;
  reviewSignal: number;
  gradedSignal: number;
  bubbles: ReadonlyMap<string, string>;
  videoLayout?: "grid" | "speaker";
  onLayoutChange: (layout: "grid" | "speaker") => void;
  onShowAll: () => void;
  /** Блок «Вы пока один» рядом с плиткой. */
  solo: ReactNode;
  onScreenShareStopped: () => void;
  onActivityClose: () => void;
  onBoardClose: (() => void) | undefined;
}) {
  // Опубликованная, а не только подписанная: сцена сразу переключается на
  // демонстрацию, и пока она грузится, `ScreenShareTile` показывает лоадер.
  const screenSharing =
    useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).length > 0;
  const studentRail = useMinViewportWidth(STUDENT_RAIL_MIN_WIDTH);

  const main =
    view === "activity" && activityId ? (
      <ActivityStage
        activityId={activityId}
        isTeacher={isTeacher}
        reviewSignal={reviewSignal}
        gradedSignal={gradedSignal}
        onClose={onActivityClose}
      />
    ) : screenSharing ? (
      <div className="flex h-full min-h-0 flex-col gap-2.5">
        <ScreenShareStatusBar lessonId={lessonId} participants={participants} onStopped={onScreenShareStopped} />
        <div className="min-h-0 flex-1">
          <ScreenShareTile />
        </div>
      </div>
    ) : view === "board" && lessonId ? (
      <Board lessonId={lessonId} canDraw={canDraw} decks={decks} onClose={onBoardClose} />
    ) : (
      <RoomVideoGrid
        participants={participants}
        reconnectingIds={reconnectingIds}
        selfId={selfId}
        mode={mode}
        layout={videoLayout}
        onLayoutChange={onLayoutChange}
        onShowAll={onShowAll}
        bubbles={bubbles}
      />
    );

  // Ученик с заданием: учебник на весь стейдж (разворот), как в макете
  // «Учебник ученика». Камера учителя — в рейле справа, если окно не уже
  // 1360px; иначе — плавающим окном поверх угла учебника (и на телефоне
  // вместо ленты плиток под ним, которая съедала высоту страницы).
  if (view === "activity" && activityId && !isTeacher) {
    return (
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 min-w-0 flex-1">
          {main}
          {studentRail ? null : (
            <RoomVideoGrid participants={participants} reconnectingIds={reconnectingIds} selfId={selfId} variant="pip" bubbles={bubbles} />
          )}
        </div>
        {studentRail ? (
          <RoomVideoGrid participants={participants} reconnectingIds={reconnectingIds} selfId={selfId} mode={mode} variant="rail" onShowAll={onShowAll} bubbles={bubbles} />
        ) : null}
      </div>
    );
  }

  const railed =
    (view === "activity" && activityId) || screenSharing || (view === "board" && lessonId);

  if (!railed) {
    if (solo) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:items-stretch md:gap-3.5">
          <div className="min-h-0 min-w-0 flex-1 md:flex-[1.5]">{main}</div>
          {solo}
        </div>
      );
    }
    return <div className="min-h-0 flex-1">{main}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row md:gap-3">
      <div className="min-h-0 min-w-0 flex-1">{main}</div>
      <RoomVideoGrid participants={participants} reconnectingIds={reconnectingIds} selfId={selfId} mode={mode} variant="rail" onShowAll={onShowAll} bubbles={bubbles} />
    </div>
  );
}

/**
 * Применяет выбранное на экране проверки устройство вывода звука к комнате
 * LiveKit (Э11). `setSinkId` под капотом — тихо игнорируется браузерами без
 * поддержки; сбой выбора не должен ронять урок (§1.2 ТЗ).
 */
function ApplyAudioOutput({ deviceId }: { deviceId: string | null }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!deviceId) return;
    void room.switchActiveDevice("audiooutput", deviceId).catch(() => undefined);
  }, [room, deviceId]);
  return null;
}
