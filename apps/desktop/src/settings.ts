import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  desktopDefaults,
  type DesktopSettings,
} from "../../../packages/shared/src/desktop";
export function normalizeDesktop(value: unknown): DesktopSettings {
  const result = { ...desktopDefaults };
  if (!value || typeof value !== "object") return result;
  const input = value as Record<string, unknown>;
  if (input.version !== undefined && input.version !== 1) return result;
  for (const key of ["minimizeToTray", "autostart", "notifications"] as const)
    if (typeof input[key] === "boolean") result[key] = input[key];
  for (const key of [
    "muteShortcut",
    "deafenShortcut",
    "pushToTalkShortcut",
  ] as const)
    if (typeof input[key] === "string" && input[key].length <= 64)
      result[key] = input[key];
  return result;
}
export class SettingsStore {
  constructor(private file: string) {}
  read() {
    try {
      return normalizeDesktop(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      return normalizeDesktop(null);
    }
  }
  save(value: DesktopSettings) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(normalizeDesktop(value)), {
      mode: 0o600,
    });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
export function closeAction(quitting: boolean, minimizeToTray: boolean) {
  return !quitting && minimizeToTray ? "hide" : "quit";
}
