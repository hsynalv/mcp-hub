# Felix Hub — production image (API + built SPA)
# Build: docker compose build
# Run:   docker compose up -d

# ── API dependencies (pnpm) ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS api-deps

# Isolate from host/Coolify build-time NODE_ENV (we install prod deps explicitly).
ENV NODE_ENV=development

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && pnpm store prune

# ── React UI ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS ui-builder

# Platforms (Coolify, etc.) inject NODE_ENV=production at build time — that skips
# devDependencies and breaks `tsc` / `vite`. Force development for this stage only.
ENV NODE_ENV=development

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --include=dev --ignore-scripts

COPY frontend ./frontend
RUN npm run build --prefix frontend

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS production

RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

COPY --from=api-deps --chown=nodejs:nodejs /build/node_modules ./node_modules
COPY --from=api-deps --chown=nodejs:nodejs /build/package.json ./
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs migrations ./migrations
COPY --chown=nodejs:nodejs eval ./eval
COPY --from=ui-builder --chown=nodejs:nodejs /build/src/public/app ./src/public/app

# /app itself stays root-owned after COPY unless fixed — nodejs cannot mkdir at runtime.
RUN mkdir -p cache logs marketplace/installed && \
    chown nodejs:nodejs /app cache logs marketplace marketplace/installed

USER nodejs

ENV NODE_ENV=production
ENV PORT=8787
ENV HUB_BIND_HOST=0.0.0.0

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
