# ================================================================
# Stage 1 — deps: install all dependencies (cached when manifests unchanged)
# ================================================================
FROM node:22-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm@10.30.0

# Copy only dependency manifests — this layer is cached until a manifest changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/client/package.json ./apps/client/
COPY apps/landing/package.json ./apps/landing/
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY packages/jest-config ./packages/jest-config
COPY patches ./patches
COPY scripts ./scripts

# Note: --no-frozen-lockfile because patchedDependencies can drift;
# the lockfile is validated in CI instead.
RUN pnpm install --no-frozen-lockfile

# ================================================================
# Stage 2 — build: compile TypeScript + generate Prisma client
# ================================================================
FROM deps AS build

COPY apps/backend ./apps/backend

WORKDIR /app/apps/backend
RUN pnpm exec prisma generate && pnpm build

# ================================================================
# Stage 3 — deploy: prune to the backend's OWN dependency tree
# `pnpm deploy --prod` resolves only the backend package (+ its workspace dep
# @ffd-connect/shared) and installs prod deps only, dropping both the ~2 GB of
# client/landing/docs deps hoisted into the root node_modules AND the backend's
# own devDeps (jest, stryker, nest-cli, eslint, typescript...). The Prisma CLI
# is a runtime dependency (entrypoint runs `prisma migrate deploy` at boot).
# ================================================================
FROM build AS deploy

# Build the shared package so pnpm injects its dist into the bundle.
WORKDIR /app/packages/shared
RUN pnpm exec tsc

WORKDIR /app
# The workspace patches only client deps (react-native, track-player); a
# backend-only deploy re-resolves without them and errors ERR_PNPM_UNUSED_PATCH.
# Strip patchedDependencies from the root manifest before deploying (the backend
# does not depend on any patched package). Does not affect the already-installed
# build stage.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.pnpm)delete p.pnpm.patchedDependencies;fs.writeFileSync('package.json',JSON.stringify(p,null,2));" && \
    pnpm --filter=backend --prod --legacy deploy /app/out

# The fresh install ships @prisma/client but not the schema-specific generated
# client — regenerate it inside the pruned bundle (no DB connection needed).
WORKDIR /app/out
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm exec prisma generate --schema=./prisma/schema

# ================================================================
# Stage 4 — production: minimal runtime image (backend deps only)
# ================================================================
FROM node:22-alpine AS production

WORKDIR /app/apps/backend

# Runtime deps:
# - ffmpeg: BPM analysis + test-track seeds need it. The @ffmpeg-installer npm
#   binary is glibc-linked and does NOT run on Alpine/musl, so we install the
#   system (musl) ffmpeg instead.
# No pnpm/npm: the entrypoint calls the Prisma CLI binary directly.
RUN apk add --no-cache ffmpeg

ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    NODE_ENV=production

# Self-contained bundle: package.json, dist, prisma schema+migrations, the
# generated client, and a pruned node_modules (backend + shared only).
COPY --from=deploy /app/out ./

# Entrypoint
COPY apps/backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

# Create upload directories and run as non-root user for security
RUN mkdir -p /app/apps/backend/uploads/certificates /app/apps/backend/uploads/renewal && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

CMD ["/app/docker-entrypoint.sh"]
