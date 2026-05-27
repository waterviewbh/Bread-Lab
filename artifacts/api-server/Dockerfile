# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /workspace

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

# Build (esbuild bundles everything into artifacts/api-server/dist/index.mjs)
RUN pnpm --filter @workspace/db build 2>/dev/null || true
RUN pnpm --filter @workspace/api-server run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

COPY --from=builder /workspace/artifacts/api-server/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
