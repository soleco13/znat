/**
 * Конвертер презентаций (Э4.1 каркас + Э4.3 воркер). Изолированный контейнер:
 * LibreOffice + Poppler + ClamAV, без выхода в интернет (docker-сеть `convnet`
 * с `internal: true`), `read_only` rootfs, `cap_drop: ALL`.
 *
 * Забирает задачи из очереди BullMQ `deck-convert` (producer — `apps/api`),
 * concurrency 1 (§10.3 ТЗ: LibreOffice — всплеск CPU, параллелить нельзя).
 * Результат возвращается значением задачи; в `apps/api` слушатель QueueEvents
 * кладёт слайды в БД и шлёт WS-прогресс. Конвертер БД не видит — только Redis
 * и общий том `/data/assets`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "bullmq";
import { CONVERT_QUEUE_NAME, type ConvertJobData } from "./contract.js";
import { runConversion } from "./convert.js";

const execFileAsync = promisify(execFile);

const REQUIRED_BINARIES: ReadonlyArray<{ cmd: string; args: string[] }> = [
  { cmd: "soffice", args: ["--version"] },
  { cmd: "pdftoppm", args: ["-v"] },
  { cmd: "pdfinfo", args: ["-v"] },
  { cmd: "pdftotext", args: ["-v"] },
  { cmd: "clamscan", args: ["--version"] },
];

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, svc: "converter", msg, ...extra };
  (level === "error" ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
}

async function checkBinaries(): Promise<void> {
  const missing: string[] = [];
  for (const { cmd, args } of REQUIRED_BINARIES) {
    try {
      await execFileAsync(cmd, args, { timeout: 15_000 });
      log("info", "binary ok", { cmd });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        missing.push(cmd);
        log("error", "binary missing", { cmd });
      } else {
        log("info", "binary ok", { cmd, note: "non-zero exit on version probe" });
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Отсутствуют обязательные бинарники: ${missing.join(", ")}`);
  }
}

/**
 * Самопроверка изоляции: контейнер НЕ должен иметь маршрута в интернет
 * (парсит недоверенные файлы, §17 ТЗ). Успех запроса наружу = сломанная
 * изоляция — логируем громко, но не падаем (граница — конфиг docker-сети).
 */
async function assertNoInternet(): Promise<void> {
  for (const url of ["https://api.github.com", "https://1.1.1.1"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
      log("warn", "СЕТЕВАЯ ИЗОЛЯЦИЯ НАРУШЕНА: конвертер достучался наружу", {
        url,
        status: res.status,
      });
      return;
    } catch {
      // Ожидаемо: нет DNS / маршрута.
    }
  }
  log("info", "network isolation confirmed: наружу хода нет");
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
  const storageRoot = process.env.STORAGE_ROOT ?? "/data/assets";
  log("info", "converter starting", { redisUrl, storageRoot, node: process.version });

  await checkBinaries();
  await assertNoInternet();

  // connection объектом опций — BullMQ сам создаёт и закрывает соединения.
  const worker = new Worker<ConvertJobData>(
    CONVERT_QUEUE_NAME,
    async (job) => {
      log("info", "job received", { jobId: job.id, deckId: job.data.deckId });
      return runConversion(job.data, (p) => job.updateProgress(p));
    },
    { connection: { url: redisUrl, maxRetriesPerRequest: null }, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log("error", "job failed", { jobId: job?.id, deckId: job?.data.deckId, err: err.message });
  });
  worker.on("completed", (job) => {
    log("info", "job completed", { jobId: job.id, deckId: job.data.deckId });
  });
  worker.on("error", (err) => {
    log("error", "worker error", { err: err.message });
  });

  log("info", "converter ready — слушаю очередь", { queue: CONVERT_QUEUE_NAME });

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log("info", "shutting down", { signal });
      void worker.close().finally(resolve);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log("error", "converter fatal", { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  },
);
