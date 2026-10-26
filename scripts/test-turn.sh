#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime/checks
# Reserved documentation IP; no host publication or production configuration.
docker run --rm --network none --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.21.0-bookworm-slim node --input-type=module -e '
import {readFileSync,writeFileSync} from "node:fs";
writeFileSync(".runtime/checks/livekit.yaml", readFileSync("infra/livekit.production.yaml","utf8").replaceAll("<PUBLIC_IPV4>","203.0.113.1").replaceAll("172.30.224.","172.30.225.").replace("172.30.225.0/24", "172.30.224.0/24").replace("[172.30.225.2/32]", "[172.30.225.2/32, 172.30.225.3/32]"));'
args=(-p hub-turn-test -f compose.test.yaml -f compose.turn-test.yaml)
trap 'docker compose "${args[@]}" stop' EXIT
docker compose "${args[@]}" config --quiet
docker compose "${args[@]}" up -d --wait db livekit turn-proxy
docker compose "${args[@]}" run --rm migrate
docker compose "${args[@]}" up -d --wait api web
# Reset only rate counters in this explicitly isolated test DB for repeatable runs.
docker compose "${args[@]}" exec -T db psql -U hub -d hub_test -c 'DELETE FROM "RateLimit";' >/dev/null
# A client on the runner network must have no direct path to the SFU.
docker run --rm --network hub-turn-test_default node:24.21.0-bookworm-slim node --input-type=module -e '
let reachable=false; try { await fetch("http://172.30.225.10:7880/",{signal:AbortSignal.timeout(1500)}); reachable=true; } catch {}
if(reachable) throw new Error("TURN test isolation failed: SFU directly reachable");
console.log("TURN isolation: client cannot reach the private SFU network.");'
docker compose "${args[@]}" build runner
browser="hub-turn-browser-$(date -u +%s)"
result=0
docker compose "${args[@]}" run --name "$browser" -e TEST_FORCE_RELAY=true runner node scripts/with-media-tunnel.mjs npm run test:e2e -- tests/e2e/voice.spec.ts "$@" || result=$?
mkdir -p artifacts/turn .runtime/checks/turn-results
docker cp "$browser:/app/artifacts/." artifacts/turn/ 2>/dev/null || true
docker cp "$browser:/app/test-results/." .runtime/checks/turn-results/ 2>/dev/null || true
docker rm "$browser"
exit "$result"
