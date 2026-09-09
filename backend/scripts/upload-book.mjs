// Uploads a sliced PDF as a teacher and generates challenges for it.
// Usage: node scripts/upload-book.mjs <pdf-path> [teacher-email]
// Creates the teacher + guild if they don't exist yet. Requires the API to be
// running on http://localhost:${API_PORT || 4010}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = `http://localhost:${process.env.API_PORT || 4010}/api`;
const PDF = process.argv[2];
const EMAIL = process.argv[3] || 'teacher.csharp@codebook.local';
const PASSWORD = process.env.SEED_PASSWORD || 'Guildmaster-2026!';
const GUILD_NAME = 'Guild of the Sharp Sign';

if (!PDF) {
  console.error('Usage: node scripts/upload-book.mjs <pdf-path> [teacher-email]');
  process.exit(1);
}
if (!fs.existsSync(PDF)) {
  console.error(`PDF not found: ${PDF}`);
  process.exit(1);
}

async function api(method, pathname, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${json.error || res.statusText}`);
  return json;
}

async function main() {
  // 1) Teacher account — sign up, or log in if the email already exists.
  let token;
  const name = 'Guildmaster Csharp';
  try {
    const r = await api('POST', '/auth/signup', { body: { name, email: EMAIL, password: PASSWORD, role: 'teacher' } });
    token = r.token;
    console.log(`✓ teacher signed up (${EMAIL})`);
  } catch {
    const r = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    token = r.token;
    console.log(`✓ teacher logged in (${EMAIL})`);
  }

  // 2) Guild — reuse the teacher's existing one, or found a new guild.
  let guild;
  try {
    guild = await api('GET', '/guilds/mine', { token });
    console.log(`✓ using existing guild "${guild.name}" (passcode ${guild.passcode})`);
  } catch {
    guild = await api('POST', '/guilds', { body: { name: GUILD_NAME } });
    console.log(`✓ guild created "${guild.name}" (passcode ${guild.passcode})`);
  }

  // 3) Upload the PDF.
  const bytes = fs.readFileSync(PDF);
  const form = new FormData();
  form.append('pdf', new Blob([bytes], { type: 'application/pdf' }), path.basename(PDF));
  const book = await api('POST', '/upload', { token, form });
  console.log(`✓ uploaded & parsed "${book.title}" — ${book.chapters.length} chapters (quests):`);
  for (const c of book.chapters) console.log(`    ${c.idx + 1}. ${c.title}`);

  // 4) Generate challenges (uses the guild's current term settings).
  const gen = await api('POST', `/books/${book.bookId}/generate`, { token, body: { term: 'prelims' } });
  console.log(`✓ challenges generated: ${gen.challengeCount}${gen.cached ? ' (cached)' : ''}`);
  console.log(`\nBook id: ${book.bookId}`);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
