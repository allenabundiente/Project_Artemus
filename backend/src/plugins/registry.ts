// ============================================================================
// Plugin registry — registration, lookup, and per-deployment toggles
// ============================================================================
// Plugins self-register by importing this module and calling registerPlugin.
// Deployment control is env-only for now (internal plugins; see the spec):
//   QUESTBOOK_DISABLED_PLUGINS=code_language_x,theme_dark  (comma-separated ids)
//   QUESTBOOK_ENABLED_PLUGINS=only_these_ids               (opt-in whitelist)
// The registry keeps FIRST-match-wins detection order, so register specific
// plugins before general ones (index.ts does this).

import type { QuizGeneratorPlugin } from './types.js';

const plugins: QuizGeneratorPlugin[] = [];

export function registerPlugin(p: QuizGeneratorPlugin): void {
  const existing = plugins.findIndex((x) => x.id === p.id);
  if (existing !== -1) {
    // Same id re-registered (e.g. hot reload): replace in place, keep order.
    plugins[existing] = p;
    return;
  }
  plugins.push(p);
}

export function listPlugins(): readonly QuizGeneratorPlugin[] {
  return plugins;
}

export function getPlugin(id: string): QuizGeneratorPlugin | undefined {
  return plugins.find((p) => p.id === id);
}

function disabledSet(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env.QUESTBOOK_DISABLED_PLUGINS ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function enabledSet(env: NodeJS.ProcessEnv): Set<string> | null {
  const raw = env.QUESTBOOK_ENABLED_PLUGINS ?? '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

/** Is this plugin allowed in the current deployment (env allow/block lists)? */
export function isPluginEnabled(p: QuizGeneratorPlugin, env: NodeJS.ProcessEnv = process.env): boolean {
  if (disabledSet(env).has(p.id)) return false;
  const allow = enabledSet(env);
  return allow ? allow.has(p.id) : true;
}

/**
 * Detect which plugin should own a book, in registration order.
 * Returns the first ENABLED plugin whose detect() matches, else the first
 * enabled fallback-capable plugin (see fallbackPluginId in index.ts).
 */
export function detectPlugin(input: { filename: string; title: string; env?: NodeJS.ProcessEnv }): QuizGeneratorPlugin | null {
  const env = input.env ?? process.env;
  for (const p of plugins) {
    if (!isPluginEnabled(p, env)) continue;
    try {
      if (p.detect({ filename: input.filename, title: input.title, env })) return p;
    } catch (e) {
      console.error(`[plugins] detect() threw for ${p.id}:`, (e as Error).message);
    }
  }
  return null;
}
