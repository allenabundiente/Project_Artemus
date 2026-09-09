// Regression check: coin sync + quest-fail penalty accounting.
//
//  1. Complete quests → the returned balance must equal
//     previousBalance + coinsEarnedThisQuest exactly (the main-hall sync bug).
//  2. Fail a quest → only coins gathered during THAT run are penalized;
//     banked coins are never touched; the balance gains netCoins >= 0.
//
// Usage: node scripts/verify-coin-sync.mjs [baseUrl]   (default :4010)
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

console.log(`Verifying against ${B}\n`);

// Setup: teacher + guild + student + book with challenges
const rT = await api('POST', '/auth/signup', { body: { name: 'Coin Prof', email: `coins.prof.${ts}@t.test`, password: 'treasure1', role: 'teacher' } });
const rS = await api('POST', '/auth/signup', { body: { name: 'Coin Hero', email: `coins.hero.${ts}@t.test`, password: 'treasure1', role: 'student' } });
ok('accounts created', rT.status === 201 && rS.status === 201);
const T = rT.data.token, S = rS.data.token;
let prevBalance = rS.data.user.coins;
ok('student starts at 0 coins', prevBalance === 0, `balance ${prevBalance}`);

const rG = await api('POST', '/guilds', { token: T, body: { name: `Coin Guild ${ts}` } });
ok('guild created', rG.status === 201, JSON.stringify(rG.data).slice(0, 80));
const rJ = await api('POST', '/guilds/join', { token: S, body: { passcode: rG.data.guild?.passcode } });
ok('student joined guild', rJ.status === 200, JSON.stringify(rJ.data).slice(0, 80));

const { mkSamplePdf } = await import('./make-e2e-pdf.mjs');
const form = new FormData();
form.append('pdf', new Blob([mkSamplePdf()], { type: 'application/pdf' }), 'coin-test-book.pdf');
const up = await api('POST', '/upload', { token: T, form });
ok('book uploaded', up.status === 200 && !!up.data.bookId, JSON.stringify(up.data).slice(0, 80));
const gen = await api('POST', `/books/${up.data.bookId}/generate`, { token: T, body: { term: 'prelims' } });
ok('challenges generated', gen.status === 200 && gen.data.challengeCount > 0, JSON.stringify(gen.data).slice(0, 80));
const bd = await api('GET', `/books/${up.data.bookId}`, { token: S });
ok('student sees book', bd.status === 200, JSON.stringify(bd.data).slice(0, 80));
const chapters = bd.data.chapters ?? [];
ok('book ready with chapters', chapters.length >= 3, `${chapters.length} chapters`);

// --- 1. SUCCESS PATH: balance must be previous + earned, exactly -------------
console.log('\n[1] success path — coin sync regression');
let expected = prevBalance;
for (let i = 0; i < 2; i++) {
  const qc = await api('POST', `/quests/${chapters[i].id}/complete`, {
    token: S,
    body: { mistakes: 0, timeSeconds: 120, finished: true, livesRemaining: 3, outOfLife: false, bestStreak: 3, term: 'prelims', coinsGathered: 7 },
  });
  ok(`complete #${i + 1} → 200`, qc.status === 200, JSON.stringify(qc.data).slice(0, 80));
  // flawless + full life: 10 + 5 + 5 = 20 coins
  ok(`complete #${i + 1} awarded 20 coins`, qc.data.coinsAwarded === 20, `awarded ${qc.data.coinsAwarded}`);
  expected += qc.data.coinsAwarded;
  ok(`balance === previous + earned (${expected})`, qc.data.coins === expected, `server says ${qc.data.coins}`);

  const bal = await api('GET', '/coins', { token: S });
  ok(`GET /coins agrees after #${i + 1}`, bal.data.coins === expected, `balance ${bal.data.coins}`);
}

// --- 2. FAIL PATH: penalty draws only from this run's gathered coins ---------
console.log('\n[2] fail path — penalty never touches banked coins');
{
  const balanceBefore = expected;
  const qf = await api('POST', `/quests/${chapters[2].id}/fail`, {
    token: S,
    body: { reason: 'out_of_lives', mistakes: 3, timeSeconds: 200, livesRemaining: 0, bestStreak: 2, term: 'prelims', coinsGathered: 40 },
  });
  ok('fail → 200', qf.status === 200, JSON.stringify(qf.data).slice(0, 100));
  ok('fail reports a penalty', qf.data.coinsPenalty > 0, `penalty ${qf.data.coinsPenalty}`);
  ok('penalty within 5–20% of gathered (≥1)', qf.data.coinsPenalty >= 2 && qf.data.coinsPenalty <= 8, `penalty ${qf.data.coinsPenalty} of 40`);
  ok('net = gathered − penalty', qf.data.coinsAwarded === 40 - qf.data.coinsPenalty, `net ${qf.data.coinsAwarded}`);
  ok('net is non-negative', qf.data.coinsAwarded >= 0);
  expected += qf.data.coinsAwarded; // ONLY the run's net — banked coins untouched
  ok(`balance gained exactly the run's net (${expected})`, qf.data.coins === expected, `server says ${qf.data.coins}`);
  // 100 base − 30 mistakes − 50 unfinished − 30 out-of-life = −10 → clamped to 0
  ok('fail used the scoring formula (clamped at 0)', qf.data.rawScore === 0, `score ${qf.data.rawScore}`);

  const bal = await api('GET', '/coins', { token: S });
  ok('GET /coins agrees after fail', bal.data.coins === expected, `balance ${bal.data.coins} (before fail: ${balanceBefore})`);
}

// --- 3. FAIL with zero gathered: nothing lost, nothing gained ----------------
console.log('\n[3] fail with an empty run');
{
  const balanceBefore = expected;
  const qf = await api('POST', `/quests/${chapters[2].id}/fail`, {
    token: S,
    body: { reason: 'out_of_time', mistakes: 0, timeSeconds: 400, livesRemaining: 1, bestStreak: 0, term: 'prelims', coinsGathered: 0 },
  });
  ok('empty-run fail → 200', qf.status === 200);
  ok('no penalty when nothing was gathered', qf.data.coinsPenalty === 0, `penalty ${qf.data.coinsPenalty}`);
  ok('balance unchanged', qf.data.coins === balanceBefore, `server says ${qf.data.coins}`);
  // 100 base − 20 over-par (400s > 300s) − 50 unfinished + 15 life kept = 45
  ok('out_of_time scores as unfinished + over-par, no out-of-life penalty', qf.data.rawScore === 100 - 20 - 50 + 15, `score ${qf.data.rawScore}`);
}

// --- 4. FAIL must NOT complete the chapter (no unlock) -----------------------
console.log('\n[4] fail path — chapter completion gating');
{
  const pr = await api('GET', `/books/${up.data.bookId}/progress`, { token: S });
  ok('progress → 200', pr.status === 200, JSON.stringify(pr.data).slice(0, 100));
  const done = pr.data.completedChapters ?? [];
  ok('chapters 1–2 completed by success path', done.includes(chapters[0].id) && done.includes(chapters[1].id), `${done.length} completed`);
  ok('failed chapter 3 NOT marked complete', !done.includes(chapters[2].id), `completed: ${done.length}`);
  ok('failed run score still counts toward book tally', pr.data.score > 0, `book score ${pr.data.score}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
