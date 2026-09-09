// CLI wrapper around the production generation pipeline.
// Deletes a book's challenges, then regenerates via the LLM (with per-chapter
// heuristic fallback) — the exact code path POST /llm/regenerate-all uses.
//
//   node --import tsx scripts/regenerate-book.mjs "C#"              # whole book
//   node --import tsx scripts/regenerate-book.mjs "C#" --keep       # fill gaps only
//   node --import tsx scripts/regenerate-book.mjs "C#" --only 0,1   # 0-based chapter idxs
//   node --import tsx scripts/regenerate-book.mjs "C#" --only "Pulling Strings" # by title
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || 'C#';
const keep = process.argv.includes('--keep');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — is backend/.env set up?');
  process.exit(1);
}

const db = await import(pathToFileURL(path.join(here, '../src/db/db.ts')));
const api = await import(pathToFileURL(path.join(here, '../src/routes/api.ts')));
const { resolveTermSettings } = await import(pathToFileURL(path.join(here, '../src/services/termSettings.ts')));
const gen = await import(pathToFileURL(path.join(here, '../src/services/contentGenerator.ts')));

const books = await db.query('SELECT id, title, guild_id FROM books ORDER BY created_at');
const book = books.find((b) => b.title.toLowerCase().includes(filter.toLowerCase()));
if (!book) {
  console.error(`no book matching "${filter}" — have: ${books.map((b) => b.title).join(' | ')}`);
  process.exit(1);
}
console.log(`book: ${book.title} (${book.id})`);

if (!keep && !only) {
  await db.deleteChallengesForBook(book.id);
  const guild = book.guild_id ? await db.getGuild(book.guild_id) : null;
  const result = await api.generateChallengesForBook(book.id, 'prelims', guild?.termSettings ?? null);
  console.log(`done: ${JSON.stringify(result)}`);
  process.exit(0);
}

// --- Surgical mode: fill gaps and/or regenerate specific chapters -------------
const guild = book.guild_id ? await db.getGuild(book.guild_id) : null;
const settings = guild?.termSettings ?? null;

// Resolve the --only selector against the book's chapters.
let targets = null;
if (only) {
  const chapters = await db.getChapters(book.id);
  if (/^\d+(,\d+)*$/.test(only)) {
    const wanted = new Set(only.split(',').map((s) => parseInt(s, 10)));
    targets = chapters.filter((c) => wanted.has(c.idx));
  } else {
    const needle = only.toLowerCase();
    targets = chapters.filter((c) => c.title.toLowerCase().includes(needle));
  }
  if (!targets || targets.length === 0) {
    console.error(`--only "${only}" matched no chapters`);
    process.exit(1);
  }
  console.log(`targets: ${targets.map((t) => t.title).join(' | ')}`);
}

const allChapters = targets ?? (await db.getChapters(book.id));
for (const chapter of allChapters) {
  if (keep && (await db.getChallengesForChapter(chapter.id)).length > 0) {
    console.log(`skip (has challenges): ${chapter.title}`);
    continue;
  }
  await db.query('DELETE FROM challenges WHERE chapter_id = $1', [chapter.id]);
  let content;
  try {
    const ts = resolveTermSettings('prelims', settings);
    content = await gen.generateWithLlm(chapter, {
      term: 'prelims',
      monsterDifficulty: ts.monsterDifficulty,
      difficultyMix: ts.difficultyMix,
    });
    console.log(`llm ok: ${chapter.title} (${content.challenges.length} challenges)`);
  } catch (e) {
    console.error(`llm failed for "${chapter.title}": ${(e).message} — using heuristics`);
    content = gen.generateHeuristically(chapter);
  }
  for (let i = 0; i < content.challenges.length; i++) {
    await db.insertChallenge({ bookId: book.id, chapterId: chapter.id, ...content.challenges[i], ord: i });
  }
}
console.log('done');
process.exit(0);
