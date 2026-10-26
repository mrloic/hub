import {
  HeldShortcut,
  parseShortcut,
} from "../../../packages/audio/src/shortcuts";
import type {
  DesktopSettings,
  DesktopEvent,
} from "../../../packages/shared/src/desktop";
export interface ShortcutRegistry {
  register(accelerator: string, handler: () => void): boolean;
  unregister(accelerator: string): void;
}
export class Shortcuts {
  private registered: string[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private held = new HeldShortcut();
  private active = false;
  constructor(
    private registry: ShortcutRegistry,
    private emit: (event: DesktopEvent) => void,
    private keyDown?: (key: number) => boolean,
  ) {}
  voiceActive(active: boolean) {
    this.active = active;
    if (!active)
      this.held.update(false, (down) => this.emit({ type: "ptt", down }));
  }
  clear() {
    for (const key of this.registered) this.registry.unregister(key);
    this.registered = [];
    clearInterval(this.timer);
    this.timer = undefined;
    this.held.update(false, (down) => this.emit({ type: "ptt", down }));
  }
  configure(settings: DesktopSettings) {
    this.clear();
    try {
      for (const [field, event] of [
        ["muteShortcut", "mute"],
        ["deafenShortcut", "deafen"],
        ["pushToTalkShortcut", "ptt"],
      ] as const) {
        const value = settings[field];
        if (!value) continue;
        const binding = parseShortcut(value);
        if (!binding) throw new Error("Недопустимое сочетание клавиш.");
        if (this.registered.includes(binding.accelerator))
          throw new Error("Выберите разные сочетания клавиш.");
        if (event === "ptt" && !this.keyDown)
          throw new Error("Глобальный Push-to-Talk доступен в Windows.");
        if (
          !this.registry.register(binding.accelerator, () => {
            if (!this.active) return;
            if (event === "ptt")
              this.held.update(
                binding.keys.every((key) => this.keyDown!(key)),
                (down) => this.emit({ type: "ptt", down }),
              );
            else this.emit({ type: event });
          })
        )
          throw new Error("Сочетание занято другим приложением или системой.");
        this.registered.push(binding.accelerator);
        if (event === "ptt")
          this.timer = setInterval(() => {
            if (
              this.held.down &&
              (!this.active || !binding.keys.every((key) => this.keyDown!(key)))
            )
              this.held.update(false, (down) =>
                this.emit({ type: "ptt", down }),
              );
          }, 20);
      }
    } catch (error) {
      this.clear();
      throw error;
    }
  }
}
