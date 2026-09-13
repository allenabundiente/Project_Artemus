# QuestBook Plugin API — quiz generators

QuestBook's question generation is pluggable. A **quiz generator plugin** decides
*when* it applies to an uploaded book and *how* generation is steered for it.
The built-in `programming` mode (`topicname_code.pdf` → code questions) is just
one plugin; new subjects or styles (language learning, law, medicine, …) drop in
without touching the core generator.

Plugins are **internal** by design (per the product spec): they ship in the
`backend/src/plugins/` tree and are registered in code — no runtime installation
or marketplace.

---

## The interface

```ts
// backend/src/plugins/types.ts
interface QuizGeneratorPlugin {
  id: string;            // stable id — e.g. 'programming'
  name: string;          // human name for logs/admin UI
  version: string;       // bump when prompt/behavior changes materially
  description?: string;

  // Does this plugin apply to this upload? FIRST enabled match wins.
  detect(input: { filename: string; title: string; env: NodeJS.ProcessEnv }): boolean;

  // Extra system-prompt text appended during LLM generation ('' = none).
  promptDirective?(ctx: GenerationContext): string;

  // Optional deterministic generation (no LLM). The shared heuristic engine
  // in contentGenerator.ts covers the 'general' plugin; a plugin may supply
  // its own instead.
  generateHeuristically?(ctx: GenerationContext): { concept: string; challenges: GeneratedChallenge[] };

  // Optional veto/repair of LLM output. Return null to reject a challenge.
  validateChallenge?(c: GeneratedChallenge, ctx: GenerationContext): GeneratedChallenge | null;
}
```

`GenerationContext` carries the chapter (`{ id, bookId, idx, title, text, codeBlocks }`),
the teacher's `targetCount` (or `null`), the derived `perChapterTarget`, and the
guild's difficulty steering.

---

## Registering a plugin

Create a file under `backend/src/plugins/builtins/`, then register it in
`backend/src/plugins/index.ts` inside `initPlugins()` — **more specific plugins
before general ones**, because detection is first-match-wins:

```ts
registerPlugin(programmingPlugin); // specific first
registerPlugin(myLanguagePlugin);  // new specific plugin
registerPlugin(generalPlugin);     // fallback last (detect always false)
```

`general` is the mandatory fallback: its `detect` returns `false` on purpose, and
the router explicitly falls back to it when nothing claims an upload.

---

## Enabling / disabling per deployment

Environment variables only — no code changes needed:

```bash
# Disable specific plugins (comma-separated ids):
QUESTBOOK_DISABLED_PLUGINS=programming

# Or run ONLY a whitelist:
QUESTBOOK_ENABLED_PLUGINS=general,programming
```

A disabled plugin is skipped during detection and its prompt directive is never
applied. Unknown ids in `QUESTBOOK_ENABLED_PLUGINS` are simply ignored.

---

## Detection: the filename convention

The `programming` plugin matches with this regex by default:

```
(?:[_-]code|code[_-]?)$      # python_chapter1_code.pdf, cpp-code.pdf, …
```

Deployments with a different naming convention can override it:

```bash
QUESTBOOK_CODE_FILE_PATTERN='(^|[_-])(code|programming)([_-]|$)'
```

Invalid regexes log a warning and fall back to the default — startup never
crashes on a bad env var.

Teachers can always override the detected mode per book:
`PUT /api/books/:id/settings` with `{ "quizMode": "general" | "programming" }`,
or the 📖→⌨ toggle in the teacher dashboard.

---

## Full example: a "language learning" plugin

```ts
// backend/src/plugins/builtins/language.ts
import type { QuizGeneratorPlugin } from '../types.js';

const languagePlugin: QuizGeneratorPlugin = {
  id: 'language',
  name: 'Language Learning',
  version: '1.0.0',
  description: 'Vocabulary, translation, and grammar drills from the text.',

  detect: ({ filename, env }) =>
    new RegExp(env.QUESTBOOK_LANGUAGE_FILE_PATTERN ?? '(?:[_-](?:lang|vocab))$', 'i')
      .test(filename.replace(/\.pdf$/i, '')),

  promptDirective: () => `

LANGUAGE MODE: treat the chapter as language-learning material. Favor fill_in_blank
vocabulary recall, multiple_choice over grammar choices, and short_answer
translation prompts. Distractors must be words/phrases from THIS chapter —
same part of speech where possible, never invented words.`,

  validateChallenge: (c) => {
    // Example veto: translation prompts must not carry code blocks.
    return c.code ? null : c;
  },
};

export default languagePlugin;
```

Then in `plugins/index.ts`:

```ts
import languagePlugin from './builtins/language.js';
// …in initPlugins():
registerPlugin(languagePlugin); // BEFORE general
```

That's the whole integration — upload routing, LLM steering, and the per-book
`quiz_mode` badge all pick it up automatically.

---

## Where the hooks run

| Stage | File | Hook |
|---|---|---|
| Upload | `routes/api.ts` → `detectQuizMode` | `detect()` decides `books.quiz_mode` |
| LLM generation | `services/contentGenerator.ts` | `promptDirective()` appended to the system prompt |
| LLM validation | `services/contentGenerator.ts` | `validateChallenge()` vetoes bad challenges |
| Heuristic generation | `services/contentGenerator.ts` | `generateHeuristically()` (optional; shared engine covers most cases) |

## Sanity check

```bash
cd backend && npx tsx scripts/check-plugins.mjs
```

Prints the registered plugins, routing decisions for sample filenames, and a
prompt-directive excerpt.
