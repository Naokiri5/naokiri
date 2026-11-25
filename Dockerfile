# MIA AI — single-service container for Railway (or any Docker host).
# One process serves the public landing page, the protected terminal and the Fastify API + SSE, backed by SQLite on
# a persistent volume. Paper trading only: this image contains no live-venue adapter or signer.

# ---- build: install everything, compile web (Vite) and server (tsc) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: production dependencies of the server workspace only ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MIA_HOST=0.0.0.0 \
    MIA_DATA_DIR=/data \
    MIA_SECURE_COOKIE=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace=server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/scripts server/scripts
COPY --from=build /app/web/dist web/dist
COPY scripts/docker-entrypoint.sh /usr/local/bin/mia-entrypoint
RUN chmod 0755 /usr/local/bin/mia-entrypoint && mkdir -p /data && chown node:node /data
# Railway injects PORT; MIA_PORT still wins when set. 8787 is the local default.
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/mia-entrypoint"]
