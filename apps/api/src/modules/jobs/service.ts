/**
 * Инфраструктура очередей BullMQ (§4.1.1 ТЗ: `jobs/ queues.ts + обработчики`).
 * Сейчас одна очередь — `deck-convert` (Э4.3): producer здесь, worker в
 * отдельном контейнере `services/converter`.
 *
 * Модуль НЕ знает про decks — персистентность результата делает вызывающий
 * код через переданные колбэки (`startConvertEvents`). Так нет зависимости
 * `jobs → decks` и, значит, цикла.
 *
 * jobId задачи === deckId (задача 1:1 с презентацией): событие QueueEvents
 * несёт только jobId, а так по нему сразу известен deckId без похода за
 * `job.data`.
 *
 * `connection` передаём объектом опций (не готовым ioredis-клиентом) — тогда
 * соединения создаёт и закрывает сам BullMQ на `.close()`, без ручного учёта.
 */
import { Queue, QueueEvents } from "bullmq";
import {
  CONVERT_QUEUE_NAME,
  type ConvertJobData,
  type ConvertJobProgress,
  type ConvertJobResult,
} from "@school/shared";
import { env } from "../../plugins/env.js";

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null } as const;

let convertQueue: Queue<ConvertJobData, ConvertJobResult> | null = null;
let convertEvents: QueueEvents<ConvertJobResult> | null = null;

function getConvertQueue(): Queue<ConvertJobData, ConvertJobResult> {
  convertQueue ??= new Queue<ConvertJobData, ConvertJobResult>(CONVERT_QUEUE_NAME, { connection });
  return convertQueue;
}

/** Ставит презентацию в очередь конвертации. Идемпотентно по deckId. */
export async function enqueueConvert(data: ConvertJobData): Promise<void> {
  await getConvertQueue().add("convert", data, {
    jobId: data.deckId,
    // Конвертация недоверенного файла: одна попытка, без авторетраев —
    // на битом .pptx повтор упадёт так же, учитель перезаливает сам.
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86_400 },
  });
}

export interface ConvertJobHandlers {
  onProgress(deckId: string, progress: ConvertJobProgress): Promise<void> | void;
  onCompleted(deckId: string, result: ConvertJobResult): Promise<void> | void;
  onFailed(deckId: string, reason: string): Promise<void> | void;
}

/**
 * Подписывается на события очереди и раздаёт их переданным обработчикам.
 * Вызывать один раз из композиционного корня (`server.ts`).
 */
export function startConvertEvents(handlers: ConvertJobHandlers): void {
  if (convertEvents) return;
  const events = new QueueEvents<ConvertJobResult>(CONVERT_QUEUE_NAME, { connection });
  convertEvents = events;

  events.on("progress", ({ jobId, data }) => {
    const progress = data as ConvertJobProgress;
    if (typeof progress?.total !== "number") return;
    void Promise.resolve(handlers.onProgress(jobId, progress)).catch((err: unknown) => {
      console.error("jobs: onProgress handler failed", jobId, err);
    });
  });

  events.on("completed", ({ jobId, returnvalue }) => {
    void Promise.resolve(handlers.onCompleted(jobId, returnvalue)).catch((err: unknown) => {
      console.error("jobs: onCompleted handler failed", jobId, err);
    });
  });

  events.on("failed", ({ jobId, failedReason }) => {
    void Promise.resolve(handlers.onFailed(jobId, failedReason)).catch((err: unknown) => {
      console.error("jobs: onFailed handler failed", jobId, err);
    });
  });
}

export async function stopConvertEvents(): Promise<void> {
  await convertEvents?.close();
  await convertQueue?.close();
  convertEvents = null;
  convertQueue = null;
}
