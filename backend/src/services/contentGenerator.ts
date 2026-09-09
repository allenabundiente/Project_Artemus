import { callLlm, LlmError } from './llmClient.js';
import type { ChapterRow, CodeBlock } from '../db/types.js';

export type ChallengeType = 'multiple_choice' | 'predict_output' | 'spot_the_bug' | 'fill_in_blank';

export interface GeneratedChallenge {
  type: ChallengeType;
  prompt: string;
  code: string | null;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface ChapterContent {
  concept: string;
  challenges: GeneratedChallenge[];
}

/** Optional per-term difficulty steering from guild settings. */
export interface GenerationOptions {
  term?: string;
  monsterDifficulty?: 'easy' | 'medium' | 'hard';
  difficultyMix?: { easy: number; medium: number; hard: number };
}

const VALID_TYPES = new Set(['multiple_choice', 'predict_output', 'spot_the_bug', 'fill_in_blank']);
const VALID_DIFFICULTY = new Set(['easy', 'medium', 'hard']);

const SYSTEM_PROMPT = `You are the content engine for "CodeBook Arcade", a retro arcade game that teaches programming from real textbook material.

Your job: take a chapter of a programming book and turn its actual content into game challenges. Ground EVERY challenge in the text or code you are given. Never invent concepts, syntax, or APIs that are not present in the source material.

Rules:
- Return ONLY a single valid JSON object. No markdown fences, no commentary, no trailing text.
- Schema:
{
  "concept": "string — the single core concept this chapter teaches",
  "challenges": [
    {
      "type": "multiple_choice | predict_output | spot_the_bug | fill_in_blank",
      "prompt": "string — the question, written like a game prompt",
      "code": "string or null — required for predict_output and spot_the_bug; optional for others",
      "options": ["4 strings — REQUIRED for multiple_choice and predict_output, null otherwise; exactly one must be correct"],
      "correctAnswer": "string — must match one of options exactly when options are present",
      "explanation": "string — 1-2 sentences that teach, tied to the book's own wording",
      "difficulty": "easy | medium | hard"
    }
  ]
}
- Generate 3-5 challenges per chapter, ordered easy to hard.
- Mix types. Use the book's real code snippets — do not rewrite them except to introduce one deliberate bug for spot_the_bug.
- Keep code snippets short (under 15 lines).`;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '\n…[truncated]…';
}

function formatCodeBlocks(blocks: CodeBlock[]): string {
  if (blocks.length === 0) return '(no code blocks detected in this chapter)';
  return blocks
    .slice(0, 12)
    .map((b, i) => `--- code block ${i + 1}${b.context ? ` (context: ${b.context.slice(0, 120)})` : ''} ---\n${b.code.slice(0, 800)}`)
    .join('\n\n');
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  // Find the outermost {...} region
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in LLM response');
  return candidate.slice(start, end + 1);
}

/**
 * Best-effort repair of near-JSON from small local models: unquoted object
 * keys, trailing commas, and // or slash-star comments are all common and all
 * fixable without ambiguity.
 */
function repairJson(text: string): string {
  let out = '';
  let inStr = false;
  let quoteChar = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] ?? ''; i++; continue; }
      if (ch === quoteChar) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quoteChar = ch; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  // 'single-quoted' strings → "double-quoted" (values and keys)
  out = out.replace(/'([^'\n]*)'/g, '"$1"');
  // Quote bare object keys: { key: or , key:
  out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  // Trailing commas before } or ]
  out = out.replace(/,\s*([}\]])/g, '$1');
  return out;
}

function validateGenerated(raw: any): ChapterContent {
  if (typeof raw !== 'object' || raw === null) throw new Error('LLM response is not an object');
  const concept = typeof raw.concept === 'string' ? raw.concept.slice(0, 120) : 'Chapter concepts';
  const list = Array.isArray(raw.challenges) ? raw.challenges : [];
  if (list.length === 0) throw new Error('LLM returned no challenges');

  const challenges: GeneratedChallenge[] = [];
  for (const c of list) {
    if (typeof c !== 'object' || c === null) continue;
    const type = c.type as ChallengeType;
    if (!VALID_TYPES.has(type)) continue;
    const prompt = typeof c.prompt === 'string' ? c.prompt.trim() : '';
    if (prompt.length < 5) continue;
    const difficulty = VALID_DIFFICULTY.has(c.difficulty) ? c.difficulty : 'medium';
    const code = typeof c.code === 'string' && c.code.trim().length > 0 ? c.code.trim() : null;
    const explanation = typeof c.explanation === 'string' ? c.explanation.trim() : 'Review the chapter for more detail.';
    let options: string[] | null = null;
    let correctAnswer = typeof c.correctAnswer === 'string' ? c.correctAnswer.trim() : '';

    if (type === 'multiple_choice' || type === 'predict_output') {
      if (!Array.isArray(c.options) || c.options.length < 2) continue;
      options = (c.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim());
      if (options.length < 2) continue;
      if (!options.includes(correctAnswer)) {
        // Try to find the correct answer among options if the model echoed it differently
        const match = options.find((o) => o.toLowerCase() === correctAnswer.toLowerCase());
        if (match) correctAnswer = match;
        else continue;
      }
    } else {
      if (correctAnswer.length === 0) continue;
    }
    // Code-grounded types without code make no sense — reject them.
    if ((type === 'spot_the_bug' || type === 'predict_output') && !code) continue;

    challenges.push({ type, prompt, code, options, correctAnswer, explanation, difficulty });
  }
  if (challenges.length === 0) throw new Error('No valid challenges survived validation');
  return { concept, challenges };
}

function difficultyDirective(opts: GenerationOptions | undefined): string {
  if (!opts) return '';
  const parts: string[] = [];
  if (opts.monsterDifficulty) {
    parts.push(`Target overall difficulty for this run: ${opts.monsterDifficulty.toUpperCase()}.`);
  }
  if (opts.difficultyMix) {
    const { easy, medium, hard } = opts.difficultyMix;
    parts.push(`Aim for roughly this distribution across the challenges you emit: ${easy}% easy, ${medium}% medium, ${hard}% hard.`);
  }
  if (opts.term) {
    parts.push(`These challenges are for the "${opts.term}" academic term.`);
  }
  if (parts.length === 0) return '';
  return `\n\nDIFFICULTY DIRECTION (respect the source material; do not invent concepts to increase difficulty):\n${parts.join('\n')}`;
}

/** Generate challenges for a chapter using the LLM. Retries once on malformed JSON. */
export async function generateWithLlm(chapter: ChapterRow, opts?: GenerationOptions): Promise<ChapterContent> {
  // Keep the prompt lean: every token must be prefilled, which is the dominant
  // cost on CPU-only inference (local Ollama). ~6k chars of text + a few code
  // blocks is plenty for grounded challenges.
  const userPrompt = [
    `Book chapter: "${chapter.title}"`,
    ``,
    `CHAPTER TEXT:`,
    truncate(chapter.text, 6000),
    ``,
    `CODE BLOCKS:`,
    formatCodeBlocks(chapter.codeBlocks.slice(0, 6)),
    difficultyDirective(opts),
  ].join('\n');

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callLlm(SYSTEM_PROMPT, attempt === 1 ? userPrompt + '\n\nIMPORTANT: Return ONLY the raw JSON object, nothing else.' : userPrompt, 2000);
      const json = extractJson(raw);
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        parsed = JSON.parse(repairJson(json)); // small models emit near-JSON
      }
      return validateGenerated(parsed);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new LlmError(`LLM generation failed after retries: ${lastErr?.message}`);
}

// ---------------------------------------------------------------------------
// Offline heuristic fallback — deterministic, no API key needed.
// ---------------------------------------------------------------------------

export function generateHeuristically(chapter: ChapterRow): ChapterContent {
  const challenges: GeneratedChallenge[] = [];

  // 1) Definition sentences → fill_in_blank + multiple_choice
  const defs = extractDefinitions(chapter.text);
  for (const d of defs.slice(0, 2)) {
    challenges.push({
      type: 'fill_in_blank',
      prompt: `Complete the sentence from the book: "${d.text.replace(d.term, '______')}"`,
      code: null,
      options: null,
      correctAnswer: d.term,
      explanation: `From the book: "${d.text}"`,
      difficulty: 'easy',
    });
  }
  if (defs.length >= 2) {
    const d = defs[0];
    const term = stripArticle(d.term);
    const distractors = defs.slice(1, 4).map((x) => stripArticle(x.term)).filter((t) => t && t !== term);
    if (term && distractors.length >= 2) {
      const options = shuffle([term, ...distractors.slice(0, 3)]);
      challenges.push({
        type: 'multiple_choice',
        prompt: `What is ${aOrAn(term)} ${term}?`,
        code: null,
        options,
        correctAnswer: term,
        explanation: `From the book: "${d.text}"`,
        difficulty: 'medium',
      });
    }
  }

  // 2) Code blocks → predict_output / spot_the_bug
  for (const block of chapter.codeBlocks.slice(0, 4)) {
    const lines = block.code.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    const bug = mutateBug(lines);
    if (bug) {
      challenges.push({
        type: 'spot_the_bug',
        prompt: `This code from the book has been sabotaged. Which line contains the introduced bug?`,
        code: bug.code,
        options: bug.choices,
        correctAnswer: bug.answer,
        explanation: `The bug: ${bug.reason}. In the book's original, that line is:\n${bug.original}`,
        difficulty: 'hard',
      });
    } else {
      const summary = summarizeCode(block);
      if (summary) {
        const options = shuffle([summary.correct, ...summary.distractors]);
        challenges.push({
          type: 'predict_output',
          prompt: `What does this code from the book do?`,
          code: block.code,
          options,
          correctAnswer: summary.correct,
          explanation: `From the book${block.context ? ` (context: "${block.context}")` : ''}: it ${summary.correct.toLowerCase()}`,
          difficulty: 'medium',
        });
      }
    }
  }

  if (challenges.length === 0) {
    // Last resort: a simple comprehension question over the chapter heading.
    const concept = chapter.title.trim();
    challenges.push({
      type: 'fill_in_blank',
      prompt: `What is the title of this chapter?`,
      code: null,
      options: null,
      correctAnswer: concept,
      explanation: `This chapter is titled "${concept}".`,
      difficulty: 'easy',
    });
  }

  return { concept: chapter.title, challenges: challenges.slice(0, 6) };
}

interface Definition {
  term: string;
  text: string;
}

function extractDefinitions(text: string): Definition[] {
  // Rejoin words hyphenated across line breaks ("pro-\ngram" → "program")
  // and collapse whitespace so print-run line breaks don't mangle sentences.
  const clean = text.replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t]*\n[ \t]*/g, ' ');
  const out: Definition[] = [];
  const re = /\b([A-Z][A-Za-z0-9 _\-]{1,40}?)\s+(is|are|refers to|means|is called|is known as|is defined as)\s+(an|a|the)?\s*([A-Za-z][^.?\n]{5,140})/g;
  const TERM_STOPWORDS = /^(that|which|what|who|how|why|where|when|there|this|it|they|you|we|if|but|and|or|so|then|in|on|at|to|for|with|by|from|as|an?|the)$/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const term = m[1].trim();
    const value = m[4].trim();
    // Skip garbage terms: multi-clause fragments, stopword endings, or terms
    // that are really sentence fragments from headings/questions.
    const words = term.split(/\s+/);
    if (term.length < 3 || words.length > 4) continue;
    // Any stopword anywhere in a "term" means we've captured sentence fragment,
    // not a noun phrase ("NET A computer", "Immediately following the expression").
    if (words.some((w) => TERM_STOPWORDS.test(w))) continue;
    // Two consecutive capitalized words mid-term are usually a heading collision.
    if (words.length >= 2 && words.slice(1).some((w) => /^[A-Z]/.test(w))) continue;
    if (value.length < 8 || /^[A-Z][a-z]+\s+[a-z]+\s+(that|which|who)\b/.test(value)) continue;
    if (out.some((d) => d.term === term)) continue;
    out.push({ term, text: `${term} ${m[2]} ${m[3] ?? ''} ${value}`.replace(/\s+/g, ' ').trim() });
  }
  return out.slice(0, 8);
}

function aOrAn(term: string): string {
  return /^[aeiou]/i.test(term) ? 'an' : 'a';
}

function stripArticle(term: string): string {
  const m = term.match(/^(?:a|an|the)\s+(.+)$/i);
  return m ? m[1] : term;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Introduce one deterministic bug into a code block and return a
 * spot_the_bug challenge. Returns null if no safe mutation applies.
 */
function mutateBug(lines: string[]): { code: string; choices: string[]; answer: string; reason: string; original: string } | null {
  // C#: a statement missing its terminating semicolon.
  const semi = lines.findIndex((l) => /;\s*$/.test(l) && !/^\s*(\/\/|using\s)/.test(l) && /[=)]|return\b/.test(l));
  if (semi !== -1) {
    const original = lines[semi];
    const buggy = original.replace(/;\s*$/, '');
    return {
      code: withReplacedLine(lines, semi, buggy),
      choices: [buggy.trim(), original.trim(), `${original.trim().replace(/;\s*$/, ';')}// forgot something?`],
      answer: buggy.trim(),
      reason: `a C# statement is missing its terminating semicolon`,
      original: original.trim(),
    };
  }

  // C#: Console.WriteLine / Console.Write call missing its closing parenthesis.
  const cw = lines.findIndex((l) => /Console\.(Write|WriteLine)\(.*\)\s*;?\s*$/.test(l));
  if (cw !== -1) {
    const original = lines[cw];
    const buggy = original.replace(/\)(\s*;?)\s*$/, '$1');
    return {
      code: withReplacedLine(lines, cw, buggy),
      choices: [buggy.trim(), original.trim(), buggy.trim().replace(/\($/, '();')],
      answer: buggy.trim(),
      reason: `the Console call is missing its closing parenthesis, which breaks the syntax`,
      original: original.trim(),
    };
  }

  const idx = lines.findIndex((l) => /^\s*(def |class |if |elif |else|for |while )/.test(l) && l.trim().endsWith(':'));
  if (idx !== -1) {
    const original = lines[idx];
    const buggy = original.replace(/:$/, '');
    return {
      code: withReplacedLine(lines, idx, buggy),
      choices: [buggy.trim(), original.trim(), `# ${original.trim()}`],
      answer: buggy.trim(),
      reason: `a block-introducing line is missing its trailing colon, which breaks the syntax`,
      original: original.trim(),
    };
  }

  const eq = lines.findIndex((l) => l.includes(' == '));
  if (eq !== -1) {
    const original = lines[eq];
    const buggy = original.replace(' == ', ' = ');
    return {
      code: withReplacedLine(lines, eq, buggy),
      choices: [buggy.trim(), original.trim(), `print(${buggy.trim()})`],
      answer: buggy.trim(),
      reason: `"==" (comparison) was changed to "=" (assignment), so the condition always assigns instead of comparing`,
      original: original.trim(),
    };
  }

  const call = lines.findIndex((l) => /^\s*[a-zA-Z_]\w*\s*\(/.test(l) && l.trim().endsWith(')'));
  if (call !== -1) {
    const original = lines[call];
    const buggy = original.replace(/\)$/, '');
    return {
      code: withReplacedLine(lines, call, buggy),
      choices: [buggy.trim(), original.trim(), `${buggy.trim()})`],
      answer: buggy.trim(),
      reason: `a function call is missing its closing parenthesis`,
      original: original.trim(),
    };
  }

  return null;
}

function withReplacedLine(lines: string[], idx: number, replacement: string): string {
  const copy = [...lines];
  copy[idx] = replacement;
  return copy.join('\n');
}

function summarizeCode(block: CodeBlock): { correct: string; distractors: string[] } | null {
  const code = block.code;
  const firstLine = code.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  // --- C# patterns -----------------------------------------------------------
  if (/^using\s+[\w.]+\s*;/.test(firstLine)) {
    return { correct: 'makes a library namespace available so its types can be used', distractors: ['defines a new class', 'prints output to the console', 'creates a variable'] };
  }
  if (/^namespace\s+\w+/.test(firstLine)) {
    const name = firstLine.replace(/^namespace\s+/, '').split(/[\s{;]/)[0];
    return { correct: `declares a namespace called ${name}`, distractors: [`defines a class called ${name}`, `imports a library called ${name}`, `calls a method called ${name}`] };
  }
  if (/Console\.(Write|WriteLine)\s*\(/.test(firstLine)) {
    return { correct: 'prints output to the console', distractors: ['reads input from the user', 'declares a variable', 'defines a class'] };
  }
  if (/^static\s+[\w<>\[\]]+\s+Main\s*\(/.test(firstLine)) {
    return { correct: "defines the program's entry point — where execution begins", distractors: ['defines a reusable library function', 'prints a welcome message', 'declares a namespace'] };
  }
  if (/^(int|double|float|decimal|bool|string|char|long|var|byte)\s+\w+\s*=/.test(firstLine)) {
    return { correct: 'declares a variable and assigns it a value', distractors: ['calls a method', 'imports a namespace', 'compares two values'] };
  }
  if (/^foreach\s*\(/.test(firstLine)) {
    return { correct: 'loops over each element in a collection, running the body once per element', distractors: ['runs exactly once', 'waits for user input', 'declares a class'] };
  }
  // --- generic / Python / JS patterns ---------------------------------------
  if (/^def\s+\w+/.test(firstLine)) {
    const name = firstLine.replace(/^def\s+/, '').split(/[(:]/)[0];
    return {
      correct: `defines a function called ${name}`,
      distractors: [`calls a function called ${name}`, `imports the ${name} module`, `prints the value of ${name}`],
    };
  }
  if (/^class\s+\w+/.test(firstLine)) {
    const name = firstLine.replace(/^class\s+/, '').split(/[(:]/)[0];
    return { correct: `defines a class called ${name}`, distractors: [`instantiates ${name}`, `imports ${name}`, `throws an error`] };
  }
  if (/^import\s/.test(firstLine)) {
    return { correct: 'imports a module so its functions can be used', distractors: ['defines a new function', 'prints output to the terminal', 'creates a file'] };
  }
  if (/^for\s/.test(firstLine)) {
    return { correct: 'loops over a sequence, running the indented body for each item', distractors: ['runs exactly once', 'waits for user input', 'compares two values'] };
  }
  if (/^if\s/.test(firstLine)) {
    return { correct: 'conditionally runs the indented block only when the condition is true', distractors: ['always runs the block', 'loops forever', 'defines a function'] };
  }
  if (/^const\s|^let\s|^var\s/.test(firstLine)) {
    return { correct: 'declares a variable and assigns it a value', distractors: ['calls a function', 'imports a library', 'throws an exception'] };
  }
  if (/^print\(|^console\./.test(firstLine)) {
    return { correct: 'prints output to the console', distractors: ['reads input from the user', 'defines a variable', 'opens a file for writing'] };
  }
  if (/^#include/.test(firstLine)) {
    return { correct: 'includes a library at compile time', distractors: ['runs a shell command', 'defines a macro', 'prints a message'] };
  }
  return null;
}
