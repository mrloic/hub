// Test-only loopback TCP forwards model SSH -L for HTTP and ICE/TCP media.
import { createServer, connect } from "node:net";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
if (process.env.APP_ENV !== "test")
  throw new Error("Только тестовое окружение");

const samples = 48000 * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
  wav.writeInt16LE(
    Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / 48000)),
    44 + i * 2,
  );
writeFileSync("/tmp/hub-voice.wav", wav);

const sockets = new Set();
function forward(port, host) {
  const server = createServer((client) => {
    const upstream = connect(port, host);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    for (const socket of [client, upstream]) {
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on("close", () => sockets.delete(socket));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
const servers = await Promise.all([
  forward(8080, "web"),
  forward(7881, "livekit"),
]);
const child = spawn(process.argv[2], process.argv.slice(3), {
  stdio: "inherit",
});
child.on("exit", (code) => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  process.exitCode = code ?? 1;
});
