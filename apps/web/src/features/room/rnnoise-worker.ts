/**
 * Worker шумоподавления RNNoise (2026-10-17, по образцу Контур Толка): тяжёлый
 * расчёт — здесь, а не в аудиопотоке. Worklet (`rnnoise-worklet.ts`) шлёт
 * кадры по 480 отсчётов через MessagePort и сам решает, успел ли ответ: не
 * успел — в эфир уходит необработанный звук, звук не рвётся.
 */
import { Rnnoise, type DenoiseState } from "@shiguredo/rnnoise-wasm";

interface FrameMessage {
  seq: number;
  frame: Float32Array;
}

let denoise: DenoiseState | null = null;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ type?: string; port?: MessagePort }>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  if (e.data?.type !== "port" || !e.data.port) return;
  const port = e.data.port;
  Rnnoise.load().then(
    (lib) => {
      denoise = lib.createDenoiseState();
      port.onmessage = (m: MessageEvent<FrameMessage | { type: "stop" }>) => {
        const data = m.data;
        if ("type" in data) {
          denoise?.destroy();
          denoise = null;
          port.close();
          return;
        }
        if (!denoise) return;
        denoise.processFrame(data.frame);
        port.postMessage({ seq: data.seq, frame: data.frame }, [data.frame.buffer]);
      };
      port.postMessage({ type: "ready", frameSize: lib.frameSize });
    },
    (err: unknown) => port.postMessage({ type: "error", message: String(err).slice(0, 200) }),
  );
};
