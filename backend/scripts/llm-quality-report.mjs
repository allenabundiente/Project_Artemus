// Quality report for a book's challenges: per-chapter counts by type + samples.
// Usage: node scripts/llm-quality-report.mjs [bookTitleSubstring] [--json out.json]
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const outPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const filter = (jsonIdx >= 0 ? args.slice(0, jsonIdx) : args).join(' ') || 'C#';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const books = await pool.query(
  `SELECT id, title, guild_id FROM books WHERE title ILIKE '%' || $1 || '%'`,
  [filter],
);
if (books.rowCount === 0) { console.log(`no book matching "${filter}"`); process.exit(1); }
const book = books.rows[0];

const chapters = await pool.query(
  `SELECT id, title FROM chapters WHERE book_id = $1 ORDER BY idx`,
  [book.id],
);

const report = { book: book.title, chapters: [] };
for (const [idx, ch] of chapters.rows.entries()) {
  const res = await pool.query(
    `SELECT type, difficulty, prompt, code FROM challenges
     WHERE chapter_id = $1 ORDER BY ord`,
    [ch.id],
  );
  const byType = {};
  for (const r of res.rows) byType[r.type] = (byType[r.type] || 0) + 1;
  report.chapters.push({
    ord: idx + 1,
    title: ch.title,
    total: res.rowCount,
    byType,
    samples: res.rows.slice(0, 3).map((r) => ({
      type: r.type,
      prompt: r.prompt.slice(0, 140),
      code: r.code ? r.code.slice(0, 90) : null,
    })),
  });
  const entry = report.chapters.at(-1);
  console.log(`\n== Ch ${entry.ord}: ${entry.title} — ${entry.total} challenges (${JSON.stringify(entry.byType)})`);
  for (const s of entry.samples) {
    console.log(`   [${s.type}] ${s.prompt}`);
  }
}
await pool.end();
if (outPath) {
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nsnapshot saved to ${outPath}`);
}
