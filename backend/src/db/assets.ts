// Admin-uploaded assets (sprite PNGs, animation clips, custom map themes) live
// in Postgres, not on disk: deployment platforms like Render wipe local writes
// on every deploy, so the database is the source of truth. Disk writes remain
// only as a best-effort mirror for local development.
//
// One-time legacy import: if a pre-existing deployment had custom themes on
// disk (backend/data/custom-themes.json), they are pulled into the DB here and
// the file is removed. Import only proceeds when the DB has no themes yet, so
// a rollback to older code still finds the disk file intact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, queryOne, execute } from './db.js';

export type AdminAssetKind = 'sprite' | 'animations' | 'themes';

/** DB key for an asset ('sprite:dragon_flap1', 'animations', 'themes:custom'). */
export function assetKey(kind: AdminAssetKind, name?: string): string {
  return kind === 'sprite' ? `sprite:${name}` : kind === 'animations' ? 'animations' : 'themes:custom';
}

export interface StoredSprite {
  bytes: Buffer;
  mime: string;
  /** Content version — bumped on every write; feeds ETags + ?v= cache busting. */
  version: number;
}

export async function putSprite(name: string, bytes: Buffer, mime = 'image/png'): Promise<void> {
  await query(
    `INSERT INTO admin_assets (key, mime, bytes, size, version) VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, size = EXCLUDED.size,
       version = admin_assets.version + 1, updated_at = now()`,
    [assetKey('sprite', name), mime, bytes, bytes.length],
  );
}

export async function getSprite(name: string): Promise<StoredSprite | null> {
  const row = await queryOne<{ mime: string; bytes: Buffer; version: number }>(
    `SELECT mime, bytes, version FROM admin_assets WHERE key = $1`,
    [assetKey('sprite', name)],
  );
  if (!row?.bytes) return null;
  return { bytes: Buffer.from(row.bytes), mime: row.mime, version: Number(row.version ?? 1) };
}

/** Content version of one sprite (null = no custom art stored). */
export async function getSpriteVersion(name: string): Promise<number | null> {
  const row = await queryOne<{ version: number }>(
    `SELECT version FROM admin_assets WHERE key = $1`,
    [assetKey('sprite', name)],
  );
  return row ? Number(row.version) : null;
}

/** name → content version for every custom sprite (drives ?v= cache busting). */
export async function listSpriteVersions(): Promise<Record<string, number>> {
  const rows = await query<{ key: string; version: number }>(
    `SELECT key, version FROM admin_assets WHERE key LIKE 'sprite:%'`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key.slice('sprite:'.length)] = Number(r.version);
  return out;
}

export async function deleteSprite(name: string): Promise<boolean> {
  const affected = await execute(`DELETE FROM admin_assets WHERE key = $1`, [assetKey('sprite', name)]);
  return affected > 0;
}

export async function listSpriteNames(): Promise<string[]> {
  const rows = await query<{ key: string }>(`SELECT key FROM admin_assets WHERE key LIKE 'sprite:%' ORDER BY key`);
  return rows.map((r) => r.key.slice('sprite:'.length));
}

export async function getJson(kind: 'animations' | 'themes'): Promise<unknown | null> {
  const row = await queryOne<{ json: unknown }>(
    `SELECT json FROM admin_assets WHERE key = $1`,
    [assetKey(kind)],
  );
  return row?.json ?? null;
}

export async function putJson(kind: 'animations' | 'themes', value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await query(
    `INSERT INTO admin_assets (key, mime, json, size, version) VALUES ($1, 'application/json', $2::jsonb, $3, 1)
     ON CONFLICT (key) DO UPDATE SET json = EXCLUDED.json, size = EXCLUDED.size,
       version = admin_assets.version + 1, updated_at = now()`,
    [assetKey(kind), text, Buffer.byteLength(text)],
  );
}

export async function hasJson(kind: 'animations' | 'themes'): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(`SELECT 1 AS ok FROM admin_assets WHERE key = $1`, [assetKey(kind)]);
  return !!row;
}

/**
 * Boot-time fallback import of disk-era custom themes. Only runs when the DB
 * has no custom themes yet; the disk file is removed only after a successful
 * import so a rollback to pre-0008 code still finds its file.
 */
export async function importLegacyThemesFromDisk(): Promise<void> {
  try {
    if (await hasJson('themes')) return;
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/custom-themes.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return;
    await putJson('themes', parsed);
    fs.rmSync(file, { force: true });
    console.log('[assets] imported disk-era custom themes into the database');
  } catch {
    // No legacy file or DB not reachable yet — either is fine.
  }
}
