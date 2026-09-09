// Avatar compositor: builds the player sprite from layered, recolored parts.
// Layer order back-to-front: cape → body → armor → hair → helmet.
// Recoloring is hue-preserving and driven by the grid's own channels: 'H'
// (light garment zone) takes the chosen tint, 'h' (shade zone) takes a darker
// shade of it. Skin, metal, gold and outlines pass through untouched.

import type { SpriteMap } from './sprites';

export interface AvatarConfig {
  sex: 'male' | 'female';
  hair: string;
  armor: string;
  helmet: string;
  cape?: string; // optional 'none' default
  /** Base tint, #rrggbb. */
  color: string;
}

const ANIM_FRAMES = ['idle', 'run1', 'run2', 'jump'] as const;
export type AvatarFrame = (typeof ANIM_FRAMES)[number];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Darken an RGB triple toward the outline tone by mixing with dark brown. */
function shadeChannel([r, g, b]: [number, number, number], k: number): [number, number, number] {
  const mix = (c: number) => Math.round(c * k + 0x14 * (1 - k));
  return [mix(r), mix(g), mix(b)];
}

/**
 * Recolor a part's pixels toward `tint` based on its green-dominant chroma
 * channels (H = light zone → tint, h = shade zone → tint × 0.72). Everything
 * else keeps its authored palette color, so outlines stay dark and metal/gold
 * stay metallic regardless of the chosen banner color.
 */
function recolor(src: HTMLImageElement, tint: string, cacheKey: string): HTMLCanvasElement {
  const cached = recolorCache.get(cacheKey);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const [tr, tg, tb] = hexToRgb(tint);
  const [sr, sg, sb] = shadeChannel([tr, tg, tb], 0.72); // garment shade tone
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    if (g > 100 && g > r * 1.25 && g > b * 1.25) {
      // H — bright recolor zone
      d[i] = tr; d[i + 1] = tg; d[i + 2] = tb;
    } else if (g > 40 && g > r * 1.25 && g > b * 1.25) {
      // h — shade zone
      d[i] = sr; d[i + 1] = sg; d[i + 2] = sb;
    }
  }
  ctx.putImageData(img, 0, 0);
  recolorCache.set(cacheKey, cv);
  return cv;
}

const recolorCache = new Map<string, HTMLCanvasElement>();

/** Cache key prefix for a part image. */
function partSpriteName(frame: string, part: 'hair' | 'armor' | 'helmet' | 'cape', set: string, sex: string): string {
  return `avatar_${part}_${set}_${sex}_${frame}`;
}

/**
 * Compose one animation frame of the avatar into a fresh 16×16 canvas.
 * Missing optional parts are skipped, so the game never breaks while art for
 * a part is being added.
 */
export function composeAvatar(frame: AvatarFrame, cfg: AvatarConfig, sprites: SpriteMap): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const draw = (name: string, tint?: string) => {
    const img = sprites[name];
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.drawImage(tint ? recolor(img, tint, `${name}:${tint}`) : img, 0, 0);
  };

  // 1. cape (recolored, hangs behind everything)
  if (cfg.cape && cfg.cape !== 'none') draw(partSpriteName(frame, 'cape', cfg.cape, cfg.sex), cfg.color);
  // 2. body base — its default tunic uses the H channel, so it takes the tint
  draw(`avatar_body_${cfg.sex}_${frame}`, cfg.color);
  // 3. armor overlay (recolored where the art says H/h)
  draw(partSpriteName(frame, 'armor', cfg.armor, cfg.sex), cfg.color);
  // 4. hair (recolored)
  if (cfg.hair !== 'none') draw(partSpriteName(frame, 'hair', cfg.hair, cfg.sex), cfg.color);
  // 5. helmet (recolored)
  if (cfg.helmet !== 'none') draw(partSpriteName(frame, 'helmet', cfg.helmet, cfg.sex), cfg.color);

  return cv;
}
