import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createApiRouter } from './routes/api.js';

const PORT = Number(process.env.API_PORT || process.env.PORT || 4010);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, llm: !!process.env.ANTHROPIC_API_KEY, db: !!process.env.DATABASE_URL }));

app.use('/api', createApiRouter());

app.listen(PORT, () => {
  console.log(`[codebook-arcade] backend listening on http://localhost:${PORT}`);
  console.log(`[codebook-arcade] LLM mode: ${process.env.ANTHROPIC_API_KEY ? 'Anthropic API' : 'offline heuristics (set ANTHROPIC_API_KEY to enable Claude)'}`);
  console.log(`[codebook-arcade] DB mode: ${process.env.DATABASE_URL ? 'Supabase/Postgres' : 'local Postgres (set DATABASE_URL)'}`);
});
