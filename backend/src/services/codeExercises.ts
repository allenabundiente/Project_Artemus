// Code exercises — generation policy, verification, and test running.
//
// A code_exercise asks the student to WRITE a program; the server runs it
// against the exercise's own stdin/stdout tests through Judge0 and only a
// server-verified pass counts as correct. Everything here is optional-safe:
// when JUDGE0_URL is unset the policy drops code exercises (existing ones
// still render with a clear "runner unavailable" message), so lessons are
// never blocked by this feature.
//
// Security rule: `referenceSolution` and hidden test expectations live in the
// database only. `publicChallengePayload()` is the single place student-facing
// routes go through, and it never returns either.

import { runCode, JUDGE0_LANGUAGES } from './integrations.js';
import type { GeneratedChallenge } from '../plugins/types.js';
import type { CodeTest, ChapterRow, ChallengeRow } from '../db/types.js';

export type { CodeTest } from '../db/types.js';

/** Code exercises may make up at most this share of a chapter's challenges. */
export const MAX_CODE_EXERCISE_SHARE = 0.4;
/** Generation asks for 3–5 tests per exercise (1 hidden minimum). */
const MIN_TESTS = 3;
const MAX_TESTS = 5;
const MAX_TEST_ENTRIES = 8; // teacher edits may add a few extra
const MAX_STARTER = 5_000;
const MAX_REFERENCE = 20_000;

/** Is the Judge0 runner configured? (no JUDGE0_URL → code exercises are off) */
export function codeRunnerConfigured(): boolean {
  return !!String(process.env.JUDGE0_URL ?? '').trim();
}

/** A language key the runner knows (JUDGE0_LANGUAGES is the single allowlist). */
export function isSupportedLanguage(language: unknown): language is string {
  return typeof language === 'string' && !!JUDGE0_LANGUAGES[language.trim().toLowerCase()];
}

/** Judge0's language keys, for prompts and the teacher editor. */
export function supportedLanguages(): string[] {
  return Object.keys(JUDGE0_LANGUAGES);
}

/**
 * Does the chapter actually contain code worth writing a program about?
 * A heading like "Console.WriteLine" in a list is not enough — require at
 * least one block with a few real lines.
 */
export function chapterHasRealCode(chapter: ChapterRow): boolean {
  const blocks = Array.isArray(chapter.codeBlocks) ? chapter.codeBlocks : [];
  return blocks.some((b) => {
    const code = String(b?.code ?? '');
    return code.trim().length >= 40 && code.split('\n').filter((l) => l.trim()).length >= 2;
  });
}

/**
 * Parse + normalize the tests JSON. Returns null when the shape is unusable —
 * a partially broken test list must never be silently half-run.
 */
export function normalizeTests(raw: unknown, max = MAX_TEST_ENTRIES): CodeTest[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CodeTest[] = [];
  for (const entry of raw.slice(0, max)) {
    if (!entry || typeof entry !== 'object') return null;
    const t = entry as Record<string, unknown>;
    if (typeof t.expectedStdout !== 'string') return null;
    const stdin = typeof t.stdin === 'string' ? t.stdin : '';
    const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 80) : `Test ${out.length + 1}`;
    out.push({
      name,
      stdin: stdin.slice(0, 10_000),
      expectedStdout: t.expectedStdout.slice(0, 10_000),
      hidden: t.hidden === true,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Validate one candidate code exercise against the chapter and the generation
 * rules. Returns the normalized challenge (with a placeholder `correctAnswer`
 * that is never used for grading) or null to reject it.
 */
export function normalizeCodeExercise(
  c: GeneratedChallenge,
  chapter: ChapterRow,
  opts: { requireRunner?: boolean } = {},
): GeneratedChallenge | null {
  if (c.type !== 'code_exercise') return null;
  if (opts.requireRunner !== false && !codeRunnerConfigured()) return null;
  if (!chapterHasRealCode(chapter)) return null;
  if (c.prompt.trim().length < 10) return null;

  const language = typeof c.language === 'string' ? c.language.trim().toLowerCase() : '';
  if (!isSupportedLanguage(language)) return null;
  const starterCode = typeof c.starterCode === 'string' ? c.starterCode.trim() : '';
  if (!starterCode || starterCode.length > MAX_STARTER) return null;
  const referenceSolution = typeof c.referenceSolution === 'string' ? c.referenceSolution.trim() : '';
  if (!referenceSolution || referenceSolution.length > MAX_REFERENCE) return null;
  const tests = normalizeTests(c.tests);
  if (!tests || tests.length < MIN_TESTS || tests.length > MAX_TESTS) return null;
  if (!tests.some((t) => t.hidden)) return null; // at least one hidden test

  return {
    type: 'code_exercise',
    prompt: c.prompt.trim(),
    code: null,
    options: null,
    // Grading happens by running the code; this string is stripped before the
    // challenge ever reaches a browser.
    correctAnswer: 'Verified by tests',
    explanation: c.explanation?.trim() || 'Read the failing test, fix your program, and submit again.',
    difficulty: c.difficulty,
    language,
    starterCode,
    tests,
    referenceSolution,
  };
}

/** Compare program output ignoring trailing spaces and trailing newlines. */
export function normalizeOutput(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

/**
 * Run the reference solution against every test, sequentially, with a short
 * timeout so a bad candidate cannot stall a generation run.
 */
export async function verifyCodeExercise(exercise: GeneratedChallenge, timeoutMs = 8_000): Promise<boolean> {
  const language = exercise.language ?? '';
  const reference = exercise.referenceSolution ?? '';
  const tests = exercise.tests ?? [];
  if (!isSupportedLanguage(language) || !reference || tests.length === 0) return false;
  for (const test of tests) {
    try {
      const run = await runCode(reference, language, test.stdin, timeoutMs);
      if (run.status !== 'Accepted') return false;
      if (normalizeOutput(run.stdout) !== normalizeOutput(test.expectedStdout)) return false;
    } catch {
      return false; // runner unreachable / rejected the language → keep it out
    }
  }
  return true;
}

export interface CodeExercisePolicyArgs {
  challenges: GeneratedChallenge[];
  chapter: ChapterRow;
  /** The plugin that produced the batch — only 'programming' may emit exercises. */
  pluginId: string;
  /** Deterministic fallback used to refill slots when exercises are dropped. */
  fallback?: () => GeneratedChallenge[];
}

/**
 * Enforce the code-exercise rules on an LLM batch:
 *   • only programming books, only chapters with real code;
 *   • at most ~40% of the chapter's challenges;
 *   • every kept exercise's reference solution must pass ALL its tests;
 *   • dropped exercises are backfilled with an existing challenge type so the
 *     chapter still meets its target count.
 *
 * Without JUDGE0_URL every candidate is dropped (and backfilled) — no code
 * exercises are ever generated when the runner is unavailable.
 */
export async function applyCodeExercisePolicy({
  challenges,
  chapter,
  pluginId,
  fallback,
}: CodeExercisePolicyArgs): Promise<GeneratedChallenge[]> {
  const maxCode = Math.max(1, Math.floor(challenges.length * MAX_CODE_EXERCISE_SHARE));
  const out: GeneratedChallenge[] = [];
  let kept = 0;
  let dropped = 0;

  for (const c of challenges) {
    if (c.type !== 'code_exercise') {
      out.push(c);
      continue;
    }
    const normalized = pluginId === 'programming' ? normalizeCodeExercise(c, chapter) : null;
    if (!normalized || kept >= maxCode) {
      dropped++;
      continue;
    }
    if (!(await verifyCodeExercise(normalized))) {
      console.warn(`[codeExercise] dropped "${normalized.prompt.slice(0, 60)}" — reference solution failed its tests`);
      dropped++;
      continue;
    }
    out.push(normalized);
    kept++;
  }

  if (dropped > 0 && fallback) {
    // Refill with generated non-code challenges from the same chapter. Keep the
    // prompts distinct so the backfill never duplicates a question.
    const used = new Set(out.map((c) => c.prompt.trim().toLowerCase()));
    const candidates = fallback().filter(
      (c) => c.type !== 'code_exercise' && !used.has(c.prompt.trim().toLowerCase()),
    );
    for (let i = 0; i < dropped && i < candidates.length; i++) {
      out.push(candidates[i]);
      used.add(candidates[i].prompt.trim().toLowerCase());
    }
  }
  return out;
}

/** A test as students may see it: name, stdin, expected stdout (never hidden). */
export interface PublicCodeTest {
  name: string;
  stdin: string;
  expectedStdout: string;
}

/**
 * The ONE student-facing mapping for challenge rows. Every other type is
 * returned exactly as before; code exercises lose their reference solution,
 * hidden test data, and correctAnswer.
 */
export function publicChallengePayload(c: ChallengeRow): unknown {
  if (c.type !== 'code_exercise') {
    // Byte-for-byte the old payload: the code columns are omitted entirely so
    // existing challenge types keep exactly the shape clients already know.
    const { language: _language, starterCode: _starterCode, tests: _tests, referenceSolution: _reference, ...rest } = c;
    return rest;
  }
  const tests = c.tests ?? [];
  const publicTests: PublicCodeTest[] = tests
    .filter((t) => !t.hidden)
    .map((t) => ({ name: t.name, stdin: t.stdin, expectedStdout: t.expectedStdout }));
  return {
    id: c.id,
    bookId: c.bookId,
    chapterId: c.chapterId,
    type: c.type,
    prompt: c.prompt,
    code: c.code,
    options: c.options,
    correctAnswer: '', // grading is server-side only
    explanation: c.explanation,
    difficulty: c.difficulty,
    ord: c.ord,
    language: c.language ?? null,
    starterCode: c.starterCode ?? null,
    tests: publicTests,
    hiddenTestCount: tests.filter((t) => t.hidden).length,
    codeRunnerAvailable: codeRunnerConfigured(),
  };
}

export interface TestRunResult {
  name: string;
  hidden: boolean;
  passed: boolean;
  stdout: string;
  stderr: string;
  compileOutput: string;
  status: string;
  /** Only present for non-hidden tests — hidden data stays server-side. */
  stdin?: string;
  /** Only present for non-hidden tests. */
  expectedStdout?: string;
}

export interface TestRunResponse {
  passed: boolean;
  sample: boolean;
  results: TestRunResult[];
}

/**
 * Run a student's program against the exercise's tests (sequentially, to stay
 * inside free-tier limits). `sample: true` runs only the non-hidden tests for
 * the RUN button and can never count as a pass.
 */
export async function runTestsForChallenge(
  challenge: ChallengeRow,
  source: string,
  sampleOnly: boolean,
): Promise<TestRunResponse> {
  const language = challenge.language ?? '';
  if (!isSupportedLanguage(language)) throw new Error('This exercise has no runnable language');
  const all = challenge.tests ?? [];
  if (all.length === 0) throw new Error('This exercise has no tests');
  const tests = (sampleOnly ? all.filter((t) => !t.hidden) : all).slice(0, MAX_TEST_ENTRIES);
  if (tests.length === 0) throw new Error('This exercise has no sample tests');

  const results: TestRunResult[] = [];
  for (const test of tests) {
    try {
      const run = await runCode(source, language, test.stdin);
      const passed = run.status === 'Accepted' && normalizeOutput(run.stdout) === normalizeOutput(test.expectedStdout);
      results.push({
        name: test.name,
        hidden: test.hidden,
        passed,
        stdout: run.stdout ?? '',
        stderr: run.stderr ?? '',
        compileOutput: run.compileOutput ?? '',
        status: run.status,
        stdin: test.hidden ? undefined : test.stdin,
        expectedStdout: test.hidden ? undefined : test.expectedStdout,
      });
    } catch (e) {
      results.push({
        name: test.name,
        hidden: test.hidden,
        passed: false,
        stdout: '',
        stderr: (e as Error).message,
        compileOutput: '',
        status: 'Runner error',
        stdin: test.hidden ? undefined : test.stdin,
        expectedStdout: test.hidden ? undefined : test.expectedStdout,
      });
    }
  }

  const passed = !sampleOnly && results.length > 0 && results.every((r) => r.passed);
  return { passed, sample: sampleOnly, results };
}
