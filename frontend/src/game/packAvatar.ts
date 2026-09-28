// Pack-character avatar: renders one of the buyable dungeon characters (the
// asset pack's other hero designs, public/dungeon/character2.png) anywhere a
// profile or player sprite renders. The classic layered wardrobe continues to
// serve the default 'knight' skin, which stays free for everyone.
//
//   composePackCharacterFrame() → 16×16 canvas (idle / run / hurt / dead)
//   packAvatarDataUrl()         → ready-to-use <img src> for profiles
//
// Ownership guard: skins are shop items (`skin_<id>` SKUs). When sprites load
// we ask the backend which skins the user owns and clear any unowned choice —
// so editing preferences elsewhere, or an old tab, can never keep wearing a
// skin that was never bought.

import type { AvatarPrefs } from '../types';
import { loadDungeonAssets, findDungeonCharacter, type LoadedDungeonAssets } from './dungeonAssets';

export type PackFrame = 'idle' | 'run1' | 'run2' | 'run3' | 'run4' | 'jump' | 'hurt' | 'dead';

let assetsPromise: Promise<LoadedDungeonAssets | null> | null = null;

/** The pack, loaded once and shared by every pack-character render. */
export function packAssetsOnce(): Promise<LoadedDungeonAssets | null> {
  assetsPromise ??= loadDungeonAssets();
  return assetsPromise;
}

/** The avatar's chosen pack skin, or null for the default (free) knight. */
export function activeCharacter(avatar?: unknown): string | null {
  const c = (avatar as { character?: string } | null | undefined)?.character;
  return c && c !== 'none' && c !== 'knight' ? c : null;
}

/** [walk, jump] canvases for a skin id, or null for the default knight. */
export async function characterPoses(id: string): Promise<[HTMLCanvasElement, HTMLCanvasElement] | null> {
  if (!findDungeonCharacter(id)) return null;
  const pack = await packAssetsOnce();
  return pack?.chars.get(id) ?? null;
}

/**
 * One animation frame of a pack character. Walk frames alternate between the
 * sheet's two poses; hurt/dead tint the silhouette crimson so damage reads
 * exactly like the classic avatar's hit-flash.
 */
export function composePackCharacterFrame(
  frame: PackFrame,
  characterId: string,
  pack: LoadedDungeonAssets,
  facingLeft = false,
): HTMLCanvasElement | null {
  const poses = pack.chars.get(characterId);
  if (!poses) return null;
  const pose = frame === 'run2' || frame === 'run4' || frame === 'jump' ? poses[1] : poses[0];
  if (!facingLeft) return pose;
  const m = document.createElement('canvas');
  m.width = 16;
  m.height = 16;
  const ctx = m.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(16, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(pose, 0, 0);
  return m;
}

/** A crimson-tinted copy of the character frame (hurt / dead flash). */
export function tintPackCharacter(src: HTMLCanvasElement, color = '#ff004d'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

const urlCache = new Map<string, string>();

/** PNG data URL of a pack character's idle frame — for profile chips and shop cards. */
export async function packAvatarDataUrl(characterId: string, size = 48): Promise<string | null> {
  const key = `${characterId}:${size}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const poses = await characterPoses(characterId);
  if (!poses) return null;
  const url = poses[0].toDataURL();
  urlCache.set(key, url);
  return url;
}

// --- ownership guard -----------------------------------------------------------

let guardInFlight = false;

/**
 * Fire-and-forget ownership check: fetches the shop catalog + owned items and,
 * if `avatar.character` names a skin the user has not bought, patches it back
 * to the default knight via the normal wardrobe save. Runs once per page load
 * (re-run after each purchase to re-check immediately).
 */
export async function enforceSkinOwnership(avatar: AvatarPrefs, save: (a: AvatarPrefs) => Promise<void> | void): Promise<void> {
  if (!activeCharacter(avatar) || guardInFlight) return;
  guardInFlight = true;
  try {
    const api = await import('../api');
    const [shop, wardrobe] = await Promise.all([api.getShop(), api.getWardrobe()]);
    const id = activeCharacter(avatar)!;
    const owned = shop.owned.includes(`skin_${id}`) || wardrobe.unlockedSkins?.includes(id);
    if (!owned) await save({ ...avatar, character: 'none' });
  } catch {
    /* shop unreachable — keep the current look */
  } finally {
    guardInFlight = false;
  }
}
