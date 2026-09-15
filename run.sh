#!/usr/bin/env bash
# ============================================================
# QuestBook — ONE command to run EVERYTHING
# ============================================================
#   ./run.sh              → build once, then serve app + API on one port
#   ./run.sh --dev        → backend (4010) + Vite dev server (5173, proxied)
#   ./run.sh --rebuild    → force a fresh frontend build, then serve
#
# The default (production-style) mode builds the frontend once, copies it to
# backend/public, and lets the Express server serve BOTH the SPA and /api on
# a single port — one process, one port, nothing else to start.
# Migrations are applied automatically (idempotent) before the server starts.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Use the local Node even if a version manager needs initializing.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

# Load backend/.env so DATABASE_URL / API_PORT / keys are set for both steps.
if [ -f "$BACKEND/.env" ]; then
  set -a; . "$BACKEND/.env"; set +a
fi

PORT="${API_PORT:-${PORT:-4010}}"

case "${1:-}" in
  --dev)
    echo "[questbook] dev mode: backend :$PORT + vite :5173"
    (cd "$BACKEND" && npx tsx watch src/server.ts) &
    BACK_PID=$!
    trap 'kill $BACK_PID 2>/dev/null || true' EXIT
    cd "$FRONTEND" && exec npx vite --host
    ;;
esac

REBUILD=""
[ "${1:-}" = "--rebuild" ] && REBUILD=1

# 1) Frontend build (skipped when a fresh-enough build already exists).
NEED_BUILD=0
if [ -n "$REBUILD" ] || [ ! -f "$FRONTEND/dist/index.html" ]; then
  NEED_BUILD=1
elif [ -n "$(find "$FRONTEND/src" "$FRONTEND/index.html" -newer "$FRONTEND/dist/index.html" -print -quit 2>/dev/null)" ]; then
  NEED_BUILD=1
fi

if [ "$NEED_BUILD" = "1" ]; then
  echo "[questbook] building frontend…"
  (cd "$FRONTEND" && npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund)
  (cd "$FRONTEND" && npm run build)
else
  echo "[questbook] frontend build is up to date (use --rebuild to force)"
fi

# 2) Ship the SPA into the backend's static dir (served on the same port).
mkdir -p "$BACKEND/public"
rm -rf "$BACKEND/public"/*
cp -r "$FRONTEND/dist/." "$BACKEND/public/"

# 3) Apply DB migrations (idempotent — safe on every run), then serve.
echo "[questbook] applying migrations…"
(cd "$BACKEND" && npm run migrate --silent) || echo "[questbook] migrate failed — continuing (server retries the DB in the background)"

echo "[questbook] starting QuestBook on http://localhost:$PORT"
cd "$BACKEND" && exec npx tsx src/server.ts
