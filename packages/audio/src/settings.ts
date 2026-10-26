export type NoiseMode = "off" | "standard" | "rnnoise";
export interface AudioSettings {
  version: 2;
  inputDeviceId: string;
  outputDeviceId: string;
  microphoneGain: number;
  noiseSuppressionMode: NoiseMode;
  echoCancellation: boolean;
  autoGainControl: boolean;
  automaticSensitivity: boolean;
  manualSensitivity: number;
  inputMode: "vad" | "ptt";
  pushToTalkShortcut: string;
  pushToTalkReleaseDelay: number;
  participantVolumes: Record<string, number>;
  profile: "isolation" | "studio" | "custom";
}
export const defaults: AudioSettings = {
  version: 2,
  inputDeviceId: "default",
  outputDeviceId: "default",
  microphoneGain: 1,
  noiseSuppressionMode: "standard",
  echoCancellation: true,
  autoGainControl: true,
  automaticSensitivity: true,
  manualSensitivity: -45,
  inputMode: "vad",
  pushToTalkShortcut: "",
  pushToTalkReleaseDelay: 150,
  participantVolumes: {},
  profile: "custom",
};
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function migrateAudio(value: unknown): AudioSettings {
  const result = { ...defaults, participantVolumes: {} };
  if (!value || typeof value !== "object") return result;
  const v = value as Record<string, unknown>;
  if (v.version !== undefined && v.version !== 1 && v.version !== 2)
    return result;
  for (const key of [
    "inputDeviceId",
    "outputDeviceId",
    "pushToTalkShortcut",
  ] as const)
    if (typeof v[key] === "string" && v[key].length <= 256)
      result[key] = v[key];
  for (const key of [
    "echoCancellation",
    "autoGainControl",
    "automaticSensitivity",
  ] as const)
    if (typeof v[key] === "boolean") result[key] = v[key];
  for (const [key, min, max] of [
    ["microphoneGain", 0, 1],
    ["manualSensitivity", -80, -10],
    ["pushToTalkReleaseDelay", 0, 1000],
  ] as const)
    if (typeof v[key] === "number" && Number.isFinite(v[key]))
      result[key] = clamp(v[key], min, max);
  if (["off", "standard", "rnnoise"].includes(String(v.noiseSuppressionMode)))
    result.noiseSuppressionMode = v.noiseSuppressionMode as NoiseMode;
  else if (typeof v.noiseSuppression === "boolean")
    result.noiseSuppressionMode = v.noiseSuppression ? "standard" : "off";
  if (v.inputMode === "ptt") result.inputMode = "ptt";
  if (["isolation", "studio", "custom"].includes(String(v.profile)))
    result.profile = v.profile as AudioSettings["profile"];
  if (v.participantVolumes && typeof v.participantVolumes === "object")
    for (const [id, volume] of Object.entries(v.participantVolumes).slice(
      0,
      500,
    ))
      if (
        /^[a-zA-Z0-9_-]{1,100}$/.test(id) &&
        typeof volume === "number" &&
        Number.isFinite(volume)
      )
        Object.defineProperty(result.participantVolumes, id, {
          value: clamp(volume, 0, 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
  return result;
}
export function profileSettings(
  profile: AudioSettings["profile"],
  current: AudioSettings,
): AudioSettings {
  return {
    ...current,
    profile,
    ...(profile === "isolation"
      ? {
          noiseSuppressionMode: "rnnoise" as const,
          echoCancellation: true,
          autoGainControl: true,
          automaticSensitivity: true,
        }
      : profile === "studio"
        ? {
            noiseSuppressionMode: "off" as const,
            autoGainControl: false,
            automaticSensitivity: false,
            manualSensitivity: -80,
          }
        : {}),
  };
}
export function constraintsFor(
  settings: AudioSettings,
  supported: MediaTrackSupportedConstraints & { voiceIsolation?: boolean },
): MediaTrackConstraints {
  const result: MediaTrackConstraints & { voiceIsolation?: boolean } = {
    deviceId:
      settings.inputDeviceId === "default"
        ? "default"
        : { exact: settings.inputDeviceId },
    channelCount: 1,
  };
  if (supported.noiseSuppression)
    result.noiseSuppression = settings.noiseSuppressionMode === "standard";
  if (supported.echoCancellation)
    result.echoCancellation = settings.echoCancellation;
  if (supported.autoGainControl)
    result.autoGainControl = settings.autoGainControl;
  // Explicitly disable stronger browser DSP as well when RNNoise or Studio is selected.
  if (supported.voiceIsolation)
    result.voiceIsolation = settings.noiseSuppressionMode === "standard";
  return result;
}
export function participantVolume(settings: AudioSettings, id: string): number {
  return Object.hasOwn(settings.participantVolumes, id)
    ? settings.participantVolumes[id]
    : 1;
}
export function effectiveVolume(volume: number, deaf: boolean) {
  return deaf ? 0 : clamp(volume, 0, 1);
}
export function availableDevice(
  selected: string,
  devices: { deviceId: string }[],
) {
  return selected === "default" || devices.some((d) => d.deviceId === selected)
    ? selected
    : "default";
}
