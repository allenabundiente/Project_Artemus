// Shared dungeon layout helpers: the deterministic pillar scatter used by the
// live engine, and a spawn search consistent with it. Extracted so the teacher
// map editor renders the same pillars (and can reason about the same blocked
// tiles) as gameplay, from one copy of the rules.

import type { DungeonEvent } from '../types';

export interface DungeonDims {
  width: number;
  height: number;
}

const PILLAR_CHANCE = 0.1;

/** Deterministic per-event-id mix into the scatter seed. */
function eventSeed(events: DungeonEvent[]): number {
  let seed = 0x9e37;
  for (const e of events) {
    for (const ch of e.event_id) seed = (Math.imul(31, seed) + ch.charCodeAt(0)) | 0;
  }
  return seed;
}

function mulberry(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  };
}

/** Tiles the layout rules keep clear: spawn corner, event tiles, exit portal. */
export function blockedTiles(dims: DungeonDims, events: DungeonEvent[]): Set<string> {
  const blocked = new Set<string>();
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) blocked.add(`${1 + dx},${1 + dy}`);
  for (const e of events) blocked.add(`${e.grid_position.x},${e.grid_position.y}`);
  blocked.add(`${dims.width - 2},${dims.height - 2}`);
  return blocked;
}

/**
 * True when the deterministic layout puts a pillar at (x, y) for this map —
 * identical to the live engine's scatter. Border walls are not pillars.
 */
export function dungeonPillarAt(dims: DungeonDims, events: DungeonEvent[], x: number, y: number): boolean {
  if (x < 2 || y < 2 || x >= dims.width - 1 || y >= dims.height - 1) return false;
  if (blockedTiles(dims, events).has(`${x},${y}`)) return false;
  // Consume the generator in row-major order up to (x, y) — the engine walks
  // the same sequence, so this matches its scatter exactly.
  const rand = mulberry(eventSeed(events));
  for (let yy = 2; yy <= y; yy++) {
    const xxMax = yy < y ? dims.width - 1 : x;
    for (let xx = 2; xx <= xxMax; xx++) {
      if (blockedTiles(dims, events).has(`${xx},${yy}`)) continue;
      if (yy === y && xx === x) return rand() < PILLAR_CHANCE;
      rand();
    }
  }
  return false;
}

/**
 * First floor tile (spiral out from the classic top-left spawn) that keeps
 * 1.5 tiles of clearance from every event and avoids pillar tiles — the same
 * rule the live engine uses to seat the hero.
 */
export function findSpawnTile(dims: DungeonDims, events: DungeonEvent[]): { x: number; y: number } {
  const pillar = (x: number, y: number) => dungeonPillarAt(dims, events, x, y);
  const clear = (tx: number, ty: number): boolean =>
    tx > 0 && ty > 0 && tx < dims.width - 1 && ty < dims.height - 1 &&
    !pillar(tx, ty) &&
    events.every((e) => Math.hypot(e.grid_position.x - tx, e.grid_position.y - ty) >= 1.5);
  if (clear(1, 1)) return { x: 1, y: 1 };
  for (let r = 1; r < Math.max(dims.width, dims.height); r++) {
    for (let y = Math.max(1, 1 - r); y <= Math.min(dims.height - 2, 1 + r); y++) {
      for (let x = Math.max(1, 1 - r); x <= Math.min(dims.width - 2, 1 + r); x++) {
        if (Math.hypot(x - 1, y - 1) <= r + 0.5 && clear(x, y)) return { x, y };
      }
    }
  }
  return { x: 1, y: 1 };
}
