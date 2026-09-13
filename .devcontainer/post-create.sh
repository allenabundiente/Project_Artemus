#!/usr/bin/env bash
# QuestBook devcontainer post-create setup.
# Installs dependencies, seeds backend/.env, and — ONLY when a DATABASE_URL
# is already available (Codespaces secret or an existing .env) — applies the
# database migrations. A missing/unreachable DATABASE_URL is NOT an error:
# the container is still usable, migrations just wait for `./run.sh` or a
# manual `npm run migrate`.
set -uo pipefail

cd "$(dirname "$0")/.."

echo "[post-create] installing backend + frontend dependencies…"
npm install --prefix backend --no-audit --no-fund
npm install --prefix frontend --no-audit --no-fund

# Seed .env from the example without clobbering an existing one.
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "[post-create] seeded backend/.env from .env.example"
fi

# Load DATABASE_URL from the environment (Codespaces secret) or backend/.env.
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f backend/.env ]; then
  DB_URL="$(grep -E '^DATABASE_URL=..+' backend/.env | head -1 | cut -d= -f2- | tr -d '\"' || true)"
fi

if [ -z "$DB_URL" ]; then
  echo "[post-create] no DATABASE_URL set — skipping migrations."
  echo "[post-create] add it to backend/.env (or a Codespaces secret named DATABASE_URL), then run: ./run.sh"
  exit 0
fi

echo "[post-create] DATABASE_URL found — applying migrations…"
if DATABASE_URL="$DB_URL" node backend/scripts/migrate.mjs; then
  echo "[post-create] migrations applied."
else
  echo "[post-create] WARNING: migrations failed (unreachable DB?). Run 'npm run migrate' in backend/ once the DB is up."
fi
