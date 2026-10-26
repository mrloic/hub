export type Processing = {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
};
export const defaultProcessing: Processing = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};
export function readProcessing(): Processing {
  try {
    const saved = JSON.parse(
      localStorage.getItem("hub.voice.processing") ?? "{}",
    );
    return Object.fromEntries(
      Object.entries(defaultProcessing).map(([key, value]) => [
        key,
        typeof saved?.[key] === "boolean" ? saved[key] : value,
      ]),
    ) as Processing;
  } catch {
    return { ...defaultProcessing };
  }
}
export function captureConstraints(
  settings: Processing,
  supported: MediaTrackSupportedConstraints & { voiceIsolation?: boolean },
): MediaTrackConstraints {
  const result: MediaTrackConstraints & { voiceIsolation?: boolean } = {};
  for (const key of Object.keys(settings) as (keyof Processing)[])
    if (supported[key]) result[key] = settings[key];
  if (supported.voiceIsolation)
    result.voiceIsolation = settings.noiseSuppression;
  return result;
}
