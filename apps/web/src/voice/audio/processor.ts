import { LocalAudioTrack } from "livekit-client";
import type {
  TrackProcessor,
  AudioProcessorOptions,
  Track,
} from "livekit-client";
import basicUrl from "./worklet?worker&url";
import enhancedUrl from "./enhanced-worklet?worker&url";
import {
  constraintsFor,
  type AudioSettings,
} from "../../../../../packages/audio/src/settings";
export interface Meter {
  db: number;
  peak: number;
  active: boolean;
  threshold: number;
  clipping: boolean;
  load: number | null;
  underflows: number;
}
export const emptyMeter: Meter = {
  db: -100,
  peak: 0,
  active: false,
  threshold: -45,
  clipping: false,
  load: null,
  underflows: 0,
};
export class HubTrackProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  name = "Hub local audio";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private down = false;
  private recaptureFallback = false;
  constructor(
    public settings: AudioSettings,
    private meter: (value: Meter) => void,
    private fallback: () => void,
  ) {}
  async init(options: AudioProcessorOptions) {
    try {
      await this.start(options);
    } catch (error) {
      await this.destroy();
      if (this.settings.noiseSuppressionMode !== "rnnoise") throw error;
      this.recaptureFallback = true;
      this.settings = {
        ...this.settings,
        noiseSuppressionMode: "standard",
        profile: "custom",
      };
      await options.track.applyConstraints(
        constraintsFor(
          this.settings,
          navigator.mediaDevices.getSupportedConstraints(),
        ),
      );
      await this.start(options);
      this.fallback();
    }
  }
  async settleCapture(track: LocalAudioTrack) {
    if (!this.recaptureFallback) return;
    this.recaptureFallback = false;
    // Chromium may accept applyConstraints without changing noiseSuppression.
    // Reacquire outside LiveKit's processor-init lock, before initial publication.
    await track.restartTrack(
      constraintsFor(
        this.settings,
        navigator.mediaDevices.getSupportedConstraints(),
      ),
    );
  }
  getAudioContext() {
    return (this.context ??= new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    }));
  }
  private async start(options: AudioProcessorOptions) {
    const context = this.getAudioContext();
    await context.audioWorklet.addModule(
      this.settings.noiseSuppressionMode === "rnnoise" ? enhancedUrl : basicUrl,
    );
    const node = new AudioWorkletNode(context, "hub-audio", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.node = node;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Audio init timeout")),
        15000,
      );
      node.onprocessorerror = () => {
        clearTimeout(timeout);
        reject(new Error("Audio worklet failed"));
      };
      node.port.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timeout);
          reject(new Error("Audio unavailable"));
        } else if (data.type === "meter") this.meter(data);
      };
      node.port.postMessage({ type: "init", settings: this.settings });
    });
    const destination = context.createMediaStreamDestination();
    this.source = context.createMediaStreamSource(
      new MediaStream([options.track]),
    );
    this.source.connect(node);
    node.connect(destination);
    this.processedTrack = destination.stream.getAudioTracks()[0];
    node.port.postMessage({ type: "ptt", down: this.down });
    await context.resume();
  }
  update(settings: AudioSettings) {
    this.settings = settings;
    this.node?.port.postMessage({ type: "settings", settings });
  }
  ptt(down: boolean) {
    this.down = down;
    this.node?.port.postMessage({ type: "ptt", down });
  }
  async restart(options: AudioProcessorOptions) {
    await this.destroy();
    await this.init(options);
  }
  async destroy() {
    this.source?.disconnect();
    this.source = undefined;
    this.node?.port.postMessage({ type: "stop" });
    this.node?.disconnect();
    this.node?.port.close();
    this.node = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    const context = this.context;
    this.context = undefined;
    await context?.close();
  }
}

export async function captureMicrophone(filter: HubTrackProcessor) {
  const constraints = constraintsFor(
    filter.settings,
    navigator.mediaDevices.getSupportedConstraints(),
  );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: constraints,
    video: false,
  });
  const track = new LocalAudioTrack(
    stream.getAudioTracks()[0],
    constraints,
    false,
    filter.getAudioContext(),
  );
  try {
    await track.setProcessor(filter);
    await filter.settleCapture(track);
    return track;
  } catch (error) {
    track.stop();
    await filter.destroy();
    throw error;
  }
}
