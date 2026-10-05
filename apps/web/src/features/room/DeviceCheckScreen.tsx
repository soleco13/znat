import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Square,
  Volume2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { ButtonGroup } from "@/shared/ui/button-group";
import { Card } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Toggle } from "@/shared/ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { BrandMark } from "@/shared/ui/brand-mark";

type PermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type EchoState = "idle" | "recording" | "ready" | "playing";

const RECORD_MS = 3000;
const METER_BARS = 40;

export type DeviceCheckResult = {
  micDeviceId: string | null;
  camDeviceId: string | null;
  spkDeviceId: string | null;
  micEnabled: boolean;
  camEnabled: boolean;
};

/**
 * Устройство есть и доступ разрешён, но его держит другая программа (Zoom,
 * второй браузер). Раньше это выглядело как «нет доступа — разрешите в
 * браузере», и человек искал настройку, которая уже включена.
 */
function isDeviceBusy(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotReadableError" || err.name === "AbortError");
}

/** Короткий синус-бип 440 Гц для теста динамиков (WAV data-URI, без сети). */
const BEEP_SRC = makeBeep();
function makeBeep(): string {
  const rate = 8000;
  const seconds = 0.4;
  const total = Math.floor(rate * seconds);
  const bytes = 44 + total * 2;
  const buf = new ArrayBuffer(bytes);
  const view = new DataView(buf);
  const wr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  wr(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wr(36, "data");
  view.setUint32(40, total * 2, true);
  for (let i = 0; i < total; i += 1) {
    const fade = Math.min(1, i / 400, (total - i) / 400);
    const sample = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3 * fade;
    view.setInt16(44 + i * 2, sample * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/**
 * Экран проверки устройств перед входом в урок (Э2.4 — микрофон, Э5.4 —
 * камера, Э11 — динамики + новый layout): две колонки — крупное превью
 * камеры слева, микрофон и динамики справа, заметная кнопка входа снизу.
 *
 * Камера и микрофон здесь — локальный просмотр себя: `getUserMedia`-поток
 * никуда не уходит, LiveKit и сервера не касается (право публиковать видео
 * ученику всё так же выдаёт учитель, Э6.1). Тумблеры задают лишь состояние,
 * с которым участник войдёт в урок; переключить можно и внутри.
 *
 * Не должен блокировать вход — при отказе в доступе к устройству всё равно
 * даёт войти, чтобы сбой оборудования не останавливал урок (§1.2 ТЗ).
 */
export function DeviceCheckScreen({
  onContinue,
  lessonTitle,
  defaultCameraOn = false,
}: {
  onContinue: (result: DeviceCheckResult) => void;
  lessonTitle?: string | null;
  /** Учителю/админу камера включается сразу (они всегда публикуют видео); ученику — по кнопке. */
  defaultCameraOn?: boolean;
}) {
  const [micPermission, setMicPermission] = useState<PermissionState>("idle");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [echoState, setEchoState] = useState<EchoState>("idle");
  const [voiceDetected, setVoiceDetected] = useState(false);

  const [camPermission, setCamPermission] = useState<PermissionState>("idle");
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>("");
  const [camEnabled, setCamEnabled] = useState(defaultCameraOn);
  const [camError, setCamError] = useState<string | null>(null);

  const [spkDevices, setSpkDevices] = useState<MediaDeviceInfo[]>([]);
  const [spkId, setSpkId] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelPeakRef = useRef(0);
  const voiceRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const beepElRef = useRef<HTMLAudioElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);

  function stopMeter() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    voiceRef.current = false;
    setVoiceDetected(false);
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    drawMeter(0);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopCamStream() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
  }

  async function refreshDeviceLists() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(list.filter((d) => d.kind === "audioinput"));
      setCamDevices(list.filter((d) => d.kind === "videoinput"));
      const outputs = list.filter((d) => d.kind === "audiooutput");
      setSpkDevices(outputs);
      setSpkId((cur) => cur || outputs.find((d) => d.deviceId === "default")?.deviceId || outputs[0]?.deviceId || "");
    } catch {
      /* enumerateDevices не критичен — выбор устройств просто останется пустым */
    }
  }

  function drawMeter(level: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const gap = 3;
    const barW = Math.max(1, (w - gap * (METER_BARS - 1)) / METER_BARS);
    for (let i = 0; i < METER_BARS; i += 1) {
      // Колокол по центру: середина реагирует сильнее краёв — «живая» дорожка.
      const dist = Math.abs(i - (METER_BARS - 1) / 2) / ((METER_BARS - 1) / 2);
      const shape = 0.35 + 0.65 * Math.cos((dist * Math.PI) / 2);
      const jitter = 0.75 + 0.25 * Math.sin(i * 12.9898 + level * 40);
      const active = Math.max(0.06, level * shape * jitter);
      const barH = Math.max(3, active * h);
      const y = (h - barH) / 2;
      ctx.fillStyle = level > 0.04 ? "hsl(142 71% 45%)" : "hsl(220 13% 82%)";
      const r = Math.max(0, Math.min(barW / 2, barH / 2, 2));
      ctx.beginPath();
      ctx.roundRect(i * (barW + gap), y, barW, barH, r);
      ctx.fill();
    }
  }

  function startMeter(stream: MediaStream) {
    stopMeter();
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const level = Math.min(1, rms * 3.2);
      levelPeakRef.current = Math.max(level, levelPeakRef.current * 0.9);
      drawMeter(reduceMotion ? Math.min(0.5, levelPeakRef.current) : levelPeakRef.current);
      const voice = levelPeakRef.current > 0.08;
      if (voice !== voiceRef.current) {
        voiceRef.current = voice;
        setVoiceDetected(voice);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function openMic(deviceId: string | null) {
    setMicError(null);
    setMicPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      stopStream();
      streamRef.current = stream;
      setMicPermission("granted");
      setMicEnabled(true);
      startMeter(stream);
      await refreshDeviceLists();
      const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (activeId) setMicId(activeId);
    } catch (err) {
      stopStream();
      stopMeter();
      if (
        err instanceof DOMException &&
        (err.name === "NotFoundError" || err.name === "OverconstrainedError")
      ) {
        setMicPermission("unavailable");
        setMicError("Микрофон не найден.");
      } else if (isDeviceBusy(err)) {
        setMicPermission("denied");
        setMicError("Микрофон занят другой программой. Закройте её и нажмите «Ещё раз».");
      } else {
        setMicPermission("denied");
        setMicError("Нет доступа к микрофону. Разрешите его в браузере и попробуйте снова.");
      }
    }
  }

  async function openCam(deviceId: string | null) {
    setCamError(null);
    setCamPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      stopCamStream();
      camStreamRef.current = stream;
      setCamPermission("granted");
      setCamEnabled(true);
      if (camVideoRef.current) camVideoRef.current.srcObject = stream;
      await refreshDeviceLists();
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) setCamId(activeId);
    } catch (err) {
      stopCamStream();
      if (
        err instanceof DOMException &&
        (err.name === "NotFoundError" || err.name === "OverconstrainedError")
      ) {
        setCamPermission("unavailable");
        setCamError("Камера не найдена.");
      } else if (isDeviceBusy(err)) {
        setCamPermission("denied");
        setCamError("Камера занята другой программой. Закройте её и нажмите «Ещё раз».");
      } else {
        setCamPermission("denied");
        setCamError("Нет доступа к камере. Разрешите её в браузере и попробуйте снова.");
      }
    }
  }

  useEffect(() => {
    openMic(null);
    if (defaultCameraOn) openCam(null);
    return () => {
      stopMeter();
      stopStream();
      stopCamStream();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      recorderRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMic() {
    if (micEnabled && micPermission === "granted") {
      stopStream();
      stopMeter();
      setMicEnabled(false);
    } else {
      openMic(micId || null);
    }
  }

  function toggleCam() {
    if (camEnabled && camPermission === "granted") {
      stopCamStream();
      setCamEnabled(false);
    } else {
      openCam(camId || null);
    }
  }

  function handleMicDeviceChange(deviceId: string) {
    setMicId(deviceId);
    setEchoState("idle");
    openMic(deviceId);
  }

  function handleCamDeviceChange(deviceId: string) {
    setCamId(deviceId);
    openCam(deviceId);
  }

  function startEchoTest() {
    const stream = streamRef.current;
    if (!stream || echoState === "recording") return;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (audioElRef.current) audioElRef.current.src = url;
      setEchoState("ready");
    };
    recorder.start();
    setEchoState("recording");
    setTimeout(() => {
      if (recorderRef.current === recorder && recorder.state === "recording") recorder.stop();
    }, RECORD_MS);
  }

  function playEcho() {
    void applySink(audioElRef.current);
    audioElRef.current?.play();
    setEchoState("playing");
  }

  async function applySink(el: HTMLMediaElement | null) {
    if (!el || !spkId) return;
    const withSink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof withSink.setSinkId === "function") {
      await withSink.setSinkId(spkId).catch(() => undefined);
    }
  }

  function testSpeaker() {
    const el = beepElRef.current;
    if (!el) return;
    void applySink(el).then(() => {
      el.currentTime = 0;
      void el.play();
    });
  }

  function handleContinue() {
    const micOn = micPermission === "granted" && micEnabled;
    const camOn = camPermission === "granted" && camEnabled;
    onContinue({
      micDeviceId: micOn ? micId || null : null,
      camDeviceId: camOn ? camId || null : null,
      spkDeviceId: spkId || null,
      micEnabled: micOn,
      camEnabled: camOn,
    });
  }

  const camActive = camPermission === "granted" && camEnabled;
  const micActive = micPermission === "granted" && micEnabled;
  const camFailed = camPermission === "denied" || camPermission === "unavailable";
  const micDeviceLabel =
    micDevices.find((d) => d.deviceId === micId)?.label || (micActive ? "Системный микрофон" : "—");
  const camDeviceLabel =
    camDevices.find((d) => d.deviceId === camId)?.label || (camActive ? "Системная камера" : "—");

  return (
    // Э14: экран обязан целиком помещаться в окно на любом устройстве — ни
    // прокрутки страницы, ни внутренних скроллов (ученик ничего не должен
    // «потерять» за краем). Корень фиксирован по высоте `h-dvh`; на телефоне
    // и планшете в портрете сжимается только превью камеры (`flex-1`),
    // карточки микрофона и динамиков занимают ровно свою высоту. Вариант
    // `short:` (max-height 560px) уплотняет всё в альбомной ориентации.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* На низком экране шапки нет — название урока уезжает в футер. */}
      <header className="shrink-0 border-b border-border bg-card short:hidden">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:h-16">
          <BrandMark className="size-9 text-primary" />
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">Подключение к уроку</p>
            <p className="truncate font-heavy text-foreground">{lessonTitle || "Проверка устройств"}</p>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 justify-center p-3 sm:p-4 lg:items-center short:p-2">
        {/* Телефон/планшет в портрете — колонка: камера сверху, под ней
            микрофон и динамики (на планшете — рядом). От lg и на низком
            экране — прежняя сетка «камера слева, звук справа». */}
        <div className="flex h-full min-h-0 w-full max-w-4xl flex-col gap-3 lg:grid lg:max-h-[28rem] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] short:grid short:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] short:gap-2">
          {/* ---------- Камера ---------- */}
          <Card className="relative min-h-28 flex-1 overflow-hidden bg-slate-900 lg:h-full lg:min-h-0 short:h-full short:min-h-0">
            <div
              className={cn(
                "absolute inset-0 grid place-items-center bg-surface-2 transition-opacity motion-reduce:transition-none",
                camActive && "opacity-0",
              )}
            >
              <div
                className={cn(
                  "flex flex-col items-center gap-2 text-center",
                  // Маленькое превью: плашка ошибки внизу важнее заглушки.
                  camFailed && "hidden sm:flex short:hidden",
                )}
              >
                <CameraOff className="size-6 text-muted-foreground short:size-5" aria-hidden />
                <p className="text-sm font-semibold text-foreground">
                  {camPermission === "requesting" ? "Запрашиваем доступ…" : "Камера выключена"}
                </p>
              </div>
            </div>

            <video
              ref={camVideoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                "absolute inset-0 size-full -scale-x-100 bg-slate-900 object-cover transition-opacity motion-reduce:transition-none",
                !camActive && "opacity-0",
              )}
            />

            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-4.5rem)] flex-col gap-0.5"
            >
              <span
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold",
                  camActive ? "bg-black/65 text-white" : "bg-card text-foreground",
                )}
              >
                {camActive ? (
                  <Camera className="size-3.5" aria-hidden />
                ) : (
                  <CameraOff className="size-3.5" aria-hidden />
                )}
                {camActive ? "Камера включена" : "Камера выключена"}
              </span>
              {camActive && (
                <span className="truncate rounded-pill bg-black/65 px-2.5 py-0.5 text-xs text-white hidden sm:block short:hidden">
                  {camDeviceLabel}
                </span>
              )}
            </div>

            <Toggle
              variant="media"
              size="circle"
              pressed={camActive}
              onPressedChange={toggleCam}
              aria-label="Камера"
              title={camActive ? "Выключить камеру" : "Включить камеру"}
              className="absolute right-3 top-3 size-11"
            >
              {camActive ? <Camera aria-hidden /> : <CameraOff aria-hidden />}
            </Toggle>

            {camFailed ? (
              <div className="absolute inset-x-3 bottom-3">
                <Alert
                  variant="warning"
                  className="bg-card px-3 py-2.5 [&>svg]:left-3 [&>svg]:top-3"
                >
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertDescription className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                    <span className="min-w-0 flex-1 break-words">{camError}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => openCam(null)}
                    >
                      <RotateCcw aria-hidden /> Ещё раз
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            ) : camDevices.length > 0 ? (
              <div className="absolute inset-x-3 bottom-3">
                <Select value={camId} onValueChange={handleCamDeviceChange}>
                  <SelectTrigger
                    aria-label="Выбор камеры"
                    className="h-10 border-0 bg-card text-xs shadow-sm"
                  >
                    <SelectValue placeholder="Камера" />
                  </SelectTrigger>
                  <SelectContent>
                    {camDevices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || "Камера"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </Card>

          {/* ---------- Микрофон + Динамики ---------- */}
          <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:min-h-0 lg:flex-col short:flex short:min-h-0 short:flex-col short:gap-2">
            <Card className="flex flex-col gap-3 p-3 sm:p-4 justify-center lg:min-h-0 lg:flex-1 short:min-h-0 short:flex-1 short:justify-center short:gap-1.5 short:p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-foreground">
                    {micActive ? (
                      <Mic className="size-4 text-primary" aria-hidden />
                    ) : (
                      <MicOff className="size-4 text-muted-foreground" aria-hidden />
                    )}
                    {micActive ? "Микрофон включён" : "Микрофон выключен"}
                  </p>
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"
                  >
                    {micActive && (
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
                          voiceDetected ? "bg-success" : "bg-muted-foreground/40",
                        )}
                      />
                    )}
                    <span className="truncate">
                      {micPermission === "requesting"
                        ? "Запрашиваем доступ…"
                        : micActive && voiceDetected
                          ? "Слышим вас"
                          : micDeviceLabel}
                    </span>
                  </p>
                </div>
                <Toggle
                  variant="media"
                  size="circle"
                  pressed={micActive}
                  onPressedChange={toggleMic}
                  aria-label="Микрофон"
                  title={micActive ? "Выключить микрофон" : "Включить микрофон"}
                  className="size-11 shrink-0 short:size-9"
                >
                  {micActive ? <Mic aria-hidden /> : <MicOff aria-hidden />}
                </Toggle>
              </div>

              <div
                className="rounded-md bg-surface-2 px-2.5 py-2 short:py-1.5"
                aria-busy={micPermission === "requesting"}
              >
                <canvas ref={canvasRef} className="h-8 w-full short:h-5" aria-hidden />
              </div>

              {micPermission === "denied" || micPermission === "unavailable" ? (
                <Alert variant="warning" className="px-3 py-2.5 [&>svg]:left-3 [&>svg]:top-3">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertDescription className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                    <span className="min-w-0 flex-1 break-words">{micError}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => openMic(null)}
                    >
                      <RotateCcw aria-hidden /> Ещё раз
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex flex-col gap-2 short:gap-1.5">
                  <Label
                    htmlFor="device-check-mic"
                    className="sr-only text-xs text-muted-foreground sm:not-sr-only short:sr-only"
                  >
                    Устройство ввода
                  </Label>
                  <Select
                    value={micId}
                    onValueChange={handleMicDeviceChange}
                    disabled={!micActive || micDevices.length < 2}
                  >
                    <SelectTrigger id="device-check-mic" className="h-10 text-xs short:h-9">
                      <SelectValue placeholder="Микрофон" />
                    </SelectTrigger>
                    <SelectContent>
                      {micDevices.map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label || "Микрофон"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ButtonGroup aria-label="Проверка голоса" className="w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 min-w-0 flex-1 short:h-9 short:px-2 short:text-xs"
                      onClick={startEchoTest}
                      disabled={!micActive || echoState === "recording"}
                    >
                      {echoState === "recording" ? <Square aria-hidden /> : <Mic aria-hidden />}
                      {echoState === "recording" ? "Запись… 3 с" : "Записать голос"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 min-w-0 flex-1 short:h-9 short:px-2 short:text-xs"
                      onClick={playEcho}
                      disabled={echoState !== "ready" && echoState !== "playing"}
                    >
                      <Play aria-hidden /> Прослушать
                    </Button>
                  </ButtonGroup>
                </div>
              )}
            </Card>

            {/* Динамики: на телефоне и низком экране — одна строка
                «иконка · выбор устройства · проверить». */}
            <Card className="flex flex-col justify-center gap-2 p-3 sm:justify-start sm:p-4 lg:justify-center short:justify-center short:p-2.5">
              <p className="hidden items-center gap-1.5 font-semibold text-foreground sm:flex short:hidden">
                <Volume2 className="size-4 text-primary" aria-hidden />
                Динамики
              </p>
              <Label
                htmlFor="device-check-spk"
                className="sr-only text-xs text-muted-foreground sm:not-sr-only short:sr-only"
              >
                Устройство вывода звука
              </Label>
              <div className="flex items-center gap-2 sm:flex-col sm:items-stretch short:flex-row short:items-center">
                <Volume2
                  className="block size-5 shrink-0 text-primary sm:hidden short:block"
                  aria-hidden
                />
                <Select
                  value={spkId}
                  onValueChange={(v) => setSpkId(v)}
                  disabled={spkDevices.length === 0}
                >
                  <SelectTrigger
                    id="device-check-spk"
                    className="h-10 min-w-0 flex-1 text-xs sm:flex-none short:h-9 short:flex-1"
                  >
                    <SelectValue
                      placeholder={spkDevices.length ? "Динамики" : "Системные динамики"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {spkDevices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || "Динамики"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 shrink-0 sm:w-full short:h-9 short:w-auto"
                  onClick={testSpeaker}
                >
                  <Play aria-hidden /> Проверить звук
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 short:py-2">
          <p className="hidden text-sm text-muted-foreground sm:block short:hidden">
            Оборудование можно переключить и во время урока
          </p>
          <p className="hidden min-w-0 truncate font-heavy text-foreground short:block">
            {lessonTitle || "Проверка устройств"}
          </p>
          <Button
            size="lg"
            className="w-full sm:ml-auto sm:w-auto sm:min-w-44 short:ml-auto short:h-10 short:w-auto short:shrink-0"
            onClick={handleContinue}
          >
            Присоединиться
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </footer>

      <audio ref={audioElRef} onEnded={() => setEchoState("ready")} className="hidden" />
      <audio ref={beepElRef} src={BEEP_SRC} className="hidden" preload="auto" />
    </div>
  );
}
