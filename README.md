# CodeBook Arcade

Feed it a programming book (PDF). It feeds you a medieval pixel-art quest that teaches the book — now with guilds, ranks, and teacher tools.

Upload a text-based PDF of a programming book. The app parses it into chapters and code
blocks, generates grounded quiz/battle challenges from that content (Claude API if a key
is set, offline heuristics otherwise), and drops you into a torch-lit side-scrolling
dungeon where every monster is a question and every wrong answer costs a heart.

## What's new in this update

- **Teacher & Student roles** — email/password auth (bcrypt + JWT). Teachers are guild
  masters; students are adventurers.
- **Guilds** — a teacher founds a guild and gets a 6-character passcode. Students either
  upload their own tomes as **Solo Adventurers** or join a guild with the passcode and
  play the books their teacher assigns. One guild per student; leaving is one click.
- **Medieval theme** — dungeon palette, stone/wood panels, knight + goblin/slime/bat
  sprites, treasure chest, castle gate, wall torches. The CRT scanline overlay is
  unchanged.
- **Ranks & leaderboard** — cumulative per-term score maps to Copper → Iron → Gold →
  Diamond → Mythril with pixel shield-crest badges. Leaderboard supports guild/global
  scope and all-time vs per-term.
- **Guild master settings** — per-term (Prelims/Midterms/Semis/Finals) time limits,
  point multipliers, monster-generation difficulty, quiz difficulty mix, and score
  weights. Settings are applied to challenge generation and score submission for guild
  students; solo adventurers use global defaults.
- **Coin economy (foundation)** — coins are awarded on quest completion (flat + flawless
  + full-life bonuses), persist across terms, show on the dashboard HUD, and are spendable
  in a future update. The shop route exists as a "Coming Soon" placeholder.

## How it plays

- **Realm map** — one quest node per book chapter; complete a quest to unlock the next.
- **Side-scrolling quests** — run, jump, collect coins, dodge pits. Collide with a
  patrolling **goblin/slime/bat** to trigger a turn-based battle.
- **Turn-based battles** — the monster asks a question drawn from the book (multiple
  choice, predict-the-output, spot-the-bug, fill-in-the-blank). Correct answer = direct
  hit (3 hits defeat it). Wrong answer = it bites, you lose a heart.
- **Dungeon boss** — reach the castle gate to wake the **DUNGEON BOSS**: hardest
  questions first, 3-hit HP bar. Win to clear the quest and claim the treasure.
- **Scoring** — per quest: `base − mistakes·penalty − (over par ? penalty) − (incomplete
  ? penalty) − (out of life ? penalty) + lives·bonus`, scaled by the term's points
  multiplier. Cumulative per-term score determines rank.

Controls: ←/→ or A/D to move · Space/↑/W to jump · FLEE to escape a battle · ⏳ quest
timer per term settings · 🔊 toggles chiptune SFX · CRT toggle for scanlines.

## Stack

- **Backend**: Express + TypeScript, `pdfjs-dist` (text + monospace-font code-block
  detection), **Supabase Postgres** via `pg` connection pool, bcrypt + JWT auth with
  role middleware, Anthropic Messages API client (server-side only) with schema
  validation + one strict retry, offline heuristic generator fallback.
- **Frontend**: React + TypeScript + Vite, plain Canvas 2D engine (rAF loop with a
  timer fallback for occluded windows) rendering a 320×180 world onto a 640×360
  backing canvas with 2×-detail 32×32 sprites, medieval palette, "Press Start 2P" +
  VT323 fonts, CRT scanline overlay, WebAudio chiptune SFX (no audio files).

## Database (Supabase)

Schema lives in **`backend/migrations/*.sql`** — Supabase-compatible Postgres, no
SQLite anywhere. Apply them in order in the Supabase SQL editor (or via the Supabase
CLI):

1. `backend/migrations/0001_init.sql` — users, guilds, books, chapters, challenges,
   progress, scores (+ indexes and the score→guild trigger)
2. `backend/migrations/0002_ranks_and_defaults.sql` — rank tiers + default term settings
3. `backend/migrations/0003_rls.sql` — RLS enablement (permissive; writes go through
   the backend connection)

The old `data/arcade.db` SQLite file is no longer used.

## Run it

```bash
# One-time: create backend/.env from backend/.env.example and set:
#   DATABASE_URL  — your Supabase connection string (Project Settings → Database)
#   JWT_SECRET    — any long random string
#
# LLM challenge generation — optional, pick ONE:
#   ANTHROPIC_API_KEY    (paid Claude, best quality), OR a free OpenAI-compatible provider:
#   OPENAI_BASE_URL + OPENAI_API_KEY + LLM_MODEL
#     OpenRouter (free tier):  https://openrouter.ai/api/v1  + models tagged ":free"
#     Google Gemini (free):    https://generativelanguage.googleapis.com/v1beta/openai
#     Groq (free tier):        https://api.groq.com/openai/v1
#     Local Ollama ($0):       http://localhost:11434/v1
#   See backend/.env.example for model ids. With nothing set, challenges are
#   generated offline by heuristics.

### Fully offline & free: local Ollama (one command)

```bash
bash backend/scripts/setup-ollama.sh
# or pick another model: MODEL=llama3.2:3b bash backend/scripts/setup-ollama.sh
```

The script starts the Ollama daemon, pulls the recommended coding model
(`qwen2.5-coder:3b`, ~1.9 GB — needs ~4 GB RAM, CPU inference is fine), writes
the OPENAI_* lines into `backend/.env`, and smoke-tests a completion.
Restart the backend, open the teacher dashboard's ⚙ Guild Master Settings →
🧙 AI Challenge Smith, confirm the model shows up, and hit
**⚒ REGENERATE ALL CHALLENGES** to re-forge every tome with the local model.
(Note: 3B-class models are much weaker than Claude — expect simpler wording and
occasional heuristic fallbacks; the API reports them per chapter.)

# Terminal 1 — backend (port 4010)
cd backend
npm install
npm run dev

# Terminal 2 — frontend (port 5173, proxies /api to :4010)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, sign up as a Teacher (found a guild, upload a tome) or a
Student (solo upload, or join with the passcode), and play.

Note: if your shell exports `PORT`, the backend prefers `API_PORT` instead (a `PORT=0`
environment breaks binding). See `backend/.env.example`.

### Regenerating challenges

Challenge sets are cached per book. After changing generator code or term settings,
POST `/api/books/:id/regenerate` and then `/api/books/:id/generate` again (authenticated
as the owning teacher/student).

## Swapping in real pixel art

Sprite grids live in `frontend/src/game/spriteGrids.ts` and render to
`frontend/public/sprites/*.png` via `npm run sprites` (frontend). Player and monster
art is 32×32 (8 hero poses incl. a 4-frame run cycle and hurt/death); check
`public/sprites/manifest.json` for each slot's size. Drop in real PNGs with
the same filenames (`player_idle.png`, `enemy_goblin.png`, `boss.png`,
`castle_gate.png`, `badge_gold.png`, …) and they load automatically; the runtime falls
back to rasterizing the grids if a file is missing.

## Testing artifacts

- `backend/scripts/make-sample-pdf.mjs` — generates `sample-book.pdf`, a tiny fake
  3-chapter programming book used to smoke-test the pipeline.
- A dev-only `window.__arcade` hook exposes live engine state (phase, player x, lives)
  when a quest is open.

## Limitations (MVP)

- Scanned/image-only PDFs are rejected with a clear error (no OCR).
- Heuristic mode is intentionally shallow; LLM mode produces the intended quality.
- Rank thresholds are global defaults (stored in `rank_tiers`); per-guild overrides are
  a future extension.
- The shop is a placeholder — coins accrue but can't be spent yet.
