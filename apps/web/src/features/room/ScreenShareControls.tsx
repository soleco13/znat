import { useEffect, useRef } from "react";
import { useLocalParticipant, useTracks } from "@livekit/components-react";
import { Track, VideoPreset } from "livekit-client";
import type { ClaimScreenShareResponse } from "@school/shared";
import { MonitorUp, MonitorX } from "lucide-react";

import { apiFetch } from "@/shared/api-client";
import { RoomControlButton, type RoomControlVariant } from "./RoomControlButton.js";
import { toast } from "@/shared/ui/sonner";

/**
 * Э7.1, §5.2 ТЗ: «1080p@5fps для документов» — дефолт, когда параметры
 * школы (§10.10 ТЗ, запрос 2026-09-14) ещё не загружены или явно не заданы.
 * Битрейт 1 Мбит/с — ОЦЕНКА, не факт из ТЗ/LiveKit: `ScreenSharePresets.
 * h1080fps15` берёт 2.5 Мбит/с на 15 fps, при втрое меньшем fps (5)
 * пропорционально вышло бы ~0.83 Мбит/с, округлено чуть вверх ради чёткости
 * текста документа (низкий fps не должен экономить на резкости кадра).
 *
 * Э12.7 UX: выбор «документ / видео» из панели убран (ученики и пожилые
 * учителя не должны выбирать fps/битрейт вручную на КАЖДОМ показе) — но
 * админ школы теперь может задать разрешение/fps ОДИН раз в «Параметрах»
 * (`toScreenShareEncoding`, `media-quality.ts`), а не за каждым учителем.
 */
const DOCUMENT_SCREEN_SHARE_PRESET = new VideoPreset(1920, 1080, 1_000_000, 5, "medium");

/**
 * Дополнительные слои демонстрации под полным (настройки школы): сервер
 * отдаёт каждому зрителю лучший слой, который пролезает в его канал, и сам
 * переключает их при изменении связи (на ближайшем опорном кадре).
 * - нижний: 360p, 5 кадр/с, 150 кбит/с — экран почти статичный, частота не
 *   важна, а в канал 100–200 кбит/с пролезает;
 * - средний: 540p (для источника 1080p — 720p), до 15 кадр/с, ~30% битрейта
 *   полного (400–1200 кбит/с) — для средней связи. Без него разрыв между
 *   нижним и полным был в 16 раз, и зритель с каналом ~1 Мбит/с всё время
 *   смотрел размытый нижний слой.
 * LiveKit делает третий слой, только если ширина источника ≥ 960 px.
 */
function screenShareExtraLayers(encoding: VideoPreset): VideoPreset[] {
  const { width, height } = encoding.resolution;
  const scaled = (targetHeight: number) => {
    const scale = Math.min(1, targetHeight / height);
    return { w: Math.round(width * scale), h: Math.round(height * scale) };
  };
  const low = scaled(360);
  const layers = [new VideoPreset(low.w, low.h, 150_000, 5, "medium")];
  const midHeight = height >= 1080 ? 720 : 540;
  if (height > midHeight) {
    const mid = scaled(midHeight);
    const midBitrate = Math.min(1_200_000, Math.max(400_000, Math.round(encoding.encoding.maxBitrate * 0.3)));
    layers.push(new VideoPreset(mid.w, mid.h, midBitrate, 15, "medium"));
  }
  return layers;
}

function releaseScreenShare(lessonId: string) {
  void apiFetch(`/lessons/${lessonId}/screen-share/release`, { method: "POST" }).catch(() => undefined);
}

/**
 * Демонстрация экрана (Э7.1). Аудио вкладки НЕ запрашивается (`audio:
 * false`) — стоп-лист Э7: «не делать шаринг вкладки со звуком в MVP».
 * `screenShareEncoding`, не `videoEncoding` — прочитано в типах
 * `TrackPublishDefaults` (`options.d.ts`): `videoEncoding` — это параметры
 * именно КАМЕРЫ, демонстрация экрана кодируется отдельным полем.
 *
 * Право `canShareScreen` одно на учителя (по умолчанию,
 * `presence.ts#defaultPermissions`) и ученика по разрешению (Э7.4) — кнопка
 * одна и та же для обеих ролей, видимость решает вызывающая сторона
 * (`RoomPage.tsx`).
 *
 * **Максимум 1 демонстрация одновременно — пользовательский баг (2026-09-14):
 * «2 участника почти одновременно жмут демонстрацию → оба трека реально
 * публикуются → вся сетка ломается».** Раньше сервер гасил лишнюю ТОЛЬКО
 * ПОСЛЕ публикации (вебхук `track_published`) — окно гонки между «оба уже
 * летят» и «лишний погашен» давало на клиенте на миг 2 живых трека разом.
 * Теперь клиент СНАЧАЛА спрашивает разрешение (`POST /lessons/:id/
 * screen-share/claim`, атомарный Redis-лок на сервере) и публикует трек
 * ТОЛЬКО при `granted: true` — гонки между двумя claim'ами больше нет.
 * Не-учитель: отказ, если лок уже занят (кто угодно). Учитель/админ
 * (`priority`): безусловный перехват — прежний держатель лока получает WS
 * `screen_share_preempted` (`preemptedSignal` проп ниже) и обязан сам
 * остановить СВОЙ трек локально, сервер не может выключить чужую
 * демонстрацию без участия его браузера.
 */
export function SelfScreenShareButton({
  lessonId,
  priority = false,
  encoding = DOCUMENT_SCREEN_SHARE_PRESET,
  /** Меняется (растёт) при получении WS `screen_share_preempted`, адресованного этому участнику — см. `RoomPage.tsx`. */
  preemptedSignal,
  onScreenShareStarted,
  onScreenShareStopped,
  variant,
}: {
  lessonId: string;
  priority?: boolean;
  /** Параметры школы (запрос 2026-09-14) — разрешение/битрейт/fps демонстрации, считается `toScreenShareEncoding` в `RoomPage.tsx`. По умолчанию — профиль «документ» (см. `DOCUMENT_SCREEN_SHARE_PRESET`). */
  encoding?: VideoPreset;
  preemptedSignal?: number;
  /** Доп. — авто-PiP (Толк-кнопка, `PictureInPictureButton`): вызывается
   *  сразу после успешного старта демонстрации, из ТОГО ЖЕ клик-хендлера
   *  (иначе браузер может отказать `requestPictureInPicture()` без
   *  свежего user activation — см. докстринг `PictureInPictureButton`). */
  onScreenShareStarted?: () => void;
  /** Закрыть PiP-окно сразу по клику «Стоп» из ГЛАВНОЙ панели (не только
   *  из тулбара внутри самого PiP, см. `ScreenShareAutoPip`) — не ждать
   *  `isScreenShareEnabled` из LiveKit-негоциации. */
  onScreenShareStopped?: () => void;
  variant?: RoomControlVariant;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const othersSharing = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).some(
    (t) => t.participant.identity !== localParticipant.identity,
  );
  // Мягкая UI-подсказка (без похода на сервер) — реальный гейт ниже, claim().
  const blocked = !isScreenShareEnabled && othersSharing && !priority;

  const isScreenShareEnabledRef = useRef(isScreenShareEnabled);
  isScreenShareEnabledRef.current = isScreenShareEnabled;

  // Учитель/админ перехватил лок — прежний держатель обязан сам погасить
  // СВОЙ трек (сервер не может это сделать за него).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!isScreenShareEnabledRef.current) return;
    onScreenShareStopped?.();
    void localParticipant.setScreenShareEnabled(false);
    toast.info("Демонстрацию перехватил учитель/администратор");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preemptedSignal]);

  async function claim(): Promise<ClaimScreenShareResponse> {
    return apiFetch<ClaimScreenShareResponse>(`/lessons/${lessonId}/screen-share/claim`, {
      method: "POST",
    });
  }

  /**
   * `withLowLayer` — дополнительные облегчённые слои (`screenShareExtraLayers`):
   * демонстрация одна на урок и шла ОДНИМ потоком по настройкам школы (720p,
   * 30 кадр/с, 2,5 Мбит/с); ученику на мобильной сети с каналом 100–200
   * кбит/с сервер её либо не отдавал вовсе, либо отдавал рывками — а сам
   * пережать поток не умеет. С облегчённым слоем сервер отдаёт каждому то,
   * что пролезет в его канал; у остальных качество прежнее.
   */
  async function publishOnce(withLowLayer: boolean): Promise<void> {
    if (withLowLayer) {
      await localParticipant.setScreenShareEnabled(
        true,
        { audio: false, resolution: encoding.resolution, contentHint: "detail" },
        {
          screenShareEncoding: encoding.encoding,
          screenShareSimulcastLayers: screenShareExtraLayers(encoding),
          simulcast: true,
        },
      );
      return;
    }
    await localParticipant.setScreenShareEnabled(
      true,
      {
        audio: false,
        resolution: encoding.resolution,
        contentHint: "detail",
      },
      {
        screenShareEncoding: encoding.encoding,
        // Параметры школы (запрос 2026-09-14) сделали разрешение/fps
        // демонстрации настраиваемыми — админ задаёт ОДНО фиксированное
        // качество на школу, адаптивные слои (simulcast) под него не
        // нужны, а комплексный расчёт нескольких слоёв под нестандартную
        // пару resolution/fps — источник тихого зависания публикации
        // (баг, пойманный по факту: «publish time out» в логах LiveKit
        // при 720p/30fps, у дефолтного 1080p/5fps не проявлялся). Один
        // слой — надёжный путь публикации независимо от выбранных цифр.
        simulcast: false,
      },
    );
  }

  /**
   * `setScreenShareEnabled` иногда НЕ отклоняется, а зависает без ответа
   * (сервер LiveKit видит это как «publish time out», ~10с — пойманное по
   * логам поведение, первопричина внутри WebRTC-негоциации клиента не
   * установлена точно, что-то похожее на гонку/коллизию рядом с моментом
   * входа в комнату). Обычный try/catch тут бессилен — нечему бросить
   * исключение, промис просто не резолвится. Оборачиваем в таймаут и, если
   * не успели за 6с, гасим зависшую попытку и пробуем ОДИН раз ещё —
   * эмпирически вторая попытка стабильно проходит быстро (собственно то,
   * что и обходил пользователь руками — «включить второй раз»).
   */
  async function publishWithTimeout(withLowLayer: boolean): Promise<"ok" | "timeout"> {
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 6000));
    const result = await Promise.race([publishOnce(withLowLayer).then(() => "ok" as const), timeout]);
    return result;
  }

  async function toggle() {
    if (isScreenShareEnabled) {
      onScreenShareStopped?.();
      await localParticipant.setScreenShareEnabled(false);
      releaseScreenShare(lessonId);
      return;
    }
    const claimResult = await claim().catch(
      (): ClaimScreenShareResponse => ({ granted: true, holderName: null }), // сеть легла — не блокируем демонстрацию из-за этого, старый вебхук-гейт подстрахует
    );
    if (!claimResult.granted) {
      toast.error(
        claimResult.holderName
          ? `Демонстрирует ${claimResult.holderName} — дождитесь окончания`
          : "Кто-то уже демонстрирует экран",
      );
      return;
    }
    try {
      let outcome = await publishWithTimeout(true).catch(() => "timeout" as const);
      if (outcome === "timeout") {
        // Зависшая попытка публикации сама трек не остановит — гасим явно
        // перед повтором, иначе второй вызов будет конкурировать с первым.
        // Повтор — прежним проверенным путём, одним слоем: если зависание
        // связано со слоями, демонстрация всё равно начнётся.
        await localParticipant.setScreenShareEnabled(false).catch(() => undefined);
        outcome = await publishWithTimeout(false);
      }
      if (outcome === "timeout") {
        toast.error("Не удалось начать демонстрацию — попробуйте ещё раз");
        releaseScreenShare(lessonId);
        return;
      }
      onScreenShareStarted?.();
    } catch (e) {
      releaseScreenShare(lessonId);
      toast.error(e instanceof Error ? `Не удалось начать демонстрацию: ${e.message}` : "Не удалось начать демонстрацию экрана");
    }
  }

  return (
    <RoomControlButton
      tone="action"
      active={isScreenShareEnabled}
      activeIcon={MonitorX}
      inactiveIcon={MonitorUp}
      activeLabel="Остановить демонстрацию"
      inactiveLabel="Демонстрация"
      onToggle={toggle}
      disabled={blocked}
      title={blocked ? "Кто-то уже демонстрирует экран" : undefined}
      caption="Экран"
      variant={variant}
    />
  );
}

/** Строка статуса над демонстрацией: кто показывает экран, у себя — кнопка «Остановить». */
export function ScreenShareStatusBar({
  lessonId,
  participants,
  onStopped,
}: {
  lessonId: string | undefined;
  participants: { userId: string; fullName: string }[];
  onStopped?: () => void;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const track = useTracks([Track.Source.ScreenShare], { onlySubscribed: true })[0];
  if (!track) return null;
  const isSelf = track.participant.identity === localParticipant.identity;
  const name =
    participants.find((p) => p.userId === track.participant.identity)?.fullName ??
    (track.participant.name || "Участник");

  async function stop() {
    onStopped?.();
    await localParticipant.setScreenShareEnabled(false);
    if (lessonId) releaseScreenShare(lessonId);
  }

  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-primary-muted bg-primary-light px-3 py-2 text-[13.5px] text-primary">
      <MonitorUp className="size-[17px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {isSelf ? "Вы показываете экран" : `${name} показывает экран`}
      </span>
      {isSelf && isScreenShareEnabled ? (
        <button
          type="button"
          onClick={() => void stop()}
          className="h-[30px] shrink-0 rounded-[9px] bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Остановить
        </button>
      ) : null}
    </div>
  );
}
