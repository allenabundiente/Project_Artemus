// Admin + commerce + cosmetics routes. Mounted under /api by createApiRouter.
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

export function registerAdminRoutes(router: Router): void {
  seedShop();

  // --- public helpers ----------------------------------------------------------

  router.get('/features', async (_req, res) => {
    res.json(await listFeatures());
  });

  // --- admin: feature locks ------------------------------------------------------

  router.put('/admin/features/:key', requireAdmin, async (req, res) => {
    const locked = req.body?.locked === true;
    const row = await setFeatureLock(String(req.params.key), locked);
    if (!row) return res.status(404).json({ error: 'Unknown feature' });
    res.json(row);
  });

  // --- admin: sprite management --------------------------------------------------

  router.get('/admin/sprites', requireAdmin, async (_req, res) => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(SPRITES_DIR, 'manifest.json'), 'utf8'));
      const files = fs.existsSync(SPRITES_DIR)
        ? fs.readdirSync(SPRITES_DIR).filter((f) => f.endsWith('.png')).sort()
        : [];
      res.json({ manifest, files: files.map((f) => f.replace(/\.png$/, '')) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/admin/sprites/:slot', requireAdmin, upload.single('png'), async (req, res) => {
    const slot = String(req.params.slot);
    if (!isSafeSlot(slot)) return res.status(400).json({ error: 'Invalid slot name' });
    if (!req.file) return res.status(400).json({ error: 'No PNG uploaded (field name: "png")' });
    try {
      fs.writeFileSync(path.join(SPRITES_DIR, `${slot}.png`), req.file.buffer);
      res.json({ ok: true, slot, bytes: req.file.size });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/sprites/:slot', requireAdmin, async (req, res) => {
    const slot = String(req.params.slot);
    if (!isSafeSlot(slot)) return res.status(400).json({ error: 'Invalid slot name' });
    try {
      // "Restore" = regenerate from the canonical grid via the generator script.
      const { execFile } = await import('node:child_process');
      const prom = new Promise<void>((resolve, reject) => {
        execFile('npx', ['tsx', 'scripts/generate-sprites.ts'], { cwd: path.resolve(SPRITES_DIR, '..') }, (err) => (err ? reject(err) : resolve()));
      });
      await prom;
      res.json({ ok: true, slot, note: 'Regenerated from canonical grid' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- admin: sprite animations ---------------------------------------------------
  //
  // Named animation cycles over uploaded sprite frames. Frames are plain PNGs
  // in public/sprites/ whose names share a base and a trailing frame number —
  // e.g. dragon_flap1, dragon_flap2, dragon_flap3 + dragon_idle — grouped here
  // into a playable clip: { name, frames: ['dragon_flap1', ...], fps, loop }.
  // Stored in public/sprites/animations.json; the frontend loader picks it up
  // and the engine plays registered clips on patrol monsters.

  const ANIM_FILE = path.join(SPRITES_DIR, 'animations.json');

  interface AnimDef {
    name: string;
    frames: string[];
    fps: number;
    loop: boolean;
  }

  function readAnims(): AnimDef[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(ANIM_FILE, 'utf8'));
      return Array.isArray(parsed) ? (parsed as AnimDef[]) : [];
    } catch {
      return [];
    }
  }

  function writeAnims(anims: AnimDef[]): void {
    fs.writeFileSync(ANIM_FILE, JSON.stringify(anims, null, 2) + '\n');
  }

  router.get('/admin/animations', requireAdmin, async (_req, res) => {
    try {
      const anims = readAnims();
      // Which frame PNGs exist but belong to no registered animation yet?
      const files = fs.existsSync(SPRITES_DIR)
        ? fs.readdirSync(SPRITES_DIR).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''))
        : [];
      const used = new Set(anims.flatMap((a) => a.frames));
      const unassigned = files.filter((f) => !used.has(f));
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
    const anims = readAnims();
    const i = anims.findIndex((a) => a.name === name);
    if (i >= 0) anims[i] = anim;
    else anims.push(anim);
    try {
      writeAnims(anims);
      res.json({ ok: true, animation: anim });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete('/admin/animations/:name', requireAdmin, async (req, res) => {
    const name = String(req.params.name);
    if (!isSafeSlot(name)) return res.status(400).json({ error: 'Invalid animation name' });
    try {
      const anims = readAnims();
      const next = anims.filter((a) => a.name !== name);
      if (next.length === anims.length) return res.status(404).json({ error: 'Unknown animation' });
      writeAnims(next);
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
    res.json(await setGlobalMapConfig({ mode, fixedTheme }));
  });

  // --- admin: shop management ----------------------------------------------------

  router.post('/admin/shop', requireAdmin, async (req, res) => {
    const b = req.body ?? {};
    const sku = typeof b.sku === 'string' && /^[a-z0-9_]{1,40}$/.test(b.sku) ? b.sku : null;
    const name = typeof b.name === 'string' && b.name.trim().length > 0 ? b.name.trim().slice(0, 60) : null;
    const category = ['hair', 'armor', 'helmet', 'pack'].includes(b.category) ? b.category : null;
    const kind = typeof b.kind === 'string' && /^[a-z0-9_:]{1,60}$/.test(b.kind) ? b.kind : null;
    const price = Number(b.price);
    if (!sku || !name || !category || !kind || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'sku, name, category, kind, price are required' });
    }
    const item = await upsertShopItem({
      sku, name, description: typeof b.description === 'string' ? b.description.slice(0, 200) : '',
      category, kind, price: Math.round(price), sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0,
    });
    res.status(201).json(item);
  });

  router.delete('/admin/shop/:id', requireAdmin, async (req, res) => {
    res.json({ ok: await deleteShopItem(String(req.params.id)) });
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
    const result = await purchaseItem(user.id, itemId, user.coins);
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
