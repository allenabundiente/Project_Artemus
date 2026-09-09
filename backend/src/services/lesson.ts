// Builds a structured lesson overview from a chapter's raw text — shown to
// students BEFORE they play the quest, so the arcade reinforces a lesson
// rather than replacing it.
//
// Extraction is deterministic (no LLM call — the overview must load instantly)
// and tuned for real textbook prose: "In This Chapter" checklists, section
// headings, "Term is/are/refers to…" definitions, and code blocks.
// `source: 'heuristic'` marks provenance so an LLM-polished variant can slot
// in later without changing the consumer.

import type { ChapterRow } from '../db/types.js';

export interface LessonSection {
  heading: string;
  /** 1–3 sentence plain-language summary distilled from the section. */
  summary: string;
  /** A real code snippet from the section, if one exists. */
  code?: string;
}

export interface LessonOverview {
  title: string;
  /** Chapter objectives — from the book's own "In This Chapter" list. */
  objectives: string[];
  /** One-paragraph plain-language intro to the chapter. */
  intro: string;
  sections: LessonSection[];
  /** Key terms with their book-grounded definitions. */
  keyTerms: { term: string; definition: string }[];
  /** One real, short code example from the chapter. */
  example?: { language: string; code: string; caption: string };
  /** A tip line drawn from the chapter's own guidance. */
  tip?: string;
  source: 'heuristic' | 'llm';
}

const STOP = new Set(['this', 'that', 'these', 'those', 'there', 'here', 'it', 'they', 'we', 'you', 'i', 'he', 'she']);

/** Words that mark a clause-initial fragment rather than a definable term. */
const SUBJ_STOP = new Set([
  'if', 'when', 'while', 'just', 'as', 'because', 'although', 'since', 'whether',
  'both', 'each', 'some', 'certain', 'other', 'another', 'such', 'most', 'many',
  'few', 'all', 'no', 'not', 'only', 'even', 'still', 'then', 'thus', 'hence',
]);

function cleanLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isHeading(rawLine: string): boolean {
  // Strip leading page numbers that print layouts glue onto headings.
  const line = rawLine.replace(/^\d+\s+/, '');
  if (line !== rawLine) return isHeading(line); // re-check the stripped line
  if (line.length < 4 || line.length > 70) return false;
  if (/[.,;:]$/.test(line)) return false; // sentences / wrapped fragments
  if (/^\d+$/.test(line)) return false; // page numbers
  if (/^[✓✦•]/.test(line)) return false; // bullet markers
  if (/^(but|so|then|and|oh|however|unfortunately|that's|it's|there|here)\b/i.test(line)) return false;
  // Title-case density: real headings capitalize most words; wrapped body
  // lines capitalize only their first word.
  const words = line.split(/\s+/).filter(Boolean);
  const minor = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'on', 'to', 'in', 'for', 'with', 'is', 'are']);
  const contentWords = words.filter((w) => !minor.has(w.toLowerCase().replace(/[^a-z]/g, '')));
  const caps = contentWords.filter((w) => /^[A-Z0-9#]/.test(w)).length;
  return contentWords.length > 0 && caps / contentWords.length >= 0.6;
}

/**
 * "In This Chapter" checklist: the CONSECUTIVE run of ✓ lines near the top —
 * later ✓-lists elsewhere in the chapter describe language features, not
 * objectives, so we stop at the first non-✓ line once the list has started.
 */
function extractObjectives(text: string): string[] {
  const lines = text.split('\n').map(cleanLine);
  const items: string[] = [];
  let inList = false;
  for (const line of lines) {
    const isItem = /^[✓✦•]\s*/.test(line) && line.length > 8 && line.length < 120;
    if (isItem) {
      inList = true;
      items.push(line.replace(/^[✓✦•]\s*/, ''));
      if (items.length >= 5) break;
    } else if (inList) {
      break; // first non-item after the list ends it
    }
  }
  return items;
}

/**
 * "Term is/are …" definitions. Sentence-bounded, capitalized subject,
 * at least 5 words of predicate — tuned to skip headings and fragments.
 */
function extractKeyTerms(text: string, max = 6): { term: string; definition: string }[] {
  const sentences = text
    .replace(/[✓✦•]/g, ' ') // strip bullet markers that leak into sentences
    .replace(/(\w)-\n(\w)/g, '$1$2') // de-hyphenate print line breaks
    .split(/(?<=[.!?])\s+(?=[A-Z])/);
  const out: { term: string; definition: string }[] = [];
  const seen = new Set<string>();
  for (const raw of sentences) {
    const s = cleanLine(raw);
    const m = s.match(/^([A-Z][A-Za-z0-9 .#/'-]{1,40}?)\s+(is|are)\s+(.{25,240})/);
    if (!m) continue;
    const term = cleanLine(m[1]);
    const words = term.split(' ');
    if (words.length > 4 || STOP.has(words[0]?.toLowerCase())) continue;
    if (SUBJ_STOP.has(words[0]?.toLowerCase())) continue;
    if (/(here|there|that|this)$/i.test(term)) continue; // clause fragments
    // Skip headings / TOC-ish lines: not all-caps.
    if (term === term.toUpperCase() && term.length > 6) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    out.push({ term, definition: s.slice(0, 240) });
    seen.add(key);
    if (out.length >= max) break;
  }
  return out;
}

/** Condense a section body into 1–2 plain sentences. */
function summarize(body: string): string {
  const sentences = body
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[✓✦•]/g, '. ') // bullet markers become sentence boundaries
    .replace(/\b(Book\s+[IVX]+|Chapter\s+\d+)\b/g, ' ') // running page headers
    .split(/(?<=[.!?])\s+(?=[A-Z"])/)
    .map(cleanLine)
    .filter((s) => s.length > 40 && /^[A-Z"]/.test(s)); // skip lowercase fragments
  if (sentences.length === 0) {
    // Page-break continuations start mid-sentence; skip to the first capital
    // that begins after a sentence end so the summary reads as prose.
    const cleaned = cleanLine(body);
    const m = cleaned.match(/[.!?]\s+[A-Z"]/);
    return m ? cleaned.slice(cleaned.indexOf(m[0]) + m[0].length - 1).slice(0, 200) : cleaned.slice(0, 200);
  }
  // Prefer the first substantive sentence, then one more if space allows.
  return sentences.slice(0, 2).join(' ').slice(0, 320);
}

/** Split the chapter into heading + body sections. */
function extractSections(text: string): { heading: string; body: string }[] {
  const lines = text.split('\n');
  const sections: { heading: string; body: string }[] = [];
  let heading = 'Overview';
  let body: string[] = [];
  for (const line of lines) {
    const l = cleanLine(line);
    if (!l) continue;
    // Print-layout noise: bullet lists (✓/✦/•) and the checklist caption
    // are list items, not prose — they'd poison summaries and intros.
    if (/^[✓✦•]/.test(l)) continue;
    if (/^In This Chapter$/i.test(l)) continue;
    if (isHeading(l) && body.length > 0) {
      const h = l.replace(/^\d+\s+/, ''); // "12 Getting a Handle…" → "Getting a Handle…"
      if (sections.length === 0 || sections[sections.length - 1].heading !== h) {
        sections.push({ heading: h, body: body.join(' ') });
      }
      heading = h;
      body = [];
    } else {
      body.push(l);
    }
  }
  if (body.length > 0) sections.push({ heading, body: body.join(' ') });
  // Keep only meaty sections; drop page-number dust and one-liners.
  return sections.filter((s) => s.body.length > 120).slice(0, 8);
}

/** Pick a real multi-line code example with a plausible caption. */
function pickExample(chapter: ChapterRow): LessonOverview['example'] {
  const blocks = (chapter.codeBlocks ?? []) as { code: string; context?: string }[];
  const usable = blocks.filter((x) => x.code && x.code.includes('\n') && x.code.length >= 60 && x.code.length <= 600);
  // Prefer a block that looks like a real program body (braces for C-family).
  const b = usable.find((x) => x.code.includes('{')) ?? usable[0];
  if (!b) return undefined;
  const firstLine = (b.context || '').split('\n')[0] || '';
  const caption = cleanLine(firstLine).slice(0, 120) || 'From the chapter';
  const language = /\b(using|namespace|Console\.Write)/.test(b.code)
    ? 'csharp'
    : /\b(def |import |print\()/.test(b.code)
      ? 'python'
      : 'code';
  return { language, code: b.code.slice(0, 600), caption };
}

/** A practical tip: a complete advice-flavored sentence from the chapter. */
function extractTip(text: string): string | undefined {
  const sentences = text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .split(/(?<=[.!?])\s+(?=[A-Z"])|\n+/);
  for (const raw of sentences) {
    const s = cleanLine(raw);
    if (s.length < 40 || s.length > 220) continue;
    if (!/\b(make sure|be sure to|always|never|avoid|remember that|it's important|note that)\b/i.test(s)) continue;
    // Must read as a full sentence: starts capital, ends with punctuation.
    if (!/^[A-Z"]/.test(s) || !/[.!?]$/.test(s)) continue;
    return s;
  }
  return undefined;
}

export function buildLessonOverview(chapter: ChapterRow): LessonOverview {
  const text = chapter.text || '';
  const sections = extractSections(text);
  const objectives = extractObjectives(text);

  // Intro: the first substantial section body (the chapter's opening prose).
  // Bullet/checklist lines are already excluded at the section level.
  const firstSubstantive = sections.find((s) => s.body.length > 300) ?? sections[0];
  const intro = firstSubstantive
    ? summarize(firstSubstantive.body) || cleanLine(firstSubstantive.body).slice(0, 240)
    : summarize(text);

  return {
    title: chapter.title,
    objectives,
    // "n this chapter" — the scanner drops the capital I off "In" on page 1.
    intro: intro.replace(/(^|\s)n this chapter/i, '$1In this chapter'),
    // Only show sections with a readable, capital-initial summary — a section
    // made entirely of print debris has no place in a briefing.
    sections: sections
      .filter((s) => s !== firstSubstantive)
      .map((s) => ({ heading: s.heading, summary: summarize(s.body) }))
      .filter((s) => /^[A-Z"]/.test(s.summary))
      .slice(0, 4),
    keyTerms: extractKeyTerms(text),
    example: pickExample(chapter),
    tip: extractTip(text),
    source: 'heuristic',
  };
}
