import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Loader } from "@/shared/ui/loader";
import { formatDuration } from "./format.js";

const SPEEDS = [1, 1.25, 1.5, 2] as const;
const SKIP_SEC = 10;
/** Через сколько без движения мыши прячем панель управления во время воспроизведения. */
const IDLE_HIDE_MS = 2500;

function fmt(sec: number): string {
  return formatDuration(Math.max(0, Math.floor(sec)));
}

function ControlButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-[38px] shrink-0 items-center justify-center rounded-md text-white transition-colors duration-150 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 [&_svg]:size-[18px]",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Плеер записи урока (макет «Просмотр записи»): своя панель поверх
 * `<video>` — прогресс с буферизацией, ±10 секунд, скорость, звук,
 * «картинка в картинке», полный экран и горячие клавиши. Клавиши слушаем
 * на window, пока плеер на странице, кроме ввода в поля.
 */
export function RecordingPlayer({ src, className }: { src: string; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const hintTimer = useRef<number | undefined>(undefined);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const flashHint = useCallback((text: string) => {
    setHint(text);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 700);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, t));
    setTime(v.currentTime);
    setStarted(true);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      seekTo(v.currentTime + delta);
      flashHint(delta < 0 ? `−${SKIP_SEC} сек` : `+${SKIP_SEC} сек`);
    },
    [seekTo, flashHint],
  );

  const cycleSpeed = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const i = SPEEDS.indexOf(v.playbackRate as (typeof SPEEDS)[number]);
    const next = (i + 1) % SPEEDS.length;
    const rate = SPEEDS[next]!;
    v.playbackRate = rate;
    setSpeed(next);
    flashHint(`${rate}×`);
  }, [flashHint]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const pip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void v.requestPictureInPicture?.().catch(() => {});
  }, []);

  // Горячие клавиши.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.code === "Space" || key === "k" || key === "л") {
        // Пробел на сфокусированной кнопке плеера — это её собственный клик.
        if (e.code === "Space" && t?.tagName === "BUTTON") return;
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        skip(-SKIP_SEC);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip(SKIP_SEC);
      } else if (key === "s" || key === "ы") cycleSpeed();
      else if (key === "m" || key === "ь") toggleMute();
      else if (key === "f" || key === "а") toggleFullscreen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip, cycleSpeed, toggleMute, toggleFullscreen]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(hintTimer.current);
    };
  }, []);

  function wake() {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_HIDE_MS);
  }

  function updateBuffered() {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    // Буферизованный отрезок, в котором сейчас стоит воспроизведение.
    for (let i = 0; i < v.buffered.length; i += 1) {
      if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
        setBuffered(v.buffered.end(i));
        return;
      }
    }
  }

  function seekFromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const controlsHidden = playing && idle;
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document;

  return (
    <div
      ref={frameRef}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
      className={cn(
        "group/player relative aspect-video select-none overflow-hidden bg-[#0b1220] [&:fullscreen]:aspect-auto",
        controlsHidden && "cursor-none",
        className,
      )}
    >
      <video
        ref={videoRef}
        key={src}
        src={src}
        playsInline
        preload="metadata"
        className="absolute inset-0 size-full"
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setIdle(false);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          updateBuffered();
        }}
        onProgress={updateBuffered}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onError={() => {
          setFailed(true);
          setBuffering(false);
        }}
      />

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-white">
          <span className="text-lg font-bold tracking-[-0.02em]">Видео не открылось</span>
          <span className="max-w-sm text-sm text-white/70">
            Ссылка на файл могла устареть. Обновите страницу — ссылка выдаётся заново.
          </span>
        </div>
      ) : null}

      {!started && !failed ? (
        <button
          type="button"
          onClick={toggle}
          aria-label="Смотреть запись"
          className="absolute inset-0 flex items-center justify-center bg-[#0b1220]/40 transition-colors duration-150 hover:bg-[#0b1220]/30 focus-visible:outline-none"
        >
          <span className="flex size-[76px] items-center justify-center rounded-full bg-white text-foreground shadow-md">
            <Play className="ml-1 size-[30px] fill-current" aria-hidden />
          </span>
        </button>
      ) : null}

      {buffering && playing ? (
        <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader className="size-11 text-white/80" />
          <span className="sr-only">Видео загружается</span>
        </div>
      ) : null}

      {hint ? (
        <div
          key={hint}
          className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 -translate-x-1/2 -translate-y-1/2 items-center rounded-pill bg-black/60 px-[18px] text-[15px] font-bold tabular-nums text-white animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {hint}
        </div>
      ) : null}

      {started && !failed ? (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-b from-transparent to-black/70 px-2.5 pb-2 pt-7 transition-opacity duration-200 sm:gap-2.5 sm:px-[18px] sm:pb-3.5 sm:pt-10",
            controlsHidden && "pointer-events-none opacity-0",
          )}
        >
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Позиция воспроизведения"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${fmt(time)} из ${fmt(duration)}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
            }}
            className="group/bar relative flex h-[18px] cursor-pointer touch-none items-center"
          >
            <span className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/bar:h-1.5">
              <span className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufPct}%` }} />
              <span className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
            </span>
            <span
              className="pointer-events-none absolute -ml-[7px] size-3.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.2)]"
              style={{ left: `${pct}%` }}
            />
          </div>

          <div className="flex items-center gap-1.5 text-white">
            <ControlButton label={playing ? "Пауза" : "Воспроизвести"} onClick={toggle} className="[&_svg]:size-5">
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </ControlButton>
            <ControlButton label="Назад 10 секунд" onClick={() => skip(-SKIP_SEC)} className="max-sm:hidden">
              <RotateCcw />
            </ControlButton>
            <ControlButton label="Вперёд 10 секунд" onClick={() => skip(SKIP_SEC)} className="max-sm:hidden">
              <RotateCw />
            </ControlButton>
            <span className="ml-1.5 whitespace-nowrap text-[13px] font-semibold tabular-nums">
              {fmt(time)}
              <span className="text-white/55"> / {fmt(duration)}</span>
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleSpeed();
              }}
              aria-label={`Скорость ${SPEEDS[speed]}×`}
              className="h-[30px] whitespace-nowrap rounded-sm border border-white/30 px-2.5 text-[12.5px] font-bold tabular-nums text-white transition-colors duration-150 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {SPEEDS[speed]}×
            </button>
            <ControlButton label={muted ? "Включить звук" : "Выключить звук"} onClick={toggleMute} className="max-sm:hidden">
              {muted ? <VolumeX /> : <Volume2 />}
            </ControlButton>
            {pipSupported ? (
              <ControlButton label="Картинка в картинке" onClick={pip} className="max-sm:hidden">
                <PictureInPicture2 />
              </ControlButton>
            ) : null}
            <ControlButton label={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран"} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </ControlButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
