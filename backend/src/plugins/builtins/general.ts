import type { QuizGeneratorPlugin } from '../types.js';

const GENERAL_DIRECTIVE = `

GENERAL MODE: this book may be about any subject (history, biology, literature, …). Build every challenge from THIS text's own facts, names, events, definitions, and relationships. Distractors must come from the same document's adjacent concepts — no generic trivia.`;

/**
 * GENERAL — the default plugin for any subject (history, biology, literature,
 * law, …). It never wins detection on purpose; the router falls back to it
 * when nothing more specific matches. Heuristic generation delegates to the
 * shared engine in contentGenerator.ts (injected at boot in plugins/index.ts).
 */
const generalPlugin: QuizGeneratorPlugin = {
  id: 'general',
  name: 'General Subjects',
  version: '1.0.0',
  description: 'Any subject: definitions, concepts, and recall grounded in the document.',

  detect: () => false, // fallback only — never claims an upload

  promptDirective: () => GENERAL_DIRECTIVE,
};

export default generalPlugin;
