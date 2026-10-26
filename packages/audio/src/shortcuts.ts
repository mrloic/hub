export function parseShortcut(value: string): {
  accelerator: string;
  keys: number[];
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
} | null {
  if (!value || value.length > 64) return null;
  const parts = value.split("+").map((p) => p.trim());
  const key = parts.pop()!.toUpperCase();
  if (
    new Set(parts).size !== parts.length ||
    parts.some((p) => !["Ctrl", "Alt", "Shift"].includes(p))
  )
    return null;
  let vk: number, code: string;
  if (/^[A-Z0-9]$/.test(key)) {
    vk = key.charCodeAt(0);
    code = /[0-9]/.test(key) ? `Digit${key}` : `Key${key}`;
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    vk = 111 + Number(key.slice(1));
    code = key;
  } else if (key === "SPACE") {
    vk = 32;
    code = "Space";
  } else return null;
  const ctrl = parts.includes("Ctrl"),
    alt = parts.includes("Alt"),
    shift = parts.includes("Shift");
  return {
    accelerator: [...parts, key === "SPACE" ? "Space" : key].join("+"),
    keys: [
      ...(ctrl ? [17] : []),
      ...(alt ? [18] : []),
      ...(shift ? [16] : []),
      vk,
    ],
    code,
    ctrl,
    alt,
    shift,
  };
}
export class HeldShortcut {
  down = false;
  update(pressed: boolean, send: (pressed: boolean) => void) {
    if (this.down !== pressed) {
      this.down = pressed;
      send(pressed);
    }
  }
}
