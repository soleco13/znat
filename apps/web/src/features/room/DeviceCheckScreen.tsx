import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Play, Square } from "lucide-react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
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

/**
 * Экран проверки устройств перед входом в урок (Э2.4 — микрофон, Э5.4 —
 * камера): выбор микрофона, индикатор уровня, тест эха и — отдельным,
 * необязательным блоком — превью камеры с выбором устройства («Ученик
 * видит себя до урока», ПЛАН.md Э5.4).
 *
 * Камера здесь показывается ВСЕМ, а не только учителю/админу, хотя
 * публиковать видео в LiveKit пока может только их роль
 * (`media/service.ts#buildPublishGrant`, Э5.1) — стоп-лист Э5 запрещает
 * публикацию камеры учеником, но не локальный просмотр себя в браузере:
 * `getUserMedia` для превью никуда не отправляет поток, сервера и LiveKit
 * не касается, нагрузки не создаёт. Выбранная камера передаётся дальше
 * (`onContinue`), чтобы учитель вошёл в урок сразу с нужным устройством;
 * для ученика значение просто не используется, пока у него нет права
 * публиковать (запасено на Э6).
 *
 * Не должен блокировать вход — при ошибке доступа к микрофону/камере даёт
 * войти без проверки, чтобы сбой устройства не останавливал урок (§1.2 ТЗ).
 */
export function DeviceCheckScreen({
  onContinue,
}: {
  onContinue: (micDeviceId: string | null, camDeviceId: string | null) => void;
}) {
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [echoState, setEchoState] = useState<EchoState>("idle");

  // Э5.4: камера — отдельное необязательное состояние, независимое от
  // микрофона (свой поток, своё разрешение браузера, свой список устройств).
  const [camPermission, setCamPermission] = useState<PermissionState>("idle");
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamId, setSelectedCamId] = useState<string>("");
  const [camErrorMessage, setCamErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBarRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);

  function stopLevelMeter() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopCamStream() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
  }

  async function openCamStream(deviceId: string | null) {
    setCamErrorMessage(null);
    setCamPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      stopCamStream();
      camStreamRef.current = stream;
      setCamPermission("granted");
      if (camVideoRef.current) camVideoRef.current.srcObject = stream;

      const list = await navigator.mediaDevices.enumerateDevices();
      setCamDevices(list.filter((d) => d.kind === "videoinput"));
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) setSelectedCamId(activeId);
    } catch (err) {
      stopCamStream();
      if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
        setCamPermission("unavailable");
        setCamErrorMessage("Камера не найдена.");
      } else {
        setCamPermission("denied");
        setCamErrorMessage("Нет доступа к камере. Разрешите доступ в браузере и попробуйте снова.");
      }
    }
  }

  function handleCamDeviceChange(deviceId: string) {
    setSelectedCamId(deviceId);
    openCamStream(deviceId);
  }

  function startLevelMeter(stream: MediaStream) {
    stopLevelMeter();
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const percent = Math.min(100, Math.round(rms * 250));
      if (levelBarRef.current) levelBarRef.current.style.width = `${percent}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function openStream(deviceId: string | null) {
    setErrorMessage(null);
    setPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      stopStream();
      streamRef.current = stream;
      setPermission("granted");
      startLevelMeter(stream);

      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (activeId) setSelectedDeviceId(activeId);
    } catch (err) {
      stopStream();
      stopLevelMeter();
      if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
        setPermission("unavailable");
        setErrorMessage("Микрофон не найден.");
      } else {
        setPermission("denied");
        setErrorMessage("Нет доступа к микрофону. Разрешите доступ в браузере и попробуйте снова.");
      }
    }
  }

  useEffect(() => {
    openStream(null);
    return () => {
      stopLevelMeter();
      stopStream();
      stopCamStream();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      recorderRef.current?.stop();
    };
  }, []);

  function handleDeviceChange(deviceId: string) {
    setSelectedDeviceId(deviceId);
    setEchoState("idle");
    openStream(deviceId);
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
    audioElRef.current?.play();
    setEchoState("playing");
  }

  function handleContinue() {
    onContinue(
      permission === "granted" ? selectedDeviceId || null : null,
      camPermission === "granted" ? selectedCamId || null : null,
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="size-5 text-primary" aria-hidden />
            Проверка устройств
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Убедитесь, что микрофон работает, прежде чем войти в урок.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {permission === "requesting" ? (
            <p className="text-sm text-muted-foreground">Запрашиваем доступ к микрофону…</p>
          ) : null}

          {permission === "denied" || permission === "unavailable" ? (
            <Alert variant="warning">
              <AlertDescription className="space-y-2">
                <p>{errorMessage}</p>
                <Button variant="outline" size="sm" onClick={() => openStream(null)}>
                  Попробовать снова
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {permission === "granted" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Микрофон</Label>
                <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Микрофон" />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || "Микрофон"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Уровень сигнала</Label>
                <div className="h-3 w-full overflow-hidden rounded-pill bg-surface-3">
                  <div
                    ref={levelBarRef}
                    className="h-full bg-success transition-[width] duration-75"
                    style={{ width: "0%" }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Скажите что-нибудь — полоска должна двигаться.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Тест эха</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startEchoTest}
                    disabled={echoState === "recording"}
                  >
                    {echoState === "recording" ? (
                      <Square aria-hidden />
                    ) : (
                      <Mic aria-hidden />
                    )}
                    {echoState === "recording" ? "Запись… (3 с)" : "Записать голос"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={playEcho}
                    disabled={echoState !== "ready" && echoState !== "playing"}
                  >
                    <Play aria-hidden />
                    Прослушать
                  </Button>
                </div>
                <audio ref={audioElRef} onEnded={() => setEchoState("ready")} className="hidden" />
              </div>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-border pt-4">
            <Label className="flex items-center gap-1.5">
              <Camera className="size-4" aria-hidden /> Камера (необязательно)
            </Label>

            {camPermission === "idle" ? (
              <Button variant="outline" size="sm" onClick={() => openCamStream(null)}>
                Проверить камеру
              </Button>
            ) : null}

            {camPermission === "requesting" ? (
              <p className="text-sm text-muted-foreground">Запрашиваем доступ к камере…</p>
            ) : null}

            {camPermission === "denied" || camPermission === "unavailable" ? (
              <Alert variant="warning">
                <AlertDescription className="space-y-2">
                  <p>{camErrorMessage}</p>
                  <Button variant="outline" size="sm" onClick={() => openCamStream(null)}>
                    Попробовать снова
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {camPermission === "granted" ? (
              <div className="space-y-2">
                <Select value={selectedCamId} onValueChange={handleCamDeviceChange}>
                  <SelectTrigger>
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
                <video
                  ref={camVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full scale-x-[-1] rounded-lg bg-slate-900 object-cover"
                />
              </div>
            ) : null}
          </div>

          <Button className="w-full" size="lg" onClick={handleContinue}>
            Войти в урок
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
