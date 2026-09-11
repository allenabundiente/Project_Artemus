import type {
  AuthResponse, AuthUser, BookDetail, BookMeta, Challenge, FeatureRow, GenerateResult,
  GuildInfo, LeaderboardResponse, LessonOverview, LlmStatus, MapConfig, MapResolve,
  Progress, RegenerateAllResult, RosterEntry, ScoreResultResponse, ShopItem, TermSettings,
  ThemeMeta, UploadResult, WardrobeResponse,
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

export async function getLesson(bookId: string, chapterId: string): Promise<LessonOverview> {
  return get(`/api/books/${bookId}/chapters/${chapterId}/lesson`);
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
  payload: { mistakes: number; timeSeconds: number; finished: boolean; livesRemaining: number; outOfLife: boolean; bestStreak: number; term: string; coinsGathered: number }
): Promise<ScoreResultResponse> {
  return send<ScoreResultResponse>(`/api/quests/${chapterId}/complete`, 'POST', payload);
}

/** Quest failed (out of lives / out of time): score + coin penalty in one call. */
export async function submitQuestFail(
  chapterId: string,
  payload: { reason: 'out_of_lives' | 'out_of_time'; mistakes: number; timeSeconds: number; livesRemaining: number; bestStreak: number; term: string; coinsGathered: number }
): Promise<ScoreResultResponse> {
  return send<ScoreResultResponse>(`/api/quests/${chapterId}/fail`, 'POST', payload);
}

export async function getLeaderboard(term: string | null, scope: 'guild' | 'global'): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ scope });
  if (term) params.set('term', term);
  return get<LeaderboardResponse>(`/api/leaderboard?${params.toString()}`);
}

export async function getCoins(): Promise<{ coins: number }> {
  return get<{ coins: number }>('/api/coins');
}

// --- llm (teacher) ----------------------------------------------------------------------

export async function getLlmStatus(): Promise<LlmStatus> {
  return get<LlmStatus>('/api/llm/status');
}

export async function regenerateAllChallenges(term: string = 'prelims'): Promise<RegenerateAllResult> {
  return send<RegenerateAllResult>('/api/llm/regenerate-all', 'POST', { term });
}

// --- feature locks (public list; admin toggles) --------------------------------------

export async function getFeatures(): Promise<FeatureRow[]> {
  return get<FeatureRow[]>('/api/features');
}

// --- shop & wardrobe ------------------------------------------------------------------

export async function getShop(): Promise<{ coins: number; items: ShopItem[]; owned: string[] }> {
  return get('/api/shop');
}

export async function purchaseItem(itemId: string): Promise<{ coins: number; item: ShopItem }> {
  return send('/api/shop/purchase', 'POST', { itemId });
}

export async function getWardrobe(): Promise<WardrobeResponse> {
  return get('/api/wardrobe');
}

export async function saveWardrobe(avatar: WardrobeResponse['avatar']): Promise<{ avatar: WardrobeResponse['avatar'] }> {
  return send('/api/wardrobe', 'PUT', { avatar });
}

// --- map themes ------------------------------------------------------------------------

export async function getThemes(): Promise<{ themes: ThemeMeta[] }> {
  return get('/api/themes');
}

export async function resolveMap(chapterId: string, difficulty: string): Promise<MapResolve> {
  return get(`/api/map/resolve?chapterId=${encodeURIComponent(chapterId)}&difficulty=${encodeURIComponent(difficulty)}`);
}

export async function getGuildMap(): Promise<{ theme: string | null }> {
  return get('/api/guilds/mine/map');
}

export async function setGuildMap(theme: string | null): Promise<{ theme: string | null }> {
  return send('/api/guilds/mine/map', 'PUT', { theme });
}

// --- admin ------------------------------------------------------------------------------

export async function setFeatureLock(key: string, locked: boolean): Promise<FeatureRow> {
  return send(`/api/admin/features/${key}`, 'PUT', { locked });
}

export async function getAdminSprites(): Promise<{ manifest: Record<string, { width: number; height: number }>; files: string[] }> {
  return get('/api/admin/sprites');
}

export async function uploadSprite(slot: string, png: File): Promise<{ ok: boolean; slot: string }> {
  const form = new FormData();
  form.append('png', png);
  const res = await fetch(`/api/admin/sprites/${encodeURIComponent(slot)}`, { method: 'POST', body: form, headers: authHeaders() });
  return json(res);
}

export async function restoreSprite(slot: string): Promise<{ ok: boolean; note?: string }> {
  return send(`/api/admin/sprites/${encodeURIComponent(slot)}`, 'DELETE');
}

// --- admin: sprite animations -------------------------------------------------------

export interface AnimDef {
  name: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

export async function getAnimations(): Promise<{ animations: AnimDef[]; unassigned: string[] }> {
  return get('/api/admin/animations');
}

export async function saveAnimation(name: string, def: { frames: string[]; fps?: number; loop?: boolean }): Promise<{ ok: boolean; animation: AnimDef }> {
  return send(`/api/admin/animations/${encodeURIComponent(name)}`, 'PUT', def);
}

export async function deleteAnimation(name: string): Promise<{ ok: boolean }> {
  return send(`/api/admin/animations/${encodeURIComponent(name)}`, 'DELETE');
}

export async function getAdminMap(): Promise<MapConfig> {
  return get('/api/admin/map');
}

export async function setAdminMap(cfg: MapConfig): Promise<MapConfig> {
  return send('/api/admin/map', 'PUT', cfg);
}

export async function createShopItem(item: Omit<ShopItem, 'id'>): Promise<ShopItem> {
  return send('/api/admin/shop', 'POST', item);
}

export async function deleteShopItem(id: string): Promise<{ ok: boolean }> {
  return send(`/api/admin/shop/${id}`, 'DELETE');
}
