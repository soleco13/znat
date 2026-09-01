import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { VideoPresets, type RoomOptions } from "livekit-client";
import type {
  ChatMessage,
  Deck,
  DeckProgressEvent,
  JoinLessonResponse,
  LessonStatus,
  MediaConnection,
  ParticipantSnapshot,
  ServerRoomMessage,
} from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";
import { useAuthStore } from "../../shared/auth-store.js";
import { Board } from "../canvas/Board.js";
import { DeckPanel } from "../decks/DeckPanel.js";
import { SelfCameraButton, VideoDegradeSuggestion } from "./CameraControls.js";
import { ConnectionQualityDot, PacketLossWarning } from "./ConnectionQuality.js";
import { DeviceCheckScreen } from "./DeviceCheckScreen.js";
import { MediaAudioStatus } from "./MediaAudioStatus.js";
import { MicStatusIcon, SelfMicButton } from "./MicControls.js";
import { MicSync } from "./MicSync.js";
import { ParticipantPresenceDot } from "./ParticipantPresenceDot.js";
import { TeacherVideoTile } from "./TeacherVideoTile.js";
import { useRoomSocket } from "./useRoomSocket.js";

// Э5.1: 720p с автослоями simulcast h360/h180 (§5.2 ТЗ) — вынесено из JSX,
// один и тот же объект на все рендеры (LiveKitRoom реагирует на identity
// пропа options, пересоздание на каждый рендер лишний раз пересобирало бы
// комнату). `videoSimulcastLayers` не пишем: то же самое даёт дефолт
// livekit-client при пустом поле (проверено чтением options.d.ts установленного
// livekit-client@2.22.0) — оставлено явным комментарием, а не полем, чтобы
// не разойтись с версией пакета при апгрейде.
//
// Э5.2 (§5.2 ТЗ): `adaptiveStream`/`dynacast` ОБА выключены по умолчанию в
// самом livekit-client (проверено чтением `roomOptionDefaults` в
// установленном dist/livekit-client.esm.mjs@2.22.0 — `adaptiveStream: false,
// dynacast: false`), поэтому без явного включения здесь требование ТЗ «не
// публиковать слои, на которые никто не подписан» и «понижать слой для
// маленькой плитки» тихо не выполнялось бы. При одной плитке учителя (Э5)
// эффект пока минимален — раскроется на сетке из 9 в Э6, но должен быть
// включён с самого начала, а не довинчен потом.
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

type SocketStatusLike = "connecting" | "connected" | "reconnecting" | "closed";

export function RoomPage() {
  const { id: lessonId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);

  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);
  const [lessonStatus, setLessonStatus] = useState<LessonStatus | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  // Э4.4: статусы конвертации презентаций урока, по deckId. Копим все —
  // одновременно могут конвертироваться несколько, а событие несёт одну.
  const [deckStatuses, setDeckStatuses] = useState<Record<string, DeckProgressEvent>>({});
  // Э4.6: полный список презентаций урока (со слайдами) — источник для панели
  // и для импорта слайдов на холст. Прогресс приходит через WS (deckStatuses),
  // а слайды готовой презентации подтягиваются этим запросом.
  const [decks, setDecks] = useState<Deck[]>([]);
  const [error, setError] = useState<string | null>(null);
  // LiveKit-подключение (Э2, только аудио — см. стоп-лист Э2 в docs/CURRENT_STAGE.md).
  const [media, setMedia] = useState<MediaConnection | null>(null);
  // Экран проверки устройств (Э2.4) — пока не пройден, в урок не входим (ни HTTP join, ни WS).
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  // Э5.4: камера, выбранная на экране проверки устройств — используется
  // только учителем/админом (`video` проп `<LiveKitRoom>` ниже), у ученика
  // просто лежит невостребованным до Э6.
  const [camDeviceId, setCamDeviceId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isTeacher = me?.role === "teacher" || me?.role === "admin";

  const handleMessage = useCallback((message: ServerRoomMessage) => {
    switch (message.type) {
      case "presence":
        setParticipants(message.participants);
        break;
      case "participant_joined":
        setParticipants((prev) => [...prev.filter((p) => p.userId !== message.participant.userId), message.participant]);
        break;
      case "participant_left":
        setParticipants((prev) => prev.filter((p) => p.userId !== message.userId));
        break;
      case "permissions_updated":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, permissions: message.permissions } : p)),
        );
        break;
      case "hand_raised":
        setParticipants((prev) =>
          prev.map((p) => (p.userId === message.userId ? { ...p, handRaised: message.raised } : p)),
        );
        break;
      case "chat_message":
        setChat((prev) => [...prev, message.message]);
        break;
      case "lesson_status":
        setLessonStatus(message.status);
        break;
      case "deck_status":
        setDeckStatuses((prev) => ({ ...prev, [message.deck.deckId]: message.deck }));
        break;
      case "error":
        setError(message.message);
        break;
    }
  }, []);

  const status = useRoomSocket(lessonId ?? "", handleMessage, deviceCheckDone);

  useEffect(() => {
    if (!lessonId || !deviceCheckDone) return;
    apiFetch<JoinLessonResponse>(`/lessons/${lessonId}/join`, { method: "POST" })
      .then((data) => {
        setParticipants(data.participants);
        setLessonStatus(data.lessonStatus);
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

  const refreshDecks = useCallback(() => {
    if (!lessonId) return;
    apiFetch<{ decks: Deck[] }>(`/lessons/${lessonId}/decks`)
      .then((data) => setDecks(data.decks))
      .catch(() => undefined);
  }, [lessonId]);

  useEffect(() => {
    refreshDecks();
  }, [refreshDecks]);

  // Как только презентация досконвертировалась (WS-событие `ready`), а слайдов
  // (или, для PDF из Э4.7, ссылки `pdfUrl`) для неё ещё нет в `decks` —
  // подтягиваем список заново. `refetchedDecksRef` не даёт зациклиться, если
  // сервер почему-то так и не отдаёт слайды по `ready`-презентации.
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

  const self = participants.find((p) => p.userId === me?.id);

  async function leaveRoom() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/leave`, { method: "POST" }).catch(() => undefined);
    navigate("/lessons");
  }

  async function endLesson() {
    if (!lessonId) return;
    await apiFetch(`/lessons/${lessonId}/end`, { method: "POST" }).catch(() => setError("Не удалось завершить урок"));
  }

  async function toggleHand() {
    if (!lessonId || !self) return;
    await apiFetch(`/lessons/${lessonId}/hand-raise`, {
      method: "POST",
      body: JSON.stringify({ raised: !self.handRaised }),
    }).catch(() => undefined);
  }

  async function togglePermission(userId: string, key: "canDraw" | "canSpeak" | "canShareScreen", value: boolean) {
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

  /** Э3.8: глобальный тумблер «ученики могут рисовать» — массово меняет canDraw у всех учеников урока. */
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
    await apiFetch(`/lessons/${lessonId}/chat`, { method: "POST", body: JSON.stringify({ body }) }).catch(() =>
      setError("Сообщение не отправлено"),
    );
  }

  const content = (
    <div className="mx-auto mt-8 max-w-6xl px-4">
      {lessonId && (
        <div className="mb-4">
          <Board lessonId={lessonId} canDraw={self?.permissions.canDraw ?? false} decks={decks} />
        </div>
      )}

      {lessonId && (
        <div className="mb-4">
          <DeckPanel
            lessonId={lessonId}
            isTeacher={isTeacher}
            decks={decks}
            statuses={deckStatuses}
            onChanged={refreshDecks}
          />
        </div>
      )}

      <div className="grid grid-cols-[2fr_1fr] gap-4">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Урок</h1>
            <p className="text-sm text-slate-500">
              Статус: {lessonStatus ?? "…"} · <span className={status === "connected" ? "text-green-600" : "text-amber-600"}>{STATUS_LABEL[status]}</span>
              {media && (
                <>
                  {" "}
                  · <MediaAudioStatus />
                </>
              )}
            </p>
            {media && self?.permissions.canSpeak && <PacketLossWarning />}
            {media && isTeacher && <VideoDegradeSuggestion />}
          </div>
          <div className="flex gap-2">
            {isTeacher && lessonStatus === "live" && (
              <button onClick={endLesson} className="rounded border border-red-300 px-3 py-1 text-sm text-red-700">
                Завершить урок
              </button>
            )}
            <button onClick={leaveRoom} className="rounded border px-3 py-1 text-sm">
              Выйти
            </button>
          </div>
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!isTeacher && (
            <button
              onClick={toggleHand}
              className={`rounded border px-3 py-1 text-sm ${self?.handRaised ? "bg-amber-100 border-amber-400" : ""}`}
            >
              {self?.handRaised ? "Опустить руку" : "Поднять руку"}
            </button>
          )}
          {media && self?.permissions.canSpeak && <SelfMicButton />}
          {media && isTeacher && <SelfCameraButton />}
          {media && isTeacher && (
            <button onClick={muteAll} className="rounded border px-3 py-1 text-sm">
              Заглушить всех
            </button>
          )}
          {isTeacher && (
            <>
              <button onClick={() => toggleDrawForAll(true)} className="rounded border px-3 py-1 text-sm">
                Разрешить рисовать всем
              </button>
              <button onClick={() => toggleDrawForAll(false)} className="rounded border px-3 py-1 text-sm">
                Запретить рисовать всем
              </button>
            </>
          )}
        </div>

        <h2 className="mb-2 text-sm font-medium text-slate-600">Участники ({participants.length})</h2>
        <ul className="flex flex-col gap-1">
          {participants.map((p) => (
            <li key={p.userId} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
              <span className="flex items-center gap-2">
                {media ? (
                  <ParticipantPresenceDot userId={p.userId} connected={p.connected} />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-green-500" : "bg-slate-300"}`} />
                )}
                {p.fullName}
                <span className="text-xs text-slate-400">({p.role})</span>
                {p.handRaised && <span title="Поднята рука">✋</span>}
                {media && <MicStatusIcon userId={p.userId} />}
                {media && <ConnectionQualityDot userId={p.userId} />}
              </span>
              {isTeacher && p.userId !== me?.id && (
                <span className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.permissions.canDraw}
                      onChange={(e) => togglePermission(p.userId, "canDraw", e.target.checked)}
                    />
                    рисовать
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.permissions.canSpeak}
                      onChange={(e) => togglePermission(p.userId, "canSpeak", e.target.checked)}
                    />
                    говорить
                  </label>
                  {media && p.permissions.canSpeak && (
                    <button onClick={() => muteParticipant(p.userId)} className="rounded border px-2 py-0.5">
                      Заглушить
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col rounded border">
        <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: "60vh" }}>
          {chat.map((m) => (
            <div key={m.id} className="mb-2 text-sm">
              <span className="font-medium">{m.authorName}: </span>
              <span>{m.body}</span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={sendChat} className="flex gap-2 border-t p-2">
          <input
            className="flex-1 rounded border px-2 py-1 text-sm"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder="Сообщение…"
            maxLength={2000}
          />
          <button type="submit" className="rounded border px-3 py-1 text-sm">
            Отправить
          </button>
        </form>
      </div>
      </div>
    </div>
  );

  if (!deviceCheckDone) {
    return (
      <DeviceCheckScreen
        onContinue={(micId, camId) => {
          setMicDeviceId(micId);
          setCamDeviceId(camId);
          setDeviceCheckDone(true);
        }}
      />
    );
  }

  if (!media) return content;

  return (
    <LiveKitRoom
      serverUrl={media.url}
      token={media.token}
      connect
      options={ROOM_OPTIONS}
      audio={self?.permissions.canSpeak ? { deviceId: micDeviceId ?? undefined } : false}
      // Э5.1: камера — только у учителя/админа (грант на сервере уже
      // ограничивает источник CAMERA той же ролью), автозапуск при входе,
      // как и микрофон; ручной тумблер — `SelfCameraButton`. Э5.4: устройство —
      // то, что выбрано (и проверено превью) на `DeviceCheckScreen`.
      video={isTeacher ? { resolution: VideoPresets.h720.resolution, deviceId: camDeviceId ?? undefined } : false}
      onDisconnected={() => setError("Аудио отключено")}
    >
      <MicSync enabled={self?.permissions.canSpeak ?? false} />
      <TeacherVideoTile />
      {content}
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
