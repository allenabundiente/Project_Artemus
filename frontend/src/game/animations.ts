// Admin-managed sprite animation clips + extra uploaded sprite frames.
//
// Clips are grouped from plain PNGs in public/sprites/ by the admin panel
// (backend/src/routes/admin.ts) and persisted as animations.json. Each clip:
//   { name, frames: ['dragon_flap1', 'dragon_flap2', ...], fps, loop }
// The engine plays a clip on any patrol monster whose sprite slot matches the
// clip's name (or the slot starts with it).

import type { SpriteMap } from './sprites';

export interface SpriteAnimation {
  name: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

interface RawAnim {
  name?: unknown;
  frames?: unknown;
  fps?: unknown;
  loop?: unknown;
}

/** Fetch + validate admin animation clips. Missing/empty file → no clips. */
export async function getAnimations(): Promise<SpriteAnimation[]> {
  try {
    const res = await fetch('/sprites/animations.json');
    if (!res.ok) return [];
    const raw = (await res.json()) as RawAnim[];
    if (!Array.isArray(raw)) return [];
    const out: SpriteAnimation[] = [];
    for (const a of raw) {
      if (
        typeof a?.name === 'string' &&
        Array.isArray(a.frames) &&
        a.frames.length > 0 &&
        a.frames.every((f) => typeof f === 'string') &&
        typeof a.fps === 'number' &&
        a.fps >= 1
      ) {
        out.push({ name: a.name, frames: [...a.frames], fps: Math.round(a.fps), loop: a.loop !== false });
      }
    }
    return out;
  } catch {
    return []; // offline / no admin clips — static sprites are fine
  }
}

/**
 * Preload animation frames + any uploaded PNGs that are not in the base
 * manifest (best-effort): images land in `sprites` so the engine can draw
 * them. Missing files are silently skipped.
 */
export async function loadExtraSprites(sprites: SpriteMap, preloaded?: SpriteAnimation[]): Promise<void> {
  let extra: string[] = [];
  const animations = preloaded ?? (await getAnimations());
  try {
    const res = await fetch('/sprites/manifest.json');
    if (res.ok) {
      const manifest = (await res.json()) as Record<string, { width: number; height: number }>;
      // Manifest slots already handled by loadSprites; anything on disk but
      // off-manifest (admin uploads like dragon_flap1) needs loading here.
      const listed = new Set(Object.keys(manifest));
      extra = animations.flatMap((a) => a.frames).filter((f) => !listed.has(f) && !sprites[f]);
    }
  } catch {
    extra = animations.flatMap((a) => a.frames).filter((f) => !sprites[f]);
  }

  await Promise.all(
    [...new Set(extra)].map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            sprites[name] = img;
            resolve();
          };
          img.onerror = () => resolve(); // frame missing → engine falls back
          img.src = `/sprites/${name}.png`;
        }),
    ),
  );
}
