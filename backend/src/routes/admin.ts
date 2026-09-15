// Admin + commerce + cosmetics routes. Mounted under /api by createApiRouter.
//
// Admin-uploaded assets (sprite PNGs, animation clips, custom map themes) are
// stored in Postgres (see ../db/assets.ts) so they survive ephemeral container
// filesystems (Render free tier wipes local writes on every deploy). The disk
// copies under frontend/public/sprites and backend/data are best-effort
// MIRRORS for local development only — the database is always read first.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listFeatures, isFeatureLocked, setFeatureLock,
  listShopItems, upsertShopItem, deleteShopItem,
  purchaseItem, getUserItemIds,
  getPreferences, setPreferences, sanitizeAvatar,
  getGlobalMapConfig, setGlobalMapConfig, getGuildMapSettings, setGuildMapTheme,
} from '../db/admin.js';
import {
  putSprite, getSprite, deleteSprite, listSpriteNames, listSpriteVersions, getSpriteVersion,
  getJson, putJson, hasJson, importLegacyThemesFromDisk,
} from '../db/assets.js';
import {
  insertAuditEntry, listAuditEntries, listAdmins, grantAdminByEmail, createAdmin, demoteAdmin,
  type AuditAction,
} from '../db/audit.js';
import { withTransaction } from '../db/db.js';
import {
  ALL_SETS, findSet, setsForSkus,
  seedWardrobeItems, WARDROBE_COLORS, type AvatarPart,
} from '../services/wardrobe.js';
import { hashPassword, verifyPassword, requireAuth, requireAdmin, requireRole, signToken } from '../services/auth.js';
import { getUserByEmail, getUserById, addCoins } from '../db/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = path.resolve(here, '../../../frontend/public/sprites');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('Only PNG files are accepted'));
  },
});

/** Validate a sprite slot name to prevent path traversal. */
function isSafeSlot(name: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(name);
}

/**
 * Best-effort audit write: a failed log insert must never break the admin
 * action itself (house style — graceful degradation).
 */
async function logAudit(req: { user?: { id: string; name: string } | undefined }, action: AuditAction, target: string, detail: object = {}): Promise<void> {
  try {
    await insertAuditEntry({ actorId: req.user?.id ?? null, actorName: req.user?.name ?? 'unknown', action, target, detail });
  } catch (e) {
    console.error(`[audit] failed to record ${action}:`, (e as Error).message);
  }
}

/** name → content version for every custom sprite (drives ?v= cache busting). */
async function spriteMeta(): Promise<Record<string, number>> {
  try {
    return await listSpriteVersions();
  } catch {
    return {};
  }
}

export function seedShop(): void {
  // Wardrobe catalog seeds at boot so the shop is never empty (idempotent).
  void (async () => {
    try {
      for (const item of seedWardrobeItems()) await upsertShopItem(item);
    } catch (e) {
      console.error('[shop] seed failed (db offline?):', (e as Error).message);
    }
  })();
}

// --- custom map themes ------------------------------------------------------------
//
// Admin-defined map themes (colors + optional sprite/monster swaps) live in the
// admin_assets table ('themes:custom' row) and are served through GET /api/themes.
// The frontend registers them into its theme registry at quest start, so a new
// map is playable everywhere without a redeploy. Built-in themes stay in
// frontend/src/game/themes.ts and cannot be overwritten from here.

const THEME_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]{1,40}\))$/;
const THEME_COLORS_REQUIRED = ['sky', 'stars', 'farHills', 'nearHills', 'pit', 'floorTop', 'floorBody', 'floorSpeckle', 'hpFilled', 'hpEmpty'] as const;
const THEME_COLORS_OPTIONAL = ['torchPole', 'torchSconce', 'particleHit', 'particleScore', 'dustColor'] as const;

export interface CustomThemeRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Custom themes from the database. Falls back to the disk mirror only when the
 * DB is unreachable (e.g. momentary outage during boot) so the game keeps its
 * custom looks. Route handlers use this instead of any sync reader.
 */
export async function fetchCustomThemes(): Promise<CustomThemeRecord[]> {
  try {
    const raw = await getJson('themes');
    return Array.isArray(raw) ? (raw as CustomThemeRecord[]) : [];
  } catch {
    return readThemesFromDisk();
  }
}

function readThemesFromDisk(): CustomThemeRecord[] {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/custom-themes.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CustomThemeRecord[]) : [];
  } catch {
    return [];
  }
}

/** Best-effort disk mirror so local dev works without redeploy-critical DB reads. */
function mirrorThemesToDisk(themes: CustomThemeRecord[]): void {
  try {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'custom-themes.json'), JSON.stringify(themes, null, 2) + '\n');
  } catch {
    // Read-only FS (e.g. container) — DB is the source of truth, mirror is optional.
  }
}

/** Strict sanitization: slug id, short name, hex/rgba colors, safe sprite slots. */
function sanitizeCustomTheme(id: string, b: Record<string, unknown>): CustomThemeRecord | { error: string } {
  const name = typeof b.name === 'string' && b.name.trim().length > 0 ? b.name.trim().slice(0, 40) : null;
  if (!name) return { error: 'name is required' };
  const out: CustomThemeRecord = { id, name };
  for (const k of THEME_COLORS_REQUIRED) {
    const v = b[k];
    if (typeof v !== 'string' || !THEME_COLOR_RE.test(v)) return { error: `color "${k}" must be a hex or rgba() string` };
    out[k] = v.slice(0, 48);
  }
  for (const k of THEME_COLORS_OPTIONAL) {
    const v = b[k];
    if (typeof v === 'string' && THEME_COLOR_RE.test(v)) out[k] = v.slice(0, 48);
  }
  if (Array.isArray(b.monsters)) {
    const monsters = b.monsters.filter((m): m is string => typeof m === 'string' && isSafeSlot(m)).slice(0, 8);
    if (monsters.length > 0) out.monsters = monsters;
  }
  if (b.spriteOverrides && typeof b.spriteOverrides === 'object' && !Array.isArray(b.spriteOverrides)) {
    const overrides: Record<string, string> = {};
    for (const [slot, file] of Object.entries(b.spriteOverrides as Record<string, unknown>).slice(0, 16)) {
      if (isSafeSlot(slot) && typeof file === 'string' && isSafeSlot(file)) overrides[slot] = file;
    }
    if (Object.keys(overrides).length > 0) out.spriteOverrides = overrides;
  }
  return out;
}

export function registerAdminRoutes(router: Router, opts: { importLegacyThemes?: boolean } = {}): void {
  seedShop();
  if (opts.importLegacyThemes) void importLegacyThemesFromDisk();

  // --- public helpers ----------------------------------------------------------

  router.get('/features', async (_req, res) => {
    res.json(await listFeatures());
  });

  // --- admin: feature locks ------------------------------------------------------

  router.put('/admin/features/:key', requireAdmin, async (req, res) => {
    const locked = req.body?.locked === true;
    const row = await setFeatureLock(String(req.params.key), locked);
    if (!row) return res.status(404).json({ error: 'Unknown feature' });
    await logAudit(req, 'feature_lock', row.key, { locked });
    res.json(row);
  });

  // --- admin: admin account management ------------------------------------------------
  //
  // Create a new admin outright, promote an existing teacher/student by email,
  // review the current admins, and demote — with a guard rail so the last admin
  // can never be demoted (no lockouts). Every change lands in the audit log.

  router.get('/admin/admins', requireAdmin, async (_req, res) => {
    try {
      res.json({ admins: await listAdmins() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/admin/admins', requireAdmin, async (req, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim().length > 0 ? req.body.name.trim().slice(0, 60) : null;
    const email = typeof req.body?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email.trim()) ? req.body.email.trim() : null;
    const password = typeof req.body?.password === 'string' && req.body.password.length >= 8 ? req.body.password : null;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, a valid email, and a password of at least 8 characters are required' });
    }
    try {
      const result = await createAdmin(name, email, await hashPassword(password));
      if (result === 'exists') return res.status(409).json({ error: 'A user with that email already exists' });
      await logAudit(req, 'admin_created', result.email, { id: result.id, name: result.name });
      res.status(201).json({ admin: result });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/admin/admins/grant', requireAdmin, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    try {
      const granted = await grantAdminByEmail(email);
      if (!granted) return res.status(404).json({ error: 'No user found with that email' });
      await logAudit(req, 'admin_granted', granted.email, { id: granted.id, name: granted.name });
      res.json({ admin: granted });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/admins/:id', requireAdmin, async (req, res) => {
    try {
      const demoted = await demoteAdmin(String(req.params.id));
      if (!demoted) return res.status(400).json({ error: 'Cannot demote the last remaining admin' });
      await logAudit(req, 'admin_revoked', demoted.email, { id: demoted.id, name: demoted.name });
      res.json({ admin: demoted });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- admin: audit log -----------------------------------------------------------------

  router.get('/admin/audit', requireAdmin, async (req, res) => {
    try {
      const limit = Number(req.query.limit);
      res.json({ entries: await listAuditEntries(Number.isFinite(limit) ? limit : 100) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- admin: sprite management ----------------------------------------------------
  //
  // Sprite slots = built-in manifest slots ∪ PNGs on disk ∪ custom PNGs in the
  // admin_assets table. Uploads go to the DB first (source of truth), then
  // mirror to disk when the filesystem allows it (local dev convenience).

  router.get('/admin/sprites', requireAdmin, async (_req, res) => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'manifest.json'), 'utf8'));
      const diskFiles = fs.existsSync(SPRITES_DIR)
        ? fs.readdirSync(SPRITES_DIR).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''))
        : [];
      let dbSprites: string[] = [];
      try {
        dbSprites = await listSpriteNames();
      } catch {
        // DB offline — listing still works with the disk-only view.
      }
      const files = [...new Set([...Object.keys(manifest), ...diskFiles, ...dbSprites])].sort();
      res.json({ manifest, files, custom: dbSprites, versions: await spriteMeta() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/admin/sprites/:slot', requireAdmin, upload.single('png'), async (req, res) => {
    const slot = String(req.params.slot);
    if (!isSafeSlot(slot)) return res.status(400).json({ error: 'Invalid slot name' });
    if (!req.file) return res.status(400).json({ error: 'No PNG uploaded (field name: "png")' });
    try {
      // Source of truth: the database (survives ephemeral redeploys).
      await putSprite(slot, req.file.buffer, req.file.mimetype || 'image/png');
      // Best-effort disk mirror for local dev; failures are non-fatal.
      try {
        fs.mkdirSync(SPRITES_DIR, { recursive: true });
        fs.writeFileSync(path.join(SPRITES_DIR, `${slot}.png`), req.file.buffer);
      } catch {
        // Read-only FS — the DB copy above still wins.
      }
      await logAudit(req, 'sprite_upload', slot, { bytes: req.file.size });
      const version = await getSpriteVersion(slot);
      res.json({ ok: true, slot, bytes: req.file.size, version: version ?? 1 });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/sprites/:slot', requireAdmin, async (req, res) => {
    const slot = String(req.params.slot);
    if (!isSafeSlot(slot)) return res.status(400).json({ error: 'Invalid slot name' });
    try {
      await deleteSprite(slot); // clear any DB override first
      try {
        fs.rmSync(path.join(SPRITES_DIR, `${slot}.png`), { force: true });
      } catch {
        // Read-only FS — fine.
      }
      // "Restore" = regenerate from the canonical grid via the generator script.
      const { execFile } = await import('node:child_process');
      const prom = new Promise<void>((resolve, reject) => {
        execFile('npx', ['tsx', 'scripts/generate-sprites.ts'], { cwd: path.resolve(SPRITES_DIR, '..') }, (err) => (err ? reject(err) : resolve()));
      });
      await prom;
      await logAudit(req, 'sprite_restore', slot);
      res.json({ ok: true, slot, note: 'Regenerated from canonical grid' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- public sprite serving -------------------------------------------------------
  //
  // The game reads PNGs from /sprites/<name>.png (static files under
  // backend/public). Custom uploads live in the DB, so serve those here:
  // GET /api/sprites/:name answers with the stored PNG (or 404, and the
  // frontend falls back to the canonical grid art).

  // Public list of custom sprite slots (DB-backed uploads). The client uses
  // this to preload custom art that has no static-file equivalent.
  // The versions map lets the client build ?v=<version> URLs for the static
  // /sprites/<name>.png copies too, so a re-upload busts every cache at once.
  router.get('/sprites/list', async (_req, res) => {
    try {
      const [sprites, versions] = await Promise.all([listSpriteNames(), spriteMeta()]);
      res.json({ sprites, versions });
    } catch {
      res.json({ sprites: [], versions: {} });
    }
  });

  router.get('/sprites/:name', async (req, res) => {
    const name = String(req.params.name).replace(/\.png$/i, '');
    if (!isSafeSlot(name)) return res.status(400).json({ error: 'Invalid sprite name' });
    try {
      const sprite = await getSprite(name);
      if (!sprite) return res.status(404).json({ error: 'No custom art for this slot' });
      res.setHeader('Content-Type', sprite.mime);
      // Content-hashed strong ETag keyed to the write-version: an admin
      // re-upload changes the version, so caches revalidate instantly while
      // unchanged art is served as a bodyless 304. Immune to content collisions
      // (unlike hashing the bytes) and to clock skew (unlike timestamps).
      const etag = `"sprite-${name}-v${sprite.version}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.send(sprite.bytes);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- admin: sprite animations -----------------------------------------------------
  //
  // Named animation cycles over uploaded sprite frames, e.g. clips grouped from
  // dragon_flap1..3 + dragon_idle. Stored in the admin_assets table
  // ('animations' row) and served publicly via GET /api/animations; the
  // frontend loader picks them up and the engine plays registered clips on
  // patrol monsters. A disk mirror (public/sprites/animations.json) is kept
  // for local dev where the DB may be empty.

  interface AnimDef {
    name: string;
    frames: string[];
    fps: number;
    loop: boolean;
  }

  /** Read clips: DB first, disk mirror as fallback. */
  async function readAnims(): Promise<AnimDef[]> {
    try {
      const raw = await getJson('animations');
      if (Array.isArray(raw)) return raw as AnimDef[];
    } catch {
      // DB offline — fall through to the disk mirror.
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'animations.json'), 'utf8'));
      return Array.isArray(parsed) ? (parsed as AnimDef[]) : [];
    } catch {
      return [];
    }
  }

  async function writeAnims(anims: AnimDef[]): Promise<void> {
    await putJson('animations', anims);
    try {
      fs.writeFileSync(path.join(SPRITES_DIR, 'animations.json'), JSON.stringify(anims, null, 2) + '\n');
    } catch {
      // Read-only FS — DB copy above is what matters.
    }
  }

  router.get('/admin/animations', requireAdmin, async (_req, res) => {
    try {
      const anims = await readAnims();
      // Which frame PNGs exist but belong to no registered animation yet?
      const diskFiles = fs.existsSync(SPRITES_DIR)
        ? fs.readdirSync(SPRITES_DIR).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''))
        : [];
      let dbSprites: string[] = [];
      try {
        dbSprites = await listSpriteNames();
      } catch {
        // DB offline — disk listing only.
      }
      const used = new Set(anims.flatMap((a) => a.frames));
      const unassigned = [...new Set([...diskFiles, ...dbSprites])].filter((f) => !used.has(f));
      res.json({ animations: anims, unassigned });
      return;
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.put('/admin/animations/:name', requireAdmin, async (req, res) => {
    const name = String(req.params.name);
    if (!isSafeSlot(name)) return res.status(400).json({ error: 'Invalid animation name' });
    const b = req.body ?? {};
    const frames = Array.isArray(b.frames) ? b.frames.filter((f: unknown) => typeof f === 'string' && isSafeSlot(f as string)) : [];
    if (frames.length === 0) return res.status(400).json({ error: 'frames: non-empty array of sprite slot names required' });
    const fps = Number(b.fps);
    const anim: AnimDef = {
      name,
      frames,
      fps: Number.isFinite(fps) && fps >= 1 && fps <= 30 ? Math.round(fps) : 8,
      loop: b.loop !== false,
    };
    const anims = await readAnims();
    const i = anims.findIndex((a) => a.name === name);
    if (i >= 0) anims[i] = anim;
    else anims.push(anim);
    try {
      await writeAnims(anims);
      await logAudit(req, 'animation_save', anim.name, { frames: anim.frames, fps: anim.fps, loop: anim.loop });
      res.json({ ok: true, animation: anim });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/animations/:name', requireAdmin, async (req, res) => {
    const name = String(req.params.name);
    if (!isSafeSlot(name)) return res.status(400).json({ error: 'Invalid animation name' });
    try {
      const anims = await readAnims();
      const next = anims.filter((a) => a.name !== name);
      if (next.length === anims.length) return res.status(404).json({ error: 'Unknown animation' });
      await writeAnims(next);
      await logAudit(req, 'animation_delete', name);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- public animation clip feed ----------------------------------------------------
  //
  // The game client fetches its clips from here (DB-backed, so admin-defined
  // animations survive redeploys). Same shape as the legacy disk file.

  router.get('/animations', async (_req, res) => {
    try {
      const anims = await readAnims();
      res.setHeader('Cache-Control', 'no-cache');
      res.json(anims);
    } catch {
      res.json([]);
    }
  });

  // --- admin: custom map themes ------------------------------------------------------

  router.get('/admin/themes', requireAdmin, async (_req, res) => {
    try {
      res.json(await fetchCustomThemes());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.put('/admin/themes/:id', requireAdmin, async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) return res.status(400).json({ error: 'Invalid theme id (lowercase slug)' });
    if (['dungeon', 'forest'].includes(id)) return res.status(400).json({ error: 'Built-in themes cannot be replaced' });
    const sanitized = sanitizeCustomTheme(id, (req.body ?? {}) as Record<string, unknown>);
    if ('error' in sanitized) return res.status(400).json({ error: sanitized.error });
    try {
      const themes = await fetchCustomThemes();
      const i = themes.findIndex((t) => t.id === id);
      if (i >= 0) themes[i] = sanitized;
      else themes.push(sanitized);
      await putJson('themes', themes);
      mirrorThemesToDisk(themes);
      await logAudit(req, 'theme_save', id, { name: sanitized.name });
      res.json({ ok: true, theme: sanitized });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/themes/:id', requireAdmin, async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) return res.status(400).json({ error: 'Invalid theme id' });
    try {
      const themes = await fetchCustomThemes();
      const next = themes.filter((t) => t.id !== id);
      if (next.length === themes.length) return res.status(404).json({ error: 'Unknown theme' });
      await putJson('themes', next);
      mirrorThemesToDisk(next);
      // If the global map config pins the deleted theme, fall back to dungeon.
      const cfg = await getGlobalMapConfig();
      if (cfg.fixedTheme === id && cfg.mode === 'fixed') {
        await setGlobalMapConfig({ mode: 'fixed', fixedTheme: 'dungeon' });
      }
      await logAudit(req, 'theme_delete', id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- admin: map config ---------------------------------------------------------

  router.get('/admin/map', requireAdmin, async (_req, res) => {
    res.json(await getGlobalMapConfig());
  });

  router.put('/admin/map', requireAdmin, async (req, res) => {
    const mode = req.body?.mode === 'fixed' ? 'fixed' : 'random_by_difficulty';
    const fixedTheme = typeof req.body?.fixedTheme === 'string' && /^[a-z0-9_-]{1,32}$/.test(req.body.fixedTheme)
      ? req.body.fixedTheme
      : 'dungeon';
    const saved = await setGlobalMapConfig({ mode, fixedTheme });
    await logAudit(req, 'map_config_save', 'global', saved);
    res.json(saved);
  });

  // --- admin: shop management ----------------------------------------------------

  router.post('/admin/shop', requireAdmin, async (req, res) => {
    const b = req.body ?? {};
    const sku = typeof b.sku === 'string' && /^[a-z0-9_]{1,40}$/.test(b.sku) ? b.sku : null;
    const name = typeof b.name === 'string' && b.name.trim().length > 0 ? b.name.trim().slice(0, 60) : null;
    const category = ['hair', 'armor', 'helmet', 'cape', 'pack'].includes(b.category) ? b.category : null;
    const kind = typeof b.kind === 'string' && /^[a-z0-9_:]{1,60}$/.test(b.kind) ? b.kind : null;
    const price = Number(b.price);
    if (!sku || !name || !category || !kind || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'sku, name, category, kind, price are required' });
    }
    const item = await upsertShopItem({
      sku, name, description: typeof b.description === 'string' ? b.description.slice(0, 200) : '',
      category, kind, price: Math.round(price), sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0,
    });
    await logAudit(req, 'shop_item_create', item.sku, { name: item.name, price: item.price, category: item.category });
    res.status(201).json(item);
  });

  router.delete('/admin/shop/:id', requireAdmin, async (req, res) => {
    const ok = await deleteShopItem(String(req.params.id));
    if (ok) await logAudit(req, 'shop_item_delete', String(req.params.id));
    res.json({ ok });
  });

  // --- shop (player-facing) ------------------------------------------------------

  router.get('/shop', requireAuth, async (req, res) => {
    if (await isFeatureLocked('shop')) return res.status(423).json({ error: 'locked', feature: 'shop' });
    const user = await getUserById(req.user!.id);
    const [items, owned] = await Promise.all([listShopItems(), getUserItemIds(req.user!.id)]);
    res.json({ coins: user?.coins ?? 0, items, owned });
  });

  router.post('/shop/purchase', requireAuth, async (req, res) => {
    if (await isFeatureLocked('shop')) return res.status(423).json({ error: 'locked', feature: 'shop' });
    const itemId = String(req.body?.itemId ?? '');
    if (!/^[0-9a-f-]{36}$/.test(itemId)) return res.status(400).json({ error: 'itemId required' });
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const result = await purchaseItem(user.id, itemId);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json({ coins: result.coins, item: result.item });
  });

  // --- wardrobe ------------------------------------------------------------------

  router.get('/wardrobe', requireAuth, async (req, res) => {
    if (await isFeatureLocked('wardrobe')) return res.status(423).json({ error: 'locked', feature: 'wardrobe' });
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ownedIds = await getUserItemIds(user.id);
    const items = await listShopItems();
    const ownedSkus = items.filter((i) => ownedIds.includes(i.id)).map((i) => i.sku);
    res.json({
      sets: ALL_SETS,
      unlocked: setsForSkus(ownedSkus),
      colors: WARDROBE_COLORS,
      avatar: sanitizeAvatar((user.preferences as { avatar?: unknown })?.avatar ?? user.preferences),
    });
  });

  router.put('/wardrobe', requireAuth, async (req, res) => {
    if (await isFeatureLocked('wardrobe')) return res.status(423).json({ error: 'locked', feature: 'wardrobe' });
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const avatar = sanitizeAvatar(req.body?.avatar);
    // Enforce ownership: paid sets must be unlocked.
    const ownedIds = await getUserItemIds(user.id);
    const items = await listShopItems();
    const ownedSkus = new Set(items.filter((i) => ownedIds.includes(i.id)).map((i) => i.sku));
    for (const part of Object.keys(ALL_SETS) as AvatarPart[]) {
      const chosen = findSet(part, avatar[part]);
      if (chosen && chosen.price > 0 && !ownedSkus.has(chosen.sku)) {
        return res.status(403).json({ error: `"${chosen.name}" is not unlocked yet` });
      }
    }
    const prefs = { ...(await getPreferences(user.id)), avatar };
    await setPreferences(user.id, prefs);
    res.json({ avatar });
  });

  // /api/me gains avatar + role in one place — handled in api.ts, but the
  // wardrobe preview needs the raw prefs too:
  router.get('/wardrobe/me', requireAuth, async (req, res) => {
    const prefs = await getPreferences(req.user!.id);
    const nested = (prefs as { avatar?: unknown }).avatar;
    res.json({ avatar: sanitizeAvatar(nested ?? prefs) });
  });
}
