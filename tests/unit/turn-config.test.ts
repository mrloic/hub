import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
test("TURN peer ACL покрывает весь IPv4, кроме единственного SFU; IPv6 закрыт", () => {
  const source = readFileSync("infra/livekit.production.yaml", "utf8");
  const rules = source.split("  deny_peer_cidrs:\n")[1].split("\nroom:")[0];
  const ranges = [...rules.matchAll(/- (\d+\.\d+\.\d+\.\d+)\/(\d+)/g)];
  const deny = new BlockList();
  let count = 0;
  for (const [, address, prefix] of ranges) {
    assert.equal(
      deny.check(address, "ipv4"),
      false,
      "Диапазоны не должны пересекаться",
    );
    deny.addSubnet(address, Number(prefix), "ipv4");
    count += 2 ** (32 - Number(prefix));
  }
  assert.equal(count, 2 ** 32 - 1);
  assert.equal(deny.check("172.30.224.10", "ipv4"), false);
  for (const address of [
    "127.0.0.1",
    "192.168.1.10",
    "172.30.224.2",
    "172.30.224.11",
    "1.1.1.1",
    "203.0.113.1",
  ])
    assert.equal(deny.check(address, "ipv4"), true);
  assert.match(rules, /"::\/0"/);
  assert.match(source, /allow_restricted_peer_cidrs: \[172\.30\.224\.10\/32\]/);
  assert.match(source, /proxy_protocol_trusted_cidrs: \[172\.30\.224\.2\/32\]/);
});
