import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import type {
  ChatMessage,
  JoinLessonResponse,
  LessonStatus,
  MediaConnection,
  ParticipantSnapshot,
  ServerRoomMessage,
} from "@school/shared";
import { apiFetch } from "../../shared/api-client.js";
import { useAuthStore } from "../../shared/auth-store.js";
import { ConnectionQualityDot, PacketLossWarning } from "./ConnectionQuality.js";
import { DeviceCheckScreen } from "./DeviceCheckScreen.js";
import { MediaAudioStatus } from "./MediaAudioStatus.js";
import { MicStatusIcon, SelfMicButton } from "./MicControls.js";
import { MicSync } from "./MicSync.js";
import { ParticipantPresenceDot } from "./ParticipantPresenceDot.js";
import { useRoomSocket } from "./useRoomSocket.js";

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
  const [error, setError] = useState<string | null>(null);
  // LiveKit-подключение (Э2, только аудио — см. стоп-лист Э2 в docs/CURRENT_STAGE.md).
  const [media, setMedia] = useState<MediaConnection | null>(null);
  // Экран проверки устройств (Э2.4) — пока не пройден, в урок не входим (ни HTTP join, ни WS).
  const [deviceCheckDone, setDeviceCheckDone] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
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
    <div className="mx-auto mt-8 grid max-w-5xl grid-cols-[2fr_1fr] gap-4 px-4">
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
          {media && isTeacher && (
            <button onClick={muteAll} className="rounded border px-3 py-1 text-sm">
              Заглушить всех
            </button>
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
  );

  if (!deviceCheckDone) {
    return (
      <DeviceCheckScreen
        onContinue={(deviceId) => {
          setMicDeviceId(deviceId);
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
      audio={self?.permissions.canSpeak ? { deviceId: micDeviceId ?? undefined } : false}
      video={false}
      onDisconnected={() => setError("Аудио отключено")}
    >
      <MicSync enabled={self?.permissions.canSpeak ?? false} />
      {content}
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
