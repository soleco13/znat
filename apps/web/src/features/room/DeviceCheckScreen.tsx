import { useEffect, useRef, useState } from "react";

type PermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type EchoState = "idle" | "recording" | "ready" | "playing";

const RECORD_MS = 3000;

/**
 * Экран проверки устройств перед входом в урок (Э2.4): выбор микрофона,
 * индикатор уровня и тест эха (запись/прослушивание своего голоса).
 * Не должен блокировать вход — при ошибке доступа к микрофону даёт войти
 * без проверки, чтобы сбой устройства не останавливал урок (§1.2 ТЗ).
 */
export function DeviceCheckScreen({ onContinue }: { onContinue: (deviceId: string | null) => void }) {
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [echoState, setEchoState] = useState<EchoState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBarRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);

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
    onContinue(permission === "granted" ? selectedDeviceId || null : null);
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded border px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold">Проверка микрофона</h1>
      <p className="mb-4 text-sm text-slate-500">Убедитесь, что микрофон работает, прежде чем войти в урок.</p>

      {permission === "requesting" && <p className="text-sm text-slate-500">Запрашиваем доступ к микрофону…</p>}

      {(permission === "denied" || permission === "unavailable") && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-2">{errorMessage}</p>
          <button onClick={() => openStream(null)} className="rounded border border-amber-400 px-2 py-1 text-xs">
            Попробовать снова
          </button>
        </div>
      )}

      {permission === "granted" && (
        <>
          <label className="mb-1 block text-xs font-medium text-slate-600">Микрофон</label>
          <select
            className="mb-4 w-full rounded border px-2 py-1 text-sm"
            value={selectedDeviceId}
            onChange={(e) => handleDeviceChange(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Микрофон"}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-xs font-medium text-slate-600">Уровень сигнала</label>
          <div className="mb-4 h-3 w-full overflow-hidden rounded bg-slate-100">
            <div ref={levelBarRef} className="h-full bg-green-500 transition-[width] duration-75" style={{ width: "0%" }} />
          </div>
          <p className="mb-4 text-xs text-slate-400">Скажите что-нибудь — полоска должна двигаться.</p>

          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium text-slate-600">Тест эха</label>
            <div className="flex items-center gap-2">
              <button
                onClick={startEchoTest}
                disabled={echoState === "recording"}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                {echoState === "recording" ? "Запись… (3 с)" : "Записать голос"}
              </button>
              <button
                onClick={playEcho}
                disabled={echoState !== "ready" && echoState !== "playing"}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                Прослушать
              </button>
            </div>
            <audio ref={audioElRef} onEnded={() => setEchoState("ready")} className="hidden" />
          </div>
        </>
      )}

      <button onClick={handleContinue} className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white">
        Войти в урок
      </button>
    </div>
  );
}
