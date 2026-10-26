#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime/checks
# Ephemeral test CA; no install in system/browser trust stores, no public issuance.
openssl req -x509 -newkey rsa:2048 -nodes -keyout .runtime/checks/ca.key -out .runtime/checks/ca.crt -days 1 -subj /CN=Hub-test-only-CA > /dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout .runtime/checks/edge.key -out .runtime/checks/edge.csr -subj /CN=hub.mrloic.ru > /dev/null 2>&1
printf '%s\n' 'subjectAltName=DNS:hub.mrloic.ru,DNS:rtc.mrloic.ru,DNS:turn.mrloic.ru' 'extendedKeyUsage=serverAuth' > .runtime/checks/edge.ext
openssl x509 -req -in .runtime/checks/edge.csr -CA .runtime/checks/ca.crt -CAkey .runtime/checks/ca.key -CAcreateserial -out .runtime/checks/edge.crt -days 1 -extfile .runtime/checks/edge.ext > /dev/null 2>&1
# Container non-root needs this test key; directory remains private to the operator.
chmod 644 .runtime/checks/edge.key
python3 - <<'PY'
import re
s=open('infra/Caddyfile.production').read()
s=re.sub(r'  tls \{\s*issuer acme \{\s*disable_tlsalpn_challenge\s*\}\s*\}', '  tls /checks/edge.crt /checks/edge.key',s)
open('.runtime/checks/Caddyfile','w').write(s)
PY
args=(-p hub-turn-test -f compose.test.yaml -f compose.turn-test.yaml)
trap 'docker rm -f hub-edge-check >/dev/null 2>&1; docker compose "${args[@]}" stop' EXIT
docker compose "${args[@]}" up -d --wait db livekit api web
docker run -d --name hub-edge-check --network hub-turn-test_media --network-alias edge-check --ip 172.30.225.3 --memory 128m --tmpfs /data:uid=1000,gid=1000 --tmpfs /config:uid=1000,gid=1000 -v "$PWD/.runtime/checks:/checks:ro" -v "$PWD/.runtime/checks/Caddyfile:/etc/caddy/Caddyfile:ro" -e PROXY_SECRET=test_only_edge_check hub-web:production run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# Poll internal health without creating a host port.
for attempt in $(seq 1 20); do
  if docker exec hub-edge-check wget -q --spider http://127.0.0.1:8080/healthz; then break; fi
  sleep 1
done
docker run --rm --network hub-turn-test_media -v "$PWD/.runtime/checks:/checks:ro" -v "$PWD/scripts/test-edge.mjs:/test-edge.mjs:ro" node:24.21.0-bookworm-slim node /test-edge.mjs
