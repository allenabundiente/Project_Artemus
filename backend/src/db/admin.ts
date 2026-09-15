// Admin, shop, cosmetics, feature locks, and map config data layer.
import { query, queryOne, execute, withTransaction } from './db.js';

// --- feature locks -----------------------------------------------------------

export interface FeatureRow {
  key: string;
  label: string;
  locked: boolean;
}

export async function listFeatures(): Promise<FeatureRow[]> {
  return query(`SELECT key, label, locked FROM app_features ORDER BY key`);
}

export async function isFeatureLocked(key: string): Promise<boolean> {
  const row = await queryOne<{ locked: boolean }>(`SELECT locked FROM app_features WHERE key = $1`, [key]);
  return row?.locked ?? false;
}

export async function setFeatureLock(key: string, locked: boolean): Promise<FeatureRow | null> {
  return queryOne<FeatureRow>(
    `UPDATE app_features SET locked = $2, updated_at = now() WHERE key = $1 RETURNING key, label, locked`,
    [key, locked],
  );
}

// --- shop catalog ------------------------------------------------------------

export interface ShopItemRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: 'hair' | 'armor' | 'helmet' | 'pack';
  kind: string;
  price: number;
  sort: number;
}

export async function listShopItems(): Promise<ShopItemRow[]> {
  return query(`SELECT id, sku, name, description, category, kind, price, sort FROM shop_items ORDER BY category, sort, price`);
}

export async function upsertShopItem(item: {
  sku: string; name: string; description?: string; category: string; kind: string; price: number; sort?: number;
}): Promise<ShopItemRow> {
  return queryOne<ShopItemRow>(
    `INSERT INTO shop_items (sku, name, description, category, kind, price, sort)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category,
       kind = EXCLUDED.kind, price = EXCLUDED.price, sort = EXCLUDED.sort
     RETURNING id, sku, name, description, category, kind, price, sort`,
    [item.sku, item.name, item.description ?? '', item.category, item.kind, item.price, item.sort ?? 0],
  ) as Promise<ShopItemRow>;
}

export async function deleteShopItem(id: string): Promise<boolean> {
  return (await execute(`DELETE FROM shop_items WHERE id = $1`, [id])) > 0;
}

// --- inventory / purchases ---------------------------------------------------

export async function purchaseItem(userId: string, itemId: string): Promise<
  { ok: true; coins: number; item: ShopItemRow } | { ok: false; reason: string }
> {
  const item = await queryOne<ShopItemRow>(
    `SELECT id, sku, name, description, category, kind, price, sort FROM shop_items WHERE id = $1`,
    [itemId],
  );
  if (!item) return { ok: false, reason: 'Item not found' };
  const owned = await queryOne(`SELECT 1 AS x FROM user_items WHERE user_id = $1 AND item_id = $2`, [userId, itemId]);
  if (owned) return { ok: false, reason: 'Already owned' };

  // Atomic: deduct coins + insert inventory in ONE real transaction on a single
  // pooled connection (BEGIN/COMMIT over separate pool.checkouts would be a
  // fiction — and a leaked transaction — under concurrency).
  try {
    const coins = await withTransaction(async (tx) => {
      // The WHERE coins >= price guard makes double-spend impossible even if
      // two purchases race past the ownership check above.
      const res = await tx.query<{ coins: number }>(
        `UPDATE users SET coins = coins - $2, coins_spent = coins_spent + $2
         WHERE id = $1 AND coins >= $2 RETURNING coins`,
        [userId, item.price],
      );
      if (!res.rows[0]) throw new Error('insufficient');
      await tx.query(`INSERT INTO user_items (user_id, item_id) VALUES ($1, $2)`, [userId, itemId]);
      return Number(res.rows[0].coins);
    });
    return { ok: true, coins, item };
  } catch (e) {
    return { ok: false, reason: (e as Error).message === 'insufficient' ? 'Not enough coins' : 'Purchase failed' };
  }
}

export async function getUserItemIds(userId: string): Promise<string[]> {
  const rows = await query<{ item_id: string }>(`SELECT item_id FROM user_items WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.item_id);
}

export async function grantItem(userId: string, itemId: string): Promise<void> {
  await query(`INSERT INTO user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, itemId]);
}

// --- avatar preferences ------------------------------------------------------

export interface AvatarPrefs {
  sex: 'male' | 'female';
  hair: string;
  armor: string;
  helmet: string;
  cape: string;
  color: string;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeAvatar(p: unknown): AvatarPrefs {
  const v = (p ?? {}) as Record<string, unknown>;
  const sex = v.sex === 'female' ? 'female' : 'male';
  const s = (x: unknown, fallback: string) => (typeof x === 'string' && /^[a-z0-9_]{1,40}$/.test(x) ? x : fallback);
  return {
    sex,
    hair: s(v.hair, 'short'),
    armor: s(v.armor, 'tunic'),
    helmet: s(v.helmet, 'none'),
    cape: s(v.cape, 'none'),
    color: typeof v.color === 'string' && COLOR_RE.test(v.color) ? v.color.toLowerCase() : '#e8b43c',
  };
}

export async function getPreferences(userId: string): Promise<Record<string, unknown>> {
  const row = await queryOne<{ preferences: Record<string, unknown> }>(`SELECT preferences FROM users WHERE id = $1`, [userId]);
  return row?.preferences ?? {};
}

export async function setPreferences(userId: string, prefs: Record<string, unknown>): Promise<void> {
  await query(`UPDATE users SET preferences = $2::jsonb WHERE id = $1`, [userId, JSON.stringify(prefs)]);
}

// --- map config ---------------------------------------------------------------

export interface MapConfig {
  mode: 'fixed' | 'random_by_difficulty';
  fixedTheme: string;
}

export async function getGlobalMapConfig(): Promise<MapConfig> {
  const row = await queryOne<MapConfig>(`SELECT mode, fixed_theme AS "fixedTheme" FROM map_config WHERE scope = 'global'`);
  return row ?? { mode: 'random_by_difficulty', fixedTheme: 'dungeon' };
}

export async function setGlobalMapConfig(cfg: MapConfig): Promise<MapConfig> {
  await query(
    `UPDATE map_config SET mode = $2, fixed_theme = $3, updated_at = now() WHERE scope = 'global'`,
    ['global', cfg.mode, cfg.fixedTheme],
  );
  return cfg;
}

export async function getGuildMapSettings(guildId: string): Promise<{ theme?: string } | null> {
  const row = await queryOne<{ map_settings: { theme?: string } }>(`SELECT map_settings FROM guilds WHERE id = $1`, [guildId]);
  return row?.map_settings ?? null;
}

export async function setGuildMapTheme(guildId: string, theme: string | null): Promise<void> {
  await query(`UPDATE guilds SET map_settings = $2::jsonb WHERE id = $1`, [guildId, JSON.stringify(theme ? { theme } : {})]);
}
