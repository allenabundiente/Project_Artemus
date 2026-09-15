# Local preview (no root, no Docker)

One command runs the whole stack locally — embedded Postgres plus the
production-style server (SPA + API on one port, migrations on boot):

```bash
./preview.sh              # → http://localhost:4010
./preview.sh --stop       # stop the server + database
```

- First run downloads ~50 MB of Postgres binaries into `.local-preview/`
  (gitignored); afterwards it works offline.
- Requires Node 22, `curl`, `ar`, `tar`, and the `psql` client.
- `backend/.env` is created automatically if missing (pointing at the local
  throwaway database, `JWT_SECRET` randomized). Existing `.env` files are
  never overwritten — delete `backend/.env` to regenerate.
- The local database is disposable: your real data lives wherever
  `DATABASE_URL` points (Supabase in production).
- The same `API_PORT` override matters anywhere `PORT` is set in your
  environment (some sandboxes export `PORT=0`, which would break binding —
  `API_PORT` always wins; see `backend/.env.example`).

For the manual equivalent (CI-style verification without the script), see
the "Reproduce the artifacts" section of the run book checked into
`.freebuff/run.md` when present, or `CONTRIBUTING.md` for the standard dev
workflow (`./run.sh --dev` for hot reload).
