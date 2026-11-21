import type { QuizGeneratorPlugin, GenerationContext } from '../types.js';
import type { GeneratedChallenge } from '../types.js';
import { chapterHasRealCode, codeRunnerConfigured, normalizeCodeExercise, supportedLanguages } from '../../services/codeExercises.js';

const PROGRAMMING_DIRECTIVE = `

PROGRAMMING MODE: this book teaches code. Favor these angles, all grounded in the chapter's own text and snippets:
- predict_output — "what does this snippet print/return?" using the book's real code.
- fill_in_blank — remove ONE token from a real snippet and ask what completes it.
- spot_the_bug — introduce exactly one realistic bug (wrong operator, off-by-one, missing symbol) and ask which line is wrong.
- multiple_choice — syntax, semantics, and "why" questions about the snippets.
Keep any non-code challenges (true_false / short_answer) anchored to technical facts in the text.`;

/**
 * The writable-coding part of the directive. Only offered when the runner is
 * actually configured AND this chapter has real code — a chapter of prose is
 * never turned into a coding task.
 */
function codeExerciseDirective(ctx: GenerationContext): string {
  if (!codeRunnerConfigured() || !chapterHasRealCode(ctx.chapter)) return '';
  const max = Math.max(1, Math.floor(Math.max(1, ctx.perChapterTarget) * 0.4));
  return `

CODE EXERCISES (the code runner is configured, and this chapter contains real code):
- You MAY include up to ${max} challenges of type "code_exercise" — never more than about 40% of the batch, and only for concepts this chapter actually shows code for (a function, loop, conditional, string/array operation, or class the student can write).
- Each code exercise must be a SELF-CONTAINED program task: read the given stdin (when the task needs input) and print EXACTLY the expected stdout. No AI grading, no files, no network.
- Fields: "prompt" (a precise task description), "starterCode" (preloaded code with a TODO where the student works), "language" (one of: ${supportedLanguages().join(', ')}), "referenceSolution" (a complete working program that solves it), and "tests" (3-5 objects: { "name": string, "stdin": string, "expectedStdout": string, "hidden": boolean }).
- "stdin" is fed to the program as its input; "expectedStdout" must match the program's stdout character for character (ignore only trailing whitespace/newlines). At least ONE test must be "hidden": true.
- "correctAnswer" is not used for code_exercise — a passing test run is the answer.
- Keep the rest of the batch in the other types. Theory, syntax recall, and bug-spotting belong in those, not in code exercises.`;
}

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
 * QUESTBOOK_CODE_FILE_PATTERN) and steers the LLM toward code-reading angles,
 * plus writable code exercises when a runner is available.
 */
const programmingPlugin: QuizGeneratorPlugin = {
  id: 'programming',
  name: 'Programming & Code',
  version: '1.1.0',
  description: 'Code-reading, output prediction, bug-spotting, code blanks, and write-and-run coding exercises.',

  detect: ({ filename, env }) => {
    const stem = filename.replace(/\.pdf$/i, '');
    return codeFilePatternFrom(env, DEFAULT_CODE_FILE_PATTERN).test(stem);
  },

  promptDirective: (ctx) => PROGRAMMING_DIRECTIVE + codeExerciseDirective(ctx),

  validateChallenge: (c: GeneratedChallenge, ctx: GenerationContext): GeneratedChallenge | null => {
    // A code exercise without a supported language, real tests, starter code,
    // or a reference solution is unusable — reject it outright.
    if (c.type === 'code_exercise') return normalizeCodeExercise(c, ctx.chapter);
    // Code-grounded types are meaningless without a snippet — reject those.
    if ((c.type === 'spot_the_bug' || c.type === 'predict_output') && !c.code) return null;
    return c;
  },
};

export default programmingPlugin;
