// Wardrobe verification: free defaults per slot, 4-slot equip + persist,
// paid-set enforcement, and avatars flowing to /me, leaderboard, and roster.
// Usage: node scripts/verify-wardrobe.mjs [baseUrl]
const B = process.argv[2] || 'http://localhost:4010/api';
const ts = Date.now();
let pass = 0, fail = 0;

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(B + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const rT = await api('POST', '/auth/signup', { body: { name: 'Wardrobe Master', email: `ward.t.${ts}@t.test`, password: 'cloak1234', role: 'teacher' } });
const rS = await api('POST', '/auth/signup', { body: { name: 'Wardrobe Hero', email: `ward.s.${ts}@t.test`, password: 'cloak1234', role: 'student' } });
const T = rT.data.token, S = rS.data.token;
const rG = await api('POST', '/guilds', { token: T, body: { name: `Cloth Guild ${ts}` } });
await api('POST', '/guilds/join', { token: S, body: { passcode: rG.data.guild.passcode } });

// --- 1. catalog shape: all four slots, multiple free defaults ----------------
const w = await api('GET', '/wardrobe', { token: S });
ok('GET /wardrobe → 200', w.status === 200);
for (const part of ['hair', 'armor', 'helmet', 'cape']) {
  const free = (w.data.sets[part] ?? []).filter((s) => s.price === 0);
  ok(`slot "${part}" has sets`, (w.data.sets[part] ?? []).length > 0, `${w.data.sets[part]?.length} sets, ${free.length} free`);
  ok(`slot "${part}" has ≥2 free defaults`, free.length >= 2, free.map((s) => s.id).join(', '));
  ok(`slot "${part}" free defaults are unlocked`, free.every((s) => w.data.unlocked[part].includes(s.id)));
}
ok('paid set is locked initially', !w.data.unlocked.armor.includes('plate'), `unlocked armor: ${w.data.unlocked.armor.join(', ')}`);

// --- 2. equip a full free look and persist -----------------------------------
const look = { sex: 'female', hair: 'topknot', armor: 'leather', helmet: 'kettle', cape: 'cloth', color: '#7fb3cb' };
const put = await api('PUT', '/wardrobe', { token: S, body: { avatar: look } });
ok('PUT /wardrobe saves the look', put.status === 200 && put.data.avatar.cape === 'cloth' && put.data.avatar.helmet === 'kettle', JSON.stringify(put.data.avatar));

const me = await api('GET', '/me', { token: S });
ok('/me reflects the equipped look', me.data.user?.avatar?.cape === 'cloth' && me.data.user?.avatar?.sex === 'female', JSON.stringify(me.data.user?.avatar));

// --- 3. paid enforcement: plate armor must be rejected -----------------------
const paid = await api('PUT', '/wardrobe', { token: S, body: { avatar: { ...look, armor: 'plate' } } });
ok('paid set rejected without ownership (403)', paid.status === 403, JSON.stringify(paid.data).slice(0, 80));

// --- 4. teacher (non-student) has the same wardrobe --------------------------
const wt = await api('GET', '/wardrobe', { token: T });
ok('teacher has a wardrobe too', wt.status === 200 && wt.data.unlocked.cape.includes('cloth'));
const putT = await api('PUT', '/wardrobe', { token: T, body: { avatar: { sex: 'male', hair: 'long', armor: 'tunic', helmet: 'great', cape: 'silk', color: '#a82a2a' } } });
ok('teacher paid sets rejected too', putT.status === 403, JSON.stringify(putT.data).slice(0, 60));

// --- 5. avatars ride on leaderboard + roster ---------------------------------
const bd = await api('GET', '/books', { token: T });
// Upload a tiny book via the sample PDF helper so the student can complete a quest.
const { mkSamplePdf } = await import('./make-e2e-pdf.mjs');
const form = new FormData();
form.append('pdf', new Blob([mkSamplePdf()], { type: 'application/pdf' }), 'wardrobe-book.pdf');
const up = await api('POST', '/upload', { token: T, form });
ok('book uploaded', up.status === 200 && !!up.data.bookId, JSON.stringify(up.data).slice(0, 80));
const gen = await api('POST', `/books/${up.data.bookId}/generate`, { token: T, body: { term: 'prelims' } });
ok('challenges generated', gen.status === 200 && gen.data.challengeCount > 0, JSON.stringify(gen.data).slice(0, 80));
const book = await api('GET', `/books/${up.data.bookId}`, { token: S });
ok('student sees the book', book.status === 200 && (book.data.chapters?.length ?? 0) > 0, JSON.stringify(book.data).slice(0, 80));
await api('POST', `/quests/${book.data.chapters[0].id}/complete`, {
  token: S,
  body: { mistakes: 0, timeSeconds: 100, finished: true, livesRemaining: 3, outOfLife: false, bestStreak: 3, term: 'prelims', coinsGathered: 5 },
});

const lb = await api('GET', '/leaderboard?scope=guild', { token: S });
const entry = lb.data.entries?.find((e) => e.name === 'Wardrobe Hero');
ok('leaderboard entry carries a sanitized avatar', !!entry?.avatar && entry.avatar.cape === 'cloth' && entry.avatar.armor === 'leather', JSON.stringify(entry?.avatar));

const ro = await api('GET', '/guilds/mine/roster', { token: T });
const member = ro.data.roster?.find((m) => m.name === 'Wardrobe Hero');
ok('roster entry carries the avatar', !!member?.avatar && member.avatar.helmet === 'kettle', JSON.stringify(member?.avatar));

// in-level sprite is a frontend concern; the API contract is the avatar on /me.
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
