#!/usr/bin/env bash
# ============================================================
# QuestBook — local preview WITHOUT root or Docker
# ============================================================
# One command: embedded Postgres (user-owned binaries) +
# backend/.env seed + production-style server (SPA + API on ONE
# port via ./run.sh, migrations applied on boot).
#
#   ./preview.sh            # start everything on :4010
#   ./preview.sh --stop     # stop the server + database
#
# Everything lives under .local-preview/ (gitignored). First run
# downloads ~50 MB of Postgres binaries; afterwards it's offline.
# Requires: Node 22, curl, ar, tar, and the psql client.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LP="$ROOT/.local-preview"
PORT="${API_PORT:-4010}"
PGBIN="$LP/pg/node_modules/@embedded-postgres/linux-x64/native/bin"

if [ "${1:-}" = "--stop" ]; then
  "$PGBIN/pg_ctl" -D "$LP/pg/data" stop 2>/dev/null || true
  pkill -f "tsx src/server.ts" 2>/dev/null || true
  echo "[preview] stopped."
  exit 0
fi

# --- 1. node deps (backend + frontend) ----------------------------------------
[ -d "$ROOT/backend/node_modules" ]  || (cd "$ROOT/backend"  && npm ci --no-audit --no-fund)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm ci --no-audit --no-fund)

# --- 2. embedded postgres ------------------------------------------------------
export LD_LIBRARY_PATH="$LP/pg/icu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ ! -x "$PGBIN/postgres" ]; then
  echo "[preview] fetching embedded postgres (first run only)…"
  mkdir -p "$LP/pg" && cd "$LP/pg"
  npm init -y >/dev/null && npm i @embedded-postgres/linux-x64 --no-audit --no-fund
  # The binaries link against ICU 60 — fetch that exact version locally
  # (modern distros ship newer ICU; no root needed with LD_LIBRARY_PATH).
  mkdir -p icu && ICU_DIR="$PWD/icu" && DEB="$(mktemp -d)"
  curl -fsSL -o "$DEB/libicu60.deb" \
    "https://launchpad.net/ubuntu/+archive/primary/+files/libicu60_60.2-6ubuntu1_amd64.deb" \
  || curl -fsSL -o "$DEB/libicu60.deb" \
    "https://archive.debian.org/debian/pool/main/i/icu/libicu60_60.2-6_amd64.deb"
  (cd "$DEB" && ar x libicu60.deb && tar xf data.tar.*)
  cp "$DEB"/usr/lib/x86_64-linux-gnu/libicu*.so* "$ICU_DIR/"
  rm -rf "$DEB"
  cd "$ROOT"
fi

if [ ! -d "$LP/pg/data" ]; then
  echo "[preview] initializing database…"
  "$PGBIN/initdb" -D "$LP/pg/data" -U postgres --auth=trust --no-locale >/dev/null
fi
"$PGBIN/pg_ctl" -D "$LP/pg/data" -o "-p 5432 -h 127.0.0.1" -l "$LP/pg/pg.log" start
sleep 1
if command -v psql >/dev/null; then
  psql -h 127.0.0.1 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='questbook'" | grep -q 1 \
    || psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE questbook;"
else
  echo "[preview] WARNING: psql client not found — create the 'questbook' database manually."
fi

# --- 3. backend/.env (only when missing — never overwrite) ---------------------
if [ ! -f "$ROOT/backend/.env" ]; then
  cat > "$ROOT/backend/.env" <<ENV
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/questbook
JWT_SECRET=local-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
ENV
  echo "[preview] wrote backend/.env"
fi

# --- 4. serve SPA + API on one port (migrations run on boot) --------------------
echo "[preview] starting QuestBook on http://localhost:$PORT"
cd "$ROOT" && exec env API_PORT="$PORT" ./run.sh
