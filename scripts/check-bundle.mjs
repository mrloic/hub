import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(`${dir}/${entry.name}`)
      : [`${dir}/${entry.name}`],
  );
}
const secrets = [];
for (const file of [".env", ".env.production"])
  if (existsSync(file))
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(file, "utf8")),
    ))
      if (/SECRET|PASSWORD|API_KEY/.test(key) && value.length >= 8)
        secrets.push(value);
const bundle = files("apps/web/dist");
if (!bundle.some((file) => file.endsWith(".js")))
  throw new Error("Сначала выполните npm run build");
for (const file of bundle) {
  const content = readFileSync(file, "utf8");
  if (
    secrets.some((value) => content.includes(value)) ||
    /postgresql:\/\/|LIVEKIT_API_SECRET|PROXY_SECRET/.test(content)
  )
    throw new Error(
      "Проверка bundle не пройдена; содержимое намеренно не выводится.",
    );
}
console.log(
  `Проверены ${bundle.length} файлов frontend: значения секретов проекта не найдены.`,
);
