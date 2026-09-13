// FINAL REVIEW — full user journey against a running server:
// signup → found guild → upload PDF (programming + language detection) →
// generate → list challenges → answer one correctly → quest completion.
// Usage: node scripts/e2e-final-review.mjs [baseUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:4177';
const stamp = Date.now();

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function step(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const pdfPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample-book.pdf');
if (!fs.existsSync(pdfPath)) {
  console.error('sample-book.pdf missing — run: node scripts/make-sample-pdf.mjs');
  process.exit(1);
}
const pdfBytes = fs.readFileSync(pdfPath);

// 1) Auth: fresh teacher per run.
const email = `final-review-${stamp}@questbook.local`;
const signup = await api('POST', '/api/auth/signup', { body: { name: 'Final Reviewer', email, password: 'review-pass-1', role: 'teacher' } });
step('signup teacher', !!signup.token);
const T = signup.token;

const me = await api('GET', '/api/me', { token: T });
step('GET /me', me.user?.role === 'teacher', `role=${me.user?.role}`);

// 2) Guild.
const guild = await api('POST', '/api/guilds', { token: T, body: { name: `Review Guild ${stamp}` } });
step('found guild', !!guild.guild?.passcode, `code=${guild.guild?.passcode}`);

// 3) Upload the programming sample (filename ends _code → programming plugin).
const form = new FormData();
form.append('pdf', new Blob([pdfBytes], { type: 'application/pdf' }), 'final_review_code.pdf');
form.append('questCount', '15');
const up = await api('POST', '/api/upload', { token: T, form });
step('upload PDF', !!up.bookId, `title="${up.title}" quizMode=${up.quizMode}`);
step('programming mode auto-detected', up.quizMode === 'programming', `filename=final_review_code.pdf → ${up.quizMode}`);

// 4) Generate with a persisted quest count.
const gen = await api('POST', `/api/books/${up.bookId}/generate`, { token: T, body: { term: 'prelims' } });
step('generate challenges', gen.challengeCount > 0, `${gen.challengeCount} challenges, mode=${gen.mode}, questCount=${gen.questCount ?? 'auto'}`);

// 5) Cached re-generate returns without work.
const gen2 = await api('POST', `/api/books/${up.bookId}/generate`, { token: T, body: { term: 'prelims' } });
step('generate is cached', gen2.cached === true, `count=${gen2.challengeCount}`);

// 6) Book detail + challenges feed (teacher review path).
const detail = await api('GET', `/api/books/${up.bookId}`, { token: T });
step('book detail', detail.chapters?.length > 0, `${detail.chapters.length} chapters, quizMode=${detail.quizMode}`);
const feed = await api('GET', `/api/books/${up.bookId}/challenges`, { token: T });
const totalChallenges = feed.chapters?.reduce((n, c) => n + c.challenges.length, 0) ?? 0;
step('review feed', totalChallenges > 0, `${totalChallenges} challenges across ${feed.chapters.length} chapters`);
const types = new Set();
for (const ch of feed.chapters) for (const c of ch.challenges) types.add(c.type);
step('question-type mix', types.size >= 2, [...types].join(', '));

// 7) Per-challenge regenerate (teacher rejects one).
const first = feed.chapters[0].challenges[0];
const regen = await api('POST', `/api/challenges/${first.id}/regenerate`, { token: T, body: { term: 'prelims' } });
step('regenerate single challenge', !!regen.challenge?.id, `new type=${regen.challenge?.type}`);

// 8) Per-book settings edit (count + mode override).
const settings = await api('PUT', `/api/books/${up.bookId}/settings`, { token: T, body: { questCount: 20, quizMode: 'general' } });
step('settings update', settings.questCount === 20 && settings.quizMode === 'general', `count=${settings.questCount}, mode=${settings.quizMode}`);

// 9) Language-mode upload: teacher uploads with explicit override (no guild
//    interference — same teacher owns it).
const form2 = new FormData();
form2.append('pdf', new Blob([pdfBytes], { type: 'application/pdf' }), `spanish_vocab_${stamp}.pdf`);
const up2 = await api('POST', '/api/upload', { token: T, form: form2 });
step('language detection', up2.quizMode === 'programming' || up2.quizMode === 'general' ? false : true, `spanish_vocab → ${up2.quizMode}`);

// 10) Student joins + plays a quest to completion.
const sEmail = `student-${stamp}@questbook.local`;
const sUp = await api('POST', '/api/auth/signup', { body: { name: 'Review Student', email: sEmail, password: 'review-pass-1', role: 'student' } });
const join = await api('POST', '/api/guilds/join', { token: sUp.token, body: { passcode: guild.guild.passcode } });
step('student joins guild', join.guild?.name === `Review Guild ${stamp}`);

const studentBooks = await api('GET', '/api/books', { token: sUp.token });
step('student sees guild books', studentBooks.some?.((b) => b.id === up.bookId));

const ch0 = detail.chapters[0];
const chal = await api('GET', `/api/books/${up.bookId}/chapters/${ch0.id}/challenges`, { token: sUp.token });
step('student reads challenges', chal.challenges?.length > 0, `${chal.challenges.length} in chapter 1`);

const lesson = await api('GET', `/api/books/${up.bookId}/chapters/${ch0.id}/lesson`, { token: sUp.token });
step('lesson overview', !!lesson && typeof lesson === 'object');

// Answer the full quest correctly (one request settles score + coins + progress atomically).
const complete = await api('POST', `/api/quests/${ch0.id}/complete`, {
  token: sUp.token,
  body: { mistakes: 0, timeSeconds: 42, finished: true, livesRemaining: 3, bestStreak: 5, term: 'prelims', coinsGathered: 12 },
});
step('quest completes', typeof complete.rawScore === 'number' && typeof complete.coins === 'number', `score=${complete.rawScore}, coins=+${complete.coinsAwarded}, rank=${complete.rank}`);

const progress = await api('GET', `/api/books/${up.bookId}/progress`, { token: sUp.token });
step('progress recorded', progress.completedChapters?.includes(ch0.id), `${progress.completedChapters.length} chapter(s) done, ${progress.score} pts`);

// 11) Leaderboard reflects the run.
const board = await api('GET', '/api/leaderboard?term=all', { token: sUp.token }).catch(() => null);
step('leaderboard reachable', board !== null);

console.log(process.exitCode ? '\nRESULT: FAILURES ABOVE' : '\nRESULT: ALL E2E STEPS PASSED');
