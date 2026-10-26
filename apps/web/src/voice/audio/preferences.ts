import {
  migrateAudio,
  type AudioSettings,
} from "../../../../../packages/audio/src/settings";
export function readAudio(): AudioSettings {
  try {
    return migrateAudio(
      JSON.parse(
        localStorage.getItem("hub.audio.v2") ??
          localStorage.getItem("hub.voice.processing") ??
          "{}",
      ),
    );
  } catch {
    return migrateAudio(null);
  }
}
export function saveAudio(settings: AudioSettings) {
  try {
    localStorage.setItem("hub.audio.v2", JSON.stringify(settings));
  } catch {
    /* Optional persistence in private browsing. */
  }
}
