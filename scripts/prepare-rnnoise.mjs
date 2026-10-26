import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync(
  new URL(
    "../node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js",
    import.meta.url,
  ),
  "utf8",
);
if (
  createHash("sha256").update(source).digest("hex") !==
  "e6958293a0118bf9860cb2753332f7562531cc987c914552c426cd7d7180a63e"
)
  throw new Error("RNNoise artifact checksum changed.");
const guard = 'typeof window == "object" || typeof WorkerGlobalScope < "u"';
if (source.split(guard).length !== 2)
  throw new Error("RNNoise wrapper changed: review patch before building.");
// Single-file WASM has no DOM or external fetch dependency; admit Worklet/Node offline harness.
writeFileSync(
  new URL("../apps/web/src/voice/audio/rnnoise.generated.js", import.meta.url),
  source.replace(guard, 'typeof WebAssembly == "object"'),
);
