import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { VideoPresets, type RoomOptions } from "livekit-client";
import { Hand, LogOut, Pin, Send, Users } from "lucide-react";
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
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
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

const LESSON_STATUS_LABEL: Record<LessonStatus, string> = {
  scheduled: "Запланирован",
  live: "Идёт",
  ended: "Завершён",
  cancelled: "Отменён",
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
      .then((l) => setLessonTitle(l.title))
      .catch(() => undefined);
  }, [lessonId, isGuest, guestSession?.lessonTitle]);

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
    <div className="flex flex-col gap-1.5">
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
      <form onSubmit={sendChat} className="flex gap-2 border-t border-border p-2.5">
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

  const content = (
    <div className="min-h-dvh bg-background">
      {/* Топ-бар урока */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-card/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-heavy tracking-tight">Урок</h1>
            {lessonStatus ? (
              <Badge variant={lessonStatus === "live" ? "green" : "gray"}>
                {LESSON_STATUS_LABEL[lessonStatus]}
              </Badge>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium",
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
            {media ? <MediaAudioStatus /> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Режим</span>
          {isTeacher ? (
            <Select value={lessonMode} onValueChange={(v) => changeLessonMode(v as LessonMode)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
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
          ) : (
            <Badge variant="blue">{LESSON_MODE_LABEL[lessonMode]}</Badge>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isTeacher && lessonStatus === "live" ? (
            <Button variant="destructive" size="sm" onClick={endLesson}>
              Завершить урок
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={leaveRoom}>
            <LogOut aria-hidden />
            Выйти
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-content px-4 py-5 sm:px-6">
        <RecordingConsentBanner active={recordingActive} />

        {media ? <ScreenShareTile /> : null}

        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {media && self?.permissions.canSpeak ? <PacketLossWarning /> : null}
        {media && (isTeacher || self?.permissions.canPublishVideo) ? <VideoDegradeSuggestion /> : null}

        {lessonId ? (
          <div className="mb-4">
            <Board lessonId={lessonId} canDraw={self?.permissions.canDraw ?? false} decks={decks} />
          </div>
        ) : null}

        {lessonId ? (
          <div className="mb-4">
            <DeckPanel
              lessonId={lessonId}
              isTeacher={isTeacher}
              decks={decks}
              statuses={deckStatuses}
              onChanged={refreshDecks}
            />
          </div>
        ) : null}

        {lessonId ? (
          <div className="mb-4">
            <LessonActivityPanel
              lessonId={lessonId}
              isTeacher={isTeacher}
              activeActivityId={activeActivityId}
              reviewSignal={reviewSignal}
            />
          </div>
        ) : null}

        {lessonId && isTeacher ? (
          <div className="mb-4">
            <RecordingPanel
              lessonId={lessonId}
              recordingActive={recordingActive}
              onActiveChange={setRecordingActive}
            />
          </div>
        ) : null}

        {/* Панель управления медиа/правами */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!isTeacher ? (
            <Button
              variant={self?.handRaised ? "secondary" : "outline"}
              size="sm"
              onClick={toggleHand}
            >
              <Hand aria-hidden />
              {self?.handRaised ? "Опустить руку" : "Поднять руку"}
            </Button>
          ) : null}
          {media && self?.permissions.canSpeak ? <SelfMicButton /> : null}
          {media && isTeacher ? <SelfCameraButton /> : null}
          {media && !isTeacher && self?.permissions.canPublishVideo ? (
            <SelfCameraButton maxResolution={VideoPresets.h360.resolution} />
          ) : null}
          {media && (isTeacher || self?.permissions.canShareScreen) ? (
            <SelfScreenShareButton priority={isTeacher} />
          ) : null}
          {media && isTeacher ? (
            <Button variant="outline" size="sm" onClick={muteAll}>
              Заглушить всех
            </Button>
          ) : null}
          {isTeacher ? (
            <>
              <Button variant="outline" size="sm" onClick={() => toggleDrawForAll(true)}>
                Разрешить рисовать всем
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleDrawForAll(false)}>
                Запретить рисовать всем
              </Button>
            </>
          ) : null}
        </div>

        {media ? (
          <div className="mb-4">
            <RoomVideoGrid participants={participants} selfId={selfId} mode={lessonMode} />
          </div>
        ) : null}

        {/* Участники + чат */}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div>
            <h2 className="ds-label mb-2 flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden /> Участники ({participants.length})
            </h2>
            {participantsPanel}
          </div>

          <Tabs defaultValue="chat" className="flex min-h-0 flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                Чат
              </TabsTrigger>
              <TabsTrigger value="people" className="flex-1 lg:hidden">
                Люди
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="chat"
              className="mt-2 h-[60vh] overflow-hidden rounded-lg border border-border bg-card"
            >
              {chatPanel}
            </TabsContent>
            <TabsContent value="people" className="mt-2 lg:hidden">
              {participantsPanel}
            </TabsContent>
          </Tabs>
        </div>
      </div>
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
