import { describe, expect, it } from "vitest";
import {
  INFO_BYTES_PER_MINUTE,
  MIN_FREE_BYTES,
  TOTAL_BYTES_PER_MINUTE,
  createLogFileSink,
  type LogFileSinkDeps,
} from "./log-file-sink.js";

function fakeDeps(free: number | null = 50 * 1024 ** 3) {
  const state = { now: 1_000_000, free, written: [] as string[], reports: [] as string[], opens: 0 };
  let onError: ((err: Error) => void) | null = null;
  const deps: LogFileSinkDeps = {
    open: () => {
      state.opens += 1;
      return {
        write: (chunk: string) => state.written.push(chunk),
        on: (_event: "error", cb: (err: Error) => void) => {
          onError = cb;
        },
        destroy: () => undefined,
      };
    },
    freeBytes: async () => state.free,
    now: () => state.now,
    report: (message) => state.reports.push(message),
  };
  return { state, deps, fail: (err: Error) => onError?.(err) };
}

const line = (level: string, pad = 0) => `{"level":"${level}","msg":"x${"y".repeat(pad)}"}\n`;
const bytes = (chunks: string[]) => chunks.reduce((sum, c) => sum + Buffer.byteLength(c), 0);

describe("createLogFileSink", () => {
  it("поток строк сверх бюджета минуты не пишется в файл, потом — одна строка log_dropped", async () => {
    const { state, deps } = fakeDeps();
    const sink = createLogFileSink("/var/log/znat/api.log", deps);
    await sink.checkDisk();
    const chunk = line("info", 1000);
    for (let i = 0; i < 100_000; i += 1) sink.write(chunk);
    expect(bytes(state.written)).toBeLessThanOrEqual(INFO_BYTES_PER_MINUTE);

    // Предупреждения ещё проходят — до общего бюджета.
    sink.write(line("warn"));
    expect(state.written.at(-1)).toContain('"warn"');

    state.now += 61_000;
    sink.write(line("info"));
    const summary = state.written.find((c) => c.includes("log_dropped"));
    expect(summary).toBeDefined();
    expect(JSON.parse(summary!).droppedLines).toBeGreaterThan(90_000);
    // Новое окно — новый бюджет.
    expect(state.written.at(-1)).toBe(line("info"));
    sink.stop();
  });

  it("общий потолок держит и поток ошибок", async () => {
    const { state, deps } = fakeDeps();
    const sink = createLogFileSink("/x/api.log", deps);
    await sink.checkDisk();
    const chunk = line("error", 1000);
    for (let i = 0; i < 100_000; i += 1) sink.write(chunk);
    expect(bytes(state.written)).toBeLessThanOrEqual(TOTAL_BYTES_PER_MINUTE);
    sink.stop();
  });

  it("мало места на диске — в файл не пишет, место появилось — пишет снова", async () => {
    const { state, deps } = fakeDeps(MIN_FREE_BYTES - 1);
    const sink = createLogFileSink("/x/api.log", deps);
    await sink.checkDisk();
    sink.write(line("error"));
    expect(state.written).toHaveLength(0);
    expect(state.reports.some((r) => r.includes("paused"))).toBe(true);

    state.free = 10 * MIN_FREE_BYTES;
    await sink.checkDisk();
    sink.write(line("info"));
    expect(state.written).toEqual([line("info")]);
    sink.stop();
  });

  it("ошибка файла (ENOSPC) не бросает исключение, через минуту файл открывается снова", async () => {
    const { state, deps, fail } = fakeDeps();
    const sink = createLogFileSink("/x/api.log", deps);
    await sink.checkDisk();
    fail(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }));
    expect(() => sink.write(line("info"))).not.toThrow();
    expect(state.written).toHaveLength(0);
    expect(state.opens).toBe(1);

    state.now += 61_000;
    sink.write(line("info"));
    expect(state.opens).toBe(2);
    expect(state.written.at(-1)).toBe(line("info"));
    sink.stop();
  });

  it("неизвестный размер диска не останавливает лог", async () => {
    const { state, deps } = fakeDeps(null);
    const sink = createLogFileSink("/x/api.log", deps);
    await sink.checkDisk();
    sink.write(line("info"));
    expect(state.written).toHaveLength(1);
    sink.stop();
  });
});
