import {
  AudioPipeline,
  NoneNoiseProcessor,
  WebRTCNoiseProcessor,
  type AudioNoiseProcessor,
} from "../../../../../packages/audio/src/dsp";
import { migrateAudio } from "../../../../../packages/audio/src/settings";
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
// Emscripten's single-file wrapper uses atob, absent in some AudioWorklet scopes.
if (typeof globalThis.atob !== "function")
  globalThis.atob = (input: string) => {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0,
      value = 0,
      out = "";
    for (const char of input.replace(/=+$/, "")) {
      const n = alphabet.indexOf(char);
      if (n < 0) continue;
      value = (value << 6) | n;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((value >> bits) & 255);
      }
    }
    return out;
  };
export function registerHubAudio(
  createEnhanced?: () => Promise<AudioNoiseProcessor>,
) {
  class HubAudio extends AudioWorkletProcessor {
    private pipeline?: AudioPipeline;
    private frame = new Float32Array(480);
    private offset = 0;
    private queue = new Float32Array(2048);
    private read = 0;
    private write = 0;
    private count = 0;
    private blocks = 0;
    private stopped = false;
    private underflows = 0;
    constructor() {
      super();
      this.port.onmessage = async ({ data }) => {
        if (data.type === "init") {
          try {
            if (sampleRate !== 48000) throw new Error("sample rate");
            const settings = migrateAudio(data.settings);
            let noise = new NoneNoiseProcessor();
            if (settings.noiseSuppressionMode === "rnnoise") {
              if (!createEnhanced) throw new Error("unavailable");
              noise = await createEnhanced();
              if (this.stopped) {
                noise.destroy();
                return;
              }
            } else if (settings.noiseSuppressionMode === "standard")
              noise = new WebRTCNoiseProcessor();
            this.pipeline = new AudioPipeline(settings, noise);
            this.port.postMessage({ type: "ready" });
          } catch {
            this.port.postMessage({ type: "error" });
          }
        } else if (data.type === "settings" && this.pipeline)
          this.pipeline.settings = migrateAudio(data.settings);
        else if (data.type === "ptt" && this.pipeline)
          this.pipeline.ptt = !!data.down;
        else if (data.type === "stop") {
          this.stopped = true;
          this.pipeline?.destroy();
          this.pipeline = undefined;
        }
      };
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][]) {
      const output = outputs[0]?.[0];
      if (!output) return !this.stopped;
      const input = inputs[0]?.[0];
      for (let i = 0; i < output.length; i++) {
        this.frame[this.offset++] = input?.[i] ?? 0;
        if (this.offset === 480) {
          this.offset = 0;
          if (this.pipeline) {
            const start =
              typeof performance === "undefined" ? 0 : performance.now();
            const meter = this.pipeline.process(this.frame);
            for (const value of this.frame) {
              this.queue[this.write] = value;
              this.write = (this.write + 1) % 2048;
              this.count++;
            }
            if (++this.blocks % 10 === 0)
              this.port.postMessage({
                type: "meter",
                ...meter,
                load: start ? (performance.now() - start) / 10 : null,
                underflows: this.underflows,
                time: currentTime,
              });
          }
        }
        if (this.count) {
          output[i] = this.queue[this.read];
          this.read = (this.read + 1) % 2048;
          this.count--;
        } else {
          output[i] = 0;
          if (this.blocks > 1) this.underflows++;
        }
      }
      return !this.stopped;
    }
  }
  registerProcessor("hub-audio", HubAudio);
}
