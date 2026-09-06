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
  Copy,
  GraduationCap,
  Hand,
  LogOut,
  MessageSquare,
  MoreVertical,
  PenLine,
  Pin,
  Send,
  Users,
  Wrench,
} from "lucide-react";
import type {
  ChatMessage,
  Deck,
  DeckProgressEvent,
  JoinLessonResponse,
  LessonMode,
  LessonSummary,
  LessonStatus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
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
import { TooltipProvider } from "@/shared/ui/tooltip";
import { Board } from "../canvas/Board.js";
import { DeckPanel } from "../decks/DeckPanel.js";
import { listLessonActivities } from "../materials/activity-api.js";
import { LessonActivityPanel } from "../materials/LessonActivityPanel.js";
import { RecordingConsentBanner, RecordingPanel } from "../recordings/RecordingPanel.js";
import { SelfCameraButton, VideoDegradeSuggestion } from "./CameraControls.js";
import { ConnectionQualityDot, PacketLossWarning } from "./ConnectionQuality.js";
import { DeviceCheckScreen, type DeviceCheckResult } from "./DeviceCheckScreen.js";
import { useRoomIdentity } from "./use-room-identity.js";
import { MediaAudioStatus } from "./MediaAudioStatus.js";
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
  // экрана переключает стейдж сама (см. `LiveStage`).
  const [drawer, setDrawer] = useState<null | "tools" | "people" | "chat">(null);
  const [stageView, setStageView] = useState<"people" | "board">("people");
  const toggleDrawer = (mode: "tools" | "people" | "chat") =>
    setDrawer((cur) => (cur === mode ? null : mode));

  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);
  const [lessonStatus, setLessonStatus] = useState<LessonStatus | null>(null);
  const [lessonMode, setLessonMode] = useState<LessonMode>("lecture");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [deckStatuses, setDeckStatuses] = useState<Record<string, DeckProgressEvent>>({});
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  const [reviewSignal, setReviewSignal] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaConnection | null>(null);
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [camDeviceId, setCamDeviceId] = useState<string | null>(null);
  const [spkDeviceId, setSpkDeviceId] = useState<string | null>(null);
  const [joinMicEnabled, setJoinMicEnabled] = useState(true);
  const [joinCamEnabled, setJoinCamEnabled] = useState(true);
  const [lessonTitle, setLessonTitle] = useState<string | null>(null);
  const [lessonJoinPath, setLessonJoinPath] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isTeacher = identity?.role === "teacher" || identity?.role === "admin";

  const handleMessage = useCallback((message: ServerRoomMessage) => {
    switch (message.type) {
      case "presence":
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
      case "lesson_status":
        setLessonStatus(message.status);
        break;
      case "lesson_mode":
        setLessonMode(message.mode);
        break;
      case "deck_status":
        setDeckStatuses((prev) => ({ ...prev, [message.deck.deckId]: message.deck }));
        break;
      case "activity_started":
        setActiveActivityId(message.activityId);
        break;
      case "activity_reviewed":
        setReviewSignal((n) => n + 1);
        break;
      case "recording_status":
        setRecordingActive(message.active);
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

  useEffect(() => {
    if (!lessonId || !deviceCheckDone) return;
    apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" })
      .then((data) => {
        setParticipants(data.participants);
        setLessonStatus(data.lessonStatus);
        setLessonMode(data.lessonMode);
        setMedia(data.media);
      })
      .catch(() => setError("Не удалось войти в урок"));

    apiFetch<{ items: ChatMessage[] }>(`/lessons/${lessonId}/chat`)
      .then((data) => setChat([...data.items].reverse()))
      .catch(() => undefined);
  }, [lessonId, deviceCheckDone]);

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

  async function endLesson() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/end`, { method: "POST" }).catch(() =>
      setError("Не удалось завершить урок"),
    );
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
            {media ? <ConnectionQualityDot userId={p.userId} /> : null}
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

  // §6.4 — «Инструменты»: доска вкл/выкл, презентации, задание классу,
  // запись, режим урока, «рисовать/заглушить всем». Ученику виден только
  // блок задания (он его проходит) + переключатель доски.
  const toolsPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-sm font-heavy">Инструменты</div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-col gap-1.5">
            <span className="ds-label">Доска</span>
            <Button
              variant={stageView === "board" ? "secondary" : "outline"}
              size="sm"
              className="justify-start"
              onClick={() => setStageView((v) => (v === "board" ? "people" : "board"))}
            >
              <PenLine aria-hidden />
              {stageView === "board" ? "Скрыть доску (показать участников)" : "Открыть доску"}
            </Button>
          </div>

          {lessonId && isTeacher ? (
            <DeckPanel
              lessonId={lessonId}
              isTeacher={isTeacher}
              decks={decks}
              statuses={deckStatuses}
              onChanged={refreshDecks}
            />
          ) : null}

          {lessonId ? (
            <LessonActivityPanel
              lessonId={lessonId}
              isTeacher={isTeacher}
              activeActivityId={activeActivityId}
              reviewSignal={reviewSignal}
            />
          ) : null}

          {lessonId && isTeacher ? (
            <RecordingPanel
              lessonId={lessonId}
              recordingActive={recordingActive}
              onActiveChange={setRecordingActive}
            />
          ) : null}

          {isTeacher ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className="ds-label">Класс</span>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Режим урока</span>
                <Select
                  value={lessonMode}
                  onValueChange={(v) => changeLessonMode(v as LessonMode)}
                >
                  <SelectTrigger className="h-8 text-xs">
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
          ) : null}
        </div>
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

      {stageView === "board" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {lessonId ? (
            <div className="min-h-0 flex-1">
              <Board
                lessonId={lessonId}
                canDraw={self?.permissions.canDraw ?? false}
                decks={decks}
              />
            </div>
          ) : null}
          {media ? (
            <RoomVideoGrid participants={participants} selfId={selfId} mode={lessonMode} variant="filmstrip" />
          ) : null}
        </div>
      ) : media ? (
        <LiveStage participants={participants} selfId={selfId} mode={lessonMode} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          Подключаемся к аудио и видео…
        </div>
      )}

      {stageView === "people" && participants.length <= 1 ? (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-medium text-foreground">Вы пока один на уроке</p>
          {isTeacher && lessonJoinPath ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Отправьте ученикам ссылку, чтобы они подключились.
              </p>
              <Button variant="secondary" size="sm" className="mt-2.5" onClick={copyJoinLink}>
                <Copy aria-hidden />
                Скопировать ссылку
              </Button>
            </>
          ) : null}
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
    <Button
      variant={drawer === mode ? "secondary" : "ghost"}
      size="sm"
      className="relative"
      onClick={() => toggleDrawer(mode)}
      aria-pressed={drawer === mode}
    >
      <Icon aria-hidden />
      <span className="hidden md:inline">{label}</span>
      {badge != null && badge > 0 ? (
        <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
          {badge}
        </span>
      ) : null}
    </Button>
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
        {media ? <span className="hidden lg:inline"><MediaAudioStatus /></span> : null}

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Меню урока">
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isTeacher && lessonStatus === "live" ? (
                <>
                  <DropdownMenuItem onSelect={endLesson}>Завершить урок для всех</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={leaveRoom}>
                <LogOut aria-hidden />
                Выйти из урока
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <RecordingConsentBanner active={recordingActive} />

      {/* §6.2/§6.4 — левый выдвижной блок + стейдж */}
      <div className="relative flex min-h-0 flex-1">
        {drawer ? (
          <aside className="absolute inset-y-0 left-0 z-20 flex w-full max-w-[360px] flex-col border-r border-border bg-card sm:relative sm:w-[340px]">
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

        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">{stageArea}</main>
      </div>

      {/* §6.3 — нижняя панель управления */}
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1">
          {drawerToggle("tools", "Инструменты", Wrench)}
          {drawerToggle("people", "Участники", Users, participants.length)}
          {drawerToggle("chat", "Чат", MessageSquare)}
        </div>

        <div className="mx-auto flex items-center gap-1.5">
          {!isTeacher ? (
            <Button
              variant={self?.handRaised ? "secondary" : "outline"}
              size="sm"
              onClick={toggleHand}
              aria-pressed={self?.handRaised}
            >
              <Hand aria-hidden />
              <span className="hidden sm:inline">{self?.handRaised ? "Опустить" : "Рука"}</span>
            </Button>
          ) : null}
          {media && (isTeacher || self?.permissions.canShareScreen) ? (
            <SelfScreenShareButton priority={isTeacher} />
          ) : null}
          {media && self?.permissions.canSpeak ? <SelfMicButton /> : null}
          {media && isTeacher ? <SelfCameraButton /> : null}
          {media && !isTeacher && self?.permissions.canPublishVideo ? (
            <SelfCameraButton maxResolution={VideoPresets.h360.resolution} />
          ) : null}
          <Button variant="destructive" size="sm" onClick={leaveRoom}>
            <LogOut aria-hidden />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant={stageView === "people" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setStageView("people")}
          >
            <Users aria-hidden />
            <span className="hidden lg:inline">Плитки</span>
          </Button>
          <Button
            variant={stageView === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setStageView("board")}
          >
            <PenLine aria-hidden />
            <span className="hidden lg:inline">Доска</span>
          </Button>
        </div>
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
            ? { deviceId: micDeviceId ?? undefined }
            : false
        }
        // Э5.1/Э5.4/Э6.1 — см. историю в git; логика неизменна. joinCamEnabled —
        // Э11: с каким состоянием камеры участник нажал «Присоединиться».
        video={
          isTeacher && joinCamEnabled
            ? { resolution: VideoPresets.h720.resolution, deviceId: camDeviceId ?? undefined }
            : false
        }
        onDisconnected={() => setError("Аудио отключено")}
      >
        <ApplyAudioOutput deviceId={spkDeviceId} />
        <MicSync enabled={self?.permissions.canSpeak ?? false} />
        <VideoSubscriptionManager participants={participants} mode={lessonMode} />
        {content}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </TooltipProvider>
  );
}

/**
 * Э12.7 §6.2 — контент стейджа при активном LiveKit: демонстрация экрана
 * (если кто-то её ведёт) на весь стейдж + плитки участников лентой; иначе —
 * адаптивная сетка плиток. Внутри `<LiveKitRoom>` — использует `useTracks`.
 */
function LiveStage({
  participants,
  selfId,
  mode,
}: {
  participants: ParticipantSnapshot[];
  selfId: string | undefined;
  mode: LessonMode;
}) {
  const screen = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  if (screen.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1">
          <ScreenShareTile />
        </div>
        <RoomVideoGrid participants={participants} selfId={selfId} mode={mode} variant="filmstrip" />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1">
      <RoomVideoGrid participants={participants} selfId={selfId} mode={mode} />
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
