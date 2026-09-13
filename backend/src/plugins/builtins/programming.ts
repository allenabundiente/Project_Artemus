import type { QuizGeneratorPlugin, GenerationContext } from '../types.js';
import type { GeneratedChallenge } from '../types.js';

const PROGRAMMING_DIRECTIVE = `

PROGRAMMING MODE: this book teaches code. Favor these angles, all grounded in the chapter's own text and snippets:
- predict_output — "what does this snippet print/return?" using the book's real code.
- fill_in_blank — remove ONE token from a real snippet and ask what completes it.
- spot_the_bug — introduce exactly one realistic bug (wrong operator, off-by-one, missing symbol) and ask which line is wrong.
- multiple_choice — syntax, semantics, and "why" questions about the snippets.
Keep any non-code challenges (true_false / short_answer) anchored to technical facts in the text.`;

/** Default filename convention: topicname_code.pdf and close cousins. */
export const DEFAULT_CODE_FILE_PATTERN = '(?:[_-]code|code[_-]?)$';

export function codeFilePatternFrom(env: NodeJS.ProcessEnv, fallback: string): RegExp {
  const src = env.QUESTBOOK_CODE_FILE_PATTERN || fallback;
  try {
    return new RegExp(src, 'i');
  } catch {
    console.warn(`[plugins] invalid QUESTBOOK_CODE_FILE_PATTERN (${src}); using default`);
    return new RegExp(fallback, 'i');
  }
}

/**
 * PROGRAMMING — the former "programming mode", now a plugin like any other.
 * Detects code-teaching books by filename convention (configurable via
 * QUESTBOOK_CODE_FILE_PATTERN) and steers the LLM toward code-reading angles.
 */
const programmingPlugin: QuizGeneratorPlugin = {
  id: 'programming',
  name: 'Programming & Code',
  version: '1.0.0',
  description: 'Code-reading, output prediction, bug-spotting, and code blanks from the book\u2019s real snippets.',

  detect: ({ filename, env }) => {
    const stem = filename.replace(/\.pdf$/i, '');
    return codeFilePatternFrom(env, DEFAULT_CODE_FILE_PATTERN).test(stem);
  },

  promptDirective: () => PROGRAMMING_DIRECTIVE,

  validateChallenge: (c: GeneratedChallenge, ctx: GenerationContext): GeneratedChallenge | null => {
    // Code-grounded types are meaningless without a snippet — reject those.
    if ((c.type === 'spot_the_bug' || c.type === 'predict_output') && !c.code) return null;
    void ctx;
    return c;
  },
};

export default programmingPlugin;
