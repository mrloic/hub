#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Invoke this script with sudo only if your account cannot access Docker.
docker compose -f compose.test.yaml config --quiet
docker compose -f compose.test.yaml up -d --wait db livekit
docker compose -f compose.test.yaml run --rm migrate
docker compose -f compose.test.yaml up -d --wait api web production-api
docker compose -f compose.test.yaml build runner
docker compose -f compose.test.yaml run --rm runner node scripts/with-media-tunnel.mjs npm run test:integration
docker compose -f compose.test.yaml run --rm -e TEST_PRODUCTION_GATEWAY=true runner npx tsx --test tests/integration/voice.test.ts
docker compose -f compose.test.yaml run --name hub-test-browser runner node scripts/with-media-tunnel.mjs npm run test:e2e
mkdir -p artifacts
docker cp hub-test-browser:/app/artifacts/. artifacts/
docker rm hub-test-browser
docker compose -f compose.test.yaml restart db api web
docker compose -f compose.test.yaml up -d --wait api web
docker compose -f compose.test.yaml run --rm -e TEST_PHASE=restart runner node scripts/with-media-tunnel.mjs npm run test:e2e
docker compose -f compose.test.yaml stop
