# syntax=docker/dockerfile:1
# MIA canonical workspaces are server/ + web/ (not packages/server or packages/web).
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production MIA_PORT=8787 MIA_HOST=0.0.0.0 MIA_DATA_DIR=/app/data
WORKDIR /app
RUN groupadd --system mia && useradd --system --gid mia --home-dir /app --shell /usr/sbin/nologin mia \
    && mkdir -p /app/data \
    && chown mia:mia /app/data
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/server/package.json /app/server/package.json
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/web/dist /app/web/dist
USER mia
EXPOSE 8787
STOPSIGNAL SIGTERM
# Existing /api/ready checks engine, SQLite WAL, and V8 runtime health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# main.ts executes canonical preflight BEFORE Fastify listen and before startBot().
CMD ["node", "server/dist/main.js"]
