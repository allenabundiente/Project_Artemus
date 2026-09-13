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
RUN npm ci
COPY backend/ ./
# The built SPA lands exactly where server.ts looks for it (backend/public).
COPY --from=frontend-build /app/frontend/dist ../public

EXPOSE 8080
# migrate.mjs is idempotent (tracked in schema_migrations), so it is safe on
# every start. tsx runs the TypeScript server directly — no build step needed.
CMD ["sh", "-c", "npm run migrate && exec npx tsx src/server.ts"]
