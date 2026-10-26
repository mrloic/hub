import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
let text = readFileSync(".env", "utf8");
for (const [key, value] of Object.entries({
  LIVEKIT_API_KEY: `hub_${randomBytes(12).toString("hex")}`,
  LIVEKIT_API_SECRET: randomBytes(48).toString("hex"),
})) {
  if (!new RegExp(`^${key}=.+$`, "m").test(text)) {
    if (new RegExp(`^${key}=.*$`, "m").test(text))
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  }
}
text = /^VOICE_ENABLED=.*$/m.test(text)
  ? text.replace(/^VOICE_ENABLED=.*$/m, "VOICE_ENABLED=true")
  : `${text}\nVOICE_ENABLED=true\n`;
writeFileSync(".env.voice-tmp", text, { flag: "wx", mode: 0o600 });
renameSync(".env.voice-tmp", ".env");
chmodSync(".env", 0o600);
console.log(
  "Голос включён; ключи LiveKit добавлены при отсутствии. Остальные настройки сохранены.",
);
