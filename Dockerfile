# Code Akos as a container. See docs/docker.md.
# Build stage: installs everything and builds the UI. Nothing from here ships except web/dist.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci
# The UI imports types from server/, and its build type-checks them.
COPY server ./server
COPY web ./web
RUN npm run build

# Runtime stage: Node, git (to clone your repositories), CA certificates (for HTTPS) and tini (to reap processes).
FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY bin ./bin
COPY scripts ./scripts
COPY --from=build /app/web/dist ./web/dist

# The `node` user comes with the base image. Everything Code Akos keeps lives in /data.
RUN mkdir /data && chown node:node /data
USER node

# Inside the container the dashboard and ingest must listen on all interfaces, or published ports cannot
# reach them. The dashboard must still only be published on 127.0.0.1 (docs/docker.md).
ENV ORCH_DATA_DIR=/data \
    ORCH_DASHBOARD_HOST=0.0.0.0 \
    ORCH_ERRORS_INGEST_HOST=0.0.0.0
VOLUME /data
EXPOSE 7420 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "bin/code-akos.mjs"]
