#!/usr/bin/env bash
# Sets up local Ollama for $0 offline LLM challenge generation in CodeBook Arcade.
#
#   bash backend/scripts/setup-ollama.sh              # pull the recommended model
#   MODEL=llama3.2:3b bash backend/scripts/setup-ollama.sh
#
# What it does:
#   1. Verifies the `ollama` binary is installed (https://ollama.com/download)
#   2. Starts the ollama daemon if it isn't already responding
#   3. Pulls the recommended coding model if missing (~1.9 GB for the default)
#   4. Appends the OPENAI_* env lines to backend/.env (idempotent)
#   5. Smoke-tests a real completion against the model
set -euo pipefail

MODEL="${MODEL:-qwen2.5-coder:3b}"
BASE_URL="http://localhost:11434/v1"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

echo "==> 1/5 Checking ollama binary..."
command -v ollama >/dev/null 2>&1 || {
  echo "  ✗ ollama is not installed. Install it from https://ollama.com/download and re-run."
  exit 1
}
echo "  ✓ $(ollama --version 2>/dev/null | head -1)"

echo "==> 2/5 Starting the ollama daemon if needed..."
if curl -sf -m 2 http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "  ✓ daemon already running"
else
  echo "  → launching 'ollama serve' in the background..."
  nohup ollama serve > /tmp/ollama-serve.log 2>&1 &
  for i in $(seq 1 20); do
    curl -sf -m 2 http://localhost:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf -m 2 http://localhost:11434/api/version >/dev/null 2>&1 \
    && echo "  ✓ daemon is up (log: /tmp/ollama-serve.log)" \
    || { echo "  ✗ daemon failed to start — check /tmp/ollama-serve.log"; exit 1; }
fi

echo "==> 3/5 Pulling model '${MODEL}' (skipped if already present)..."
if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "${MODEL}"; then
  echo "  ✓ ${MODEL} already present"
else
  ollama pull "${MODEL}"
  echo "  ✓ pulled ${MODEL}"
fi

echo "==> 4/5 Writing env lines to ${ENV_FILE}..."
touch "${ENV_FILE}"
set_env() { # set_env KEY VALUE — replace existing line or append
  local key="$1" value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}
# Note: ANTHROPIC_API_KEY, if set, takes precedence over Ollama. Comment it out
# only if it is empty, so an existing paid setup keeps working.
if grep -qE "^ANTHROPIC_API_KEY=.+" "${ENV_FILE}" 2>/dev/null; then
  echo "  ! ANTHROPIC_API_KEY is set — it takes precedence. Comment it out to use Ollama."
fi
set_env "OPENAI_BASE_URL" "${BASE_URL}"
set_env "OPENAI_API_KEY" "ollama"
set_env "LLM_MODEL" "${MODEL}"
echo "  ✓ OPENAI_BASE_URL / OPENAI_API_KEY / LLM_MODEL configured"

echo "==> 5/5 Smoke test — asking ${MODEL} to complete a sentence..."
PAYLOAD=$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with exactly one word: the programming language created by Microsoft is called ___"}],"max_tokens":20}' "${MODEL}")
RESP=$(curl -sf -m 120 "${BASE_URL}/chat/completions" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer ollama' \
  -d "${PAYLOAD}") || { echo "  ✗ smoke test failed"; exit 1; }
TEXT=$(echo "${RESP}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).choices[0].message.content)}catch{console.log('(unparsed)')}})" 2>/dev/null || echo "(unparsed)")
echo "  ✓ model responded: ${TEXT}"

echo ""
echo "All set! Restart the backend and regenerate a book:"
echo "  kill \$(cat .freebuff/backend.pid 2>/dev/null) 2>/dev/null; cd backend && npx tsx src/server.ts"
echo "  # then: POST /api/books/<id>/generate  (or the teacher settings → Regenerate all)"
