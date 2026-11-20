// Third-party integrations hub for QuestBook.
//
// Every integration here is OPTIONAL and env-driven, in the same spirit as
// llmClient.ts: leave the env vars empty and the feature quietly turns off
// (routes answer 503, helpers return null / pass-through). Nothing in the app
// breaks when a service is missing or down — all helpers fail soft.
//
// No new npm dependencies: everything uses Node's built-in fetch. The one
// exception is Sentry, which is loaded dynamically only if you install
// `@sentry/node` and set SENTRY_DSN.
//
// Wiring (see the bottom of this file and the notes in the chat reply):
//   server.ts → initSentry(); app.use('/api/integrations', createIntegrationsRouter());
//   api.ts    → moderateText() in chat POST, ocrPdf() as a parsePdf fallback, etc.

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from './auth.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const env = (k: string) => (process.env[k] || '').trim();
const DEFAULT_TIMEOUT_MS = 10_000;

export class IntegrationError extends Error {
  constructor(public service: string, message: string) {
    super(`[${service}] ${message}`);
  }
}

async function http<T = any>(
  service: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  let res: Response | globalThis.Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    throw new IntegrationError(service, e?.name === 'TimeoutError' ? 'request timed out' : String(e?.message || e));
  }
  const r = res as globalThis.Response;
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new IntegrationError(service, `HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  const type = r.headers.get('content-type') || '';
  return (type.includes('json') ? await r.json() : await r.text()) as T;
}

const json = (body: unknown) => ({ 'content-type': 'application/json' as const, body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Status — which integrations are configured (feeds /health and the UI)
// ---------------------------------------------------------------------------

export function integrationStatus() {
  return {
    judge0: !!env('JUDGE0_URL'),
    turnstile: !!env('TURNSTILE_SECRET'),
    resend: !!env('RESEND_API_KEY'),
    dictionary: true, // no key required
    redis: !!(env('UPSTASH_REDIS_REST_URL') && env('UPSTASH_REDIS_REST_TOKEN')),
    ocr: !!env('OCR_SPACE_API_KEY'),
    languageTool: true, // public endpoint works without a key (rate-limited)
    libreTranslate: !!env('LIBRETRANSLATE_URL'),
    oneSignal: !!(env('ONESIGNAL_APP_ID') && env('ONESIGNAL_REST_API_KEY')),
    moderation: !!env('OPENAI_MODERATION_KEY'),
    sentry: !!env('SENTRY_DSN'),
  };
}

// ---------------------------------------------------------------------------
// 1. Judge0 CE — run student code against test input
//    env: JUDGE0_URL (e.g. https://judge0-ce.p.rapidapi.com or self-hosted),
//         JUDGE0_KEY (RapidAPI key, optional for self-hosted), JUDGE0_HOST
// ---------------------------------------------------------------------------

export interface CodeRunResult {
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  status: string;
  timeSec: number | null;
  memoryKb: number | null;
}

// Common Judge0 language ids. Extend as your programming plugin grows.
export const JUDGE0_LANGUAGES: Record<string, number> = {
  javascript: 63,
  python: 71,
  java: 62,
  c: 50,
  cpp: 54,
  typescript: 74,
  php: 68,
  go: 60,
  rust: 73,
};

export async function runCode(source: string, language: string, stdin = ''): Promise<CodeRunResult> {
  const base = env('JUDGE0_URL').replace(/\/+$/, '');
  if (!base) throw new IntegrationError('judge0', 'JUDGE0_URL is not set');
  const languageId = JUDGE0_LANGUAGES[language.toLowerCase()];
  if (!languageId) throw new IntegrationError('judge0', `unsupported language "${language}"`);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env('JUDGE0_KEY')) {
    headers['x-rapidapi-key'] = env('JUDGE0_KEY');
    if (env('JUDGE0_HOST')) headers['x-rapidapi-host'] = env('JUDGE0_HOST');
  }
  const out = await http<any>('judge0', `${base}/submissions?base64_encoded=false&wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source_code: source, language_id: languageId, stdin, cpu_time_limit: 5 }),
    timeoutMs: 20_000,
  });
  return {
    stdout: out.stdout ?? null,
    stderr: out.stderr ?? null,
    compileOutput: out.compile_output ?? null,
    status: out.status?.description ?? 'Unknown',
    timeSec: out.time ? Number(out.time) : null,
    memoryKb: out.memory ?? null,
  };
}

// ---------------------------------------------------------------------------
// 2. Cloudflare Turnstile — bot protection for signup / login
//    env: TURNSTILE_SECRET   (frontend uses the public site key)
//    When unset, verification passes so local dev keeps working.
// ---------------------------------------------------------------------------

export async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  const secret = env('TURNSTILE_SECRET');
  if (!secret) return true;
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const out = await http<{ success: boolean }>('turnstile', 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    return !!out.success;
  } catch (e) {
    console.error('[turnstile]', e);
    return false; // fail closed: a broken verifier must not let bots through
  }
}

/** Express middleware: require a valid `captchaToken` in the JSON body. */
export function requireCaptcha(req: Request, res: Response, next: NextFunction): void {
  verifyTurnstile(req.body?.captchaToken, req.ip).then((ok) => {
    if (ok) return next();
    res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
  });
}

// ---------------------------------------------------------------------------
// 3. Resend — transactional email (streak reminders, teacher announcements)
//    env: RESEND_API_KEY, RESEND_FROM (e.g. "QuestBook <noreply@yourdomain.com>")
// ---------------------------------------------------------------------------

export async function sendEmail(to: string | string[], subject: string, html: string): Promise<boolean> {
  const key = env('RESEND_API_KEY');
  if (!key) return false;
  try {
    await http('resend', 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, ...json({
        from: env('RESEND_FROM') || 'QuestBook <onboarding@resend.dev>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }) },
    });
    return true;
  } catch (e) {
    console.error('[resend]', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Free Dictionary API — definitions, phonetics, examples (no key)
// ---------------------------------------------------------------------------

export interface DictionaryEntry {
  word: string;
  phonetic: string | null;
  audio: string | null;
  meanings: { partOfSpeech: string; definition: string; example: string | null }[];
}

export async function lookupWord(word: string, lang = 'en'): Promise<DictionaryEntry | null> {
  const clean = word.trim().toLowerCase();
  if (!/^[\p{L}'-]{1,40}$/u.test(clean)) return null;
  try {
    const out = await http<any[]>('dictionary', `https://api.dictionaryapi.dev/api/v2/entries/${encodeURIComponent(lang)}/${encodeURIComponent(clean)}`);
    const e = out[0];
    if (!e) return null;
    return {
      word: e.word,
      phonetic: e.phonetic ?? e.phonetics?.find((p: any) => p.text)?.text ?? null,
      audio: e.phonetics?.find((p: any) => p.audio)?.audio ?? null,
      meanings: (e.meanings ?? []).slice(0, 3).map((m: any) => ({
        partOfSpeech: m.partOfSpeech,
        definition: m.definitions?.[0]?.definition ?? '',
        example: m.definitions?.[0]?.example ?? null,
      })),
    };
  } catch {
    return null; // 404 = unknown word; treat any failure as "no entry"
  }
}

// ---------------------------------------------------------------------------
// 5. Upstash Redis (REST) — cache LLM output, rate limit, leaderboards
//    env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//    All helpers fail open: if Redis is down the app just runs uncached.
// ---------------------------------------------------------------------------

async function redis<T = any>(command: (string | number)[]): Promise<T | null> {
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return null;
  try {
    const out = await http<{ result: T }>('redis', url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...json(command) },
      timeoutMs: 3_000,
    });
    return out.result;
  } catch (e) {
    console.error('[redis]', e);
    return null;
  }
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const raw = await redis<string>(['GET', `qb:${key}`]);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function cacheSet(key: string, value: unknown, ttlSec = 60 * 60 * 24): Promise<void> {
  await redis(['SET', `qb:${key}`, JSON.stringify(value), 'EX', ttlSec]);
}

/** Stable short hash for cache keys (e.g. PDF text + generation options). */
export async function hashKey(input: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Fixed-window rate limiter. Returns true when the call is allowed. */
export async function rateLimitAllow(bucket: string, limit: number, windowSec: number): Promise<boolean> {
  const key = `qb:rl:${bucket}`;
  const count = await redis<number>(['INCR', key]);
  if (count === null) return true; // Redis off/down → don't block users
  if (count === 1) await redis(['EXPIRE', key, windowSec]);
  return count <= limit;
}

/** Express middleware factory: limit per user (or IP) per route name. */
export function rateLimit(name: string, limit: number, windowSec: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const who = req.user?.id || req.ip || 'anon';
    if (await rateLimitAllow(`${name}:${who}`, limit, windowSec)) return next();
    res.status(429).json({ error: 'Too many requests — slow down a little.' });
  };
}

// ---------------------------------------------------------------------------
// 6. OCR.space — text from scanned / image-only PDFs
//    env: OCR_SPACE_API_KEY
// ---------------------------------------------------------------------------

export async function ocrPdf(buffer: Buffer, filename = 'book.pdf'): Promise<string | null> {
  const key = env('OCR_SPACE_API_KEY');
  if (!key) return null;
  try {
    const form = new FormData();
    form.set('apikey', key);
    form.set('language', 'eng');
    form.set('isOverlayRequired', 'false');
    form.set('OCREngine', '2');
    form.set('file', new Blob([buffer], { type: 'application/pdf' }), filename);
    const out = await http<any>('ocr.space', 'https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form,
      timeoutMs: 60_000,
    });
    if (out.IsErroredOnProcessing) return null;
    const text = (out.ParsedResults ?? []).map((r: any) => r.ParsedText || '').join('\n').trim();
    return text || null;
  } catch (e) {
    console.error('[ocr]', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. LanguageTool — grammar / spelling feedback for free-text answers
//    env: LANGUAGETOOL_URL (default public API), LANGUAGETOOL_USER/KEY (premium, optional)
// ---------------------------------------------------------------------------

export interface GrammarIssue {
  message: string;
  offset: number;
  length: number;
  suggestions: string[];
}

export async function checkGrammar(text: string, language = 'auto'): Promise<GrammarIssue[]> {
  const base = (env('LANGUAGETOOL_URL') || 'https://api.languagetool.org').replace(/\/+$/, '');
  try {
    const form = new URLSearchParams({ text: text.slice(0, 5000), language });
    if (env('LANGUAGETOOL_USER') && env('LANGUAGETOOL_KEY')) {
      form.set('username', env('LANGUAGETOOL_USER'));
      form.set('apiKey', env('LANGUAGETOOL_KEY'));
    }
    const out = await http<any>('languagetool', `${base}/v2/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    return (out.matches ?? []).slice(0, 25).map((m: any) => ({
      message: m.message,
      offset: m.offset,
      length: m.length,
      suggestions: (m.replacements ?? []).slice(0, 3).map((r: any) => r.value),
    }));
  } catch (e) {
    console.error('[languagetool]', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 8. LibreTranslate — vocabulary / question translation (self-hostable)
//    env: LIBRETRANSLATE_URL, LIBRETRANSLATE_KEY (optional)
// ---------------------------------------------------------------------------

export async function translateText(text: string, source: string, target: string): Promise<string | null> {
  const base = env('LIBRETRANSLATE_URL').replace(/\/+$/, '');
  if (!base) return null;
  try {
    const out = await http<{ translatedText: string }>('libretranslate', `${base}/translate`, {
      method: 'POST',
      ...json({ q: text.slice(0, 2000), source, target, format: 'text', api_key: env('LIBRETRANSLATE_KEY') || undefined }),
    });
    return out.translatedText ?? null;
  } catch (e) {
    console.error('[libretranslate]', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 9. OneSignal — web push (streak-at-risk reminders, announcements)
//     env: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY
//     The frontend registers the browser and calls OneSignal.login(userId),
//     so we can target by external_id = our user id.
// ---------------------------------------------------------------------------

export async function sendPush(userIds: string[], title: string, message: string, url?: string): Promise<boolean> {
  const appId = env('ONESIGNAL_APP_ID');
  const key = env('ONESIGNAL_REST_API_KEY');
  if (!appId || !key || userIds.length === 0) return false;
  try {
    await http('onesignal', 'https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { authorization: `Key ${key}`, ...json({
        app_id: appId,
        target_channel: 'push',
        include_aliases: { external_id: userIds },
        headings: { en: title },
        contents: { en: message },
        url,
      }) },
    });
    return true;
  } catch (e) {
    console.error('[onesignal]', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 10. OpenAI Moderation — screen guild chat before it's stored
//     env: OPENAI_MODERATION_KEY  (separate from OPENAI_API_KEY on purpose,
//          since that one may point at Gemini/Groq/Ollama)
// ---------------------------------------------------------------------------

export async function moderateText(text: string): Promise<{ flagged: boolean; categories: string[] }> {
  const key = env('OPENAI_MODERATION_KEY');
  if (!key) return { flagged: false, categories: [] };
  try {
    const out = await http<any>('moderation', 'https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, ...json({ model: 'omni-moderation-latest', input: text }) },
      timeoutMs: 5_000,
    });
    const r = out.results?.[0];
    const categories = Object.entries(r?.categories ?? {}).filter(([, v]) => v).map(([k]) => k);
    return { flagged: !!r?.flagged, categories };
  } catch (e) {
    console.error('[moderation]', e);
    return { flagged: false, categories: [] }; // fail open: chat keeps working
  }
}

// ---------------------------------------------------------------------------
// 11. Sentry — error tracking (optional: `npm i @sentry/node`)
//     env: SENTRY_DSN
// ---------------------------------------------------------------------------

let sentry: any = null;

export async function initSentry(): Promise<void> {
  const dsn = env('SENTRY_DSN');
  if (!dsn) return;
  try {
    const pkg = '@sentry/node'; // variable specifier: TS won't require the package
    sentry = await import(pkg);
    sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.NODE_ENV || 'development' });
    console.log('[questbook] Sentry enabled');
  } catch {
    console.warn('[questbook] SENTRY_DSN is set but @sentry/node is not installed — run `npm i @sentry/node`');
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (sentry) sentry.captureException(err, { extra: context });
}

/** Express error middleware — register AFTER all routes. */
export function sentryErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  captureError(err);
  console.error('[unhandled route error]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
}

// ---------------------------------------------------------------------------
// 12. UptimeRobot — no code needed. Point a free HTTP monitor at /health;
//     integrationStatus() is merged into that response in server.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Router — mount at /api/integrations
// ---------------------------------------------------------------------------

export function createIntegrationsRouter(): Router {
  const router = Router();

  router.get('/status', requireAuth, (_req, res) => res.json(integrationStatus()));

  // Run a code snippet (programming mode). Limited to 10 runs/min per user.
  router.post('/run-code', requireAuth, rateLimit('run-code', 10, 60), async (req, res) => {
    if (!env('JUDGE0_URL')) return res.status(503).json({ error: 'Code runner is not configured' });
    const { source, language, stdin } = req.body ?? {};
    if (typeof source !== 'string' || !source.trim() || source.length > 20_000) {
      return res.status(400).json({ error: 'Provide "source" (max 20,000 characters)' });
    }
    if (typeof language !== 'string' || !JUDGE0_LANGUAGES[language.toLowerCase()]) {
      return res.status(400).json({ error: `Unsupported language. Try: ${Object.keys(JUDGE0_LANGUAGES).join(', ')}` });
    }
    try {
      res.json(await runCode(source, language, typeof stdin === 'string' ? stdin : ''));
    } catch (e) {
      captureError(e);
      res.status(502).json({ error: 'Code runner failed' });
    }
  });

  // Standalone CAPTCHA check (or use requireCaptcha directly on signup/login).
  router.post('/verify-captcha', async (req, res) => {
    res.json({ ok: await verifyTurnstile(req.body?.token, req.ip) });
  });

  // Dictionary lookups are cached for a week to stay polite to the free API.
  router.get('/dictionary/:word', requireAuth, rateLimit('dictionary', 60, 60), async (req, res) => {
    const word = String(req.params.word);
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const cacheKey = `dict:${lang}:${word.toLowerCase()}`;
    const cached = await cacheGet<DictionaryEntry>(cacheKey);
    if (cached) return res.json(cached);
    const entry = await lookupWord(word, lang);
    if (!entry) return res.status(404).json({ error: 'No definition found' });
    await cacheSet(cacheKey, entry, 60 * 60 * 24 * 7);
    res.json(entry);
  });

  router.post('/grammar', requireAuth, rateLimit('grammar', 30, 60), async (req, res) => {
    const { text, language } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Provide "text"' });
    res.json({ issues: await checkGrammar(text, typeof language === 'string' ? language : 'auto') });
  });

  router.post('/translate', requireAuth, rateLimit('translate', 30, 60), async (req, res) => {
    if (!env('LIBRETRANSLATE_URL')) return res.status(503).json({ error: 'Translation is not configured' });
    const { text, source, target } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim() || typeof target !== 'string') {
      return res.status(400).json({ error: 'Provide "text" and "target" (and optionally "source")' });
    }
    const translated = await translateText(text, typeof source === 'string' ? source : 'auto', target);
    if (!translated) return res.status(502).json({ error: 'Translation failed' });
    res.json({ translated });
  });

  return router;
}
