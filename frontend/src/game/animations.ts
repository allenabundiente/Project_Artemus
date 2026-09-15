// Admin-managed sprite animation clips + extra uploaded sprite frames.
//
// Clips and custom sprite PNGs are stored server-side in Postgres and served
// through the API (GET /api/animations, GET /api/sprites/list, and
// GET /api/sprites/<name>.png), so admin-defined art survives deploys onto
// ephemeral filesystems. Each clip:
//   { name, frames: ['dragon_flap1', 'dragon_flap2', ...], fps, loop }
// The engine plays a clip on any patrol monster whose sprite slot matches the
// clip's name (or the slot starts with it).

import type { SpriteMap } from './sprites';
import { spriteApiUrl, spriteStaticUrl, refreshSpriteVersions } from './spriteVersions';

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

function toClips(raw: unknown): SpriteAnimation[] {
  if (!Array.isArray(raw)) return [];
  const out: SpriteAnimation[] = [];
  for (const a of raw as RawAnim[]) {
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
}

/** Fetch + validate admin animation clips. No clips / offline → no clips. */
export async function getAnimations(): Promise<SpriteAnimation[]> {
  try {
    const res = await fetch('/api/animations');
    if (res.ok) return toClips(await res.json());
  } catch {
    // fall through to the legacy static file
  }
  try {
    // Legacy local-dev source: public/sprites/animations.json (pre-DB era).
    const res = await fetch('/sprites/animations.json');
    if (!res.ok) return [];
    return toClips(await res.json());
  } catch {
    return []; // offline / no admin clips — static sprites are fine
  }
}

/**
 * Preload animation frames + custom uploaded PNGs that are not in the base
 * manifest (best-effort): images land in `sprites` so the engine can draw
 * them. Missing files are silently skipped — the engine falls back to the
 * built-in grid art.
 */
export async function loadExtraSprites(sprites: SpriteMap, preloaded?: SpriteAnimation[]): Promise<void> {
  const animations = preloaded ?? (await getAnimations());
  const wanted = [...new Set(animations.flatMap((a) => a.frames))].filter((f) => !sprites[f]);

  // Custom uploads live in the DB (served from /api/sprites/:name); everything
  // the static manifest covers was already loaded by loadSprites().
  let custom: string[] = [];
  try {
    const list = await refreshSpriteVersions();
    if (list) custom = list.sprites.filter((n) => typeof n === 'string' && !sprites[n] && !wanted.includes(n));
  } catch {
    // API unreachable — skip custom preloading entirely.
  }

  await Promise.all(
    [...new Set([...wanted, ...custom])].map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            sprites[name] = img;
            resolve();
          };
          img.onerror = () => {
            // No DB copy (e.g. a legacy disk-only upload in local dev) — try
            // the static file before giving up.
            const alt = new Image();
            alt.onload = () => {
              sprites[name] = alt;
              resolve();
            };
            alt.onerror = () => resolve(); // frame missing → engine falls back
            alt.src = spriteStaticUrl(name);
          };
          img.src = spriteApiUrl(name);
        }),
    ),
  );
}
