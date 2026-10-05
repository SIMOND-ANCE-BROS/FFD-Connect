#!/usr/bin/env bash
# Démarre Cloud SQL Auth Proxy sur le port 5433 pour la DB de test GCloud.
# Usage : ./scripts/start-test-proxy.sh
# Stopper : Ctrl+C ou kill $(cat /tmp/cloud-sql-proxy-test.pid)

INSTANCE="ffd-connect-sdb:europe-west1:ffd-connect-db"
PORT=5433
PID_FILE="/tmp/cloud-sql-proxy-test.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Proxy already running (PID $(cat "$PID_FILE"))"
  exit 0
fi

echo "Starting Cloud SQL Auth Proxy on port $PORT..."
cloud-sql-proxy "${INSTANCE}" --port "$PORT" &
echo $! > "$PID_FILE"
echo "Proxy started (PID $(cat "$PID_FILE"))"
echo "Waiting for proxy to be ready..."
sleep 2
echo "Ready. DATABASE_URL=postgresql://ffd_user:***@localhost:$PORT/ffd_test"
