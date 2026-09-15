// Runtime loading of admin-managed sprite extras:
//   • custom frame PNGs uploaded through the admin Sprite Vault (they are not
//     in the canonical grids, so the base loader never saw them)
//   • named animation clips registered in the admin Animations manager,
//     persisted to public/sprites/animations.json, e.g.
//       [{ name: 'dragon_flap', frames: ['dragon_flap1','dragon_flap2'], fps: 8, loop: true }]
//
// Animation playback lives in the engine: a monster whose sprite slot matches
// an animation name plays that clip instead of the static PNG.

import type { SpriteMap } from './sprites';

/** One registered animation clip. */
export interface SpriteAnimation {
  name: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

let animCache: SpriteAnimation[] | null = null;

/**
 * Fetch animations.json (admin-managed). Returns [] when absent or corrupt —
 * a missing file is the normal state for a stock checkout, never an error.
 */
export async function getAnimations(): Promise<SpriteAnimation[]> {
  if (animCache) return animCache;
  try {
    const res = await fetch('/sprites/animations.json', { cache: 'no-store' });
    if (!res.ok) {
      animCache = [];
      return animCache;
    }
    const parsed = (await res.json()) as unknown;
    animCache = Array.isArray(parsed)
      ? parsed.filter(
          (a): a is SpriteAnimation =>
            !!a && typeof (a as SpriteAnimation).name === 'string' &&
            Array.isArray((a as SpriteAnimation).frames) &&
            (a as SpriteAnimation).frames.length > 0,
        )
      : [];
  } catch {
    animCache = [];
  }
  return animCache;
}/**
 * Load any manifest-listed sprite not already in `map` (i.e. custom uploads
 * beyond the canonical grids). Missing files are skipped silently — the
 * engine falls back per-slot.
 *
 * Slots already present in `map` are RE-fetched with cache-busting: the admin
 * may have uploaded a new PNG for a canonical slot (Theme Forge sprite swap)
 * since `map` was built, and `loadSprites` never re-checks the disk.
 */
export async function loadExtraSprites(map: SpriteMap): Promise<number> {
  let loaded = 0;
  try {
    const res = await fetch('/sprites/manifest.json', { cache: 'no-store' });
    if (!res.ok) return 0;
    const manifest = (await res.json()) as Record<string, { width: number; height: number }>;
    const bust = Date.now().toString(36);
    await Promise.all(
      Object.keys(manifest).map(
        (slot) =>
          new Promise<void>((resolve) => {
            const hadSlot = Boolean(map[slot]);
            const img = new Image();
            img.onload = () => {
              // Keep grid-rendered data: fallbacks (the PNG is missing on disk,
              // so the busted fetch above must have hit an old cache entry);
              // everything else gets the freshest bytes from the server.
              if (hadSlot && map[slot].src.startsWith('data:')) return resolve();
              if (map[slot] === img) return resolve();
              map[slot] = img;
              loaded += 1;
              resolve();
            };
            img.onerror = () => resolve(); // slot stays absent; engine falls back
            // Cache-bust only re-checks (slots already in the map); brand-new
            // slots have no cached entry to bust.
            img.src = hadSlot ? `/sprites/${slot}.png?${bust}` : `/sprites/${slot}.png`;
          }),
      ),
    );
  } catch {
    /* no manifest — nothing extra to load */
  }
  return loaded;
}
