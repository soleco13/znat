/**
 * AudioWorklet шумоподавления RNNoise. С 2026-10-17 расчёт RNNoise — в
 * отдельном Worker (`rnnoise-worker.ts`), как у Контур Толка: раньше WASM
 * считался прямо в аудиопотоке, и на перегруженном процессоре звук рвался.
 *
 * Здесь: вход копится кадрами по 480 отсчётов (10 мс при 48 кГц), кадр уходит
 * в Worker, выход отстаёт на `DELAY_FRAMES` кадров. К моменту воспроизведения
 * кадра берём обработанный, если Worker успел, иначе — необработанный
 * (переход между ними — косинусный, `FADE` отсчётов, без щелчков). Если за
 * окно `WINDOW_FRAMES` обработано меньше `MIN_DENOISED` кадров — сообщаем
 * `fallback`: контроллер переключит на встроенное шумоподавление.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** RNNoise ждёт 16-битный диапазон, Web Audio даёт [-1, 1]. */
const PCM_SCALE = 32768;
const FRAME = 480;
/** Задержка выхода: столько кадров ждём ответа Worker (≈ 30 мс с накоплением). */
const DELAY_FRAMES = 2;
const SLOTS = 16;
const FADE = 128;
/** Окно оценки «успевает ли Worker»: 60 с кадров по 10 мс. */
const WINDOW_FRAMES = 6000;
const MIN_DENOISED = 0.5;

class MatisRnnoiseProcessor extends AudioWorkletProcessor {
  private worker: MessagePort | null = null;
  private ready = false;
  private stopped = false;
  private fellBack = false;
  private input = new Float32Array(FRAME);
  private filled = 0;
  private seq = 0;
  /** Кольцо кадров: необработанный (в шкале [-1,1]) и обработанный, если пришёл. */
  private raw: Float32Array[] = Array.from({ length: SLOTS }, () => new Float32Array(FRAME));
  private den: (Float32Array | null)[] = Array.from({ length: SLOTS }, () => null);
  private slotSeq: number[] = Array.from({ length: SLOTS }, () => -1);
  /** Воспроизводимый кадр и позиция в нём. */
  private playSeq = -DELAY_FRAMES;
  private playPos = 0;
  /** 1 — обработанный, 0 — сырой; плавно движется к цели. */
  private mix = 0;
  private denoisedFrames = 0;
  private totalFrames = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type?: string; port?: MessagePort }>) => {
      if (e.data?.type === "port" && e.data.port) {
        this.worker = e.data.port;
        this.worker.onmessage = (m: MessageEvent<{ type?: string; seq?: number; frame?: Float32Array; message?: string }>) => {
          const d = m.data;
          if (d.type === "ready") {
            this.ready = true;
            this.port.postMessage({ type: "ready" });
          } else if (d.type === "error") {
            this.port.postMessage({ type: "error", message: d.message });
          } else if (typeof d.seq === "number" && d.frame) {
            const slot = d.seq % SLOTS;
            if (this.slotSeq[slot] === d.seq && d.seq >= this.playSeq) {
              const f = d.frame;
              for (let i = 0; i < FRAME; i++) f[i] = f[i]! / PCM_SCALE;
              this.den[slot] = f;
            }
          }
        };
      } else if (e.data?.type === "stop") {
        this.stopped = true;
        this.worker?.postMessage({ type: "stop" });
        this.worker = null;
      }
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
    // Вход → кадры → Worker.
    for (let i = 0; i < input.length; i++) {
      this.input[this.filled++] = input[i]!;
      if (this.filled === FRAME) {
        const seq = this.seq++;
        const slot = seq % SLOTS;
        this.raw[slot]!.set(this.input);
        this.den[slot] = null;
        this.slotSeq[slot] = seq;
        if (this.ready && this.worker) {
          const copy = new Float32Array(FRAME);
          for (let j = 0; j < FRAME; j++) copy[j] = this.input[j]! * PCM_SCALE;
          this.worker.postMessage({ seq, frame: copy }, [copy.buffer]);
        }
        this.filled = 0;
      }
    }
    // Выход: кадр playSeq, отстающий на DELAY_FRAMES.
    for (let i = 0; i < output.length; i++) {
      if (this.playSeq < 0) {
        output[i] = 0;
      } else {
        const slot = this.playSeq % SLOTS;
        const raw = this.raw[slot]!;
        const den = this.den[slot];
        const target = den ? 1 : 0;
        if (this.mix !== target) this.mix += target > this.mix ? 1 / FADE : -1 / FADE;
        if (this.mix < 0) this.mix = 0;
        if (this.mix > 1) this.mix = 1;
        const w = 0.5 - 0.5 * Math.cos(Math.PI * this.mix);
        const r = raw[this.playPos]!;
        output[i] = den ? den[this.playPos]! * w + r * (1 - w) : r;
      }
      this.playPos++;
      if (this.playPos === FRAME) {
        this.playPos = 0;
        if (this.playSeq >= 0) this.countFrame(this.den[this.playSeq % SLOTS] !== null);
        this.playSeq++;
      }
    }
    return true;
  }

  private countFrame(denoised: boolean) {
    if (!this.ready || this.fellBack) return;
    this.totalFrames++;
    if (denoised) this.denoisedFrames++;
    if (this.totalFrames < WINDOW_FRAMES) return;
    if (this.denoisedFrames / this.totalFrames < MIN_DENOISED) {
      this.fellBack = true;
      this.port.postMessage({ type: "fallback", denoised: this.denoisedFrames, total: this.totalFrames });
    }
    this.totalFrames = 0;
    this.denoisedFrames = 0;
  }
}

registerProcessor("matis-rnnoise", MatisRnnoiseProcessor);
