import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
test("адрес клиента: поддельные proxy headers не обходят лимит", async () => {
  process.env.APP_SECRET = "test_only_".repeat(8);
  process.env.DATABASE_URL = "postgresql://test:test@localhost/hub_test";
  const { clientAddress } =
    await import("../../apps/api/src/common/client-address.js");
  const secret = "proxy_test_only_".repeat(8);
  const req = {
    socket: { remoteAddress: "172.30.224.2" },
    headers: {
      "x-forwarded-for": "198.51.100.7",
      "x-hub-client-ip": "198.51.100.8",
      "x-hub-proxy": "fake",
    },
  } as unknown as Request;
  assert.equal(clientAddress(req, "production", secret), "172.30.224.2");
  req.headers["x-hub-proxy"] = secret;
  assert.equal(clientAddress(req, "production", secret), "198.51.100.8");
  assert.equal(clientAddress(req, "local", secret), "172.30.224.2");
  req.headers["x-hub-client-ip"] = "malformed";
  assert.equal(clientAddress(req, "production", secret), "172.30.224.2");
});
