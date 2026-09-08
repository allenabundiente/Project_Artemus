import type {
  AuthResponse, AuthUser, BookDetail, BookMeta, Challenge, GenerateResult,
  GuildInfo, LeaderboardResponse, Progress, RosterEntry, ScoreResultResponse, TermSettings, UploadResult,
} from './types';

const TOKEN_KEY = 'arcade-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  return json<T>(await fetch(url, { headers: authHeaders() }));
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return json<T>(res);
}

// --- auth -----------------------------------------------------------------------

export async function signup(name: string, email: string, password: string, role: 'teacher' | 'student'): Promise<AuthResponse> {
  return send<AuthResponse>('/api/auth/signup', 'POST', { name, email, password, role });
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return send<AuthResponse>('/api/auth/login', 'POST', { email, password });
}

export async function getMe(): Promise<{ user: AuthUser; guild: GuildInfo | null }> {
  return get<{ user: AuthUser; guild: GuildInfo | null }>('/api/me');
}

// --- guilds -----------------------------------------------------------------------

export async function createGuild(name: string): Promise<{ guild: GuildInfo }> {
  return send<{ guild: GuildInfo }>('/api/guilds', 'POST', { name });
}

export async function getMyGuild(): Promise<{ guild: (GuildInfo & { termSettings: Record<string, unknown> }) | null; roster?: RosterEntry[] }> {
  return get('/api/guilds/mine');
}

export async function getRoster(): Promise<{ roster: RosterEntry[] }> {
  return get<{ roster: RosterEntry[] }>('/api/guilds/mine/roster');
}

export async function regeneratePasscode(): Promise<{ passcode: string }> {
  return send<{ passcode: string }>('/api/guilds/mine/regenerate-passcode', 'POST');
}

export async function joinGuild(passcode: string): Promise<{ user: AuthUser; guild: { id: string; name: string } }> {
  return send('/api/guilds/join', 'POST', { passcode });
}

export async function leaveGuild(): Promise<{ user: AuthUser }> {
  return send('/api/guilds/leave', 'POST');
}

// --- term settings (teacher) ---------------------------------------------------------

export async function getGuildSettings(): Promise<{ guildId: string; termSettings: Record<string, TermSettings> }> {
  return get('/api/guilds/mine/settings');
}

export async function saveGuildSettings(termSettings: Record<string, TermSettings>): Promise<{ guildId: string; termSettings: Record<string, TermSettings> }> {
  return send('/api/guilds/mine/settings', 'PUT', { termSettings });
}

export async function getTermSettings(term: string): Promise<{ term: string; settings: TermSettings; guildId: string | null }> {
  return get(`/api/terms/current?term=${encodeURIComponent(term)}`);
}

// --- books -------------------------------------------------------------------------

export async function uploadPdf(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('pdf', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form, headers: authHeaders() });
  return json<UploadResult>(res);
}

export async function generateChallenges(bookId: string, term: string = 'prelims'): Promise<GenerateResult> {
  return send<GenerateResult>(`/api/books/${bookId}/generate`, 'POST', { term });
}

export async function listBooks(): Promise<BookMeta[]> {
  return get<BookMeta[]>('/api/books');
}

export async function getBook(bookId: string): Promise<BookDetail> {
  return get<BookDetail>(`/api/books/${bookId}`);
}

export async function getChallenges(bookId: string, chapterId: string): Promise<Challenge[]> {
  const data = await get<{ challenges: Challenge[] }>(`/api/books/${bookId}/chapters/${chapterId}/challenges`);
  return data.challenges;
}

export async function getProgress(bookId: string): Promise<Progress> {
  return get<Progress>(`/api/books/${bookId}/progress`);
}

export async function saveProgress(bookId: string, p: Progress): Promise<Progress> {
  return send<Progress>(`/api/books/${bookId}/progress`, 'POST', p);
}

// --- scoring / leaderboard / coins ----------------------------------------------------

export async function submitQuestComplete(
  chapterId: string,
  payload: { mistakes: number; timeSeconds: number; finished: boolean; livesRemaining: number; outOfLife: boolean; bestStreak: number; term: string }
): Promise<ScoreResultResponse> {
  return send<ScoreResultResponse>(`/api/quests/${chapterId}/complete`, 'POST', payload);
}

export async function getLeaderboard(term: string | null, scope: 'guild' | 'global'): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ scope });
  if (term) params.set('term', term);
  return get<LeaderboardResponse>(`/api/leaderboard?${params.toString()}`);
}

export async function getCoins(): Promise<{ coins: number }> {
  return get<{ coins: number }>('/api/coins');
}
