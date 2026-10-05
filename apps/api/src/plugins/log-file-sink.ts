import { createWriteStream, statfs } from "node:fs";
import { dirname } from "node:path";

/**
 * Запись лога в файл на хосте (LOG_FILE) с потолками. Без них файл рос со
 * скоростью запросов: строка пишется на каждый HTTP-запрос (в том числе на
 * отказ 429 и на статику вне лимита) и на каждое событие телеметрии, а
 * logrotate хоста смотрит на размер раз в час. Поток мусорных запросов
 * заполнял бы диск, а на том же диске — Postgres и Redis: урок упал бы не
 * от нагрузки, а от переполнения.
 *
 * - Бюджет байт в минуту: info/debug — до INFO_BYTES_PER_MINUTE, warn и
 *   выше — до TOTAL_BYTES_PER_MINUTE. Сверх — строки отбрасываются, раз в
 *   минуту одна строка `log_dropped` со счётчиками. Обычный урок на 30 человек
 *   пишет десятки КБ в минуту — до бюджета на порядки.
 * - Мало места на диске (MIN_FREE_BYTES) — в файл не пишем вовсе. stdout
 *   (docker logs, ротация 20 МБ × 3) работает как раньше.
 * - Ошибка файла (ENOSPC, удалённый каталог) — не роняем процесс, через
 *   REOPEN_AFTER_MS открываем файл снова: после чистки диска лог вернётся
 *   без рестарта.
 */
export const INFO_BYTES_PER_MINUTE = 2 * 1024 * 1024;
export const TOTAL_BYTES_PER_MINUTE = 4 * 1024 * 1024;
export const MIN_FREE_BYTES = 1024 * 1024 * 1024;
const WINDOW_MS = 60_000;
const DISK_CHECK_MS = 30_000;
const REOPEN_AFTER_MS = 60_000;

export interface LogFileSinkDeps {
  open(path: string): { write(chunk: string): unknown; on(event: "error", cb: (err: Error) => void): unknown; destroy(): unknown };
  /** Свободно байт на томе файла; null — узнать не удалось (тогда пишем). */
  freeBytes(path: string): Promise<number | null>;
  now(): number;
  report(message: string): void;
}

const defaultDeps: LogFileSinkDeps = {
  open: (path) => createWriteStream(path, { flags: "a" }),
  freeBytes: (path) =>
    new Promise((resolve) => {
      statfs(dirname(path), (err, stats) => resolve(err ? null : stats.bavail * stats.bsize));
    }),
  now: () => Date.now(),
  report: (message) => process.stderr.write(`${message}\n`),
};

function isWarnOrAbove(chunk: string): boolean {
  return chunk.includes('"level":"warn"') || chunk.includes('"level":"error"') || chunk.includes('"level":"fatal"');
}

export interface LogFileSink {
  write(chunk: string): void;
  checkDisk(): Promise<void>;
  stop(): void;
}

export function createLogFileSink(path: string, overrides: Partial<LogFileSinkDeps> = {}): LogFileSink {
  const deps = { ...defaultDeps, ...overrides };
  let file: ReturnType<LogFileSinkDeps["open"]> | null = null;
  let brokenAt: number | null = null;
  let lowDisk = false;
  let windowStart = deps.now();
  let windowBytes = 0;
  let windowInfoBytes = 0;
  let droppedLines = 0;
  let droppedBytes = 0;

  const open = () => {
    const stream = deps.open(path);
    stream.on("error", (err) => {
      if (file !== stream) return;
      deps.report(`log file unavailable: ${err.message}`);
      file = null;
      brokenAt = deps.now();
      stream.destroy();
    });
    file = stream;
    brokenAt = null;
  };
  open();

  const rollWindow = (now: number) => {
    if (now - windowStart < WINDOW_MS) return;
    if (droppedLines > 0 && file && !lowDisk) {
      file.write(
        `${JSON.stringify({
          level: "warn",
          time: new Date(now).toISOString(),
          service: "api",
          event: "log_dropped",
          msg: "log_dropped",
          droppedLines,
          droppedBytes,
          windowMs: now - windowStart,
        })}\n`,
      );
    }
    windowStart = now;
    windowBytes = 0;
    windowInfoBytes = 0;
    droppedLines = 0;
    droppedBytes = 0;
  };

  const checkDisk = async () => {
    const free = await deps.freeBytes(path);
    const low = free !== null && free < MIN_FREE_BYTES;
    if (low !== lowDisk) {
      deps.report(low ? `log file paused: ${free} bytes free on disk` : "log file resumed: disk space available");
    }
    lowDisk = low;
  };
  void checkDisk();
  const diskTimer = setInterval(() => void checkDisk(), DISK_CHECK_MS);
  diskTimer.unref();

  return {
    write(chunk: string) {
      const now = deps.now();
      rollWindow(now);
      if (lowDisk) return;
      if (!file) {
        if (brokenAt === null || now - brokenAt < REOPEN_AFTER_MS) return;
        open();
      }
      const size = Buffer.byteLength(chunk);
      const important = isWarnOrAbove(chunk);
      const overBudget =
        windowBytes + size > TOTAL_BYTES_PER_MINUTE || (!important && windowInfoBytes + size > INFO_BYTES_PER_MINUTE);
      if (overBudget) {
        droppedLines += 1;
        droppedBytes += size;
        return;
      }
      windowBytes += size;
      if (!important) windowInfoBytes += size;
      file!.write(chunk);
    },
    checkDisk,
    stop() {
      clearInterval(diskTimer);
    },
  };
}
