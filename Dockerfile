# --- Stage 1: Build base with dependencies (pnpm workspace) ---
# Builds the combined static site (landing at /, docs at /docs) served by nginx.
# Used by the docker-compose `frontend` service (profile: full) for a local
# full-stack preview. NOT part of CI/prod deploy — the landing is published to
# GitHub Pages (deploy-landing.yml), the web app has apps/client/Dockerfile.web.
FROM node:22-alpine AS builder
ARG FRONTEND_DOMAIN
ENV FRONTEND_DOMAIN=$FRONTEND_DOMAIN
WORKDIR /app

RUN npm install -g pnpm@10.30.0

# Manifests + workspace config first so the install layer caches until a
# manifest changes. All workspace members are copied so pnpm can resolve the
# workspace graph; only landing + docs deps are actually installed (filtered),
# which keeps the backend/client native modules out of this image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/backend/package.json ./apps/backend/
COPY apps/client/package.json ./apps/client/
COPY apps/landing/package.json ./apps/landing/
COPY apps/admin/package.json ./apps/admin/
COPY apps/docs/package.json ./apps/docs/
COPY packages/shared/package.json ./packages/shared/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/jest-config/package.json ./packages/jest-config/
RUN pnpm install --frozen-lockfile --filter landing --filter docs

COPY . .

# --- Stage 2: Build Landing Page ---
FROM builder AS build-landing
RUN pnpm --filter landing build

# --- Stage 3: Build Documentation (Astro) ---
FROM builder AS build-docs
RUN pnpm --filter docs build

# --- Stage 4: Production Nginx Server ---
FROM nginx:alpine AS runner
ARG FRONTEND_DOMAIN
# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Inject domain into nginx.conf
RUN sed -i "s/__FRONTEND_DOMAIN__/${FRONTEND_DOMAIN:-localhost}/g" /etc/nginx/nginx.conf

# Copy build artifacts to the correct Nginx directories
# Landing page at root
COPY --from=build-landing /app/apps/landing/dist /usr/share/nginx/html
# Docs inside a /docs subfolder (Astro should be built with base: '/docs')
COPY --from=build-docs /app/apps/docs/dist /usr/share/nginx/html/docs

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
