// ============================================================================
// Plugin system entrypoint — built-in registration + routing helpers
// ============================================================================
// Import this module (not registry.ts) wherever generation happens so the
// built-ins are registered exactly once. Register more specific plugins
// BEFORE general ones: detection is first-match-wins.

import { registerPlugin, listPlugins, detectPlugin, isPluginEnabled, getPlugin } from './registry.js';
import generalPlugin from './builtins/general.js';
import programmingPlugin from './builtins/programming.js';
import languagePlugin from './builtins/language.js';
import type { QuizGeneratorPlugin, GenerationContext } from './types.js';

export { registerPlugin, listPlugins, detectPlugin, isPluginEnabled, getPlugin } from './registry.js';
export type { QuizGeneratorPlugin, GenerationContext, GeneratedChallenge, QuizMode } from './types.js';

let booted = false;

/** Idempotent: registers the built-ins in priority order. */
export function initPlugins(): void {
  if (booted) return;
  booted = true;
  registerPlugin(programmingPlugin); // specific first
  registerPlugin(languagePlugin);    // also specific
  registerPlugin(generalPlugin);     // fallback last (detect always false)
}

/**
 * Which plugin owns this book? First enabled match, else the 'general'
 * fallback (explicitly, in case a deployment disabled it).
 */
export function resolvePluginFor(filename: string, title: string, env: NodeJS.ProcessEnv = process.env): QuizGeneratorPlugin {
  initPlugins();
  const matched = detectPlugin({ filename, title, env });
  if (matched) return matched;
  return pluginById('general', env);
}

/**
 * Plugin by id with graceful fallback: a disabled or unknown id resolves to
 * the general fallback (or the first enabled plugin as a last resort), so
 * callers never have to branch on undefined.
 */
export function pluginById(id: string, env: NodeJS.ProcessEnv = process.env): QuizGeneratorPlugin {
  initPlugins();
  const p = getPlugin(id);
  if (p && isPluginEnabled(p, env)) return p;
  const fallback = getPlugin('general');
  if (fallback && isPluginEnabled(fallback, env)) return fallback;
  return listPlugins().find((x) => isPluginEnabled(x, env)) ?? generalPlugin;
}

/** The plugin's prompt contribution for a chapter ( '' when none). */
export function promptDirectiveFor(plugin: QuizGeneratorPlugin, ctx: GenerationContext): string {
  try {
    return plugin.promptDirective?.(ctx) ?? '';
  } catch (e) {
    console.error(`[plugins] promptDirective threw for ${plugin.id}:`, (e as Error).message);
    return '';
  }
}

/** Plugin-level challenge validation (null = reject the challenge). */
export function validateWithPlugin(plugin: QuizGeneratorPlugin, c: import('./types.js').GeneratedChallenge, ctx: GenerationContext): import('./types.js').GeneratedChallenge | null {
  try {
    // No hook → accept. A hook returning null is an explicit REJECT and must
    // NOT fall back to the challenge (hence no ?? here).
    if (!plugin.validateChallenge) return c;
    return plugin.validateChallenge(c, ctx);
  } catch (e) {
    console.error(`[plugins] validateChallenge threw for ${plugin.id}:`, (e as Error).message);
    return c;
  }
}
