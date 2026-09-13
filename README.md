# QuestBook

> *(formerly CodeBook Arcade — if you have an old clone or bookmark, pull the latest and you're up to date; the app itself is a single-page app, so no link paths changed)*

> Hi, I'm Richard — or, as I like to call myself, **Artemus** (my artist name).
>
> This is **QuestBook**: a personal project I've been building as a pressure valve for my frustration with college professors who have the knowledge but not the energy to teach it properly. The idea is simple — if the lecture isn't going to hold my attention, maybe a dungeon will.

**Feed it a programming book. It turns the book into a quest you actually have to play to pass.**

Upload a text-based PDF of a programming book — think a textbook, a technical ebook, or a language spec — and the app chops it into chapters, pulls out the code blocks, and generates quiz-style challenges from the content. Then it drops you straight into a torch-lit side-scrolling dungeon where every monster is a question you have to answer and every wrong one costs you a heart. It's basically a reading assignment that fights back.

It's built for two kinds of people:

- **Students / solo learners** — upload your own book, play through it at your own pace, tournament-friendly per-term scores, ranks, and a coin economy that keeps a running tally of how much you've actually grinded.
- **Teachers / guilds** — found a guild, hand out a 6-character passcode, assign the same books to everyone, tweak the per-term difficulty (time limits, point multipliers, monster and quiz mix), and watch the leaderboard fill up.

### What it actually does right now

- **Two roles** — Teachers and Students, email/password signup, bcrypt + JWT on the backend.
- **Guilds** — one guild per student. Solo players are their own guild; teacher-led guilds share a passcode and share the books the teacher assigns.
- **Realm map** — one quest node per chapter. Beat a quest, the next one unlocks.
- **Side-scrolling quests** — run, jump, collect coins, dodge pits. Hit a patrolling goblin, slime, or bat and you're pulled into a turn-based battle.
- **Turn-based battles** — the monster asks a real question drawn from the book: multiple choice, predict-the-output, spot-the-bug, fill-in-the-blank. Nail it and you land a direct hit (3 hits takes it down). Miss and you lose a heart.
- **Dungeon boss** — the castle gate wakes the boss: hardest questions first, a 3-hit HP bar. Win and the quest clears, the treasure drops.
- **Scoring** — per quest it's basically `base − mistakes·penalty − (over par ? penalty) − (incomplete ? penalty) − (out of life ? penalty) + lives·bonus`, scaled by the term's points multiplier. Cumulative per-term score pushes you up through Copper → Iron → Gold → Diamond → Mythril with pixel shield-crest badges.
- **Leaderboards** — guild or global, all-time or per-term.
- **Coin economy (foundation)** — coins drop on quest completion (flat + flawless + full-life bonuses), persist across terms, show up on the HUD. The shop route is a "Coming Soon" placeholder for now.

### Controls

←/→ or A/D to move · Space/↑/W to jump · FLEE to bail out of a battle · quest timer runs per the term's settings · 🔊 toggles chiptune SFX · CRT toggle for scanlines.

## Quick start — clone to playing in ~5 minutes

This gets a new dev from a fresh clone to a playable build locally, including the database and a sample book.

### 0. One command (optional)

Once `backend/.env` has `DATABASE_URL`, this single script builds the frontend, applies migrations, and serves the app + API on ONE port (default 4010):

```bash
./run.sh            # build + migrate + serve everything on one port
./run.sh --dev      # classic two-process dev mode (backend :4010, vite :5173)
./run.sh --rebuild  # force a fresh frontend build, then serve
```

Prefer containers? `docker build -t questbook . && docker run -p 8080:8080 -e DATABASE_URL=... -e JWT_SECRET=... questbook` — the image migrates on start and serves the SPA from the same server.

### 1. Install dependencies

Two package installs, one per side:

```bash
cd backend && npm install
cd frontend && npm install
```

### 2. Set up the database on Supabase (free tier)

- Create a new Supabase project (free tier is fine).
- Go to **Project Settings → Database** and copy the **Connection string** (session mode, pooled). That's your `DATABASE_URL`.
  - Use the **pooled** connection string, not the direct one — serverless and short-lived connections behave better through the pooler, and the direct host is IPv6-only.
- Open the Supabase **SQL editor** and run the three migrations in order:
  - `backend/migrations/0001_init.sql`
  - `backend/migrations/0002_ranks_and_defaults.sql`
  - `backend/migrations/0003_rls.sql`

If you're running locally against a local Postgres instead of Supabase, set `DATABASE_URL` to that connection string and run the same migrations locally.

### 3. Create the backend env file

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set:

- `DATABASE_URL` — the Supabase connection string you copied.
- `JWT_SECRET` — any long random string.

Everything else is optional. If you leave the LLM vars blank, the app still generates challenges using offline heuristics, which is plenty to get started.

### 4. Generate a sample book (optional but useful)

If you don't have a real programming PDF handy, generate the built-in sample:

```bash
cd backend && node scripts/make-sample-pdf.mjs
```

That drops `sample-book.pdf` next to the script. Upload it once the app is running.

### 5. Start both sides

Two terminals:

```bash
# Terminal 1 — backend (port 4010)
cd backend
npm run dev

# Terminal 2 — frontend (port 5173, proxies /api to :4010)
cd frontend
npm run dev
```

The frontend dev server already proxies `/api` to the backend, so you don't need to configure anything else.

### 6. Open it and sign up

Open http://localhost:5173.

- **To play solo:** sign up as a Student, upload a PDF (or the sample book), and start a quest.
- **To try the teacher flow:** sign up as a Teacher, found a guild, grab the 6-character passcode, then sign up a second account as a Student and join with that passcode.

If you set up an LLM key, open the teacher dashboard → ⚙ Guild Master Settings → 🧙 AI Challenge Smith, confirm the model shows up, and hit **⚒ REGENERATE ALL CHALLENGES**. If you didn't, the app uses heuristics and you can play immediately.

That's it — you're in the dungeon.

### One gotcha to know about

If your shell happens to export `PORT`, the backend prefers `API_PORT` instead. A `PORT=0` environment breaks binding. See `backend/.env.example`.

---

## Architecture map

A quick map of the big modules so a new dev can find their way around without reading everything first.

```
questbook/
├── backend/                          # Express + TypeScript server
│   ├── src/
│   │   ├── server.ts                 # app setup: cors, json body parser, /health, /api mount
│   │   ├── routes/
│   │   │   ├── api.ts               # main game/play routes: auth, guilds, books, challenges,
│   │   │   │                      #   progress, scores, leaderboard, shop...
│   │   │   └── admin.ts             # admin-panel routes: sprites, animations, themes,
│   │   │                            #   map, guild admin, shop items
│   │   └── services/
│   │       ├── auth.ts              # bcrypt + JWT: signup, login, role middleware
│   │       ├── contentGenerator.ts  # PDF parsing (pdfjs-dist) + challenge generation
│   │       ├── llmClient.ts         # Anthropic / OpenAI-compatible provider client
│   │       └── lesson.ts            # chapter → quest/challenge resolution logic
│   ├── migrations/                  # Supabase-compatible Postgres schema (3 files, in order)
│   ├── scripts/
│   │   ├── make-sample-pdf.mjs      # generates sample-book.pdf for local testing
│   │   └── setup-ollama.sh          # one-command local LLM bootstrap
│   └── .env.example                 # template for DATABASE_URL, JWT_SECRET, LLM vars
│
├── frontend/                         # React + TypeScript + Vite
│   ├── src/
│   │   ├── api.ts                   # fetch wrappers: auth headers, JSON, error handling
│   │   ├── types.ts                # shared API types
│   │   ├── App.tsx                 # top-level shell: auth state, route into dashboards/game
│   │   ├── components/             # React screens: auth, dashboards, teacher tools,
│   │   │                            #   lesson, leaderboard, shop, admin panel, etc.
│   │   └── game/                   # hand-rolled Canvas 2D engine
│   │       ├── engine.ts           # rAF loop, input, physics, battle, world render, 320×180
│   │       ├── sprites.ts          # sprite loading + manifest, PNG vs grid fallback
│   │       ├── spriteGrids.ts      # built-in text pixel grids (fallback + docs)
│   │       ├── themes.ts           # scene theme registry (colors, monsters, sprite swaps)
│   │       ├── sfx.ts              # WebAudio chiptune synthesis (no audio files)
│   │       └── ...                 # avatar, animations, etc.
│   ├── public/
│   │   └── sprites/                # runtime PNGs + manifest.json (auto-generated)
│   ├── scripts/generate-sprites.ts  # renders spriteGrids → PNGs + manifest
│   └── vite.config.ts              # dev server on 5173, proxies /api → localhost:4010
│
└── docs/ASSET_GUIDE.md             # full art / map / cosmetics contributor guide
```

### How the pieces talk to each other

- **Frontend dev server → backend:** the Vite dev server proxies `/api` to `http://localhost:4010`, so the frontend's relative `/api/*` calls in `api.ts` reach the backend with no CORS or base-URL wiring in dev.
- **Backend → database:** `pg` connection pool using `DATABASE_URL`. Supabase is the default; local Postgres works if you set the URL accordingly.
- **Backend → LLM (optional):** `llmClient.ts` is server-side only. The frontend never talks to Anthropic or any OpenAI-compatible provider directly.
- **Frontend → game engine:** the game components render a Canvas element and hand input/time events into `engine.ts`. The engine is a self-contained Canvas thing — it doesn't know about React state directly.
- **Art path:** sprite grids in `spriteGrids.ts` rasterize to PNGs via `npm run sprites` into `public/sprites/`. At runtime, `sprites.ts` loads the manifest and falls back to the grid art if a PNG is missing.

### Where to look when you add something

- **New API endpoint** → add the route in `backend/src/routes/` (or a new route file), call into a service in `backend/src/services/`, then add a fetch wrapper in `frontend/src/api.ts`.
- **New database table/column** → new numbered migration under `backend/migrations/`.
- **New game content** (monster, item, prop) → sprite slot in `spriteGrids.ts`, run `npm run sprites`, swap in real art.
- **New map look** → new theme block in `themes.ts`; most looks are a theme, not engine code.
- **New UI screen** → new component under `frontend/src/components/`, wired to `api.ts`.
- **New engine behavior** (platforms, hazards, weather, etc.) → `engine.ts` / `buildLayout()`, and keep the capability driven by optional theme fields rather than new hardcoded constants.

For the detailed art and cosmetics guide, see **`docs/ASSET_GUIDE.md`**.

### What the game looks like

- Dungeon palette: stone floor, brick background, wood panel accents, torchlit walls.
- Retro pixel sprites for the knight, goblin, slime, and bat, plus treasure chest, castle gate, and wall torches.
- CRT scanline overlay you can toggle off.
- WebAudio chiptune SFX — no audio files, just synthesized tones.
- Two web fonts: "Press Start 2P" for the pixel UI and VT323 for the terminal-style bits.

## How it's built

- **Backend** — Express + TypeScript.
  - `pdfjs-dist` parses the uploaded PDF: text extraction plus monospace-font detection so code blocks don't get butchered into prose.
  - Supabase Postgres via a `pg` connection pool — no SQLite, no local database. Schema lives in `backend/migrations/*.sql`.
  - bcrypt for passwords, JWT for sessions, role middleware so teachers and students hit different things.
  - Challenge generation can talk to an LLM (Anthropic, or any free OpenAI-compatible provider) with schema validation and one strict retry. If nothing is configured, it falls back to offline heuristics.
- **Frontend** — React + TypeScript + Vite.
  - Plain Canvas 2D engine: a requestAnimationFrame loop with a timer fallback for when the tab is hidden.
  - The game simulates a **320×180 pixel world** drawn onto a **640×360 backing canvas** (2× scale, nearest-neighbor) and upscaled with `image-rendering: pixelated`. Sprites are authored at **32×32** for crisp extra detail.
  - Medieval palette, the two fonts above, CRT scanline overlay, synthesized chiptune SFX.

## How to run it

Two terminals, one per side. The frontend dev server already proxies `/api` to the backend, so you don't need to wire anything else up.

**One-time setup**

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set at least:

- `DATABASE_URL` — your Supabase connection string (Project Settings → Database).
- `JWT_SECRET` — any long random string.

### LLM challenge generation (optional)

If you don't set anything, the app still generates challenges — it just uses offline heuristics, which are intentionally shallow. If you want the real thing, pick **one**:

- **Paid / best quality**: `ANTHROPIC_API_KEY` (Claude).
- **Free OpenAI-compatible providers**: set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `LLM_MODEL`.
  - OpenRouter (free tier): `https://openrouter.ai/api/v1` — use models tagged `:free`.
  - Google Gemini (free): `https://generativelanguage.googleapis.com/v1beta/openai`.
  - Groq (free tier): `https://api.groq.com/openai/v1`.
  - Local Ollama ($0): `http://localhost:11434/v1`.

See `backend/.env.example` for the model ids.

#### Fully offline & free: local Ollama

```bash
bash backend/scripts/setup-ollama.sh
# or pick another model: MODEL=llama3.2:3b bash backend/scripts/setup-ollama.sh
```

The script starts the Ollama daemon, pulls the recommended coding model (`qwen2.5-coder:3b`, about 1.9 GB — needs ~4 GB RAM, CPU inference is fine), writes the `OPENAI_*` lines into `backend/.env`, and smoke-tests a completion.

After that, restart the backend, open the teacher dashboard → ⚙ Guild Master Settings → 🧙 AI Challenge Smith, confirm the model shows up, and hit **⚒ REGENERATE ALL CHALLENGES** to re-forge every tome with the local model.

Keep in mind 3B-class models are a lot weaker than Claude — expect simpler wording and occasional heuristic fallbacks, and the API reports them per chapter.

### Start both sides

```bash
# Terminal 1 — backend (port 4010)
cd backend
npm install
npm run dev

# Terminal 2 — frontend (port 5173, proxies /api to :4010)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, sign up as a Teacher (found a guild, upload a tome) or a Student (solo upload, or join with the passcode), and play.

One note on the port: if your shell happens to export `PORT`, the backend prefers `API_PORT` instead — a `PORT=0` environment breaks binding. See `backend/.env.example`.

### Regenerating challenges

Challenge sets are cached per book. After you change generator code or term settings, POST `/api/books/:id/regenerate` and then `/api/books/:id/generate` again — both need to be authenticated as the owning teacher or student.

### Testing artifacts

- `backend/scripts/make-sample-pdf.mjs` — generates `sample-book.pdf`, a tiny fake 3-chapter programming book you can use to smoke-test the pipeline.
- A dev-only `window.__arcade` hook exposes live engine state (phase, player x, lives) when a quest is open.

## Database

Schema lives in **`backend/migrations/*.sql`** — Supabase-compatible Postgres, no SQLite anywhere. Apply them in order, either in the Supabase SQL editor or through the Supabase CLI:

1. `backend/migrations/0001_init.sql` — users, guilds, books, chapters, challenges, progress, scores, plus indexes and the score→guild trigger.
2. `backend/migrations/0002_ranks_and_defaults.sql` — rank tiers and default term settings.
3. `backend/migrations/0003_rls.sql` — RLS enablement (permissive; writes go through the backend connection).

The old `data/arcade.db` SQLite file is no longer used.

## How to extend it

This is an MVP with a lot of moving parts left to add. If you want to build on it, the short version is: keep new systems modular, keep art and engine behavior separated by the theme object, and add new capabilities as optional fields rather than hardcoding more constants.

### Architecture-level things to know first

- **Backend is one Express app** in `backend/src/server.ts`, with routes in `backend/src/routes/`. Most of the real work is in `backend/src/services/` (`auth.ts`, `contentGenerator.ts`, `lesson.ts`, `llmClient.ts`, and so on).
- **Frontend is a Vite + React app** with a hand-rolled Canvas 2D engine in `frontend/src/game/`. The game screen components sit in `frontend/src/components/`. The API layer is `frontend/src/api.ts`.
- **Stateful vs stateless** — the app is stateless between requests. Auth lives in a JWT, everything else is in Supabase. That's why adding a new feature is usually: one or two new routes, one or two new tables (or columns), and whatever UI calls them.
- **LLM calls are server-side only** — the frontend never talks to Anthropic or any OpenAI-compatible provider directly. If you add a new generation mode or provider, keep it on the backend.

### Adding a new system

When you add something big (a shop that actually sells things, achievements, a new game mode, multiplayer, cosmetics, whatever), here's the shape to follow:

1. **Database first.** New tables go in a numbered migration under `backend/migrations/`, same style as the existing three. Keep one migration per logical change so it's reviewable and re-runnable.
2. **Backend route + handler.** Put the route in the right file under `backend/src/routes/` and call into a service in `backend/src/services/` rather than dumping logic into the route file.
3. **Frontend API helper.** Add the fetch wrapper in `frontend/src/api.ts` (or a small dedicated module) so components call one function instead of re-implementing headers, JSON, and error handling each time.
4. **UI last.** Build the component, wire it to the API helper, and keep it from reaching into game/engine internals directly.

A couple of current extension points already exist and are ready for you to finish:

- **The shop** is a placeholder. Coins already persist server-side and show on the HUD. Making them spendable is one join table and a couple of routes away — no engine changes.
- **Per-guild rank overrides** are a future extension. Right now rank thresholds are global defaults stored in `rank_tiers`. Per-guild overrides mean one more table (or columns) and a small bit of logic in the score/rank path.
- **Cosmetics / player-chosen skins** are already sketched in `docs/ASSET_GUIDE.md`. The registry is structured for it — a pack is just the same shape a theme uses, with one text column on `users` for the chosen id.

### Adding game content

- **New monsters, items, or props** — add the sprite slot in `frontend/src/game/spriteGrids.ts`, then run `npm run sprites` from the frontend to render the fallback PNG and regenerate `manifest.json`. Swap in real art afterward.
- **New map looks** — add a theme block to `frontend/src/game/themes.ts`. The engine reads scene colors, which monsters patrol, and per-theme sprite swaps from the theme object, so most new looks are just a new theme, not new engine code.
- **Custom themes and animations** — teachers and admins can already forge themes and register animated sprite clips through the admin panel, with no code changes. If you want those to do more, extend the theme/animation objects and the places that read them.

### Design and art

The art system already has a safety net: if a PNG is missing or fails to load, the engine falls back to the built-in grid art, and an unknown sprite name draws a tiny red square instead of crashing. That means you can drop in new art without fear of taking the game down.

See **`docs/ASSET_GUIDE.md`** for the full, detailed art guide. The short version:

- The game simulates a **320×180 pixel world**, drawn onto a **640×360 backing canvas** (2× scale, nearest-neighbor).
- Player and monster art is authored at **32×32**. The physics grid stays 16px-class — the sprites are bigger than the collision boxes on purpose, so there's room for detail.
- Every sprite slot has a fixed size listed in `public/sprites/manifest.json`. Match it exactly or the art gets clipped or overlaps its neighbors.
- Sprites are **PNG, RGBA, transparent background**, lowercase filename matching the slot name.
- The sprite grids in `frontend/src/game/spriteGrids.ts` are both documentation and fallback. Add a grid entry even if you're shipping a PNG — it makes the slot real to the engine and keeps the fallback alive.
- Map theming today covers sky, stars/parallax, floor, pits, HP pips, particle colors, which monsters patrol, and per-theme sprite swaps. Anything that needs new platform shapes, multi-height floors, moving hazards, or weather is engine work in `engine.ts`/`buildLayout()`, and should still come from optional Theme fields, not new hardcoded constants.

### Modular components and code style

- **One concern per file.** Routes handle HTTP; services handle the actual work.
- **Small API helpers.** Keep fetch wrappers in `api.ts` (or a dedicated small module) so new endpoints don't keep getting re-implemented in every component.
- **Give new systems their own module** instead of expanding a god-file. If a feature grows past a screenful or two, split it.
- **Keep the game engine decoupled from the React UI.** The engine is a Canvas thing; the UI renders on top of it. New gameplay systems should plug into the engine, not force the UI layer to know about frames and hitboxes.
- **Preserve the fallback story.** Any new sprite slot, theme field, or cosmetic hook should still degrade gracefully when missing — the existing art and theme systems do, and new stuff should too.

### Things that are still MVP

- **Scanned / image-only PDFs are rejected** with a clear error — there's no OCR.
- **Heuristic mode is intentionally shallow.** The intended quality comes from LLM mode.
- **Rank thresholds are global defaults** — per-guild overrides are an extension, not done yet.
- **The shop is a placeholder** — coins accrue but can't be spent yet.
- **Other obvious next steps** (pick whichever fits the project): real shop purchases, player cosmetics, more battle question types, new difficulty and monster variants, richer platforming, subtitle/alt-text for accessibility, anime-style or non-medieval themes, and anything multiplayer or social that makes guilds feel more alive.
