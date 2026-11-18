# syntax=docker/dockerfile:1.7
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# `docker build --target test` — unit tests + parity harness inside Linux.
FROM deps AS test
ENV NODE_OPTIONS="--disable-warning=ExperimentalWarning"
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
CMD ["sh", "-c", "npm test && npx tsx test/parity/run-parity.ts"]

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ENV NODE_ENV=production \
    NODE_OPTIONS="--disable-warning=ExperimentalWarning" \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
RUN apk add --no-cache tini && mkdir -p /data && chown node:node /data
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
