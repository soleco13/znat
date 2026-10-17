import { useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext, VideoTrack } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { NoiseSuppressionMode } from "@school/shared";
import { Mic, Video, Volume2, Waves, type LucideIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import {
  autoNoise,
  currentNoiseMode,
  setUserNoiseMode,
  strongNoiseAvailable,
  useNoiseVersion,
  type NoiseEffective,
} from "./noise-suppression.js";

const NOISE_LABEL: Record<NoiseEffective, string> = {
  strong: "сильное",
  standard: "обычное",
  off: "выключено",
};

/**
 * Настройки устройств посреди урока. Переключает уже идущую публикацию через
 * `room.switchActiveDevice()` по «Применить». Превью — реальный опубликованный
 * трек, а не второй `getUserMedia` с того же устройства.
 */
export function DeviceSettingsModal({
  open,
  onOpenChange,
  schoolNoiseMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Режим шумоподавления школы — с ним «Авто», пока участник не выбрал своё. */
  schoolNoiseMode: NoiseSuppressionMode;
}) {
  const room = useRoomContext();
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();

  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [spkDevices, setSpkDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [spkId, setSpkId] = useState("");
  // Выбор участника поверх режима школы (`noise-suppression.ts`) — до
  // закрытия страницы; при повторном открытии показываем текущий.
  useNoiseVersion();
  const [noiseMode, setNoiseMode] = useState<NoiseSuppressionMode>("auto");
  const strongOk = strongNoiseAvailable();

  useEffect(() => {
    if (!open) return;
    setMicId("");
    setCamId("");
    setSpkId("");
    setNoiseMode(currentNoiseMode(schoolNoiseMode));
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const usable = list.filter((d) => d.deviceId !== "");
        setMicDevices(usable.filter((d) => d.kind === "audioinput"));
        setCamDevices(usable.filter((d) => d.kind === "videoinput"));
        setSpkDevices(usable.filter((d) => d.kind === "audiooutput"));
      })
      .catch(() => undefined);
  }, [open, room, schoolNoiseMode]);

  function apply() {
    if (micId) void room.switchActiveDevice("audioinput", micId).catch(() => undefined);
    if (camId) void room.switchActiveDevice("videoinput", camId).catch(() => undefined);
    if (spkId) void room.switchActiveDevice("audiooutput", spkId).catch(() => undefined);

    // Применяет `NoiseSuppressionController` — к микрофону и к дефолту комнаты.
    setUserNoiseMode(noiseMode);

    onOpenChange(false);
  }

  const cameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
  const videoTrackRef =
    cameraTrack?.videoTrack && isCameraEnabled
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[720px] gap-0 overflow-y-auto rounded-[20px] p-0">
        <DialogHeader className="flex-row items-baseline gap-2.5 space-y-0 border-b border-border px-[22px] py-[18px] pr-14">
          <DialogTitle className="text-lg font-heavy tracking-[-.02em]">Настройки</DialogTitle>
          <DialogDescription className="text-[13px]">устройства и качество</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[22px] p-[22px] sm:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-[250px]">
            <div className="aspect-video overflow-hidden rounded-xl bg-slate-900">
              {videoTrackRef ? (
                <VideoTrack trackRef={videoTrackRef} className="size-full -scale-x-100 object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-white/60">
                  Камера выключена
                </div>
              )}
            </div>
            <MicLevelMeter active={isMicrophoneEnabled} />
            <span className="text-xs text-text-3">Скажите что-нибудь — полоса должна двигаться.</span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <DeviceField label="Микрофон" icon={Mic} value={micId} onChange={setMicId} devices={micDevices} fallback="Микрофон" />
            <DeviceField label="Камера" icon={Video} value={camId} onChange={setCamId} devices={camDevices} fallback="Камера" />
            <DeviceField label="Звук выводить в" icon={Volume2} value={spkId} onChange={setSpkId} devices={spkDevices} fallback="Динамики" />

            <div className="flex items-center gap-3 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <Waves className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text-2">Шумоподавление</p>
                  <p className="text-xs text-text-3">Убирает фоновый шум с вашего микрофона</p>
                </div>
              </div>
            </div>
            <Select value={noiseMode} onValueChange={(v) => setNoiseMode(v as NoiseSuppressionMode)}>
              <SelectTrigger className="-mt-2 h-10 text-sm" aria-label="Шумоподавление">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Авто — по возможностям устройства (сейчас: {NOISE_LABEL[autoNoise()]})
                </SelectItem>
                <SelectItem value="strong" disabled={!strongOk}>
                  {strongOk ? "Сильное — убирает и громкий фон" : "Сильное — недоступно на этом устройстве"}
                </SelectItem>
                <SelectItem value="standard">Обычное — встроенное в браузер</SelectItem>
                <SelectItem value="off">Выключено</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-[22px] py-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={apply}>Применить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeviceField({
  label,
  icon: Icon,
  value,
  onChange,
  devices,
  fallback,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (id: string) => void;
  devices: MediaDeviceInfo[];
  fallback: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[13px] font-semibold text-text-2">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">
            <SelectValue placeholder="Устройство по умолчанию" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {devices.map((d) => (
            <SelectItem key={d.deviceId} value={d.deviceId}>
              {d.label || fallback}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Уровень локального микрофона по уже опубликованному треку (`AnalyserNode`). */
function MicLevelMeter({ active }: { active: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
    const mediaTrack = pub?.audioTrack?.mediaStreamTrack;
    if (!mediaTrack) return;

    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 90));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      src.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [active, localParticipant]);

  return (
    <div className="flex items-center gap-2">
      <Mic className={active ? "size-4 text-success" : "size-4 text-muted-foreground"} aria-hidden />
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </span>
    </div>
  );
}
