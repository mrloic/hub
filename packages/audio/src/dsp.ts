import { clamp, type AudioSettings } from "./settings";
export interface AudioNoiseProcessor {
  readonly mode: string;
  process(frame: Float32Array): number;
  destroy(): void;
}
export class NoneNoiseProcessor implements AudioNoiseProcessor {
  readonly mode: string = "off";
  process(_frame: Float32Array) {
    return 0;
  }
  destroy() {}
}
export class WebRTCNoiseProcessor extends NoneNoiseProcessor {
  override readonly mode = "standard";
}
export interface DenoiseState {
  processFrame(frame: Float32Array): number;
  destroy(): void;
}
export class RNNoiseProcessor implements AudioNoiseProcessor {
  readonly mode = "rnnoise";
  constructor(private state: DenoiseState) {}
  process(frame: Float32Array) {
    for (let i = 0; i < frame.length; i++) frame[i] *= 32768;
    const probability = this.state.processFrame(frame);
    for (let i = 0; i < frame.length; i++) frame[i] /= 32768;
    return probability;
  }
  destroy() {
    this.state.destroy();
  }
}
export class VoiceGate {
  active = false;
  noiseFloor = -65;
  private attack = 0;
  private silence = 0;
  private frames = 0;
  update(db: number, settings: AudioSettings, ms = 10) {
    // A bounded initial estimate prevents a steady fan from permanently opening the gate.
    if (this.frames++ < 30 || !this.active) {
      const ambient = Math.min(-50, db);
      this.noiseFloor +=
        (ambient - this.noiseFloor) * (this.frames < 30 ? 0.12 : 0.02);
    }
    const threshold = settings.automaticSensitivity
      ? clamp(this.noiseFloor + 12, -55, -25)
      : settings.manualSensitivity;
    if (db >= threshold) {
      this.attack += ms;
      this.silence = 0;
      if (this.attack >= 30) this.active = true;
    } else if (db < threshold - 6) {
      this.attack = 0;
      this.silence += ms;
      if (this.silence >= 250) this.active = false;
    } else {
      this.attack = 0;
      this.silence = 0;
    }
    return { active: this.active, threshold };
  }
}
export class AudioPipeline {
  readonly gate = new VoiceGate();
  private gain = 0;
  private release = 0;
  ptt = false;
  constructor(
    public settings: AudioSettings,
    public noise: AudioNoiseProcessor,
  ) {}
  process(frame: Float32Array) {
    let sum = 0,
      peak = 0;
    for (const sample of frame) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const db = 20 * Math.log10(Math.max(1e-8, Math.sqrt(sum / frame.length)));
    const vad = this.gate.update(db, this.settings);
    this.noise.process(frame);
    this.release = this.ptt
      ? this.settings.pushToTalkReleaseDelay
      : Math.max(0, this.release - 10);
    const open =
      this.settings.inputMode === "ptt"
        ? this.ptt || this.release > 0
        : vad.active;
    const target = open ? this.settings.microphoneGain : 0;
    for (let i = 0; i < frame.length; i++) {
      this.gain += (target - this.gain) * 0.01;
      const sample = frame[i] * this.gain;
      frame[i] = Number.isFinite(sample) ? clamp(sample, -1, 1) : 0;
    }
    return {
      db,
      peak,
      active: open,
      threshold: vad.threshold,
      clipping: peak >= 0.99,
    };
  }
  destroy() {
    this.noise.destroy();
  }
}
