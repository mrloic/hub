export interface DesktopSettings {
  version: 1;
  minimizeToTray: boolean;
  autostart: boolean;
  notifications: boolean;
  muteShortcut: string;
  deafenShortcut: string;
  pushToTalkShortcut: string;
}
export const desktopDefaults: DesktopSettings = {
  version: 1,
  minimizeToTray: true,
  autostart: false,
  notifications: false,
  muteShortcut: "",
  deafenShortcut: "",
  pushToTalkShortcut: "",
};
export type DesktopEvent =
  | { type: "ptt"; down: boolean }
  | { type: "mute" | "deafen" | "capture-cancel" }
  | {
      type: "capture";
      sources: { id: string; name: string; thumbnail: string }[];
      audio: boolean;
    };
export interface DesktopAPI {
  getSettings(): Promise<DesktopSettings & { error?: string }>;
  saveSettings(
    value: DesktopSettings,
  ): Promise<{ settings: DesktopSettings; error?: string }>;
  onEvent(callback: (event: DesktopEvent) => void): () => void;
  selectCapture(id: string | null, audio: boolean): Promise<void>;
  notifyMessage(): void;
  voiceActive(active: boolean, testing?: boolean): void;
}
declare global {
  interface Window {
    hubDesktop?: DesktopAPI;
  }
}
