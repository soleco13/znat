/**
 * Конвертер презентаций (Э4.1). Изолированный контейнер: LibreOffice + Poppler +
 * ClamAV, без выхода в интернет (docker-сеть `convnet` с `internal: true`),
 * `read_only` rootfs, `cap_drop: ALL`. Пайплайн BullMQ (скан → soffice → pdftoppm
 * → PNG/WebP → StorageAdapter) — это Э4.3; здесь только каркас процесса и
 * самопроверка среды: нужные бинарники на месте, наружу хода нет.
 *
 * Почему отдельный контейнер (§4.1.1 / §10.2 ТЗ): (1) парсинг недоверенных
 * офисных файлов — классический вектор RCE, его нужно держать в отдельном
 * cgroup без сети; (2) LibreOffice раздувает образ на ~1,5 ГБ; (3) конвертация
 * даёт всплески CPU на 100% нескольких ядер — их нельзя пускать в один cgroup
 * с медиа (раскладка ядер — Э4.2, §10.3 ТЗ).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HEARTBEAT_MS = 60_000;

/** Бинарники, которые обязаны быть в образе. Проверяются на старте. */
const REQUIRED_BINARIES: ReadonlyArray<{ cmd: string; args: string[] }> = [
  { cmd: "soffice", args: ["--version"] },
  { cmd: "pdftoppm", args: ["-v"] },
  { cmd: "pdfinfo", args: ["-v"] },
  { cmd: "pdftotext", args: ["-v"] },
  { cmd: "clamscan", args: ["--version"] },
];

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, svc: "converter", msg, ...extra };
  const sink = level === "error" ? process.stderr : process.stdout;
  sink.write(`${JSON.stringify(line)}\n`);
}

async function checkBinaries(): Promise<void> {
  const missing: string[] = [];
  for (const { cmd, args } of REQUIRED_BINARIES) {
    try {
      // pdftoppm/pdfinfo/pdftotext печатают версию в stderr и выходят с кодом 99 —
      // нам важен сам факт, что бинарник нашёлся и запустился, а не его код.
      await execFileAsync(cmd, args, { timeout: 15_000 });
      log("info", "binary ok", { cmd });
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { code?: string | number };
      if (e.code === "ENOENT") {
        missing.push(cmd);
        log("error", "binary missing", { cmd });
      } else {
        // Ненулевой код выхода (как у poppler-утилит на `-v`) — бинарник есть.
        log("info", "binary ok", { cmd, note: "non-zero exit on version probe" });
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Отсутствуют обязательные бинарники: ${missing.join(", ")}`);
  }
}

/**
 * Самопроверка изоляции: контейнер НЕ должен иметь маршрута в интернет.
 * Успешный ответ извне — это сломанная изоляция (конвертер парсит недоверенные
 * файлы, §17 ТЗ). Логируем громко, но не падаем: единственная граница —
 * конфигурация docker-сети, а не этот процесс.
 */
async function assertNoInternet(): Promise<void> {
  const probes = ["https://api.github.com", "https://1.1.1.1"];
  for (const url of probes) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
      log("warn", "СЕТЕВАЯ ИЗОЛЯЦИЯ НАРУШЕНА: конвертер достучался наружу", {
        url,
        status: res.status,
      });
      return;
    } catch {
      // Ожидаемо: DNS не резолвится / нет маршрута.
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

  // Э4.3 подключит сюда BullMQ Worker (concurrency: 1) на очереди convert.
  log("info", "converter ready (idle — пайплайн подключается в Э4.3)");

  const heartbeat = setInterval(() => {
    log("info", "heartbeat", { rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log("info", "shutting down", { signal });
      clearInterval(heartbeat);
      resolve();
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
