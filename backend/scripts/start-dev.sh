#!/usr/bin/env bash
# Starts the CodeBook Arcade backend detached, on API_PORT (default 4010).
cd "$(dirname "$0")/.."
API_PORT="${API_PORT:-4010}"
export API_PORT
mkdir -p data
setsid nohup npx tsx src/server.ts > /tmp/arcade-backend.log 2>&1 < /dev/null &
echo "backend starting (pid $!) -> http://localhost:$API_PORT"