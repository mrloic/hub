// Isolated TLS check with an explicitly trusted test CA, never production ACME.
import https from "node:https";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const ca = readFileSync("/checks/ca.crt");
const get = (servername, path) =>
  new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: "edge-check",
        port: 443,
        servername,
        ca,
        path,
        headers: { Host: servername },
      },
      (res) => {
        let body = "";
        res.on("data", (data) => (body += data));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
let res = await get("hub.mrloic.ru", "/c/direct/ch/route");
assert.equal(res.status, 200);
assert.match(res.body, /<html/);
assert.equal(res.headers["strict-transport-security"], "max-age=31536000");
assert.match(res.headers["content-security-policy"], /wss:\/\/rtc.mrloic.ru/);
res = await get("hub.mrloic.ru", "/assets/missing.js");
assert.equal(res.status, 404);
assert.doesNotMatch(res.body, /<html/);
res = await get("hub.mrloic.ru", "/api/missing");
assert.equal(res.status, 404);
assert.match(res.headers["content-type"], /json/);
res = await get("hub.mrloic.ru", "/api/health");
assert.equal(res.status, 200);
res = await get("rtc.mrloic.ru", "/twirp/livekit.RoomService/ListRooms");
assert.equal(res.status, 404);
res = await get("rtc.mrloic.ru", "/livekit/rtc/validate");
assert.equal(res.status, 403);
await new Promise((resolve, reject) => {
  const client = tls.connect(
    { host: "edge-check", port: 443, servername: "turn.mrloic.ru", ca },
    () => {
      assert.equal(client.authorized, true);
      // Unauthenticated STUN binding reaches the real TURN listener through SNI/TLS.
      const packet = Buffer.alloc(20);
      packet.writeUInt16BE(1, 0);
      packet.writeUInt32BE(0x2112a442, 4);
      randomBytes(12).copy(packet, 8);
      client.write(packet);
    },
  );
  client.setTimeout(10000, () =>
    client.destroy(new Error("TURN binding timeout")),
  );
  client.once("data", (data) => {
    try {
      assert.equal(data.readUInt16BE(0), 0x0101);
      client.end();
      resolve();
    } catch (error) {
      client.destroy();
      reject(error);
    }
  });
  client.once("error", reject);
});
console.log(
  "TLS/SNI: Hub routes, API JSON, RTC allowlist, authenticated certificates and TURN binding passed.",
);
await new Promise((resolve, reject) => {
  const client = tls.connect(
    { host: "edge-check", port: 443, servername: "turn.mrloic.ru", ca },
    () => {
      const packet = Buffer.alloc(28);
      packet.writeUInt16BE(3, 0); // TURN Allocate
      packet.writeUInt16BE(8, 2);
      packet.writeUInt32BE(0x2112a442, 4);
      randomBytes(12).copy(packet, 8);
      packet.writeUInt16BE(0x0019, 20); // REQUESTED-TRANSPORT: UDP
      packet.writeUInt16BE(4, 22);
      packet[24] = 17;
      client.write(packet);
    },
  );
  client.setTimeout(10000, () =>
    client.destroy(new Error("TURN auth timeout")),
  );
  let response = Buffer.alloc(0);
  client.on("data", (chunk) => {
    response = Buffer.concat([response, chunk]);
    if (response.length < 20 || response.length < 20 + response.readUInt16BE(2))
      return;
    try {
      assert.equal(response.readUInt16BE(0), 0x0113);
      let code = 0;
      for (let pos = 20; pos + 4 <= response.length;) {
        const type = response.readUInt16BE(pos),
          length = response.readUInt16BE(pos + 2);
        if (type === 9) code = response[pos + 6] * 100 + response[pos + 7];
        assert.notEqual(type, 0x0016); // No relay address for anonymous clients.
        pos += 4 + Math.ceil(length / 4) * 4;
      }
      assert.equal(code, 401);
      client.end();
      resolve();
    } catch (error) {
      client.destroy();
      reject(error);
    }
  });
  client.once("error", reject);
});
console.log("TURN: unauthenticated Allocate rejected with 401.");
