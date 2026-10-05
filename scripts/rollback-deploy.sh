#!/usr/bin/env bash
# rollback-deploy.sh — Roll back a deployment to a specific commit SHA.
#
# Usage:
#   ./scripts/rollback-deploy.sh <environment> <sha> [app_path]
#
# Examples:
#   ./scripts/rollback-deploy.sh staging abc1234   # rollback staging
#   ./scripts/rollback-deploy.sh production abc1234 # rollback production (requires confirmation)
#
# The script:
#   1. Authenticates to ACR (using VM managed identity)
#   2. Pulls the pre-built image for the target SHA
#   3. Restarts containers with the target image
#   4. Runs a health check
#
# Prerequisites:
#   - SSH access to the target server
#   - ACR_NAME environment variable (registry name, e.g. ffdconnectprodacr)
#   - APP_PATH environment variable (or passed as 3rd arg)
#   - Azure CLI configured (VM managed identity handles this)

set -euo pipefail

ENVIRONMENT="${1:?Usage: rollback-deploy.sh <staging|production> <sha> [app_path]}"
TARGET_SHA="${2:?Usage: rollback-deploy.sh <staging|production> <sha> [app_path]}"
APP_PATH="${3:-}"

# ── Validate environment ──
case "$ENVIRONMENT" in
  staging)
    COMPOSE_OVERLAY="docker-compose.staging.yml"
    HEALTH_URL="https://api-staging.ffd-connect.fr/health"
    ;;
  production)
    COMPOSE_OVERLAY="docker-compose.production.yml"
    HEALTH_URL="https://api.ffd-connect.fr/health"
    ;;
  *)
    echo "Error: environment must be 'staging' or 'production', got '$ENVIRONMENT'"
    exit 1
    ;;
esac

# ── Require APP_PATH and ACR_NAME ──
if [ -z "$APP_PATH" ]; then
  echo "Error: APP_PATH not set. Pass it as 3rd argument or export APP_PATH."
  exit 1
fi

if [ -z "${ACR_NAME:-}" ]; then
  echo "Error: ACR_NAME not set. Export the Azure Container Registry name."
  exit 1
fi

# ── Production confirmation ──
if [ "$ENVIRONMENT" = "production" ]; then
  echo "You are about to rollback PRODUCTION to SHA: $TARGET_SHA"
  echo "    App path: $APP_PATH"
  echo "    Image: $ACR_NAME.azurecr.io/ffd-connect-backend:$TARGET_SHA"
  read -r -p "Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "$APP_PATH"

# ── Record current state for audit trail ──
CURRENT_SHA=$(cat ~/.deploy/current-sha 2>/dev/null || echo "unknown")
echo "Current SHA: $CURRENT_SHA"
echo "Target SHA:  $TARGET_SHA"
echo "Environment: $ENVIRONMENT"
echo ""

# ── Auth to ACR ──
echo "Authenticating to ACR..."
az login --identity --allow-no-subscriptions
az acr login --name "$ACR_NAME"

# ── Rollback ──
echo "Rolling back to $TARGET_SHA..."
export IMAGE_TAG="$TARGET_SHA"

echo "Pulling image: $ACR_NAME.azurecr.io/ffd-connect-backend:$TARGET_SHA"
docker compose -f docker-compose.yml -f "$COMPOSE_OVERLAY" --profile full pull backend
docker compose -f docker-compose.yml -f "$COMPOSE_OVERLAY" --profile full up -d
docker compose -f docker-compose.yml -f "$COMPOSE_OVERLAY" ps

# Update deploy state
echo "$TARGET_SHA" > ~/.deploy/current-sha

# ── Health check ──
echo ""
echo "Running health check against $HEALTH_URL..."
for i in $(seq 1 12); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "Health check passed after ~$((i * 5))s"
    echo ""
    echo "Rollback complete: $CURRENT_SHA -> $TARGET_SHA"
    exit 0
  fi
  echo "  attempt $i/12 — retrying in 5s..."
  sleep 5
done

echo "Health check failed after 60s!"
echo "Current containers:"
docker compose -f docker-compose.yml -f "$COMPOSE_OVERLAY" ps
echo ""
echo "Logs (last 50 lines):"
docker compose -f docker-compose.yml -f "$COMPOSE_OVERLAY" logs --tail=50 backend
exit 1
