import { resolve, sep } from "node:path";
export const HUB_ORIGIN = "https://hub.mrloic.ru";
export function trusted(url: string) {
  try {
    return new URL(url).origin === HUB_ORIGIN;
  } catch {
    return false;
  }
}
export function externalLink(url: string) {
  try {
    const u = new URL(url);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function localAsset(root: string, pathname: string): string | null {
  try {
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    return path.startsWith(resolve(root) + sep) ? path : null;
  } catch {
    return null;
  }
}
export function networkAllowed(url: string) {
  try {
    const u = new URL(url);
    return (
      ["https:", "wss:"].includes(u.protocol) &&
      ["hub.mrloic.ru", "rtc.mrloic.ru"].includes(u.hostname) &&
      !u.port &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
