#!/usr/bin/env bash
PID_FILE="/tmp/cloud-sql-proxy-test.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Cloud SQL Proxy stopped (PID $PID)"
  else
    echo "Proxy was not running"
  fi
  rm -f "$PID_FILE"
else
  echo "No PID file found"
fi
