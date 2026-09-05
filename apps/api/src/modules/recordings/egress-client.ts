import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EgressStatus,
  EncodingOptionsPreset,
  type EgressInfo,
} from "livekit-server-sdk";
import type { RecordingStatus } from "@school/shared";
import { env } from "../../plugins/env.js";

/**
 * Э10 — тонкая обёртка над LiveKit Egress (§10.4 ТЗ). Egress-контейнер
 * живёт на ВТОРОЙ машине и сам держит связь с LiveKit-сервером и Redis по
 * внутренней сети; API отсюда ставит и снимает задания через тот же
 * `LIVEKIT_URL`, что и остальной media/ (egress-команды идут через
 * LiveKit-сервер, не напрямую в egress).
 *
 * Читать построчно (§1.2 CLAUDE.md, «конфиги LiveKit не делегировать
 * вслепую»): ошибка в layout/битрейте тихо испортит все записи, а
 * заметят через недели.
 */

// Тот же приём, что в media/service.ts: SDK сам меняет ws→http для twirp.
const egressClient = new EgressClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

/**
 * Проекция `livekit.EgressStatus` на наш `RecordingStatus`. `deleted` —
 * не из egress (удаление файла по ретеншну), тут не появляется.
 * `LIMIT_REACHED` → `failed`: для пользователя это тот же исход (записи нет).
 */
export function mapEgressStatus(status: EgressStatus | undefined): RecordingStatus {
  switch (status) {
    case EgressStatus.EGRESS_STARTING:
      return "starting";
    case EgressStatus.EGRESS_ACTIVE:
      return "recording";
    case EgressStatus.EGRESS_ENDING:
      return "processing";
    case EgressStatus.EGRESS_COMPLETE:
      return "ready";
    case EgressStatus.EGRESS_ABORTED:
      return "aborted";
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_LIMIT_REACHED:
      return "failed";
    default:
      // Неизвестный/未来 статус — считаем, что запись ещё идёт, чтобы не
      // отдать пользователю ложное «готово» и не удалить файл раньше срока.
      return "processing";
  }
}

/**
 * H.264 720p @ ~1.5 Мбит/с (§10.10 ТЗ, строка про лавинообразный рост
 * хранилища). Дефолтный пресет LiveKit `H264_720P_30` — ровно это.
 */
const RECORDING_ENCODING_PRESET = EncodingOptionsPreset.H264_720P_30;

export interface StartRecordingParams {
  /** Комната урока в LiveKit (`lessons.livekit_room`, напр. `lesson-<uuid>`). */
  roomName: string;
  /**
   * Ключ файла в хранилище школы. Egress-контейнер пишет по этому пути
   * (`STORAGE_ROOT` смонтирован в него так же, как в API); доступ к
   * готовому файлу — только через StorageAdapter (CLAUDE.md). При
   * переезде на S3 (§10.6 ТЗ) здесь меняется тип output, `storageKey`
   * остаётся тот же.
   */
  storageKey: string;
  /** Абсолютный путь к файлу для egress = `${STORAGE_ROOT}/${storageKey}`. */
  absoluteFilepath: string;
}

export interface StartedRecording {
  egressId: string;
  status: RecordingStatus;
}

/**
 * RoomComposite (а не Track/Participant egress) — «как выглядел урок»
 * (§10.4 ТЗ, вариант 1). Кастомный layout (Э10.2: демонстрация/доска
 * крупно + плитка учителя) — веб-страница `/egress` фронтенда, задаётся
 * `RECORDING_EGRESS_TEMPLATE_URL` (обычно `${PUBLIC_ORIGIN}/egress`);
 * egress сам допишет `?url=&token=&layout=`. Пусто → дефолтный `speaker`
 * layout LiveKit.
 */
export async function startRoomRecording(params: StartRecordingParams): Promise<StartedRecording> {
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: params.absoluteFilepath,
    // Манифест LiveKit (.json рядом с файлом) нам не нужен — метаданные
    // ведём в таблице recordings.
    disableManifest: true,
  });

  const info = await egressClient.startRoomCompositeEgress(params.roomName, output, {
    layout: env.RECORDING_EGRESS_TEMPLATE_URL ? "speaker" : "",
    customBaseUrl: env.RECORDING_EGRESS_TEMPLATE_URL ?? "",
    encodingOptions: RECORDING_ENCODING_PRESET,
  });

  return { egressId: info.egressId, status: mapEgressStatus(info.status) };
}

export async function stopRecording(egressId: string): Promise<RecordingStatus> {
  const info = await egressClient.stopEgress(egressId);
  return mapEgressStatus(info.status);
}

/**
 * Активные egress по комнате — для Э10.5 (алерт «egress без публикующих»)
 * и защиты от двойного старта.
 */
export async function listActiveEgress(roomName?: string): Promise<EgressInfo[]> {
  const all = await egressClient.listEgress(roomName ? { roomName, active: true } : { active: true });
  return all;
}

/** Детали одного egress по id — синхронизация статуса, если вебхук потерялся. */
export async function getEgressInfo(egressId: string): Promise<EgressInfo | null> {
  const list = await egressClient.listEgress({ egressId });
  return list[0] ?? null;
}
