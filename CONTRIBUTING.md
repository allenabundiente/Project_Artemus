# Contributing to QuestBook

Thanks for helping build the dungeon! This guide gets you from clone to
contributing: the Codespace workflow, the one-command runner, how migrations
work, and how to add a quiz-generator plugin without touching the core.

New here? The product story lives in [README.md](README.md); this file is the
*how to change it* companion. The plugin API has its own deep-dive in
[docs/PLUGIN_API.md](docs/PLUGIN_API.md).

---

## 1. Getting a dev environment

### The fast way: GitHub Codespaces (recommended)

The repo ships a ready dev container (`.devcontainer/devcontainer.json`), so:

1. On GitHub: **Code → Codespaces → Create codespace on main**.
   Setup is automatic — Node 22, `backend/` + `frontend/` dependencies
   installed, `backend/.env` seeded from the example, ports **4010** (app)
   and **5173** (Vite) forwarded.
2. The one thing setup can't do for you is the database. Point the app at
   Postgres by either:
   - adding a **Codespaces secret** named `DATABASE_URL`
     (repo → Settings → Secrets and variables → Codespaces — future
     codespaces get it automatically), or
   - editing `backend/.env` in this codespace:
     `DATABASE_URL=postgresql://...` (Supabase → Connect → URI works great).
3. Run the app and open the forwarded URL:

   ```bash
   ./run.sh
   ```

CLI alternative: `gh codespace create -r <owner>/Project_Artemus -b main`.

Codespaces idles after inactivity — after a restart, just `./run.sh` again
(your files and `.env` persist).

### Local machine (works the same)

Requirements: **Node 22** and a reachable **Postgres** (Supabase's free tier
is fine).

```bash
git clone <repo> && cd Project_Artemus
cp backend/.env.example backend/.env   # then set DATABASE_URL + JWT_SECRET
npm install --prefix backend
npm install --prefix frontend
./run.sh
```

---

## 2. Running the app: `run.sh`

One command, three modes:

| Command | What it does |
|---|---|
| `./run.sh` | Builds the frontend (skipped when sources are unchanged), copies it to `backend/public`, applies pending migrations, serves **SPA + API on one port** (default 4010). |
| `./run.sh --dev` | Two-process hot-reload mode: backend on 4010 (`tsx watch`), Vite dev server on 5173 (proxies `/api`). Open the **5173** URL. |
| `./run.sh --rebuild` | Forces a fresh frontend build, then serves like the default mode. |

Useful env overrides:

```bash
API_PORT=4020 ./run.sh     # different port (4010 is the default)
```

In production-style mode the Express server serves `backend/public` with an
SPA fallback — one process, one port, no CORS. The Dockerfile wraps exactly
this (migrations run on container start).

Verification quickies:

- `curl localhost:4010/health` → `{"ok":true,...}`
- The server retries the DB in the background, so a wrong `DATABASE_URL`
  doesn't crash startup — check the log line `[db] connected to Postgres`.

---

## 3. Database migrations

Schema lives in **`backend/migrations/NNNN_name.sql`**, applied in filename
order by `npm run migrate` (in `backend/`). The runner is **idempotent and
transactional**: it tracks applied files in `schema_migrations`, so re-running
is always safe, and a failed migration rolls back cleanly.

`run.sh` and the Docker CMD run migrations automatically before the server
starts — locally you can also just do:

```bash
cd backend && npm run migrate
```

### Adding a migration

1. Create the next number: `backend/migrations/0008_my_change.sql`.
2. Keep it **additive** when possible (`ADD COLUMN IF NOT EXISTS`,
   `CREATE TABLE IF NOT EXISTS`) so existing data survives — every migration
   in this repo so far is additive.
3. Enum/column constraints live in the same file as the change that needs
   them (see `0006`/`0007` for the `quiz_mode` check constraint evolving).
4. Test the round trip: `npm run migrate` twice — the second run should print
   `Schema is up to date.`
5. If you add a column the backend maps, update the row mapper in
   `backend/src/db/db.ts` (`mapBook`-style functions) and the frontend mirror
   in `frontend/src/types.ts`.

Sanity scripts that exercise schema-adjacent logic:
`npm run migrate && npx tsx scripts/check-quest-count.mjs && npx tsx
scripts/check-plugins.mjs && npx tsx scripts/check-challenge-mix.mjs`.

---

## 4. Quiz-generator plugins (the main extension point)

Question generation is pluggable. The built-ins — `programming`
(`*_code.pdf` filenames), `language` (`*_lang` / `*_vocab`), and `general`
(everything else) — are registered like any plugin; nothing in the core
generator is special-cased. Full interface docs with a worked example live in
[docs/PLUGIN_API.md](docs/PLUGIN_API.md); the short version:

```ts
// backend/src/plugins/builtins/mySubject.ts
import type { QuizGeneratorPlugin } from '../types.js';

const myPlugin: QuizGeneratorPlugin = {
  id: 'mySubject',          // stable id — also the books.quiz_mode value
  name: 'My Subject',
  version: '1.0.0',

  // FIRST enabled match wins → register BEFORE general.
  detect: ({ filename }) => /(?:[_-]mysubj)$/i.test(filename.replace(/\.pdf$/i, '')),

  // Appended to the LLM system prompt for matching books.
  promptDirective: () => '\n\nMY SUBJECT MODE: ...',

  // Optional veto/repair of LLM output (null = reject the challenge).
  validateChallenge: (c) => (c.code ? null : c),
};
export default myPlugin;
```

Wire-up (two lines) in `backend/src/plugins/index.ts`:

```ts
import myPlugin from './builtins/mySubject.js';
// in initPlugins():  registerPlugin(myPlugin);  // before generalPlugin
```

Then:

- If the mode should be teacher-selectable and persisted, extend the
  `books_quiz_mode_valid` check constraint (new migration), the `QuizMode`
  types (`backend/src/plugins/types.ts`, `backend/src/db/db.ts`,
  `frontend/src/types.ts`), and the dashboard select/badge.
- Verify routing: add a case to `backend/scripts/check-plugins.mjs` and run it.
- Per-deployment toggles: `QUESTBOOK_DISABLED_PLUGINS=mySubject` or
  `QUESTBOOK_ENABLED_PLUGINS=general,mySubject`.

---

## 5. How this repo likes things done

- **Routes handle HTTP, services do the work.** New endpoint →
  `backend/src/routes/`, logic in `backend/src/services/`, fetch wrapper in
  `frontend/src/api.ts`, and a type in `frontend/src/types.ts`.
- **Typecheck both sides before pushing:**

  ```bash
  cd backend && npx tsc --noEmit
  cd frontend && npx tsc --noEmit
  ```

  CI (`.github/workflows/ci.yml`) runs these plus a frontend build and a
  Docker image build on every push/PR — same commands, so green locally
  means green remotely.
- **End-to-end check after generation changes:** start `./run.sh`, then
  `node backend/scripts/e2e-final-review.mjs` — exercises signup → guild →
  upload → generate → play → score against your local server.
- **Graceful degradation is the house style.** Missing PNG → grid fallback;
  bad env regex → default pattern; LLM down → heuristics. Keep new systems
  failing soft the same way.
- **One migration per logical change**, additive, with the row mappers
  updated in the same commit.
