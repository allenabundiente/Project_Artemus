// Seeds Book I ("Basics of C# Programming") as a clean 5-chapter book.
// The generic PDF parser splits on every "Chapter N" occurrence in the
// For Dummies running page headers, producing 40 fragments; this script
// detects REAL chapter starts (followed by "In This Chapter"), merges the
// fragments, strips headers/page numbers, and inserts the book directly.
//
// Usage: node scripts/seed-book1.mjs <pdf-path>
// Requires the API on http://localhost:${API_PORT || 4010} and DATABASE_URL
// in backend/.env (reads it via dotenv).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = `http://localhost:${process.env.API_PORT || 4010}/api`;
const PDF = process.argv[2];
const EMAIL = process.argv[3] || 'teacher.csharp@questbook.local';
const PASSWORD = process.env.SEED_PASSWORD || 'Guildmaster-2026!';
const FILENAME = path.basename(PDF || '');
const BOOK_TITLE = 'C# Book I: Basics of C# Programming';

const CHAPTER_TITLES = {
  1: 'Creating Your First C# Console Application',
  2: 'Living with Variability — Declaring Value-Type Variables',
  3: 'Pulling Strings',
  4: 'Smooth Operators',
  5: 'Getting Into the Program Flow',
};

const MONO_RE = /(mono|courier|consolas|menlo|source.?code|code|terminal|hack|fira|jetbrains|droid.?sans.?mono|liberation.?mono|dejavu.?sans.?mono)/i;
const CODE_MARKER_RE = /^\s*(def |class |function|const |let |var |import |from |#include|int |float |char |void |public |private |protected |if |else|elif |for |while |return |Console\.|using |namespace |static |\/\/ )/;
const PAGE_NUM_RE = /^\s*\d{1,3}\s*$/;
const CHAPTER_LINE_RE = /^\s*(?:Book\s+I\b[.:—-]*)?\s*Chapter\s+(\d+)\s*[:.]\s*(.*?)\s*$/i;

async function extractLines() {
  const data = new Uint8Array(fs.readFileSync(PDF));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const byY = [];
    for (const item of tc.items) {
      const str = (item.str || '').replace(/\u00a0/g, ' ');
      if (!str.trim()) continue;
      const y = Math.round(item.transform[5]);
      let line = byY.find((l) => Math.abs(l.y - y) <= 2);
      if (!line) { line = { y, parts: [] }; byY.push(line); }
      line.parts.push({ str, mono: MONO_RE.test(item.fontName || '') });
    }
    byY.sort((a, b) => b.y - a.y);
    for (const l of byY) {
      // pdf.js splits words into separate items; joining with '' concatenates
      // them ("PressEntertoterminate"). Re-insert single spaces between items
      // unless one side already has whitespace or the next starts punctuation.
      let text = '';
      for (const pp of l.parts) {
        const s = pp.str;
        if (text && !/\s$/.test(text) && !/^\s/.test(s) && !/^[,.;:!?)%\]]/.test(s) && !/[([{&]$/.test(text)) {
          text += ' ';
        }
        text += s;
      }
      lines.push({
        text,
        mono: l.parts.length > 0 && l.parts.every((pp) => pp.mono),
        page: p,
      });
    }
  }
  await pdf.cleanup();
  return lines;
}

function isHardNoise(text) {
  const t = text.trim();
  if (!t) return true;
  if (PAGE_NUM_RE.test(t)) return true;                       // bare page numbers
  if (/\.{4,}\s*\d+\s*$/.test(t)) return true;                // TOC dotted leaders
  if (/C#\s*2010 All-in-One For Dummies/.test(t)) return true; // running footer
  if (/^Part\s+I\b/.test(t) && t.length < 60) return true;     // "Part I: ..." headers
  return false;
}

function looksLikeCode(line) {
  if (line.mono) return true;
  const t = line.text.trim();
  if (!t) return false;
  if (/^\s{2,}/.test(line.text) && /[=;{}()]/.test(line.text)) return true;
  return CODE_MARKER_RE.test(t);
}

/** Find the 5 real chapter starts: a "Chapter N:" line with "In This Chapter"
 *  within the next few lines (running headers never have that). */
function findChapterStarts(lines) {
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(CHAPTER_LINE_RE);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!CHAPTER_TITLES[n]) continue;
    let verified = false;
    for (let j = i + 1; j <= i + 8 && j < lines.length; j++) {
      if (/^In This Chapter/i.test(lines[j].text.trim())) { verified = true; break; }
      if (CHAPTER_LINE_RE.test(lines[j].text)) break;
    }
    if (verified) starts.push({ idx: i, n });
  }
  return starts;
}

function buildChapters(lines, starts) {
  const chapters = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s].idx + 1; // skip the "Chapter N: Title" line itself
    const to = s + 1 < starts.length ? starts[s + 1].idx : lines.length;
    const slice = lines.slice(from, to).filter((l) => !isHardNoise(l.text));

    const bodyLines = [];
    const codeBlocks = [];
    let code = [];
    let context = [];
    let inCode = false;
    const flush = () => {
      if (code.length) {
        const joined = code.join('\n').trim();
        if (joined.length >= 4) codeBlocks.push({ code: joined, context: context.filter((c) => c.trim()).slice(-2).join(' ').trim() });
        code = [];
      }
    };
    for (const line of slice) {
      if (looksLikeCode(line)) {
        if (!inCode) { flush(); inCode = true; context = []; }
        code.push(line.text.replace(/\s+$/, ''));
      } else {
        if (inCode) flush();
        inCode = false;
        bodyLines.push(line.text);
        context.push(line.text);
        if (context.length > 4) context.shift();
      }
    }
    flush();

    chapters.push({
      title: `Chapter ${starts[s].n}: ${CHAPTER_TITLES[starts[s].n]}`,
      text: bodyLines.join('\n').trim(),
      codeBlocks,
    });
  }
  return chapters;
}

async function api(method, pathname, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${json.error || res.statusText}`);
  return json;
}

async function main() {
  if (!PDF || !fs.existsSync(PDF)) { console.error(`PDF not found: ${PDF}`); process.exit(1); }

  // 1) Teacher account via API (signup or login).
  let token;
  try {
    token = (await api('POST', '/auth/signup', { body: { name: 'Guildmaster Csharp', email: EMAIL, password: PASSWORD, role: 'teacher' } })).token;
    console.log(`✓ teacher signed up (${EMAIL})`);
  } catch {
    token = (await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } })).token;
    console.log(`✓ teacher logged in (${EMAIL})`);
  }

  // 2) Guild via API.
  let guild;
  try {
    const mine = await api('GET', '/guilds/mine', { token });
    if (!mine.guild) throw new Error('teacher has no guild but /guilds/mine returned none');
    guild = mine.guild;
    console.log(`✓ guild "${guild.name}" (passcode ${guild.passcode})`);
  } catch {
    guild = (await api('POST', '/guilds', { token, body: { name: 'Guild of the Sharp Sign' } })).guild;
    console.log(`✓ guild created "${guild.name}" (passcode ${guild.passcode})`);
  }

  // 3) Parse the PDF into the 5 real chapters.
  const lines = await extractLines();
  const starts = findChapterStarts(lines);
  if (starts.length !== 5) throw new Error(`Expected 5 chapter starts, found ${starts.length}: ${starts.map((s) => s.n).join(', ')}`);
  const chapters = buildChapters(lines, starts);
  for (const c of chapters) {
    console.log(`  · ${c.title} — ${c.text.length} chars, ${c.codeBlocks.length} code blocks`);
  }

  // 4) Insert book + chapters directly (bypassing /upload's generic splitter).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let bookId;
  try {
    const teacher = (await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [EMAIL])).rows[0];
    if (!teacher) throw new Error('teacher row missing after auth');

    // Remove previous uploads of this book (incl. the fragmented attempt).
    const del = await client.query(
      `DELETE FROM books WHERE owner_id = $1 AND (filename = $2 OR title = $3) RETURNING id`,
      [teacher.id, FILENAME, BOOK_TITLE]
    );
    if (del.rows.length) console.log(`✓ removed ${del.rows.length} previous upload(s) of this book`);

    const bookIdLocal = (await client.query(
      `INSERT INTO books (title, filename, owner_id, guild_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [BOOK_TITLE, FILENAME, teacher.id, guild.id]
    )).rows[0].id;
    bookId = bookIdLocal;

    for (let i = 0; i < chapters.length; i++) {
      await client.query(
        `INSERT INTO chapters (book_id, idx, title, text, code_blocks) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [bookIdLocal, i, chapters[i].title, chapters[i].text, JSON.stringify(chapters[i].codeBlocks)]
      );
    }
    console.log(`✓ book inserted (${bookId}) with ${chapters.length} chapters`);
    client.release();
    await pool.end();
  } catch (e) {
    client.release();
    await pool.end();
    throw e;
  }
  // 5) Generate challenges through the API (honors guild term settings).
  const gen = await api('POST', `/books/${bookId}/generate`, { token, body: { term: 'prelims' } });
  console.log(`✓ challenges generated: ${gen.challengeCount}${gen.cached ? ' (cached)' : ''}`);
  console.log(`\nDone. Book id: ${bookId}`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
