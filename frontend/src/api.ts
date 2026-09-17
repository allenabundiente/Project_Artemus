import type {
  AdminAccount, AuditEntry, AuthResponse, AuthUser, BookChallengeReview, BookDetail, BookMeta, Challenge, FeatureRow,
  GenerateResult, GuildAdminInfo, GuildInfo, LeaderboardResponse, LessonOverview, LlmStatus, MapConfig, MapResolve,
  Progress, QuizMode, RegenerateAllResult, RosterEntry, ScoreResultResponse, ShopItem, TermSettings,
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

/**
 * Hard-refresh the whole app after an identity-level change (joining or
 * leaving a guild, regenerating a guild code, dismissing a member): every
 * screen that flows from App's user/guild state — header, panels, rosters —
 * is rebuilt from the server, so nothing can stay stale.
 */
export function refreshApp(): void {
  window.location.reload();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // HTML/plain errors (proxies, gateways, timeouts) carry no JSON — give
      // the teacher/player something actionable instead of a naked status.
      if (res.status === 502 || res.status === 504) {
        message = 'The server took too long to answer — please try again in a moment.';
      } else if (res.status === 503) {
        message = 'The server is briefly unavailable (it may be waking up) — please try again.';
      }
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
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

// --- guild chat ---------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  guildId: string;
  userId: string;
  userName: string;
  userRole: string;
  avatar: Record<string, unknown>;
  rank: string;
  message: string;
  createdAt: string;
  /** Opaque full-precision polling cursor (`<µs>:<id>`) — pass back as-is. */
  cursor: string;
}

/**
 * Guild messages (initial load), or only ones after the opaque `cursor`
 * (polling). The cursor is a server-minted token carrying full microsecond
 * precision; never parse or reformat it on the client.
 */
export async function getGuildChat(cursor?: string): Promise<{ messages: ChatMessage[] }> {
  return get(`/api/guilds/mine/chat${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
}

export async function postGuildChat(message: string): Promise<{ message: ChatMessage }> {
  return send('/api/guilds/mine/chat', 'POST', { message });
}

export async function deleteGuildChatMessage(messageId: string): Promise<{ ok: boolean }> {
  return send(`/api/guilds/mine/chat/${messageId}`, 'DELETE');
}

// --- announcements (teacher → guild notice board) -----------------------------------

export interface Announcement {
  id: string;
  guildId: string;
  teacherId: string;
  teacherName: string;
  title: string;
  message: string;
  createdAt: string;
}

export async function getAnnouncements(): Promise<{ announcements: Announcement[] }> {
  return get('/api/guilds/mine/announcements');
}

export async function postAnnouncement(title: string, message: string): Promise<{ announcement: Announcement }> {
  return send('/api/guilds/mine/announcements', 'POST', { title, message });
}

export async function deleteAnnouncement(id: string): Promise<{ ok: boolean }> {
  return send(`/api/guilds/mine/announcements/${id}`, 'DELETE');
}

export async function getUnreadAnnouncements(): Promise<{ hasUnread: boolean; latestAnnouncementAt: string | null }> {
  return get('/api/guilds/mine/announcements/unread');
}

export async function markAnnouncementsSeen(): Promise<{ ok: boolean }> {
  return send('/api/guilds/mine/announcements/seen', 'POST');
}

// --- personal streaks ---------------------------------------------------------------

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  /** Streak ≥1, no quest today, and the evening has begun — show the reminder. */
  atRisk?: boolean;
  /** The raw stored streak, still salvageable while the reminder can fire. */
  storedStreak?: number;
}

/** Get the user's current streak info. */
export async function getStreak(): Promise<StreakInfo> {
  return get('/api/me/streak');
}

/** One quested day of the streak calendar; milestone = a 7-day bonus day. */
export interface StreakCalendarDay {
  date: string; // YYYY-MM-DD (UTC day with a finished quest)
  milestone: boolean;
}

/** Quested-day history for the streak calendar. */
export async function getStreakCalendar(): Promise<{ days: StreakCalendarDay[] }> {
  return get('/api/me/streak/calendar');
}

export interface GuildStreakEntry {
  userId: string;
  name: string;
  currentStreak: number;
  longestStreak: number;
  questedToday: boolean;
  avatar: Record<string, unknown>;
}

/** Guild streak standings (current vs longest, quested-today flag). */
export async function getGuildStreaks(): Promise<{ guildId: string; entries: GuildStreakEntry[] }> {
  return get('/api/guilds/mine/streaks');
}

// --- guild member management (teacher) ----------------------------------------------

/** Kick a student from your guild — their account, coins, and scores survive. */
export async function removeGuildMember(userId: string): Promise<{ removed: { id: string; name: string } }> {
  return send(`/api/guilds/mine/members/${userId}`, 'DELETE');
}

// --- guild management (admin: any guild, by id) ---------------------------------------

export async function getAdminGuilds(): Promise<{ guilds: GuildAdminInfo[] }> {
  return get('/api/admin/guilds');
}

export async function getAdminGuildMembers(guildId: string): Promise<{ roster: RosterEntry[] }> {
  return get(`/api/admin/guilds/${guildId}/members`);
}

export async function removeAdminGuildMember(guildId: string, userId: string): Promise<{ removed: { id: string; name: string } }> {
  return send(`/api/admin/guilds/${guildId}/members/${userId}`, 'DELETE');
}

export async function regenerateAdminGuildPasscode(guildId: string): Promise<{ passcode: string }> {
  return send(`/api/admin/guilds/${guildId}/regenerate-passcode`, 'POST');
}

export async function getAdminGuildSettings(guildId: string): Promise<{ guildId: string; termSettings: Record<string, TermSettings> }> {
  return get(`/api/admin/guilds/${guildId}/settings`);
}

export async function saveAdminGuildSettings(guildId: string, termSettings: Record<string, TermSettings>): Promise<{ guildId: string; termSettings: Record<string, TermSettings> }> {
  return send(`/api/admin/guilds/${guildId}/settings`, 'PUT', { termSettings });
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

export async function uploadPdf(file: File, questCount?: number | null, quizMode?: QuizMode | 'auto', questChapters?: number | null): Promise<UploadResult> {
  const form = new FormData();
  form.append('pdf', file);
  if (questCount != null) form.append('questCount', String(questCount));
  if (quizMode && quizMode !== 'auto') form.append('quizMode', quizMode);
  if (questChapters != null) form.append('questChapters', String(questChapters));
  const res = await fetch('/api/upload', { method: 'POST', body: form, headers: authHeaders() });
  return json<UploadResult>(res);
}

export async function generateChallenges(bookId: string, term: string = 'prelims', questCount?: number | null): Promise<GenerateResult> {
  return send<GenerateResult>(`/api/books/${bookId}/generate`, 'POST', { term, ...(questCount !== undefined ? { questCount } : {}) });
}

/** Read or set a book's per-PDF quest settings (quest count; null = auto). */
export async function setBookQuestCount(bookId: string, questCount: number | null, quizMode?: QuizMode, questChapters?: number | null): Promise<{ bookId: string; questCount: number | null; questChapters: number | null; quizMode: QuizMode }> {
  return send(`/api/books/${bookId}/settings`, 'PUT', {
    questCount,
    ...(quizMode ? { quizMode } : {}),
    ...(questChapters !== undefined ? { questChapters } : {}),
  });
}

/**
 * Wipe a book's challenges so the next generate() rebuilds them.
 * (Legacy no-op wipe — regeneration now replaces per chapter in one call
 * via generateChallenges, which also reports what it did.)
 */
export async function regenerateBook(bookId: string): Promise<{ ok: boolean; challengeCount?: number; note?: string }> {
  return send(`/api/books/${bookId}/regenerate`, 'POST');
}

/** Rebuild ONE chapter's quest set; every other chapter of the tome is untouched. */
export async function regenerateBookChapter(bookId: string, chapterId: string, term: string = 'prelims'): Promise<{ ok: boolean; chapterId: string; challengeCount: number; note: string }> {
  return send(`/api/books/${bookId}/chapters/${chapterId}/regenerate`, 'POST', { term });
}

/** All challenges in a book grouped by chapter — the teacher's review feed. */
export async function getBookChallenges(bookId: string): Promise<BookChallengeReview> {
  return get(`/api/books/${bookId}/challenges`);
}

/** Reject one challenge and have a fresh one generated in its place. */
export async function regenerateChallenge(challengeId: string, term: string = 'prelims'): Promise<{ challenge: Challenge }> {
  return send(`/api/challenges/${challengeId}/regenerate`, 'POST', { term });
}

export async function listBooks(): Promise<BookMeta[]> {
  return get<BookMeta[]>('/api/books');
}

export async function getBook(bookId: string): Promise<BookDetail> {
  return get<BookDetail>(`/api/books/${bookId}`);
}

/** Delete a tome entirely (chapters, challenges, and progress go with it). */
export async function deleteBook(bookId: string): Promise<{ ok: boolean; title: string }> {
  return send(`/api/books/${bookId}`, 'DELETE');
}

/** Lock/unlock a tome or set its availability window (time-limited access). */
export async function setBookAccess(
  bookId: string,
  gate: { locked?: boolean; availableFrom?: string | null; availableUntil?: string | null },
): Promise<{ locked: boolean; availableFrom: string | null; availableUntil: string | null }> {
  return send(`/api/books/${bookId}/access`, 'PUT', gate);
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

/** Teacher quest rules for a tome: quest cap + availability window. */
export interface BookRules {
  questLimit: number | null;
  availableFrom: string | null;
  availableUntil: string | null;
}

export async function setBookRules(bookId: string, rules: Partial<BookRules>): Promise<{ ok: boolean; rules: BookRules }> {
  return send(`/api/books/${bookId}/rules`, 'PUT', rules);
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

export async function getAdminSprites(): Promise<{ manifest: Record<string, { width: number; height: number }>; files: string[]; custom?: string[]; versions?: Record<string, number> }> {
  return get('/api/admin/sprites');
}

/**
 * Upload several PNG frames to new sprite slots (admin). Used for the Theme
 * Forge's per-map swaps and the Animations studio alike. Rejects as soon as
 * one upload fails so callers can surface a clean error.
 */
export async function uploadSpriteFrames(
  slots: string[],
  files: File[],
): Promise<{ uploaded: string[] }> {
  if (slots.length !== files.length) throw new Error('slot/file count mismatch');
  const uploaded: string[] = [];
  for (let i = 0; i < files.length; i++) {
    await uploadSprite(slots[i], files[i]);
    uploaded.push(slots[i]);
  }
  return { uploaded };
}

// --- admin: admin account management -------------------------------------------------

export async function getAdminAccounts(): Promise<{ admins: AdminAccount[] }> {
  return get('/api/admin/admins');
}

export async function createAdminAccount(name: string, email: string, password: string): Promise<{ admin: AdminAccount }> {
  return send('/api/admin/admins', 'POST', { name, email, password });
}

export async function grantAdminAccount(email: string): Promise<{ admin: AdminAccount }> {
  return send('/api/admin/admins/grant', 'POST', { email });
}

export async function demoteAdminAccount(id: string): Promise<{ admin: AdminAccount }> {
  return send(`/api/admin/admins/${id}`, 'DELETE');
}

// --- admin: audit log ------------------------------------------------------------------

export async function getAuditLog(limit = 100): Promise<{ entries: AuditEntry[] }> {
  return get(`/api/admin/audit?limit=${limit}`);
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

// --- admin: custom map themes ---------------------------------------------------------

/** One admin-defined map theme, exactly as persisted in custom-themes.json. */
export interface CustomThemeFull {
  id: string;
  name: string;
  sky: string;
  stars: string;
  farHills: string;
  nearHills: string;
  pit: string;
  floorTop: string;
  floorBody: string;
  floorSpeckle: string;
  hpFilled: string;
  hpEmpty: string;
  torchPole?: string;
  torchSconce?: string;
  particleHit?: string;
  particleScore?: string;
  dustColor?: string;
  monsters?: string[];
  spriteOverrides?: Record<string, string>;
}

export interface CustomThemePayload {
  name: string;
  sky: string;
  stars: string;
  farHills: string;
  nearHills: string;
  pit: string;
  floorTop: string;
  floorBody: string;
  floorSpeckle: string;
  hpFilled: string;
  hpEmpty: string;
  torchPole?: string;
  torchSconce?: string;
  particleHit?: string;
  particleScore?: string;
  dustColor?: string;
  monsters?: string[];
  spriteOverrides?: Record<string, string>;
}

export async function saveCustomTheme(id: string, theme: CustomThemePayload): Promise<{ ok: boolean; theme: Record<string, unknown> }> {
  return send(`/api/admin/themes/${encodeURIComponent(id)}`, 'PUT', theme);
}

export async function deleteCustomTheme(id: string): Promise<{ ok: boolean }> {
  return send(`/api/admin/themes/${encodeURIComponent(id)}`, 'DELETE');
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

// --- guild chat ------------------------------------------------------------------
// Polling-based MVP: clients poll every few seconds for new messages.
// TODO: upgrade to Supabase Realtime for true push notifications.

export interface ChatMessage {
  id: string;
  guildId: string;
  userId: string;
  userName: string;
  userRole: string;
  avatar: Record<string, unknown>;
  rank: string;
  message: string;
  createdAt: string;
}


// --- streaks ---------------------------------------------------------------------

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

