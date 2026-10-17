/**
 * AudioWorklet шумоподавления RNNoise (запрос 2026-10-17, «сильное»
 * шумоподавление). Собирается Vite отдельным файлом (`?worker&url`), WASM
 * встроен в сам скрипт — ничего не качается с чужих адресов.
 *
 * RNNoise работает кадрами по 480 отсчётов (10 мс при 48 кГц), а worklet
 * получает звук по 128: входные отсчёты копятся в кадр, обработанные кадры
 * ложатся в кольцевой буфер выхода. Выход заранее заполнен одним кадром
 * тишины — так он никогда не пустеет (задержка +10 мс). Пока WASM грузится,
 * звук проходит как есть.
 */

import { Rnnoise, type DenoiseState } from "@shiguredo/rnnoise-wasm";

// Сборка emscripten при `Rnnoise.load()` проверяет окружение (`window` или
// `WorkerGlobalScope`), в AudioWorkletGlobalScope нет ни того, ни другого —
// без заглушки бросает «not compiled for this environment». Больше ничего из
// окружения ей не нужно (WASM встроен base64, декодер свой). `import.meta.url`
// в сборке воркера Vite превращает в `self.location.href` — в worklet нет ни
// `self`, ни `location`; адрес там нужен лишь для поиска .wasm рядом (у нас он
// встроен), так что подойдёт пустой.
const scope = globalThis as unknown as Record<string, unknown>;
scope.WorkerGlobalScope ??= function WorkerGlobalScope() {};
scope.self ??= globalThis;
scope.location ??= { href: "" };

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** RNNoise ждёт 16-битный диапазон, Web Audio даёт [-1, 1]. */
const PCM_SCALE = 32768;
const RING = 4096;

let rnnoise: Promise<Rnnoise> | null = null;

class MatisRnnoiseProcessor extends AudioWorkletProcessor {
  private denoise: DenoiseState | null = null;
  private frameSize = 480;
  private frame = new Float32Array(480);
  private filled = 0;
  private ring = new Float32Array(RING);
  private readAt = 0;
  private writeAt = 0;
  private stopped = false;

  constructor() {
    super();
    rnnoise ??= Rnnoise.load();
    rnnoise.then(
      (lib) => {
        if (this.stopped) return;
        this.denoise = lib.createDenoiseState();
        this.frameSize = lib.frameSize;
        this.frame = new Float32Array(this.frameSize);
        // Один кадр тишины вперёд — см. комментарий в начале файла.
        this.writeAt = this.frameSize;
        this.port.postMessage({ type: "ready" });
      },
      (err: unknown) => this.port.postMessage({ type: "error", message: String(err).slice(0, 200) }),
    );
    this.port.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type !== "stop") return;
      this.stopped = true;
      this.denoise?.destroy();
      this.denoise = null;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    const denoise = this.denoise;
    if (!denoise) {
      output.set(input);
      return true;
    }
    for (let i = 0; i < input.length; i++) {
      this.frame[this.filled++] = input[i]! * PCM_SCALE;
      if (this.filled === this.frameSize) {
        denoise.processFrame(this.frame);
        for (let j = 0; j < this.frameSize; j++) {
          this.ring[this.writeAt] = this.frame[j]! / PCM_SCALE;
          this.writeAt = (this.writeAt + 1) % RING;
        }
        this.filled = 0;
      }
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.ring[this.readAt]!;
      this.readAt = (this.readAt + 1) % RING;
    }
    return true;
  }
}

registerProcessor("matis-rnnoise", MatisRnnoiseProcessor);
