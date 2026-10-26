FROM node:24.21.0-bookworm-slim AS source
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/shared/package.json packages/shared/package.json
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
FROM source AS test
CMD ["npm", "run", "test:integration"]
FROM source AS api
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
FROM caddy:2.10.2-alpine AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=source /app/apps/web/dist /srv
USER 1000:1000
FROM livekit/caddyl4:v2.11.3@sha256:9dd090159a6042a907dbff0ce9dda27a21d2a559dc7b03b60a8e6b1b60b8348e AS web-production
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
COPY infra/Caddyfile.production /etc/caddy/Caddyfile
COPY --from=source /app/apps/web/dist /srv
RUN mkdir -p /data/caddy /config/caddy && chown -R 1000:1000 /data /config
USER 1000:1000
