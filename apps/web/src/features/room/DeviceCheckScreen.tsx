import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CameraOff,
  GraduationCap,
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
  let bin = "";
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]!);
  return `data:audio/wav;base64,${btoa(bin)}`;
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
    const barW = (w - gap * (METER_BARS - 1)) / METER_BARS;
    for (let i = 0; i < METER_BARS; i += 1) {
      // Колокол по центру: середина реагирует сильнее краёв — «живая» дорожка.
      const dist = Math.abs(i - (METER_BARS - 1) / 2) / ((METER_BARS - 1) / 2);
      const shape = 0.35 + 0.65 * Math.cos((dist * Math.PI) / 2);
      const jitter = 0.75 + 0.25 * Math.sin(i * 12.9898 + level * 40);
      const active = Math.max(0.06, level * shape * jitter);
      const barH = Math.max(3, active * h);
      const y = (h - barH) / 2;
      ctx.fillStyle = level > 0.04 ? "hsl(142 71% 45%)" : "hsl(220 13% 82%)";
      const r = Math.min(barW / 2, 2);
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
  const micDeviceLabel =
    micDevices.find((d) => d.deviceId === micId)?.label || (micActive ? "Системный микрофон" : "—");
  const camDeviceLabel =
    camDevices.find((d) => d.deviceId === camId)?.label || (camActive ? "Системная камера" : "—");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">Подключение к уроку</p>
            <p className="truncate font-heavy text-foreground">{lessonTitle || "Проверка устройств"}</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        {/* Э12.7: фиксированная сетка — камера + микрофон + динамики образуют
            единый блок постоянного размера. Переключение тумблеров и
            появление подсказок НЕ меняют раскладку: у правых карточек
            фиксированная высота строк и внутренний скролл, контролы всегда
            в разметке (в выключенном состоянии — disabled). */}
        <div className="grid w-full max-w-4xl gap-3 md:h-[26rem] md:grid-cols-[3fr_2fr]">
          {/* ---------- Камера ---------- */}
          <Card className="relative aspect-video overflow-hidden bg-slate-900 md:aspect-auto md:h-full">
            <div
              className={cn(
                "absolute inset-0 grid place-items-center bg-gradient-to-br from-primary-light via-card to-teal-light transition-opacity",
                camActive && "opacity-0",
              )}
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-16 items-center justify-center rounded-2xl bg-card/80 text-primary shadow-sm">
                  <GraduationCap className="size-8" aria-hidden />
                </span>
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
                "absolute inset-0 size-full -scale-x-100 bg-slate-900 object-cover transition-opacity",
                !camActive && "opacity-0",
              )}
            />

            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-4.5rem)] flex-col gap-0.5">
              <span
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold backdrop-blur",
                  camActive ? "bg-black/45 text-white" : "bg-card/85 text-foreground",
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
                <span className="truncate rounded-pill bg-black/35 px-2.5 py-0.5 text-[11px] text-white/85 backdrop-blur">
                  {camDeviceLabel}
                </span>
              )}
            </div>

            <Toggle
              variant="media"
              size="circle"
              pressed={camActive}
              onPressedChange={toggleCam}
              aria-label={camActive ? "Выключить камеру" : "Включить камеру"}
              className="absolute right-3 top-3 size-11"
            >
              {camActive ? <Camera aria-hidden /> : <CameraOff aria-hidden />}
            </Toggle>

            {camPermission === "denied" || camPermission === "unavailable" ? (
              <div className="absolute inset-x-3 bottom-3">
                <Alert variant="warning" className="bg-card/95 backdrop-blur">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    <span>{camError}</span>
                    <Button variant="outline" size="sm" onClick={() => openCam(null)}>
                      <RotateCcw aria-hidden /> Ещё раз
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            ) : camDevices.length > 0 ? (
              <div className="absolute inset-x-3 bottom-3">
                <Select value={camId} onValueChange={handleCamDeviceChange}>
                  <SelectTrigger className="h-10 border-0 bg-card/90 text-xs shadow-sm backdrop-blur">
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
          <div className="grid min-h-0 gap-3 md:grid-rows-[1.55fr_1fr]">
            <Card className="flex min-h-0 flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-foreground">
                    {micActive ? (
                      <Mic className="size-4 text-primary" aria-hidden />
                    ) : (
                      <MicOff className="size-4 text-muted-foreground" aria-hidden />
                    )}
                    {micActive ? "Микрофон включён" : "Микрофон выключен"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {micPermission === "requesting" ? "Запрашиваем доступ…" : micDeviceLabel}
                  </p>
                </div>
                <Toggle
                  variant="media"
                  size="circle"
                  pressed={micActive}
                  onPressedChange={toggleMic}
                  aria-label={micActive ? "Выключить микрофон" : "Включить микрофон"}
                  className="size-11 shrink-0"
                >
                  {micActive ? <Mic aria-hidden /> : <MicOff aria-hidden />}
                </Toggle>
              </div>

              <div className="mt-3 rounded-md bg-surface-2 p-2.5">
                <canvas ref={canvasRef} className="h-9 w-full" aria-hidden />
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {micPermission === "denied" || micPermission === "unavailable" ? (
                  <Alert variant="warning">
                    <AlertTriangle className="size-4" aria-hidden />
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      <span>{micError}</span>
                      <Button variant="outline" size="sm" onClick={() => openMic(null)}>
                        <RotateCcw aria-hidden /> Ещё раз
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Select
                      value={micId}
                      onValueChange={handleMicDeviceChange}
                      disabled={!micActive || micDevices.length < 2}
                    >
                      <SelectTrigger className="h-10 text-xs">
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
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={startEchoTest}
                        disabled={!micActive || echoState === "recording"}
                      >
                        {echoState === "recording" ? <Square aria-hidden /> : <Mic aria-hidden />}
                        {echoState === "recording" ? "Запись… 3 с" : "Записать голос"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={playEcho}
                        disabled={echoState !== "ready" && echoState !== "playing"}
                      >
                        <Play aria-hidden /> Прослушать
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="flex min-h-0 flex-col justify-center gap-2 p-4">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <Volume2 className="size-4 text-primary" aria-hidden />
                Динамики
              </p>
              <Label className="sr-only">Устройство вывода звука</Label>
              <Select
                value={spkId}
                onValueChange={(v) => setSpkId(v)}
                disabled={spkDevices.length === 0}
              >
                <SelectTrigger className="h-10 text-xs">
                  <SelectValue
                    placeholder={
                      spkDevices.length ? "Динамики" : "Список появится после доступа к микрофону"
                    }
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
              <Button variant="outline" size="sm" className="w-full" onClick={testSpeaker}>
                <Play aria-hidden /> Проверить звук
              </Button>
            </Card>
          </div>
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <p className="hidden text-sm text-muted-foreground sm:block">
            Оборудование можно переключить и во время урока
          </p>
          <Button size="lg" className="ml-auto min-w-44" onClick={handleContinue}>
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
