#!/bin/bash
# راه‌اندازی محلی سندباکس (production از Docker Compose استفاده می‌کند)
cd "$(dirname "$0")"
export NOOR_HTTP_PORT=8080
export NOOR_DATA_DIR=./data
export NOOR_SOURCES_DIR=./data/sources
export NOOR_SERVICE_TOKEN="${NOOR_SERVICE_TOKEN:-dev-internal-token}"
export NOOR_COOKIE_SECURE=false
pkill -f "bin/api" 2>/dev/null; pkill -f "bin/worker" 2>/dev/null
sleep 0.5
setsid nohup ./bin/api > api.log 2>&1 < /dev/null &
sleep 1
setsid nohup ./bin/worker > worker.log 2>&1 < /dev/null &
echo "api + worker started (logs: api.log, worker.log)"
