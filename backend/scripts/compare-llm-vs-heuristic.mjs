// Side-by-side quality comparison: what the heuristic generator would produce
// for each chapter (computed in memory, no DB writes) vs what is actually
// stored (LLM output when an LLM is configured).
//
//   node --import tsx scripts/compare-llm-vs-heuristic.mjs "C#"
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || 'C#';

const db = await import(pathToFileURL(path.join(here, '../src/db/db.ts')));
const gen = await import(pathToFileURL(path.join(here, '../src/services/contentGenerator.ts')));

const books = await db.query('SELECT id, title FROM books ORDER BY created_at');
const book = books.find((b) => b.title.toLowerCase().includes(filter.toLowerCase()));
if (!book) { console.error(`no book matching "${filter}"`); process.exit(1); }

const chapters = await db.getChapters(book.id);
for (const ch of chapters) {
  const stored = await db.getChallengesForChapter(ch.id);
  const heuristic = gen.generateHeuristically(ch).challenges;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${ch.title}`);
  console.log(`${'='.repeat(72)}`);

  const show = (label, list) => {
    console.log(`\n  --- ${label} (${list.length} challenges) ---`);
    for (const c of list.slice(0, 4)) {
      console.log(`  [${c.type}/${c.difficulty}] ${c.prompt.slice(0, 110)}`);
      if (c.code) console.log(`      code: ${c.code.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    if (list.length > 4) console.log(`  … +${list.length - 4} more`);
  };
  show('HEURISTIC (before)', heuristic);
  show('STORED (LLM where available)', stored);
}
process.exit(0);
