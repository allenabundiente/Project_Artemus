import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface CodeBlock {
  code: string;
  context: string;
}

export interface ParsedChapter {
  title: string;
  text: string;
  codeBlocks: CodeBlock[];
}

export interface ParsedBook {
  title: string;
  chapters: ParsedChapter[];
}

interface TextItem {
  str: string;
  fontName?: string;
  transform: number[];
}

const MONOSPACE_RE = /(mono|courier|consolas|menlo|source.?code|code|terminal|hack|fira.?code|jetbrains|droid.?sans.?mono|liberation.?mono|dejavu.?sans.?mono)/i;
const HEADING_RE = /^\s*(chapter|part|section|lesson|module|unit)\s+\d+/i;
const NUMBERED_HEADING_RE = /^\s*\d+(\.\d+)*\s+[A-Z][A-Za-z0-9 ,&'\-:]{3,70}$/;
const ALL_CAPS_RE = /^[A-Z][A-Z0-9 &'\-:]{4,50}$/;
const CODE_MARKER_RE = /^\s*(def |class |function|const |let |var |import |from |#include|int |float |char |void |public |private |protected |if |else|elif |for |while |return |print\(|console\.|fn |let |pub |use |package |require\(|using |namespace |# |\/\/ |<!--|<\?|<[a-z][^>]*>|SELECT |INSERT |UPDATE |DELETE )/;

function isMonospace(fontName: string | undefined): boolean {
  return !!fontName && MONOSPACE_RE.test(fontName);
}

function looksLikeCode(line: string, isMono: boolean): boolean {
  if (isMono) return true;
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) return true;
  if (/^\s{2,}/.test(line) && /[=;{}()]/.test(line)) return true;
  if (CODE_MARKER_RE.test(line)) return true;
  if (/^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed)) return true;
  return false;
}

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (HEADING_RE.test(t)) return true;
  if (NUMBERED_HEADING_RE.test(t)) return true;
  // Short all-caps line on its own (common for book section titles)
  if (ALL_CAPS_RE.test(t) && t.split(' ').length <= 8) return true;
  return false;
}

/**
 * Extract text from a PDF buffer, page by page, tracking whether each line
 * was rendered in a monospace font (a strong signal for code blocks).
 */
export async function parsePdf(buffer: Buffer, fallbackTitle: string): Promise<ParsedBook> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  let totalChars = 0;
  const pages: { lines: { text: string; mono: boolean }[]; pageNum: number }[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = (textContent?.items ?? []) as TextItem[];

      // Group items into lines by their vertical position (transform[5] is y).
      const byY: { y: number; parts: { str: string; mono: boolean }[] }[] = [];
      for (const item of items) {
        const str = (item.str || '').replace(/\u00a0/g, ' ');
        if (!str.trim()) continue;
        const y = Math.round(item.transform[5]);
        let line = byY.find((l) => Math.abs(l.y - y) <= 2);
        if (!line) {
          line = { y, parts: [] };
          byY.push(line);
        }
        line.parts.push({ str, mono: isMonospace(item.fontName) });
      }

      byY.sort((a, b) => b.y - a.y); // PDF y grows upward; top of page first
      const lines = byY.map((l) => {
        const text = l.parts.map((p) => p.str).join('');
        const mono = l.parts.length > 0 && l.parts.every((p) => p.mono);
        return { text, mono };
      });

      const pageChars = lines.reduce((n, l) => n + l.text.length, 0);
      totalChars += pageChars;
      pages.push({ lines, pageNum: i });
    }
  } finally {
    await pdf.cleanup();
  }

  if (totalChars < 200) {
    throw new Error(
      'This PDF appears to be scanned or image-based — almost no extractable text was found. ' +
      'CodeBook Arcade needs a text-based PDF (one where you can select/copy text).'
    );
  }

  // Flatten into a single stream of lines with page boundaries preserved.
  const stream: { text: string; mono: boolean; page: number }[] = [];
  for (const p of pages) {
    for (const l of p.lines) stream.push({ ...l, page: p.pageNum });
  }

  return structureBook(stream, fallbackTitle);
}

function structureBook(stream: { text: string; mono: boolean; page: number }[], fallbackTitle: string): ParsedBook {
  // 1) Detect chapter headings.
  const chapterStarts: number[] = [];
  let firstHeading = '';
  for (let i = 0; i < stream.length; i++) {
    const line = stream[i].text;
    if (looksLikeHeading(line) && !stream[i].mono) {
      if (firstHeading === '') firstHeading = line.trim();
      chapterStarts.push(i);
    }
  }

  // If no headings found, fall back to page-based chunks.
  const splits: number[] = chapterStarts.length >= 2 ? chapterStarts : [];
  if (splits.length === 0) {
    const pages = [...new Set(stream.map((l) => l.page))];
    // Group every ~8 pages into a "chapter"
    const per = Math.max(1, Math.ceil(pages.length / 8));
    for (let i = 1; i < pages.length; i++) {
      if (i % per === 0) {
        const idx = stream.findIndex((l) => l.page === pages[i]);
        if (idx > 0) splits.push(idx);
      }
    }
  }

  // 2) Slice into chapters, detect code blocks within each.
  const chapters: ParsedChapter[] = [];
  for (let s = 0; s < splits.length + 1; s++) {
    const start = s === 0 ? 0 : splits[s - 1];
    const end = s === splits.length ? stream.length : splits[s];
    const slice = stream.slice(start, end);
    if (slice.length === 0) continue;

    const title = slice[0].text.trim() || `Chapter ${s + 1}`;
    const bodyLines: string[] = [];
    const codeBlocks: CodeBlock[] = [];
    let currentCode: string[] = [];
    let currentContext: string[] = [];
    let inCode = false;

    const flushCode = () => {
      if (currentCode.length > 0) {
        const code = currentCode.join('\n').trim();
        if (code.length >= 4) {
          codeBlocks.push({
            code,
            context: currentContext.filter((c) => c.trim().length > 0).slice(-2).join(' ').trim(),
          });
        }
        currentCode = [];
      }
    };

    for (const line of slice) {
      const isCode = looksLikeCode(line.text, line.mono);
      if (isCode) {
        if (!inCode) {
          flushCode();
          inCode = true;
          currentContext = [];
        }
        currentCode.push(line.text.replace(/\s+$/, ''));
      } else {
        if (inCode) flushCode();
        inCode = false;
        bodyLines.push(line.text);
        currentContext.push(line.text);
        if (currentContext.length > 4) currentContext.shift();
      }
    }
    flushCode();

    const text = bodyLines.join('\n').trim();
    if (text.length >= 40 || codeBlocks.length > 0) {
      chapters.push({ title, text, codeBlocks });
    }
  }

  if (chapters.length === 0) {
    throw new Error('Could not find any readable chapters in this PDF.');
  }

  const title = cleanTitle(firstHeading || fallbackTitle);
  return { title, chapters };
}

function cleanTitle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length > 80) return t.slice(0, 77) + '...';
  return t;
}