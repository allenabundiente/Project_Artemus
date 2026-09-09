// Pluggable LLM client. Two dialects are supported:
//
//   1. "anthropic"    — the Anthropic Messages API (paid Claude, best quality)
//   2. "openai_compat" — the OpenAI /chat/completions dialect, which covers every
//      major FREE option with one implementation:
//        • OpenRouter  (https://openrouter.ai/api/v1) — 20+ ":free" models
//        • Google Gemini (https://generativelanguage.googleapis.com/v1beta/openai)
//        • Groq        (https://api.groq.com/openai/v1) — generous free tier
//        • Local Ollama (http://localhost:11434/v1) — fully offline, $0
//
// Selection is purely env-driven; no code changes needed to swap providers:
//   LLM_PROVIDER=anthropic | openai_compat   (default: auto-detect from keys)
//   ANTHROPIC_API_KEY=...                    (enables provider 1)
//   OPENAI_BASE_URL=https://openrouter.ai/api/v1
//   OPENAI_API_KEY=routersk_...              (enables provider 2)
//   LLM_MODEL=deepseek/deepseek-chat-v3:free (model id from the provider)

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Ollama (and other non-streaming hosts) only send response headers once the
// whole completion is ready — CPU inference can exceed undici's 5-minute
// default headers timeout, so give every LLM call an explicit, generous one.
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 15 * 60_000);

export class LlmError extends Error {}

export type LlmProvider = 'anthropic' | 'openai_compat' | 'none';

/** Which provider will actually be used, given the current env. */
export function activeProvider(): LlmProvider {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL) return 'openai_compat';
  return 'none';
}

/** True when at least one LLM provider is configured. */
export function isLlmConfigured(): boolean {
  return activeProvider() !== 'none';
}

export function llmModeLabel(): string {
  const p = activeProvider();
  if (p === 'anthropic') return `anthropic (${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'})`;
  if (p === 'openai_compat') return `openai-compat ${process.env.OPENAI_BASE_URL} (${process.env.LLM_MODEL || 'default model'})`;
  return 'offline heuristics (set ANTHROPIC_API_KEY, or OPENAI_API_KEY + OPENAI_BASE_URL for a free model)';
}

/**
 * Send one prompt to the configured provider and return the assistant text.
 * Throws LlmError on any failure — callers fall back to heuristics.
 */
export async function callLlm(system: string, user: string, maxTokens = 4000): Promise<string> {
  switch (activeProvider()) {
    case 'anthropic':
      return callAnthropic(system, user, maxTokens);
    case 'openai_compat':
      return callOpenAiCompatible(system, user, maxTokens);
    default:
      throw new LlmError('No LLM provider configured');
  }
}

/** Anthropic Messages API. Returns the assistant text. */
export async function callAnthropic(system: string, user: string, maxTokens = 4000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmError('ANTHROPIC_API_KEY is not set');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new LlmError(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new LlmError('Anthropic API returned no text');
  }
  return text;
}

/**
 * OpenAI-compatible chat completions — the dialect spoken by OpenRouter,
 * Gemini's OpenAI endpoint, Groq, Ollama, and many other free/cheap hosts.
 */
export async function callOpenAiCompatible(system: string, user: string, maxTokens = 2000): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseUrl) throw new LlmError('OPENAI_API_KEY / OPENAI_BASE_URL are not set');
  if (!model) throw new LlmError('LLM_MODEL is not set (e.g. deepseek/deepseek-chat-v3:free for OpenRouter)');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      // OpenRouter-specific but harmless elsewhere: attribution headers.
      'http-referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5173',
      'x-title': 'CodeBook Arcade',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4, // some creativity, but grounded — see SYSTEM_PROMPT
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (res.status === 429) {
    throw new LlmError('Free-tier rate limit hit (HTTP 429) — try again shortly or use a smaller batch');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new LlmError(`LLM API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    throw new LlmError('LLM API returned no text');
  }
  if (process.env.LLM_DEBUG_DIR) {
    try {
      const fs = await import('node:fs');
      fs.mkdirSync(process.env.LLM_DEBUG_DIR, { recursive: true });
      fs.writeFileSync(`${process.env.LLM_DEBUG_DIR}/resp-${Date.now()}.txt`, text);
    } catch { /* best effort */ }
  }
  return text;
}
