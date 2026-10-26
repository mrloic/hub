import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const password = randomBytes(32).toString("hex");
try {
  writeFileSync(
    ".env",
    `APP_NAME=Hub\nAPP_ENV=local\nAPP_URL=http://localhost:8080\nVOICE_ENABLED=false\nPOSTGRES_PASSWORD=${password}\nAPP_SECRET=${randomBytes(48).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Создан .env с локальными секретами.");
} catch (error) {
  if (error.code === "EEXIST")
    console.log(".env уже существует; сохранён без изменений.");
  else throw error;
}
