import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionQuality, Track, VideoPresets, type RoomOptions } from "livekit-client";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  Disc,
  GraduationCap,
  Hand,
  LayoutGrid,
  Link as LinkIcon,
  LogOut,
  Maximize,
  MessageSquare,
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
import { apiFetch, setGuestMode } from "@/shared/api-client";
import { useGuestSessionStore } from "@/features/guest/guest-session-store";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Skeleton } from "@/shared/ui/skeleton";
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
import { SimpleTooltip, TooltipProvider } from "@/shared/ui/tooltip";
import { Board } from "../canvas/Board.js";
import { DeckPanel } from "../decks/DeckPanel.js";
import { listLessonActivities } from "../materials/activity-api.js";
import { LessonActivityPanel } from "../materials/LessonActivityPanel.js";
import { ActivityStage } from "./ActivityStage.js";
import { RecordingConsentBanner, RecordingPanel } from "../recordings/RecordingPanel.js";
import { playRecordingSound } from "./recording-sound.js";
import { SelfCameraButton, VideoDegradeSuggestion } from "./CameraControls.js";
import { toScreenShareEncoding, toVideoEncoding, toVideoResolution } from "./media-quality.js";
import { PacketLossWarning } from "./ConnectionQuality.js";
import { DeviceCheckScreen, type DeviceCheckResult } from "./DeviceCheckScreen.js";
import { DeviceSettingsModal } from "./DeviceSettingsModal.js";
import { formatClock, participantsCount } from "./format.js";
import { ScreenShareAutoPip, type ScreenShareAutoPipHandle } from "./ScreenShareAutoPip.js";
import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";
import { useRoomIdentity } from "./use-room-identity.js";
import { useIsNarrowViewport } from "./use-narrow-viewport.js";
import { SelfMicButton } from "./MicControls.js";
import { MicSync } from "./MicSync.js";
import { ParticipantMenu } from "./ParticipantMenu.js";
import { ScreenShareStatusBar, SelfScreenShareButton } from "./ScreenShareControls.js";
import { RoomVideoGrid } from "./RoomVideoGrid.js";
import { ScreenShareTile } from "./ScreenShareTile.js";
import { useRoomSocket } from "./useRoomSocket.js";
import { VideoSubscriptionManager } from "./VideoSubscriptions.js";

// Э5.1/Э5.2 — см. подробные комментарии ниже у <LiveKitRoom>. 720p + simulcast,
// adaptiveStream/dynacast включены явно (в livekit-client по умолчанию off).
// Дефолт на время, пока `clientMediaSettings` ещё не загружены (см. `buildRoomOptions`).
const FALLBACK_ROOM_OPTIONS: RoomOptions = {
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: { simulcast: true },
  adaptiveStream: true,
  dynacast: true,
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
    publishDefaults: {
      simulcast: true,
      videoEncoding: toVideoEncoding(settings.cameraFps, settings.cameraBitrateKbps),
    },
    adaptiveStream: true,
    dynacast: true,
  };
}

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

const MENU_CONTENT = "w-[280px] rounded-2xl p-1.5 shadow-lg";
const MENU_ITEM = "h-9 gap-2.5 rounded-[10px] px-2.5 text-sm [&>svg]:text-muted-foreground";
const MENU_LABEL = "px-2.5 pb-1 pt-2 text-[11.5px] font-bold uppercase tracking-[.07em] text-text-3";
const ICON_BTN =
  "relative flex size-11 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-surface-3 hover:text-foreground [&_svg]:size-5";

type PermissionKey = "canDraw" | "canSpeak" | "canShareScreen" | "canPublishVideo";

export function RoomPage() {
  const { id: lessonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const identity = useRoomIdentity();
  const guestSession = useGuestSessionStore((s) => s.session);
  const clearGuestSession = useGuestSessionStore((s) => s.clearSession);
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
  const [chatSeen, setChatSeen] = useState(0);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [deckStatuses, setDeckStatuses] = useState<Record<string, DeckProgressEvent>>({});
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [reviewSignal, setReviewSignal] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinFailed, setJoinFailed] = useState(false);
  const [media, setMedia] = useState<MediaConnection | null>(null);
  const [clientMediaSettings, setClientMediaSettings] = useState<ClientMediaSettings | null>(null);
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [camDeviceId, setCamDeviceId] = useState<string | null>(null);
  const [spkDeviceId, setSpkDeviceId] = useState<string | null>(null);
  const [joinMicEnabled, setJoinMicEnabled] = useState(true);
  const [joinCamEnabled, setJoinCamEnabled] = useState(true);
  const [lessonTitle, setLessonTitle] = useState<string | null>(null);
  const [lessonJoinPath, setLessonJoinPath] = useState<string | null>(null);
  const [lessonStart, setLessonStart] = useState<string | null>(null);
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoLayout, setVideoLayout] = useState<"grid" | "speaker">("grid");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isNarrowViewport = useIsNarrowViewport();
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
  // датированы в прошлом), сбрасывается при переприсоединении.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!media) return;
    const startedAt = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [media]);
  const elapsedLabel = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  const isTeacher = identity?.role === "teacher" || identity?.role === "admin";

  const handleMessage = useCallback((message: ServerRoomMessage) => {
    switch (message.type) {
      case "presence":
        recordingActivePrevRef.current = null;
        setParticipants(message.participants);
        break;
      case "participant_joined":
        setParticipants((prev) => [
          ...prev.filter((p) => p.userId !== message.participant.userId),
          message.participant,
        ]);
        break;
      case "participant_left":
        setParticipants((prev) => prev.filter((p) => p.userId !== message.userId));
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
          prev.map((p) => (p.userId === message.userId ? { ...p, handRaised: message.raised } : p)),
        );
        break;
      case "participant_pinned":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, pinned: message.pinned } : p)),
        );
        break;
      case "chat_message":
        setChat((prev) => [...prev, message.message]);
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
      case "recording_status": {
        const prev = recordingActivePrevRef.current;
        if (prev !== null && prev !== message.active) playRecordingSound(message.active);
        recordingActivePrevRef.current = message.active;
        setRecordingActive(message.active);
        break;
      }
      case "screen_share_preempted":
        if (message.userId === selfIdRef.current) setScreenSharePreempted((n) => n + 1);
        break;
      case "error":
        setError(message.message);
        break;
    }
  }, []);

  const status = useRoomSocket(
    lessonId ?? "",
    handleMessage,
    deviceCheckDone,
    isGuest ? "guest" : "staff",
  );

  // Оверлей переподключения — только если WS уже был `connected` хотя бы
  // раз: на самом первом подключении место занимает экран загрузки.
  const everConnectedRef = useRef(false);
  if (status === "connected") everConnectedRef.current = true;

  const attemptJoin = useCallback(() => {
    if (!lessonId) return;
    setJoinFailed(false);
    apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" })
      .then((data) => {
        setParticipants(data.participants);
        setLessonMode(data.lessonMode);
        setMedia(data.media);
        setClientMediaSettings(data.clientMediaSettings);
        setSharedStage(data.stage);
        setStageView((v) => (v === "activity" ? v : data.stage));
      })
      .catch(() => setJoinFailed(true));
  }, [lessonId]);

  useEffect(() => {
    if (!lessonId || !deviceCheckDone) return;
    attemptJoin();

    apiFetch<{ items: ChatMessage[] }>(`/lessons/${lessonId}/chat`)
      .then((data) => {
        setChat([...data.items].reverse());
        setChatSeen(data.items.length);
      })
      .catch(() => undefined);
  }, [lessonId, deviceCheckDone, attemptJoin]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, drawer]);

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
    apiFetch<LessonSummary>(`/lessons/${lessonId}`)
      .then((l) => {
        setLessonTitle(l.title);
        setLessonJoinPath(l.joinPath);
        setLessonStart(l.scheduledAt);
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
    apiFetch<{ decks: Deck[] }>(`/lessons/${lessonId}/decks`)
      .then((data) => setDecks(data.decks))
      .catch(() => undefined);
  }, [lessonId]);

  useEffect(() => {
    refreshDecks();
  }, [refreshDecks]);

  useEffect(() => {
    if (!lessonId) return;
    listLessonActivities(lessonId)
      .then((data) => {
        const latest = data.items[0];
        if (latest) setActiveActivityId((prev) => prev ?? latest.id);
      })
      .catch(() => undefined);
  }, [lessonId]);

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

  async function leaveRoom() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/leave`, { method: "POST" }).catch(() => undefined);
    if (isGuest) {
      // У гостя нет /lessons и личного кабинета — показываем экран выхода.
      setGuestMode(false);
      clearGuestSession();
      setLeftAsGuest(true);
      return;
    }
    navigate("/lessons");
  }

  async function toggleHand() {
    if (!lessonId || !self) return;
    await apiFetch(`/lessons/${lessonId}/hand-raise`, {
      method: "POST",
      body: JSON.stringify({ raised: !self.handRaised }),
    }).catch(() => undefined);
  }

  async function togglePermission(userId: string, key: PermissionKey, value: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ [key]: value }),
    }).catch((e) => setError(e instanceof Error ? e.message : "Не удалось изменить права"));
  }

  async function muteParticipant(userId: string) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/mute`, { method: "POST" }).catch(() =>
      setError("Не удалось заглушить участника"),
    );
  }

  async function muteAll() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/mute-all`, { method: "POST" }).catch(() =>
      setError("Не удалось заглушить всех участников"),
    );
  }

  /** Э6.3, §5.3 ТЗ. */
  async function togglePin(userId: string, pinned: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/participants/${userId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }).catch(() => setError("Не удалось закрепить участника"));
  }

  /** Э6.4, §5.3 ТЗ. */
  async function changeLessonMode(mode: LessonMode) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }).catch(() => setError("Не удалось изменить режим урока"));
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
    }).catch(() => setError("Не удалось переключить стейдж"));
  }
  const toggleBoard = () => changeLessonStage(stageView === "board" ? "people" : "board");

  /** Э3.8. */
  async function toggleDrawForAll(canDraw: boolean) {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/draw-all`, {
      method: "POST",
      body: JSON.stringify({ canDraw }),
    }).catch(() => setError("Не удалось изменить право рисования"));
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!lessonId || !chatDraft.trim()) return;
    const body = chatDraft;
    setChatDraft("");
    await apiFetch(`/lessons/${lessonId}/chat`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }).catch(() => setError("Сообщение не отправлено"));
  }

  const openSettings = () => setSettingsOpen(true);
  const openRecording = () => {
    setDrawer("tools");
    setActiveTool("recording");
  };

  const connectedCount = participants.filter((p) => p.connected).length;
  const aloneOnStage = media !== null && stageView === "people" && connectedCount <= 1;
  const raisedHands = participants.filter((p) => p.handRaised && p.connected && p.userId !== selfId);
  const unreadChat = drawer === "chat" ? 0 : Math.max(0, chat.length - chatSeen);
  const headerMeta = lessonStart
    ? `начало ${formatClock(lessonStart)} · ${participantsCount(connectedCount)}`
    : participantsCount(connectedCount);
  const shareVisible =
    media !== null &&
    Boolean(lessonId) &&
    (isTeacher || Boolean(self?.permissions.canShareScreen)) &&
    clientMediaSettings?.screenShareEnabled !== false;

  // ── Панель «Участники» ────────────────────────────────────────────────
  const peopleListProps: PeopleListProps = {
    participants,
    selfId,
    isTeacher,
    hasMedia: media !== null,
    query: peopleQuery,
    onTogglePermission: togglePermission,
    onMute: muteParticipant,
    onTogglePin: togglePin,
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
          <span className="text-xs font-bold uppercase tracking-[.07em] text-text-3">
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
        {media ? <LivePeopleList {...peopleListProps} /> : <PeopleList {...peopleListProps} />}
      </ScrollArea>
    </div>
  );

  // ── Панель «Чат» ──────────────────────────────────────────────────────
  const chatPanel = (sheet: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {chat.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-7 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-light text-primary">
            <MessageSquare className="size-5" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold">Сообщений пока нет</span>
          <span className="text-[13px] text-muted-foreground [text-wrap:pretty]">
            Напишите вопрос — его увидит весь класс. Учитель отвечает, не прерывая объяснение.
          </span>
        </div>
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
    hint?: string;
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
      hint: recordingActive ? `идёт запись · ${elapsedLabel}` : "начать запись",
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
              className="flex items-center gap-3 rounded-2xl px-2.5 py-[11px] text-left transition-colors hover:bg-surface-2"
            >
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
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

  const drawerBody = (sheet: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      {sheet ? (
        <>
          <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
            <span className="h-1 w-[38px] rounded-full bg-border" />
          </div>
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
    <div className="flex shrink-0 flex-col items-start justify-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs md:min-w-0 md:flex-1 md:gap-3.5 md:p-8">
      <span className="hidden size-11 items-center justify-center rounded-full bg-primary-light text-primary md:flex">
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
        <span className="hidden max-w-full truncate font-mono text-[12.5px] text-text-3 md:block">
          {window.location.host}
          {lessonJoinPath}
        </span>
      ) : null}
    </div>
  ) : null;

  const stageArea = (
    <>
      {error ? (
        <StageBanner tone="error" icon={AlertTriangle} action={{ label: "Скрыть", onClick: () => setError(null) }}>
          {error}
        </StageBanner>
      ) : null}
      {isTeacher && raisedHands.length > 0 ? (
        <StageBanner
          tone="info"
          icon={Hand}
          action={
            raisedHands.length === 1 && !raisedHands[0]!.permissions.canSpeak
              ? {
                  label: "Дать слово",
                  onClick: () => void togglePermission(raisedHands[0]!.userId, "canSpeak", true),
                }
              : { label: "Участники", onClick: () => setDrawer("people") }
          }
        >
          {raisedHands.length === 1
            ? `${raisedHands[0]!.fullName} поднял(а) руку — дайте слово, не прерывая объяснение.`
            : `${raisedHands[0]!.fullName} и ещё ${raisedHands.length - 1} подняли руку.`}
        </StageBanner>
      ) : null}
      {media && self?.permissions.canSpeak ? <PacketLossWarning /> : null}
      {media && (isTeacher || self?.permissions.canPublishVideo) ? <VideoDegradeSuggestion /> : null}

      {media ? (
        <StageContent
          view={stageView}
          activityId={activeActivityId}
          participants={participants}
          selfId={selfId}
          mode={lessonMode}
          lessonId={lessonId}
          canDraw={self?.permissions.canDraw ?? false}
          decks={decks}
          isTeacher={isTeacher}
          reviewSignal={reviewSignal}
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
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-video w-[150px] rounded-2xl md:w-[200px]" />
            ))}
          </div>
          <span className="flex items-center gap-2.5 text-sm text-text-2">
            <span
              className="size-[18px] animate-spin rounded-full border-2 border-primary-muted border-t-primary"
              aria-hidden
            />
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
        <DropdownMenuSubContent className="w-56 rounded-2xl p-1.5 shadow-lg">
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
      <span className="flex-1">Запись урока</span>
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
    <SimpleTooltip content={label} side="top">
      <button
        type="button"
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

  const content = (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Шапка — десктоп */}
      <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md md:flex">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
          <GraduationCap className="size-[17px]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-bold leading-tight tracking-[-.02em]">
            {lessonTitle ?? "Урок"}
          </span>
          <span className="truncate text-xs leading-tight text-muted-foreground">{headerMeta}</span>
        </span>
        <StatusPill status={status} />
        {recordingActive ? <RecordingPill /> : null}
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

      {/* Шапка — телефон */}
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-[max(8px,env(safe-area-inset-top))] md:hidden">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground">
          <GraduationCap className="size-[15px]" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-[13.5px] font-bold">{lessonTitle ?? "Урок"}</span>
        <StatusPill status={status} compact />
        {recordingActive ? <RecordingPill compact /> : null}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <RecordingConsentBanner active={recordingActive} />

      <div className="relative flex min-h-0 flex-1">
        {drawer ? (
          <aside className="hidden w-[340px] shrink-0 flex-col border-r border-border bg-card md:flex">
            {drawerBody(false)}
          </aside>
        ) : null}

        {/* `Sheet` затемняет весь экран своим оверлеем независимо от CSS-классов
            содержимого — монтируем его только на узком вьюпорте. */}
        {isNarrowViewport ? (
          <Sheet open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)}>
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              className="flex h-[min(560px,80dvh)] flex-col gap-0 rounded-t-3xl border-0 p-0 shadow-[0_-8px_24px_rgba(16,24,40,.18)] [&>button:first-of-type]:hidden"
            >
              {drawerBody(true)}
            </SheetContent>
          </Sheet>
        ) : null}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-3 md:gap-3 md:p-3.5">
          {stageArea}
        </main>
      </div>

      {/* Футер — десктоп */}
      <footer className="hidden h-[76px] shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4 md:flex">
        <div className="hidden min-w-[200px] items-center gap-2.5 xl:flex">
          <span className="inline-flex h-8 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-3 font-mono text-[12.5px] font-semibold text-text-2">
            <Clock className="size-3.5" aria-hidden />
            {elapsedLabel}
          </span>
          <span className="truncate text-[12.5px] text-text-3">
            Режим: {LESSON_MODE_LABEL[lessonMode].toLowerCase()}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          {!isTeacher ? (
            <RoomControlButton
              variant="pill"
              tone="action"
              active={self?.handRaised ?? false}
              activeIcon={Hand}
              inactiveIcon={Hand}
              activeLabel="Опустить руку"
              inactiveLabel="Поднять руку"
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

        <div className="flex shrink-0 items-center gap-1.5">
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
            <DropdownMenuContent align="end" side="top" sideOffset={10} className={MENU_CONTENT}>
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
          <Button
            type="button"
            variant="destructive"
            onClick={leaveRoom}
            className="ml-1.5 h-11 gap-2 rounded-full px-[18px] text-[15px] font-semibold [&_svg]:size-[19px]"
          >
            <LogOut aria-hidden />
            Выйти
          </Button>
        </div>
      </footer>

      {/* Футер — телефон */}
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
            badge={unreadChat}
            onToggle={() => toggleDrawer("chat")}
          />
        </div>
        <button
          type="button"
          onClick={leaveRoom}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#fecaca] bg-danger-light text-[15px] font-semibold text-danger transition-colors hover:bg-[#fee2e2]"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Выйти из урока
        </button>
      </footer>

      {media ? <DeviceSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} /> : null}

      {/* Только WS-канал (`status`), НЕ LiveKit-медиа — оно продолжает
          работать под оверлеем, урок не прерывается. */}
      {status === "reconnecting" && everConnectedRef.current ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,24,40,.45)] p-6 backdrop-blur-[3px]">
          <div className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-[20px] bg-card p-7 text-center shadow-lg">
            <span
              className="size-11 animate-spin rounded-full border-[3px] border-[#fde68a] border-t-warning"
              aria-hidden
            />
            <h2 className="text-lg font-bold tracking-[-.02em]">Связь прервалась — переподключаемся</h2>
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

  if (leftAsGuest) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#eff6ff] to-[#f0fdfa] p-6">
        <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-9 text-center shadow-lg">
          <h1 className="text-[22px] font-heavy tracking-tight">Вы вышли из урока</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Чтобы вернуться, откройте ссылку на урок ещё раз.
          </p>
        </div>
      </div>
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
        // Э6.2, §5.2 ТЗ: автоподписка LiveKit выключена намеренно — подпиской
        // управляет `VideoSubscriptionManager` ниже, единственное место.
        connectOptions={{ autoSubscribe: false }}
        audio={
          self?.permissions.canSpeak && joinMicEnabled
            ? {
                deviceId: micDeviceId ?? undefined,
                // Параметры школы (§10.10 ТЗ) — мягкий дефолт «высокое
                // качество звука» (стерео); участник не переопределяет
                // явно, но выбор устройства (deviceId) остаётся его.
                channelCount: clientMediaSettings?.micHighQuality ? 2 : undefined,
              }
            : false
        }
        // Э5.1/Э5.4/Э6.1 — см. историю в git; логика неизменна. joinCamEnabled —
        // Э11: с каким состоянием камеры участник нажал «Присоединиться».
        video={
          isTeacher && joinCamEnabled
            ? {
                resolution: clientMediaSettings
                  ? toVideoResolution(clientMediaSettings.cameraResolution, clientMediaSettings.cameraFps)
                  : VideoPresets.h720.resolution,
                deviceId: camDeviceId ?? undefined,
              }
            : false
        }
        // Разрыв аудио не показываем баннером — состояние видно на самой
        // кнопке микрофона, плюс индикатор связи в шапке.
        onDisconnected={() => undefined}
      >
        <ApplyAudioOutput deviceId={spkDeviceId} />
        <MicSync enabled={self?.permissions.canSpeak ?? false} />
        <VideoSubscriptionManager participants={participants} mode={lessonMode} />
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

function StatusPill({ status, compact = false }: { status: SocketStatusLike; compact?: boolean }) {
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
          status !== "connected" && "animate-pulse",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

function RecordingPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-danger-light font-semibold text-danger",
        compact ? "h-[22px] gap-[5px] px-2 text-[11px]" : "h-[26px] gap-1.5 px-2.5 text-xs",
      )}
    >
      <span className={cn("animate-pulse rounded-full bg-current", compact ? "size-[5px]" : "size-1.5")} />
      Запись
    </span>
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
        "flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13.5px]",
        tone === "info" && "border-primary-muted bg-primary-light text-primary",
        tone === "warn" && "border-[#fde68a] bg-warn-light text-[#b45309]",
        tone === "error" && "border-[#fecaca] bg-danger-light text-danger",
      )}
    >
      <Icon className="size-[17px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 [text-wrap:pretty]">{children}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="h-[30px] shrink-0 rounded-[9px] border border-current bg-transparent px-3 text-[13px] font-semibold"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

type PeopleListProps = {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  isTeacher: boolean;
  hasMedia: boolean;
  query: string;
  micOffIds?: Set<string>;
  weakIds?: Set<string>;
  onTogglePermission: (userId: string, key: PermissionKey, value: boolean) => void;
  onMute: (userId: string) => void;
  onTogglePin: (userId: string, pinned: boolean) => void;
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
  weakIds,
  onTogglePermission,
  onMute,
  onTogglePin,
}: PeopleListProps) {
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
            <UserAvatar name={p.fullName} size={32} />
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
                />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
  selfId,
  mode,
  lessonId,
  canDraw,
  decks,
  isTeacher,
  reviewSignal,
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
  selfId: string | undefined;
  mode: LessonMode;
  lessonId: string | undefined;
  canDraw: boolean;
  decks: Deck[];
  isTeacher: boolean;
  reviewSignal: number;
  videoLayout?: "grid" | "speaker";
  onLayoutChange: (layout: "grid" | "speaker") => void;
  onShowAll: () => void;
  /** Блок «Вы пока один» рядом с плиткой. */
  solo: ReactNode;
  onScreenShareStopped: () => void;
  onActivityClose: () => void;
  onBoardClose: (() => void) | undefined;
}) {
  const screenSharing =
    useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).length > 0;

  const main =
    view === "activity" && activityId ? (
      <ActivityStage
        activityId={activityId}
        isTeacher={isTeacher}
        reviewSignal={reviewSignal}
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
        selfId={selfId}
        mode={mode}
        layout={videoLayout}
        onLayoutChange={onLayoutChange}
        onShowAll={onShowAll}
      />
    );

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
      <RoomVideoGrid participants={participants} selfId={selfId} mode={mode} variant="rail" onShowAll={onShowAll} />
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
