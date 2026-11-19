# ---------- Stage 1: frontend build ----------
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The API base is same-origin ('/api/...'), so no VITE_ vars are needed.
RUN npm run build

# ---------- Stage 2: backend + static frontend ----------
FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
# NODE_ENV=production (above) makes npm omit devDependencies — but tsx is a
# devDependency and is what actually runs the server. Without --include=dev the
# image shipped no tsx, so every boot had to download it from the registry via
# npx (slow, and fatal whenever that download failed).
RUN npm ci --include=dev
COPY backend/ ./
# The built SPA lands exactly where server.ts looks for it. server.ts resolves
# publicDir relative to backend/src → <repo>/backend/public, and this stage's
# WORKDIR is /app/backend, so "./public" = /app/backend/public.
# (The old "../public" copied to /app/public, which the server never reads —
# the SPA block never registered and / answered 404 "Cannot GET /".)
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 8080
# migrate.mjs is idempotent (tracked in schema_migrations), so it is safe on
# every start. A FAILED migration must not abort the boot: a bad or unreachable
# DATABASE_URL then turns into a crash loop ("Exited with status 1") and Render
# never gets a service to route traffic to. So we log the failure and start
# anyway — the app stays up, /health answers, and the boot log says why the DB
# is unusable. run.sh has always behaved the same way.
# tsx runs the TypeScript server directly — no build step needed.
CMD ["sh", "-c", "npm run migrate || echo '[boot] migrations failed (see above) — starting the server anyway; fix DATABASE_URL and redeploy to apply them'; exec node_modules/.bin/tsx src/server.ts"]
