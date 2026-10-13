import type { VideoCodec } from "livekit-client";

import { track } from "@/shared/telemetry";

/**
 * Профиль устройства — определяется молча при открытии урока, до входа в
 * комнату (запрос 2026-10-13: «в фоне, чтобы пользователь ни о чём не
 * знал»). Настройки школы остаются потолком качества; профиль лишь решает,
 * как этого качества достигать на конкретном устройстве:
 *  - `codec` — аппаратное сжатие видео. Если VP8 этот браузер сжимает
 *    программно, а H.264 — видеокартой, камера и экран идут в H.264.
 *    Урок 2026-10-13: Pentium N3700 сжимал всё программно (libvpx), процессор
 *    был в «critical» ещё до демонстрации, а с ней рвался голос;
 *  - `weak` — слабый процессор: сразу лёгкий режим (камера 360p, экран одним
 *    потоком 5 кадр/с, звук демонстрации моно и тише по битрейту), а не через
 *    минуту лагов, пока его найдёт `cpu-load-engine`.
 * У нормальных устройств профиль ничего не меняет.
 */
export interface DeviceProfile {
  codec: VideoCodec;
  /** Браузер обещает аппаратный H.264 (VP8 при этом программный) — только для журнала, см. `detect`. */
  h264Hw: boolean;
  weak: boolean;
  /** Условные операции за мс одного потока (i7-8700 ≈ 66, Pentium N3700 ≈ 17). */
  score: number;
  cores: number;
}

/** Ниже — процессор уровня Celeron/Pentium N, Atom, старых i3 мобильных. */
const WEAK_SCORE = 28;

let cached: DeviceProfile | null = null;
let pending: Promise<DeviceProfile> | null = null;

/** Профиль, если уже определён; иначе `null` — тогда работаем как раньше. */
export function deviceProfileNow(): DeviceProfile | null {
  return cached;
}

/** Определить профиль (один раз за загрузку страницы). Не бросает. */
export function detectDeviceProfile(): Promise<DeviceProfile> {
  if (cached) return Promise.resolve(cached);
  pending ??= detect()
    .catch((): DeviceProfile => ({ codec: "vp8", h264Hw: false, weak: false, score: 0, cores: navigator.hardwareConcurrency ?? 0 }))
    .then((profile) => {
      cached = profile;
      track("device_profile", { ...profile });
      return profile;
    });
  return pending;
}

async function detect(): Promise<DeviceProfile> {
  const cores = navigator.hardwareConcurrency ?? 0;
  // Замер — когда страница простаивает, иначе он мерил бы загрузку страницы.
  await idle();
  const score = cpuScore();
  const weak = score > 0 && (score < WEAK_SCORE || (cores > 0 && cores <= 2));
  const [vp8, h264] = await Promise.all([encoderInfo("video/VP8"), encoderInfo(H264_CONTENT_TYPE)]);
  const h264Hw = !vp8.powerEfficient && h264.supported && h264.powerEfficient;
  // H.264 пока не включаем (урок 2026-10-13): у ученицы с Pentium-уровнем
  // браузер пообещал аппаратный H.264, опубликовал демонстрацию в H.264 и
  // через секунду сам переключился на VP8 — LiveKit такую смену кодека без
  // запасного не переживает («can't regress codec»), и демонстрацию не видел
  // никто. Вернуть — только с проверкой фактического кодека после публикации.
  const codec: VideoCodec = "vp8";
  return { codec, h264Hw, weak, score: Math.round(score * 10) / 10, cores };
}

/** Тот же профиль H.264, что согласует WebRTC в Chrome/Safari (baseline, packetization-mode=1). */
const H264_CONTENT_TYPE = 'video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f';

async function encoderInfo(contentType: string): Promise<{ supported: boolean; powerEfficient: boolean }> {
  const caps = navigator.mediaCapabilities;
  if (!caps?.encodingInfo) return { supported: false, powerEfficient: false };
  try {
    const info = await caps.encodingInfo({
      type: "webrtc",
      video: { contentType, width: 1280, height: 720, bitrate: 1_500_000, framerate: 30 },
    } as MediaEncodingConfiguration);
    return { supported: info.supported, powerEfficient: info.powerEfficient };
  } catch {
    return { supported: false, powerEfficient: false };
  }
}

/** Короткий (≈ 3 × 25 мс) замер скорости одного потока; берём лучший из трёх. */
function cpuScore(): number {
  let best = 0;
  let sink = 0;
  for (let round = 0; round < 3; round++) {
    const ms = 25;
    const end = performance.now() + ms;
    let n = 0;
    while (performance.now() < end) {
      for (let i = 0; i < 1000; i++) sink += Math.sqrt(i * 1.0001 + (sink % 7));
      n++;
    }
    best = Math.max(best, n / ms);
  }
  // Не даём оптимизатору выбросить цикл.
  if (sink === -1) console.debug(sink);
  return best;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 1500 });
    else setTimeout(resolve, 300);
  });
}
