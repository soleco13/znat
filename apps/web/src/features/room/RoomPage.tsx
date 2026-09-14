import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track, VideoPresets, type RoomOptions } from "livekit-client";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Disc,
  GraduationCap,
  Hand,
  LogOut,
  MessageSquare,
  PenLine,
  Pin,
  Presentation,
  Send,
  SlidersHorizontal,
  Users,
  Wrench,
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
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { toast } from "@/shared/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
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
import { toVideoResolution } from "./media-quality.js";
import { ConnectionQualityIcon, PacketLossWarning } from "./ConnectionQuality.js";
import { DeviceCheckScreen, type DeviceCheckResult } from "./DeviceCheckScreen.js";
import { ScreenShareAutoPip, type ScreenShareAutoPipHandle } from "./ScreenShareAutoPip.js";
import { RoomControlButton } from "./RoomControlButton.js";
import { useRoomIdentity } from "./use-room-identity.js";
import { MicStatusIcon, SelfMicButton } from "./MicControls.js";
import { MicSync } from "./MicSync.js";
import { ParticipantPresenceDot } from "./ParticipantPresenceDot.js";
import { SelfScreenShareButton } from "./ScreenShareControls.js";
import { RoomVideoGrid } from "./RoomVideoGrid.js";
import { ScreenShareTile } from "./ScreenShareTile.js";
import { useRoomSocket } from "./useRoomSocket.js";
import { VideoSubscriptionManager } from "./VideoSubscriptions.js";

// Э5.1/Э5.2 — см. подробные комментарии ниже у <LiveKitRoom>. 720p + simulcast,
// adaptiveStream/dynacast включены явно (в livekit-client по умолчанию off).
const ROOM_OPTIONS: RoomOptions = {
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: { simulcast: true },
  adaptiveStream: true,
  dynacast: true,
};

const STATUS_LABEL: Record<SocketStatusLike, string> = {
  connecting: "Подключение…",
  connected: "На связи",
  reconnecting: "Переподключение…",
  closed: "Нет связи",
};

/** Э6.4, §5.3 ТЗ. */
const LESSON_MODE_LABEL: Record<LessonMode, string> = {
  lecture: "Лекция",
  discussion: "Обсуждение",
  assignment: "Работа над заданием",
  spotlight: "У доски",
};

type SocketStatusLike = "connecting" | "connected" | "reconnecting" | "closed";

export function RoomPage() {
  const { id: lessonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const identity = useRoomIdentity();
  const guestSession = useGuestSessionStore((s) => s.session);
  const clearGuestSession = useGuestSessionStore((s) => s.clearSession);
  const isGuest = identity?.kind === "guest";
  const selfId = identity?.id;
  const [leftAsGuest, setLeftAsGuest] = useState(false);

  // Э12.7 §6.3/§6.4 — каркас урока: левый выдвижной блок (один, три режима)
  // и что показано на стейдже (плитки участников / доска). Демонстрация
  // экрана переключает стейдж сама (см. `StageContent`).
  const [drawer, setDrawer] = useState<null | "tools" | "people" | "chat">(null);
  const [stageView, setStageView] = useState<"people" | "board" | "activity">("people");
  // Э12 полировка: авторитетное «людям/доска» с сервера — держим отдельно от
  // `stageView`, чтобы закрытие задания знало, куда вернуться (не всегда «people»).
  const [sharedStage, setSharedStage] = useState<"people" | "board">("people");
  const [activeTool, setActiveTool] = useState<null | "deck" | "activity" | "recording" | "class">(
    null,
  );
  const toggleDrawer = (mode: "tools" | "people" | "chat") =>
    setDrawer((cur) => (cur === mode ? null : mode));

  useEffect(() => {
    if (drawer !== "tools") setActiveTool(null);
  }, [drawer]);

  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);
  const [lessonMode, setLessonMode] = useState<LessonMode>("lecture");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
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
      .then((data) => setChat([...data.items].reverse()))
      .catch(() => undefined);
  }, [lessonId, deviceCheckDone, attemptJoin]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

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

  async function togglePermission(
    userId: string,
    key: "canDraw" | "canSpeak" | "canShareScreen" | "canPublishVideo",
    value: boolean,
  ) {
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
   * своего же эхо `stage_changed` по WS (тот же приём, что уже работает
   * для режима урока) — так self и остальные участники обновляются
   * одинаково, без риска разойтись с сервером.
   */
  async function changeLessonStage(stage: "people" | "board") {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    }).catch(() => setError("Не удалось переключить стейдж"));
  }

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

  const connected = status === "connected";

  // «Вы пока один» — показываем 10 сек после того, как стали единственным,
  // потом прячем (одна плитка и так занимает весь стейдж адаптивно).
  const [showAlonePill, setShowAlonePill] = useState(true);
  const connectedCount = participants.filter((p) => p.connected).length;
  const aloneOnStage = deviceCheckDone && stageView === "people" && connectedCount <= 1;
  useEffect(() => {
    if (!aloneOnStage) return;
    setShowAlonePill(true);
    const t = setTimeout(() => setShowAlonePill(false), 10_000);
    return () => clearTimeout(t);
  }, [aloneOnStage]);

  const participantsPanel = (
    <div className="flex flex-col gap-1.5 p-3">
      {participants.map((p) => (
        <div
          key={p.userId}
          className="rounded-md border border-border bg-card px-2.5 py-2 text-sm"
        >
          <div className="flex items-center gap-2">
            {media ? (
              <ParticipantPresenceDot userId={p.userId} connected={p.connected} />
            ) : (
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  p.connected ? "bg-success" : "bg-text-3",
                )}
              />
            )}
            <UserAvatar name={p.fullName} size={26} />
            <span className="min-w-0 truncate font-medium text-foreground">{p.fullName}</span>
            <span className="text-xs text-muted-foreground">
              ({p.kind === "staff" ? p.role : "ученик"})
            </span>
            {p.handRaised ? (
              <Hand className="size-3.5 text-warning" aria-label="Поднята рука" />
            ) : null}
            {p.pinned ? (
              <Pin className="size-3.5 text-primary" aria-label="Закреплён в сетке видео" />
            ) : null}
            {media ? <MicStatusIcon userId={p.userId} /> : null}
            {media ? <ConnectionQualityIcon userId={p.userId} /> : null}
          </div>

          {isTeacher && p.userId !== selfId ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-xs">
              {(
                [
                  ["canDraw", "рисовать"],
                  ["canSpeak", "говорить"],
                  ["canPublishVideo", "видео"],
                  ["canShareScreen", "экран"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <Checkbox
                    checked={p.permissions[key]}
                    onCheckedChange={(v) => togglePermission(p.userId, key, v === true)}
                  />
                  {label}
                </label>
              ))}
              {media && p.permissions.canSpeak ? (
                <Button variant="outline" size="sm" onClick={() => muteParticipant(p.userId)}>
                  Заглушить
                </Button>
              ) : null}
              {media && p.kind === "guest" ? (
                <Button
                  variant={p.pinned ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => togglePin(p.userId, !p.pinned)}
                >
                  <Pin aria-hidden />
                  {p.pinned ? "Открепить" : "Закрепить"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-sm font-heavy">Чат</div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {chat.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Сообщений пока нет</p>
          ) : (
            chat.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="font-semibold text-foreground">{m.authorName}: </span>
                <span className="text-foreground">{m.body}</span>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </ScrollArea>
      <form onSubmit={sendChat} className="flex shrink-0 gap-2 border-t border-border p-2.5">
        <Input
          value={chatDraft}
          onChange={(e) => setChatDraft(e.target.value)}
          placeholder="Сообщение…"
          maxLength={2000}
          className="h-9"
        />
        <Button type="submit" size="icon" className="size-9 shrink-0" aria-label="Отправить">
          <Send />
        </Button>
      </form>
    </div>
  );

  // §6.4 — «Инструменты»: список «иконка + короткое название». Клик по
  // строке открывает нужный инструмент в этой же панели (с кнопкой «назад»).
  // «Доска» — не инструмент-панель, а переключатель стейджа для ВСЕГО урока
  // (Э12 полировка), поэтому доступна только учителю/админу; ученик и
  // методист просто видят её, когда её включает учитель. Ученику из строк
  // ниже доступно только задание.
  const toolRows: {
    key: "board" | "deck" | "activity" | "recording" | "class";
    icon: typeof PenLine;
    label: string;
    hint?: string;
    show: boolean;
    onClick: () => void;
    trailing?: React.ReactNode;
  }[] = [
    {
      key: "board",
      icon: PenLine,
      label: "Доска",
      hint: stageView === "board" ? "открыта" : "рисование и слайды",
      show: isTeacher,
      onClick: () => changeLessonStage(stageView === "board" ? "people" : "board"),
      trailing:
        stageView === "board" ? (
          <Badge variant="green" className="shrink-0">
            вкл
          </Badge>
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ),
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
      trailing:
        activeActivityId && stageView === "activity" ? (
          <Badge variant="green" className="shrink-0">
            на экране
          </Badge>
        ) : undefined,
    },
    {
      key: "recording",
      icon: Disc,
      label: "Запись урока",
      hint: recordingActive ? "идёт запись" : "начать запись",
      show: Boolean(lessonId && isTeacher),
      onClick: () => setActiveTool("recording"),
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
          <span className="text-xs font-medium text-muted-foreground">Режим урока</span>
          <Select value={lessonMode} onValueChange={(v) => changeLessonMode(v as LessonMode)}>
            <SelectTrigger className="h-9 text-sm">
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
          <Button variant="outline" size="sm" onClick={muteAll}>
            Заглушить всех
          </Button>
        ) : null}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => toggleDrawForAll(true)}
          >
            Рисовать всем
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => toggleDrawForAll(false)}
          >
            Запретить
          </Button>
        </div>
      </div>
    ) : null;

  const activeToolLabel = toolRows.find((r) => r.key === activeTool)?.label ?? "";

  const toolsPanel = (
    <div className="flex h-full min-h-0 flex-col">
      {activeTool ? (
        <button
          type="button"
          onClick={() => setActiveTool(null)}
          className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2 text-sm font-heavy text-foreground transition-colors hover:bg-secondary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {activeToolLabel}
        </button>
      ) : (
        <div className="shrink-0 border-b border-border px-3 py-2 text-sm font-heavy">
          Инструменты
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {activeTool ? (
          <div className="p-3">{toolBody}</div>
        ) : (
          <div className="flex flex-col p-1.5">
            {toolRows
              .filter((r) => r.show)
              .map(({ key, icon: Icon, label, hint, onClick, trailing }) => (
                <button
                  key={key}
                  type="button"
                  onClick={onClick}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {label}
                    </span>
                    {hint ? (
                      <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                    ) : null}
                  </span>
                  {trailing ?? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                </button>
              ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  const stageArea = (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 text-sm">
          <span className="text-foreground">Не удалось войти в урок</span>
          <Button size="sm" onClick={attemptJoin}>
            Повторить
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          Подключаемся к аудио и видео…
        </div>
      )}

      {/* «Вы пока один» — плавающая подсказка поверх стейджа (не двигает
          сетку), уходит через 10 сек. */}
      {aloneOnStage && showAlonePill ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex animate-fade-in justify-center px-3">
          <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm shadow-sm backdrop-blur">
            <span className="truncate text-muted-foreground">
              {isTeacher ? "Вы пока один — пригласите учеников" : "Ждём других участников"}
            </span>
            {isTeacher && lessonJoinPath ? (
              <Button size="sm" className="shrink-0" onClick={copyJoinLink}>
                <Copy aria-hidden />
                Ссылка
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  const drawerToggle = (
    mode: "tools" | "people" | "chat",
    label: string,
    Icon: typeof Wrench,
    badge?: number,
  ) => (
    <div className="flex flex-col items-center gap-1">
      <SimpleTooltip content={label} side="top">
        <Button
          variant={drawer === mode ? "secondary" : "ghost"}
          size="icon"
          className="relative size-10"
          onClick={() => toggleDrawer(mode)}
          aria-pressed={drawer === mode}
          aria-label={label}
        >
          <Icon aria-hidden />
          {badge != null && badge > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {badge}
            </span>
          ) : null}
        </Button>
      </SimpleTooltip>
      <span className="text-[11px] leading-none text-muted-foreground">{label}</span>
    </div>
  );

  const content = (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* §6.1 — верхняя строка */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <GraduationCap className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-sm font-heavy tracking-tight">
          {lessonTitle ?? "Урок"}
        </span>
        {recordingActive ? (
          <Badge variant="red" className="shrink-0">
            <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
            Запись
          </Badge>
        ) : null}
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 text-xs font-medium sm:inline-flex",
            connected ? "text-success" : "text-warning",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-success" : "bg-warning animate-pulse",
            )}
          />
          {STATUS_LABEL[status]}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isTeacher && lessonJoinPath ? (
            <Button variant="ghost" size="sm" onClick={copyJoinLink}>
              <Copy aria-hidden />
              <span className="hidden md:inline">Ссылка</span>
            </Button>
          ) : null}
          {!isTeacher ? (
            <Badge variant="blue" className="hidden sm:inline-flex">
              {LESSON_MODE_LABEL[lessonMode]}
            </Badge>
          ) : null}
        </div>
      </header>

      <RecordingConsentBanner active={recordingActive} />

      {/* §6.2/§6.4 — левый выдвижной блок + стейдж. Брейкпоинт inline-сайдбара —
          `md` (768px), не `sm`: компактные планшеты-портрет (iPad mini ~744px
          и похожие) тоже должны получать оверлей поверх стейджа, а не
          сжатую боковую панель — там для сетки видео/доски просто не
          остаётся места. */}
      <div className="relative flex min-h-0 flex-1">
        {drawer ? (
          <button
            type="button"
            aria-label="Закрыть панель"
            onClick={() => setDrawer(null)}
            className="fixed inset-0 z-10 bg-black/30 md:hidden"
          />
        ) : null}
        {drawer ? (
          <aside className="absolute inset-y-0 left-0 z-20 flex w-full max-w-[360px] flex-col border-r border-border bg-card md:relative md:w-[340px]">
            {drawer === "tools" ? toolsPanel : null}
            {drawer === "people" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-border px-3 py-2 text-sm font-heavy">
                  Участники ({participants.length})
                </div>
                <ScrollArea className="min-h-0 flex-1">{participantsPanel}</ScrollArea>
              </div>
            ) : null}
            {drawer === "chat" ? chatPanel : null}
          </aside>
        ) : null}

        <main className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {stageArea}
        </main>
      </div>

      {/* §6.3 — нижняя панель управления: иконка + короткая подпись под ней */}
      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border bg-card px-3 py-2 sm:justify-between">
        <div className="flex items-center gap-1">
          {drawerToggle("tools", "Инструменты", Wrench)}
          {drawerToggle("people", "Участники", Users, participants.length)}
          {drawerToggle("chat", "Чат", MessageSquare)}
        </div>

        <div className="flex items-center gap-2">
          {!isTeacher ? (
            <RoomControlButton
              tone="action"
              active={self?.handRaised ?? false}
              activeIcon={Hand}
              inactiveIcon={Hand}
              activeLabel="Опустить руку"
              inactiveLabel="Поднять руку"
              onToggle={toggleHand}
              caption="Рука"
            />
          ) : null}
          {media &&
          (isTeacher || self?.permissions.canShareScreen) &&
          clientMediaSettings?.screenShareEnabled !== false ? (
            <SelfScreenShareButton
              priority={isTeacher}
              onScreenShareStarted={() => void pipRef.current?.open()}
              onScreenShareStopped={() => pipRef.current?.close()}
            />
          ) : null}
          {media ? (
            <SelfMicButton
              disabled={!self?.permissions.canSpeak}
              disabledReason="Микрофон выключил учитель — поднимите руку"
            />
          ) : null}
          {media ? (
            isTeacher ? (
              <SelfCameraButton
                maxResolution={
                  clientMediaSettings
                    ? toVideoResolution(clientMediaSettings.cameraResolution, clientMediaSettings.cameraFps)
                    : undefined
                }
              />
            ) : (
              <SelfCameraButton
                maxResolution={VideoPresets.h360.resolution}
                disabled={!self?.permissions.canPublishVideo}
                disabledReason="Камеру включил учитель — поднимите руку"
              />
            )
          ) : null}
          <div className="flex flex-col items-center gap-1">
            <SimpleTooltip content="Выйти из урока" side="top">
              <button
                type="button"
                onClick={leaveRoom}
                className="flex size-10 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label="Выйти из урока"
              >
                <LogOut className="size-5" aria-hidden />
              </button>
            </SimpleTooltip>
            <span className="text-[11px] leading-none text-muted-foreground">Выйти</span>
          </div>
        </div>

        {/* правый кластер намеренно пуст — переключение «плитки / доска»
            живёт в панели «Инструменты» и в шапке доски (§6.5). */}
        <div className="hidden w-[120px] sm:block" aria-hidden />
      </footer>
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
        options={ROOM_OPTIONS}
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
        // кнопке микрофона (красная «Звук выкл.»), плюс индикатор связи в шапке.
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
 * Э12.7 §6.2 — контент стейджа при активном LiveKit. Рендерится только
 * внутри `<LiveKitRoom>` (использует `useTracks`). Один компонент на все
 * виды стейджа (плитки / доска / задание), потому что демонстрацию экрана
 * нужно учитывать в каждом из них:
 *
 *  - активная демонстрация экрана — это то, на что смотрит урок (§5.3 ТЗ,
 *    Э7.3 сам переводит режим в «Лекцию»): показываем её на стейдже поверх
 *    плиток И доски. Иначе демонстрацию, начатую при открытой доске, не
 *    видел бы никто — регресс каркаса RoomShell (Э12.7), где `ScreenShareTile`
 *    жил только в ветке плиток;
 *  - явно выданное задание (`view === "activity"`) демонстрацией НЕ
 *    перебиваем — это отдельное осознанное действие учителя «показать
 *    работу классу», оно приоритетнее;
 *  - плитки участников: в ветке демонстрации/доски/задания — узкой лентой
 *    справа (`variant="rail"`), иначе — адаптивной сеткой на весь стейдж.
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
      <ScreenShareTile />
    ) : view === "board" && lessonId ? (
      <Board lessonId={lessonId} canDraw={canDraw} decks={decks} onClose={onBoardClose} />
    ) : (
      <RoomVideoGrid participants={participants} selfId={selfId} mode={mode} />
    );

  const railed =
    (view === "activity" && activityId) || screenSharing || (view === "board" && lessonId);

  if (!railed) return <div className="min-h-0 flex-1">{main}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
      <div className="min-h-0 flex-1">{main}</div>
      <RoomVideoGrid participants={participants} selfId={selfId} mode={mode} variant="rail" />
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
