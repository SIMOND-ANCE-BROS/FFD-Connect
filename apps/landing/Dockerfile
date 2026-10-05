# ============================================
# Landing — Vite/React static site
# ============================================
# Build with: docker build -f apps/landing/Dockerfile -t ffd-connect-landing .
# Context: monorepo root (for pnpm workspaces)

# ── Stage 1: Build ───────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

WORKDIR /app

# Copy workspace manifests for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/landing/package.json ./apps/landing/
COPY packages/eslint-config/package.json ./packages/eslint-config/
# Patches dir referenced by pnpm.patchedDependencies in root package.json
COPY patches ./patches

RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 pnpm install --filter landing... --no-frozen-lockfile

# Copy source
COPY apps/landing ./apps/landing
COPY packages/eslint-config ./packages/eslint-config
# The legal pages are rendered from these at build time (legal-plugin.ts).
# docs/legal is the maintained source; the site reads it rather than forking it.
COPY docs/legal ./docs/legal

RUN pnpm --filter landing build

# ── Stage 2: Serve ───────────────────────────
FROM nginx:alpine

COPY --from=build /app/apps/landing/dist /usr/share/nginx/html

# SPA fallback: route everything to index.html
RUN echo 'server { \
  listen 80; \
  server_name _; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ { \
    expires 1y; \
    add_header Cache-Control "public, immutable"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://localhost/ > /dev/null || exit 1
