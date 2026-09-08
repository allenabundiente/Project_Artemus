// End-to-end verification against the live Supabase DB.
// Usage: node scripts/e2e-verify.mjs [baseUrl]
const B = process.argv[2] || 'http://localhost:4011/api';
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
  const res = await fetch(B + path, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

console.log(`Verifying against ${B}\n`);

// --- 1. teacher signup -------------------------------------------------------
const teacherEmail = `prof.${ts}@hogwarts.test`;
const rT = await api('POST', '/auth/signup', { body: { name: 'Prof McGonagall', email: teacherEmail, password: 'gryffindor1', role: 'teacher' } });
ok('teacher signup', rT.status === 201 && !!rT.data.token, rT.status === 201 ? `id ${rT.data.user?.id}` : JSON.stringify(rT.data).slice(0, 120));
const T = rT.data.token;

// --- 2. student signup -------------------------------------------------------
const studentEmail = `harry.${ts}@hogwarts.test`;
const rS = await api('POST', '/auth/signup', { body: { name: 'Harry Potter', email: studentEmail, password: 'quidditch1', role: 'student' } });
ok('student signup', rS.status === 201 && !!rS.data.token, `id ${rS.data.user?.id}`);
const S = rS.data.token;

// --- 3. teacher creates guild --------------------------------------------------
const rG = await api('POST', '/guilds', { token: T, body: { name: `House of Lions ${ts}` } });
const passcode = rG.data.guild?.passcode;
ok('teacher creates guild', rG.status === 201 && /^[A-Z2-9]{6}$/.test(passcode ?? ''), `passcode ${passcode}`);

// --- 4. student joins via passcode ----------------------------------------------
const rJ = await api('POST', '/guilds/join', { token: S, body: { passcode } });
ok('student joins guild', rJ.status === 200 && rJ.data.guild?.name?.includes('House of Lions'), rJ.data.guild?.name ?? JSON.stringify(rJ.data).slice(0, 120));

// --- 5. teacher uploads a book (assigns to guild) ---------------------------------
const { mkSamplePdf } = await import('./make-e2e-pdf.mjs');
const form = new FormData();
form.append('pdf', new Blob([mkSamplePdf()], { type: 'application/pdf' }), 'learning-python-basics.pdf');
const up = await api('POST', '/upload', { token: T, form });
ok('teacher uploads PDF', up.status === 200 && !!up.data.bookId, `${up.data.chapters?.length ?? 0} chapters`);
const bookId = up.data.bookId;

// guild student should see it
const bk = await api('GET', '/books', { token: S });
ok('guild student sees assigned book', bk.status === 200 && bk.data.some((b) => b.id === bookId));

// student upload should be rejected while in a guild
const form2 = new FormData();
form2.append('pdf', new Blob([mkSamplePdf()], { type: 'application/pdf' }), 'nope.pdf');
const upS = await api('POST', '/upload', { token: S, form: form2 });
ok('guild student upload rejected', upS.status === 403);

// --- 6. generate challenges --------------------------------------------------------
const gen = await api('POST', `/books/${bookId}/generate`, { token: T, body: { term: 'prelims' } });
ok('challenge generation', gen.status === 200 && gen.data.challengeCount > 0, `${gen.data.challengeCount} challenges (${gen.data.mode} mode)`);

// --- 7. fetch chapter + challenges ---------------------------------------------------
const bd = await api('GET', `/books/${bookId}`, { token: S });
const chapter = bd.data.chapters?.[0];
ok('book detail + chapters', bd.status === 200 && !!chapter, chapter?.title ?? '');
const ch = await api('GET', `/books/${bookId}/chapters/${chapter.id}/challenges`, { token: S });
ok('challenges for chapter', ch.status === 200 && ch.data.challenges?.length > 0, `${ch.data.challenges?.length} questions`);

// --- 8. quest completion: score + coins ------------------------------------------------
const qc = await api('POST', `/quests/${chapter.id}/complete`, {
  token: S,
  body: { mistakes: 1, timeSeconds: 240, finished: true, livesRemaining: 2, outOfLife: false, bestStreak: 4, term: 'prelims' },
});
ok('quest complete → score', qc.status === 200 && qc.data.rawScore === 100 - 10 - 0 + 2 * 15, `rawScore ${qc.data.rawScore} (breakdown: ${qc.data.breakdown?.map((b) => `${b.label} ${b.value > 0 ? '+' : ''}${b.value}`).join(', ')})`);
ok('quest complete → coins', qc.status === 200 && qc.data.coinsAwarded === 10 && qc.data.coins === 10, `balance ${qc.data.coins}`);

// --- 9. second student + leaderboard -----------------------------------------------------
const student2Email = `ron.${ts}@hogwarts.test`;
const rS2 = await api('POST', '/auth/signup', { body: { name: 'Ron Weasley', email: student2Email, password: 'scabbers12', role: 'student' } });
const S2 = rS2.data.token;
await api('POST', '/guilds/join', { token: S2, body: { passcode } });
await api('POST', `/quests/${chapter.id}/complete`, {
  token: S2,
  body: { mistakes: 0, timeSeconds: 120, finished: true, livesRemaining: 3, outOfLife: false, bestStreak: 5, term: 'prelims' },
});

const lb = await api('GET', '/leaderboard?scope=guild&term=prelims', { token: T });
const harry = lb.data.entries?.find((e) => e.name === 'Harry Potter');
const ron = lb.data.entries?.find((e) => e.name === 'Ron Weasley');
ok('leaderboard (guild, prelims)', lb.status === 200 && lb.data.entries?.length === 2, `entries: ${lb.data.entries?.length}`);
ok('ranking order correct', ron?.termScore > harry?.termScore, `Ron ${ron?.termScore} > Harry ${harry?.termScore}`);
ok('ranks assigned', harry?.rank === 'copper' && ron?.rank === 'copper', `both copper at ${harry?.termScore}/${ron?.termScore} pts`);

// --- 10. teacher roster -----------------------------------------------------------------
const ro = await api('GET', '/guilds/mine/roster', { token: T });
ok('teacher roster', ro.status === 200 && ro.data.roster?.length === 2, `${ro.data.roster?.length} adventurers`);

// --- 11. term settings -------------------------------------------------------------------
const gs = await api('GET', '/guilds/mine/settings', { token: T });
ok('teacher reads term settings', gs.status === 200 && !!gs.data.termSettings?.finals, `finals multiplier ${gs.data.termSettings?.finals?.pointsMultiplier}×`);
const save = await api('PUT', '/guilds/mine/settings', {
  token: T,
  body: { termSettings: { finals: { pointsMultiplier: 2.5, monsterDifficulty: 'hard', difficultyMix: { easy: 15, medium: 45, hard: 40 } } } },
});
ok('teacher saves term settings', save.status === 200 && save.data.termSettings?.finals?.pointsMultiplier === 2.5, `finals now ${save.data.termSettings?.finals?.pointsMultiplier}×, monster ${save.data.termSettings?.finals?.monsterDifficulty}`);
const gsBack = await api('GET', '/guilds/mine/settings', { token: T });
ok('settings persist in Supabase', gsBack.data.termSettings?.finals?.monsterDifficulty === 'hard' && gsBack.data.termSettings?.finals?.scoreWeights?.basePoints === 100, 'override + default merge intact');

// role guard: student cannot read teacher settings
const forbidden = await api('GET', '/guilds/mine/settings', { token: S });
ok('role guard (student blocked)', forbidden.status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
