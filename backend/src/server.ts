import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from './routes/api.js';
import { llmModeLabel } from './services/llmClient.js';

const PORT = Number(process.env.API_PORT || process.env.PORT || 4010);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, llm: llmModeLabel(), db: !!process.env.DATABASE_URL }));

app.use('/api', createApiRouter());

// --- static frontend (single-server deployment / Docker) ---------------------
// If a built frontend exists at ../public (i.e. frontend/dist copied in by the
// Dockerfile or the run script), serve it and fall back to index.html for any
// non-API GET so the SPA owns its routes.
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  console.log(`[questbook] serving frontend from ${publicDir}`);
}

app.listen(PORT, () => {
  console.log(`[questbook] backend listening on http://localhost:${PORT}`);
  console.log(`[questbook] LLM mode: ${llmModeLabel()}`);
  console.log(`[questbook] DB mode: ${process.env.DATABASE_URL ? 'Supabase/Postgres' : 'local Postgres (set DATABASE_URL)'}`);
});
