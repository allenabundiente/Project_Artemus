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
  /** Which monster sprites patrol the level, cycling by monster index. */
  monsters?: string[];
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
  torchPole: '#3a2a12',
  torchSconce: '#2a1f14',
};

export const THEMES: Theme[] = [DUNGEON, FOREST];

/** Resolve a theme id (URL param / setting) with a safe fallback. */
export function resolveTheme(id: string | null | undefined): Theme {
  if (!id) return DUNGEON;
  const t = THEMES.find((x) => x.id === id);
  if (!t) console.warn(`[themes] unknown theme "${id}" — using dungeon`);
  return t ?? DUNGEON;
}
