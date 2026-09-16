// Map theme registry. The engine reads ALL of its scenery colors from here,
// so adding a whole new look for a level is a matter of appending one Theme
// block to THEMES — zero engine code changes. A theme can also swap any
// sprite slot for its own PNG via `spriteOverrides` (slot → filename in
// public/sprites/, same name as in the manifest).
//
// Test a theme live by opening a quest with ?theme=<id> in the URL:
//   http://localhost:5173/?theme=forest

export interface Theme {
  /** Stable id — used in URLs (?theme=forest) and settings. */
  id: string;
  /** Human-readable name shown in pickers. */
  name: string;
  /** Backdrop sky fill. */
  sky: string;
  /** Star/firefly dots color (1px dots, upper 70px). */
  stars: string;
  /** Distant parallax silhouette layer (castles/rooftops/hills). */
  farHills: string;
  /** Near parallax layer (forest/rocks). */
  nearHills: string;
  /** Pit darkness. */
  pit: string;
  /** 4px walkable floor lip. */
  floorTop: string;
  /** Floor body under the lip. */
  floorBody: string;
  /** 4x2 speckles scattered on the floor. */
  floorSpeckle: string;
  /** Monster HP pips. */
  hpFilled: string;
  hpEmpty: string;
  /** Standing torch hardware (defaults: dark wood pole, iron sconce). */
  torchPole?: string;
  torchSconce?: string;
  /** Particle bursts. Defaults keep the classic green/gold. */
  particleHit?: string;
  particleScore?: string;
  /** Run-footfall dust puff color (defaults to a warm floor-dust tone). */
  dustColor?: string;
  /** Which monster sprites patrol the level, cycling by monster index. */
  monsters?: string[];
  /**
   * End-of-level boss sprite slot. Defaults to the dungeon brute ('boss')
   * when unset — themed maps swap in their own tyrant (the caldera's giant
   * lava dragon, etc.). Battles render its art + roster name.
   */
  boss?: string;
  /**
   * Sprite-slot overrides: slot name → PNG filename (from the manifest) that
   * replaces it in this theme — e.g. { castle_gate: 'exit_crystal' }.
   */
  spriteOverrides?: Record<string, string>;
}

export const DUNGEON: Theme = {
  id: 'dungeon',
  name: 'Dungeon Night',
  sky: '#2a1f2e',
  stars: '#f2e8d5',
  farHills: '#4f2a25',
  nearHills: '#3f5d3a',
  pit: '#000000',
  floorTop: '#8b5a2b',
  floorBody: '#5c554e',
  floorSpeckle: '#706a62',
  hpFilled: '#a82a2a',
  hpEmpty: '#5c554e',
};

export const FOREST: Theme = {
  id: 'forest',
  name: 'Firefly Glade',
  sky: '#1c2a1c',
  stars: '#cdeab0',
  farHills: '#2c4226',
  nearHills: '#4a6b3a',
  pit: '#08120a',
  floorTop: '#6f4a1f',
  floorBody: '#3a2c22',
  floorSpeckle: '#4f3a2b',
  hpFilled: '#a82a2a',
  hpEmpty: '#4f3a2b',
  particleHit: '#8fdc4a',
  dustColor: 'rgba(122, 150, 96, 0.7)', // mossy glade dust
  torchPole: '#3a2a12',
  torchSconce: '#2a1f14',
};

export const LAVA: Theme = {
  id: 'lava',
  name: 'Volcano Caldera',
  sky: '#1c0b08',
  stars: '#ffb26b', // drifting embers, not stars
  farHills: '#4a1410', // distant volcano ridges
  nearHills: '#2e0d0a', // cooled black-rock slope
  pit: '#150302', // fissure darkness
  floorTop: '#e2531f', // molten crust lip
  floorBody: '#3a120c', // charred rock body
  floorSpeckle: '#5a1814', // cooled lava crust speckle
  hpFilled: '#a82a2a',
  hpEmpty: '#5a1814',
  particleHit: '#ffd21e', // molten sparks
  particleScore: '#ff9d3a', // ember bursts
  dustColor: 'rgba(255, 157, 58, 0.55)', // kicked-up embers
  torchPole: '#2e1209',
  torchSconce: '#1f0d06',
  // The caldera's own bestiary: ember imps and lava dragons (canonical
  // sprites with grid fallbacks, so they render even if a PNG goes missing).
  monsters: ['enemy_ember', 'lava_dragon', 'enemy_ember', 'enemy_slime'],
  // The gate to the caldera's heart wakes the giant lava dragon.
  boss: 'lava_dragon_boss',
};

export const THEMES: Theme[] = [DUNGEON, FOREST, LAVA];

/**
 * Register admin-defined custom themes (fetched from /api/themes) into the
 * runtime registry. Built-ins can never be replaced; a re-registration with
 * the same id updates the existing custom theme in place.
 */
export function registerCustomThemes(list: ({ id: string; name: string } & Partial<Theme>)[]): void {
  for (const raw of list) {
    if (!raw?.id || ['dungeon', 'forest', 'lava'].includes(raw.id)) continue;
    const theme: Theme = {
      id: raw.id,
      name: raw.name ?? raw.id,
      sky: raw.sky ?? DUNGEON.sky,
      stars: raw.stars ?? DUNGEON.stars,
      farHills: raw.farHills ?? DUNGEON.farHills,
      nearHills: raw.nearHills ?? DUNGEON.nearHills,
      pit: raw.pit ?? DUNGEON.pit,
      floorTop: raw.floorTop ?? DUNGEON.floorTop,
      floorBody: raw.floorBody ?? DUNGEON.floorBody,
      floorSpeckle: raw.floorSpeckle ?? DUNGEON.floorSpeckle,
      hpFilled: raw.hpFilled ?? DUNGEON.hpFilled,
      hpEmpty: raw.hpEmpty ?? DUNGEON.hpEmpty,
      torchPole: raw.torchPole ?? DUNGEON.torchPole,
      torchSconce: raw.torchSconce ?? DUNGEON.torchSconce,
      particleHit: raw.particleHit,
      particleScore: raw.particleScore,
      dustColor: raw.dustColor,
      monsters: Array.isArray(raw.monsters) && raw.monsters.length > 0 ? raw.monsters : undefined,
      boss: typeof raw.boss === 'string' && raw.boss.trim() ? raw.boss.trim() : undefined,
      spriteOverrides: raw.spriteOverrides,
    };
    const i = THEMES.findIndex((t) => t.id === theme.id);
    if (i >= 0) THEMES[i] = theme;
    else THEMES.push(theme);
  }
}

/**
 * Fetch + register custom themes from the backend. Best-effort: on any failure
 * the game proceeds with built-ins only.
 */
export async function loadCustomThemes(): Promise<void> {
  try {
    let token: string | null = null;
    try {
      token = localStorage.getItem('arcade-token');
    } catch {
      token = null;
    }
    const res = await fetch('/api/themes', token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    if (!res.ok) return;
    const data = (await res.json()) as { themes?: ({ id: string; name: string; builtin?: boolean } & Partial<Theme>)[] };
    if (Array.isArray(data.themes)) {
      const custom = data.themes.filter((t) => t && !t.builtin && typeof t.id === 'string' && typeof t.name === 'string');
      registerCustomThemes(custom as ({ id: string; name: string } & Partial<Theme>)[]);
    }
  } catch {
    /* offline / not logged in — built-ins are enough */
  }
}

/** Resolve a theme id (URL param / setting) with a safe fallback. */
export function resolveTheme(id: string | null | undefined): Theme {
  if (!id) return DUNGEON;
  const t = THEMES.find((x) => x.id === id);
  if (!t) console.warn(`[themes] unknown theme "${id}" — using dungeon`);
  return t ?? DUNGEON;
}
