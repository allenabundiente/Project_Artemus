// Top-down dungeon engine ("The Depths").
//
// A 16×16-tile grid dungeon rendered on the same canvas stack as the classic
// side-scroller, but navigated in 4 directions (WASD/arrows + touch d-pad).
// The map JSON (monster_gate / rune_socket / chest_lock events, plus optional
// trap tiles) comes from the backend generator. Touching an event pauses the
// sim and fires a callback — the engine knows nothing about React.
//
// Rendering layers (blueprint §4):
//   layer 0  cobblestone floors (non-collidable)          — dungeonTileset
//   layer 1  walls, pillars, spike traps, portal, event
//            markers, hero                                 — dungeonTileset
//   layer 2  torch flames (overhead) + vignette            — drawn last
//
// Combo system (blueprint §2): correct answers charge the SURGE gauge. While
// it glows the hero sprints AND wears a shield field that lets them pass
// spike traps unharmed. A wrong answer (or a trap hit without the shield)
// drains the gauge and costs a heart. Spike traps never disappear — a charged
// runner can weave through them; an unshielded walker must route around.
//
// Layout: border walls, scattered pillars, an exit portal that unlocks once
// SURGE_KEYS_REQUIRED events are cleared (any cleared event drops a key, so a
// player can rush the exit after 3 clears but misses the completion bonus).

import { sfx } from './sfx';
import { tileCanvas } from './dungeonTileset';
import { loadDungeonAssets, packFrame, type LoadedDungeonAssets } from './dungeonAssets';
import { dungeonPillarAt, blockedTiles as sharedBlockedTiles, findSpawnTile as sharedSpawnTile } from './dungeonLayout';
import { activeCharacter, composePackCharacterFrame, tintPackCharacter } from './packAvatar';
import type { AvatarPrefs, DungeonEvent, DungeonMap } from '../types';

export const DUNGEON_GRID = 16;
/** Render scale: 16×16 tiles on the canvas → CSS-scaled with pixelated rendering. */
export const DUNGEON_TILE = 16;

export interface DungeonEngineCallbacks {
  /** Player stepped onto an uncleared event — open its dialog (engine pauses). */
  onEventEncounter(event: DungeonEvent, eventId: string): void;
  /** Every required key collected (or all events cleared) → portal open. */
  onPortalOpen(): void;
  /** Player reached the open portal → quest complete. */
  onExit(): void;
  /** HUD state changed (lives/score/surge/keys). */
  onStateChange(state: { lives: number; score: number; surge: number; keys: number }): void;
  /** Out of hearts → game over. */
  onGameOver(): void;
}

export interface DungeonPlayerState {
  tx: number;
  ty: number;
  facing: 'up' | 'down' | 'left' | 'right';
}

type TileKind = 'floor' | 'wall' | 'pillar';

interface PlacedEvent {
  event: DungeonEvent;
  tx: number;
  ty: number;
  cleared: boolean;
  /** Animation phase for the marker (bob/pulse). */
  t: number;
}

const PLAYER_SPEED = 84; // px/s — brisk but controllable on a 16px grid
const SURGE_MAX = 100;
const SURGE_PER_HIT = 34;
const SURGE_DECAY_PER_SEC = 4.5;
const SURGE_SPEED_MULT = 1.55;
/** Keys needed to open the exit portal (completion bonus needs ALL events). */
const KEYS_REQUIRED = 3;
const START_LIVES = 3;
/** Invulnerability window after a spike-trap hit (seconds). */
const TRAP_COOLDOWN = 1.2;
/** Duration of the red hurt-flash on the hero (seconds). */
const HURT_FLASH_SEC = 0.35;

export class DungeonEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: DungeonMap;
  private renderScale: number;
  private cb: DungeonEngineCallbacks;

  private cols: number;
  private rows: number;
  private tiles: TileKind[] = [];
  private events: PlacedEvent[] = [];
  /** Spike-trap tile indices (walkable, hazardous unless shielded). */
  private traps: Set<number> = new Set();
  /** Wall tiles decorated with a torch sconce (rendered overhead). */
  private torches: { x: number; y: number }[] = [];
  private mirrorCache = new Map<string, HTMLCanvasElement>();
  private mirrorCanvases = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  /** Real asset pack (tileset atlas + per-frame sprites); null → authored-grid fallback. */
  private assets: LoadedDungeonAssets | null = null;
  /** Wardrobe prefs — `character` picks the equipped pack skin, if any. */
  private avatar?: AvatarPrefs;

  // player position in pixels (center-based)
  private px = 0;
  private py = 0;
  private facing: 'up' | 'down' | 'left' | 'right' = 'down';
  private animT = 0;
  private moving = false;

  private lives = START_LIVES;
  private score = 0;
  private surge = 0;
  private surgeActive = false;
  private keys = 0;
  private portalOpen = false;
  private clearedCount = 0;
  private trapCooldown = 0;
  private lastShieldTile = -1;
  /** Seconds left in the red hurt-flash after taking damage. */
  private hurtT = 0;

  private particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string }[] = [];
  private running = false;
  private paused = false;
  private lastT = 0;
  private time = 0;
  private keysDown: Set<string> = new Set();
  private touch: { up: boolean; down: boolean; left: boolean; right: boolean } = { up: false, down: false, left: false, right: false };
  /** Set while a dialog handles an event; the tile keeps pulsing. */
  private activeEventId: string | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    map: DungeonMap,
    cb: DungeonEngineCallbacks,
    opts?: { renderScale?: number },
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.map = map;
    this.renderScale = opts?.renderScale ?? 2;
    this.cb = cb;
    this.cols = Math.max(8, Math.min(32, map.map_dimensions.width || DUNGEON_GRID));
    this.rows = Math.max(8, Math.min(32, map.map_dimensions.height || DUNGEON_GRID));
    canvas.width = this.cols * DUNGEON_TILE * this.renderScale;
    canvas.height = this.rows * DUNGEON_TILE * this.renderScale;
    this.ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    this.buildLayout();
  }

  // --- layout ----------------------------------------------------------------

  private buildLayout(): void {
    this.tiles = new Array(this.cols * this.rows).fill('floor');
    const set = (x: number, y: number, k: TileKind) => {
      if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.tiles[y * this.cols + x] = k;
    };
    // Border walls.
    for (let x = 0; x < this.cols; x++) { set(x, 0, 'wall'); set(x, this.rows - 1, 'wall'); }
    for (let y = 0; y < this.rows; y++) { set(0, y, 'wall'); set(this.cols - 1, y, 'wall'); }
    // Exit portal sits bottom-right.
    const portalX = this.cols - 2;
    const portalY = this.rows - 2;
    const blocked = sharedBlockedTiles(this.map.map_dimensions, this.map.dungeon_events);
    // Deterministic pillar scatter (seeded by event ids so revisits match) —
    // the shared rules the map editor previews (dungeonLayout.ts).
    for (let y = 2; y < this.rows - 1; y++) {
      for (let x = 2; x < this.cols - 1; x++) {
        if (blocked.has(`${x},${y}`)) continue;
        if (dungeonPillarAt(this.map.map_dimensions, this.map.dungeon_events, x, y)) set(x, y, 'pillar');
      }
    }
    // Seal the corners around the portal so it reads as a chamber.
    set(portalX - 1, portalY + 1, 'wall');
    set(portalX + 1, portalY - 1, 'wall');

    // Spike traps (blueprint: pass physical traps with the surge shield).
    // Map-provided traps win; the rest of the floor gets a deterministic
    // sprinkle so unshielded players have real routing decisions.
    this.traps.clear();
    const trapCandidates: { x: number; y: number }[] = [];
    const provided = (this.map as DungeonMap & { traps?: { x: number; y: number }[] }).traps ?? [];
    for (const t of provided) {
      const tx = Math.round(t.x);
      const ty = Math.round(t.y);
      if (tx < 1 || ty < 1 || tx > this.cols - 2 || ty > this.rows - 2) continue;
      if (blocked.has(`${tx},${ty}`)) continue;
      const idx = ty * this.cols + tx;
      if (!this.traps.has(idx)) {
        this.traps.add(idx);
        blocked.add(`${tx},${ty}`);
      }
    }
    for (let y = 2; y < this.rows - 1; y++) {
      for (let x = 2; x < this.cols - 1; x++) {
        if (blocked.has(`${x},${y}`)) continue;
        trapCandidates.push({ x, y });
      }
    }
    for (const c of trapCandidates) {
      if (this.traps.size >= 10) break;
      if (Math.random() < 0.05) {
        this.traps.add(c.y * this.cols + c.x);
        blocked.add(`${c.x},${c.y}`);
      }
    }

    // Torch sconces along the border walls (every 5th tile, rendered overhead).
    this.torches = [];
    for (let x = 4; x < this.cols - 2; x += 5) {
      this.torches.push({ x, y: 0 });
      this.torches.push({ x, y: this.rows - 1 });
    }
    for (let y = 4; y < this.rows - 2; y += 5) {
      this.torches.push({ x: 0, y });
      this.torches.push({ x: this.cols - 1, y });
    }

    // Place events (validator guarantees in-bounds, non-overlapping).
    this.events = this.map.dungeon_events.map((e) => ({
      event: e,
      tx: Math.max(1, Math.min(this.cols - 2, e.grid_position.x)),
      ty: Math.max(1, Math.min(this.rows - 2, e.grid_position.y)),
      cleared: false,
      t: Math.random() * Math.PI * 2,
    }));

    // Spawn far from any event — landing on a marker the instant the floor
    // loads would open a dialog before the player has moved once (shared rule
    // with the editor preview, dungeonLayout.ts).
    const spawn = sharedSpawnTile(this.map.map_dimensions, this.map.dungeon_events);
    this.px = spawn.x * DUNGEON_TILE + DUNGEON_TILE / 2;
    this.py = spawn.y * DUNGEON_TILE + DUNGEON_TILE / 2;
  }

  private tileAt(tx: number, ty: number): TileKind {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return 'wall';
    return this.tiles[ty * this.cols + tx];
  }

  private isWalkable(px: number, py: number): boolean {
    // Circle-vs-tile: check the four corners of the player's box.
    const half = 5;
    for (const [ox, oy] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
      const tx = Math.floor((px + ox) / DUNGEON_TILE);
      const ty = Math.floor((py + oy) / DUNGEON_TILE);
      if (this.tileAt(tx, ty) !== 'floor') return false;
    }
    return true;
  }

  // --- lifecycle ---------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    requestAnimationFrame(this.rafLoop);
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.touch = { up: false, down: false, left: false, right: false };
  }

  setTouchInput(t: Partial<{ up: boolean; down: boolean; left: boolean; right: boolean }>): void {
    this.touch = { ...this.touch, ...t };
  }

  clearTouchInput(): void {
    this.touch = { up: false, down: false, left: false, right: false };
  }

  /**
   * Attach the loaded asset pack. Until (and unless) this resolves the engine
   * renders the authored grids from dungeonTileset.ts, so the game is always
   * playable even when /dungeon/*.png is unavailable.
   */
  async useAssets(): Promise<void> {
    this.assets = await loadDungeonAssets();
  }

  /** Equip the wardrobe look; the `character` field picks a pack skin. */
  setAvatar(avatar?: AvatarPrefs): void {
    this.avatar = avatar;
  }

  /** Player takes one damage (wrong answer at a gate / trap without shield). */
  damage(): void {
    this.lives -= 1;
    this.surge = 0;
    this.surgeActive = false;
    this.hurtT = HURT_FLASH_SEC;
    this.cb.onStateChange({ lives: this.lives, score: this.score, surge: this.surge, keys: this.keys });
    sfx.hit();
    this.burst(this.px, this.py, 10, '#ff6b6b');
    if (this.lives <= 0) {
      this.cb.onGameOver();
    }
  }

  /**
   * The dialog for `eventId` was WON: clear the event, award points, charge
   * surge, drop a key. The engine resumes; the marker becomes a trophy.
   */
  clearEvent(eventId: string): void {
    const placed = this.events.find((e) => e.event.event_id === eventId);
    if (!placed || placed.cleared) return;
    placed.cleared = true;
    this.clearedCount += 1;
    this.activeEventId = null;
    this.score += 120;
    this.keys += 1;
    this.surge = Math.min(SURGE_MAX, this.surge + SURGE_PER_HIT);
    if (this.surge >= SURGE_MAX) this.surgeActive = true;
    sfx.coin();
    this.burst(placed.tx * DUNGEON_TILE + DUNGEON_TILE / 2, placed.ty * DUNGEON_TILE + DUNGEON_TILE / 2, 18, '#ffd76a');
    this.refreshPortal();
    this.cb.onStateChange({ lives: this.lives, score: this.score, surge: this.surge, keys: this.keys });
  }

  /** The dialog was lost/retreated: damage + resume away from the tile. */
  failEvent(_eventId: string): void {
    this.activeEventId = null;
    this.damage();
  }

  getLives(): number {
    return this.lives;
  }

  getScore(): number {
    return this.score;
  }

  getClearedCount(): number {
    return this.clearedCount;
  }

  getTotalEvents(): number {
    return this.events.length;
  }

  /** Completion = every event cleared when the player exits. */
  isFlawless(): boolean {
    return this.clearedCount === this.events.length && this.lives === START_LIVES;
  }

  private refreshPortal(): void {
    if (!this.portalOpen && (this.keys >= KEYS_REQUIRED || this.clearedCount === this.events.length)) {
      this.portalOpen = true;
      sfx.bossRoar();
      this.cb.onPortalOpen();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.paused) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private get input(): { up: boolean; down: boolean; left: boolean; right: boolean } {
    const k = this.keysDown;
    return {
      up: k.has('ArrowUp') || k.has('KeyW') || this.touch.up,
      down: k.has('ArrowDown') || k.has('KeyS') || this.touch.down,
      left: k.has('ArrowLeft') || k.has('KeyA') || this.touch.left,
      right: k.has('ArrowRight') || k.has('KeyD') || this.touch.right,
    };
  }

  private rafLoop = (t: number): void => {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    }
    this.render();
    requestAnimationFrame(this.rafLoop);
  };

  // --- simulation ---------------------------------------------------------------

  private update(dt: number): void {
    const inp = this.input;
    const speed = PLAYER_SPEED * (this.surgeActive ? SURGE_SPEED_MULT : 1);
    let dx = 0;
    let dy = 0;
    if (inp.left && !inp.right) dx = -1;
    else if (inp.right && !inp.left) dx = 1;
    if (inp.up && !inp.down) dy = -1;
    else if (inp.down && !inp.up) dy = 1;
    // Normalize diagonals.
    if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    this.moving = dx !== 0 || dy !== 0;
    if (dx < 0) this.facing = 'left';
    else if (dx > 0) this.facing = 'right';
    else if (dy < 0) this.facing = 'up';
    else if (dy > 0) this.facing = 'down';

    // Axis-separated movement so sliding along walls feels smooth.
    if (dx !== 0) {
      const nx = this.px + dx * speed * dt;
      if (this.isWalkable(nx, this.py)) this.px = nx;
    }
    if (dy !== 0) {
      const ny = this.py + dy * speed * dt;
      if (this.isWalkable(this.px, ny)) this.py = ny;
    }
    if (this.moving) this.animT += dt * (this.surgeActive ? 1.6 : 1);

    // Surge decay.
    if (this.surgeActive) {
      this.surge -= SURGE_DECAY_PER_SEC * SURGE_MAX * dt;
      if (this.surge <= 0) { this.surge = 0; this.surgeActive = false; this.cb.onStateChange({ lives: this.lives, score: this.score, surge: this.surge, keys: this.keys }); }
    } else if (this.surge > 0) {
      this.surge = Math.max(0, this.surge - SURGE_DECAY_PER_SEC * dt);
    }

    // Spike traps: shielded players pass unharmed; everyone else takes a
    // hit (with a short mercy window so a single stumble can't chain-kill).
    if (this.trapCooldown > 0) this.trapCooldown -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    const ctx = Math.floor(this.px / DUNGEON_TILE);
    const cty = Math.floor(this.py / DUNGEON_TILE);
    const tileIdx = cty * this.cols + ctx;
    if (this.traps.has(tileIdx)) {
      if (this.surgeActive) {
        if (this.lastShieldTile !== tileIdx) {
          // One shield-ping per trap tile while the field holds.
          this.lastShieldTile = tileIdx;
          sfx.coin();
          this.burst(this.px, this.py, 8, '#7fb3cb');
        }
      } else if (this.trapCooldown <= 0) {
        this.lastShieldTile = -1;
        this.trapCooldown = TRAP_COOLDOWN;
        this.burst(this.px, this.py, 12, '#c9cdd6');
        this.damage();
      }
    } else {
      this.lastShieldTile = -1;
    }

    // Event encounters: overlap with an uncleared marker opens its dialog.
    if (this.activeEventId === null) {
      for (const placed of this.events) {
        if (placed.cleared) continue;
        const ex = placed.tx * DUNGEON_TILE + DUNGEON_TILE / 2;
        const ey = placed.ty * DUNGEON_TILE + DUNGEON_TILE / 2;
        if (Math.abs(ex - this.px) < DUNGEON_TILE * 0.75 && Math.abs(ey - this.py) < DUNGEON_TILE * 0.75) {
          this.activeEventId = placed.event.event_id;
          sfx.hit();
          this.cb.onEventEncounter(placed.event, placed.event.event_id);
          break;
        }
      }
    }

    // Portal.
    const portalX = (this.cols - 2) * DUNGEON_TILE + DUNGEON_TILE / 2;
    const portalY = (this.rows - 2) * DUNGEON_TILE + DUNGEON_TILE / 2;
    if (this.portalOpen && Math.abs(portalX - this.px) < DUNGEON_TILE * 0.6 && Math.abs(portalY - this.py) < DUNGEON_TILE * 0.6) {
      this.running = false;
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      sfx.victory();
      this.cb.onExit();
      return;
    }

    // Particles.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 30 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 55;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: 0.4 + Math.random() * 0.4, maxLife: 0.8, color });
    }
  }

  // --- render ---------------------------------------------------------------

  /** Horizontally mirrored copy of a tile canvas (for left-facing sprites). */
  private flipped(name: string): HTMLCanvasElement | null {
    let c = this.mirrorCache.get(name);
    if (c) return c;
    const src = tileCanvas(name);
    if (!src) return null;
    c = document.createElement('canvas');
    c.width = DUNGEON_TILE;
    c.height = DUNGEON_TILE;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    cx.translate(DUNGEON_TILE, 0);
    cx.scale(-1, 1);
    cx.drawImage(src, 0, 0);
    this.mirrorCache.set(name, c);
    return c;
  }

  private blit(name: string, x: number, y: number): void {
    const img = tileCanvas(name);
    if (img) this.ctx.drawImage(img, x, y);
  }

  private floorName(x: number, y: number): string {
    if ((x * 7 + y * 13) % 11 === 0) return 'floor_crack';
    return (x + y) % 2 === 0 ? 'floor_a' : 'floor_b';
  }

  /**
   * Pack frame set for a gate's monster, honoring the event's enemy_sprite
   * field ("skeleton_knight" → skeleton, "wizard" → priest, etc.) with a
   * deterministic variety fallback for generic names like "enemy_goblin".
   */
  private monsterFor(event: DungeonEvent, i: number): string {
    const s = (event.data.enemy_sprite ?? '').toLowerCase();
    if (s.includes('skeleton') || s.includes('knight') || s.includes('guard') || s.includes('soldier')) return 'skeleton';
    if (s.includes('skull')) return 'skull';
    if (s.includes('vampire') || s.includes('bat') || s.includes('ghost') || s.includes('wraith') || s.includes('demon')) return 'vampire';
    if (s.includes('priest') || s.includes('wizard') || s.includes('mage') || s.includes('cult') || s.includes('monk')) return 'priest';
    return ['skeleton', 'vampire', 'skull', 'priest'][i % 4];
  }

  /** Horizontally mirrored copy of any 16×16 canvas (WeakMap-cached). */
  private flippedCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    let c = this.mirrorCanvases.get(src);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = DUNGEON_TILE;
    c.height = DUNGEON_TILE;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    cx.translate(DUNGEON_TILE, 0);
    cx.scale(-1, 1);
    cx.drawImage(src, 0, 0);
    this.mirrorCanvases.set(src, c);
    return c;
  }

  private render(): void {
    const ctx = this.ctx;
    const W = this.cols * DUNGEON_TILE;
    const H = this.rows * DUNGEON_TILE;
    ctx.fillStyle = '#16101a';
    ctx.fillRect(0, 0, W, H);

    const A = this.assets;
    const frame = (set: string, offset = 0): HTMLImageElement | null => packFrame(A, set, this.time, offset);

    // --- layer 0: floors (and full-tile walls) -------------------------------
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const k = this.tileAt(x, y);
        const px = x * DUNGEON_TILE;
        const py = y * DUNGEON_TILE;
        if (k === 'wall') {
          if (A) ctx.drawImage(A.tiles.wall, px, py);
          else this.blit('wall', px, py);
        } else {
          if (A) ctx.drawImage(A.tiles.floor, px, py);
          else this.blit(this.floorName(x, y), px, py);
        }
      }
    }

    // --- layer 1: spike traps (under entities), pillars, portal, markers ------
    for (const idx of this.traps) {
      const tx = idx % this.cols;
      const ty = Math.floor(idx / this.cols);
      const spikes = frame('peaks');
      if (A && spikes) ctx.drawImage(spikes, tx * DUNGEON_TILE, ty * DUNGEON_TILE);
      else this.blit('trap', tx * DUNGEON_TILE, ty * DUNGEON_TILE);
      // Danger shimmer when the player is unshielded and close.
      const cxp = tx * DUNGEON_TILE + 8;
      const cyp = ty * DUNGEON_TILE + 8;
      if (!this.surgeActive && Math.abs(cxp - this.px) < DUNGEON_TILE * 1.5 && Math.abs(cyp - this.py) < DUNGEON_TILE * 1.5) {
        ctx.fillStyle = `rgba(255, 107, 107, ${0.10 + 0.08 * Math.sin(this.time * 8)})`;
        ctx.fillRect(tx * DUNGEON_TILE, ty * DUNGEON_TILE, DUNGEON_TILE, DUNGEON_TILE);
      }
    }
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.tileAt(x, y) === 'pillar') {
          if (A) ctx.drawImage(A.tiles.pillar, x * DUNGEON_TILE, y * DUNGEON_TILE);
          else this.blit('pillar', x * DUNGEON_TILE, y * DUNGEON_TILE);
        }
      }
    }

    // Exit portal: the pack's ladder, capped with a banner once unlocked.
    const portalX = (this.cols - 2) * DUNGEON_TILE;
    const portalY = (this.rows - 2) * DUNGEON_TILE;
    if (A) {
      ctx.drawImage(A.tiles.exit, portalX, portalY);
      if (this.portalOpen) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
        ctx.drawImage(A.tiles.banner, portalX, portalY);
        ctx.fillStyle = `rgba(157, 209, 255, ${0.12 + pulse * 0.18})`;
        ctx.fillRect(portalX - 2, portalY - 2, DUNGEON_TILE + 4, DUNGEON_TILE + 4);
      }
    } else {
      this.blit(this.portalOpen ? 'portal_open' : 'portal_closed', portalX, portalY);
      if (this.portalOpen) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
        ctx.fillStyle = `rgba(157, 209, 255, ${0.12 + pulse * 0.18})`;
        ctx.fillRect(portalX - 2, portalY - 2, DUNGEON_TILE + 4, DUNGEON_TILE + 4);
      }
    }

    // Event markers.
    this.events.forEach((placed, ei) => {
      const x = placed.tx * DUNGEON_TILE;
      const bob = Math.sin(this.time * 2.2 + placed.t) * 1.2;
      const y = placed.ty * DUNGEON_TILE - bob;
      if (placed.cleared) {
        if (A) {
          const open = frame('chest_open', ei);
          if (placed.event.type === 'chest_lock' && open) ctx.drawImage(open, x, placed.ty * DUNGEON_TILE);
          else ctx.drawImage(A.tiles.banner, x, placed.ty * DUNGEON_TILE);
        } else {
          this.blit('trophy', x, placed.ty * DUNGEON_TILE);
        }
        return;
      }
      const isActive = placed.event.event_id === this.activeEventId;
      let drew = false;
      if (A) {
        if (placed.event.type === 'monster_gate') {
          const m = frame(this.monsterFor(placed.event, ei), ei);
          if (m) { ctx.drawImage(m, x, y); drew = true; }
        } else if (placed.event.type === 'chest_lock') {
          const chest = frame('chest', ei);
          if (chest) { ctx.drawImage(chest, x, y); drew = true; }
        } else {
          const rune = frame('key', ei);
          if (rune) { ctx.drawImage(rune, x, y); drew = true; }
        }
      }
      if (!drew) {
        const name = placed.event.type === 'monster_gate' ? 'gate_marker' : placed.event.type === 'rune_socket' ? 'rune_marker' : 'chest';
        this.blit(name, x, y);
      }
      if (isActive) {
        ctx.fillStyle = `rgba(255, 215, 106, ${0.18 + 0.14 * Math.sin(this.time * 12)})`;
        ctx.fillRect(x, y, DUNGEON_TILE, DUNGEON_TILE);
      }
    });

    // Hero: pack knight (or authored grids), 2-frame walk, shield ring.
    const pose: 'a' | 'b' = this.moving && Math.floor(this.animT * 6) % 2 === 0 ? 'b' : 'a';
    const pxx = Math.round(this.px) - 8;
    const pyy = Math.round(this.py) - 8;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(this.px) - 5, Math.round(this.py) + 5, 10, 2);
    let drewHero = false;
    if (A) {
      // Equipped pack character when one is owned; otherwise the free knight.
      const skin = activeCharacter(this.avatar);
      const skinCell = skin ? composePackCharacterFrame(pose === 'b' ? 'run2' : 'idle', skin, A, this.facing === 'left') : null;
      const cell: HTMLCanvasElement = skinCell ?? A.heroPoses[pose === 'b' ? 1 : 0];
      if (this.hurtT > 0) ctx.drawImage(tintPackCharacter(cell, '#ff6b6b'), pxx, pyy);
      else ctx.drawImage(cell, pxx, pyy);
      drewHero = true;
    }
    if (!drewHero) {
      let heroName: string;
      if (this.facing === 'down') heroName = `hero_down_${pose}`;
      else if (this.facing === 'up') heroName = `hero_up_${pose}`;
      else heroName = `hero_side_${pose}`; // right, or left flipped below
      if (this.facing === 'left') {
        const img = this.flipped(heroName);
        if (img) ctx.drawImage(img, pxx, pyy);
      } else {
        this.blit(heroName, pxx, pyy);
      }
    }
    // Surge shield field: pulsing pixel ring around the hero.
    if (this.surgeActive) {
      const a = 0.35 + 0.25 * Math.sin(this.time * 10);
      ctx.strokeStyle = `rgba(255, 215, 106, ${a})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(pxx - 1.5, pyy - 1.5, DUNGEON_TILE + 3, DUNGEON_TILE + 3);
      ctx.strokeStyle = `rgba(157, 209, 255, ${a * 0.7})`;
      ctx.strokeRect(pxx + 0.5, pyy + 0.5, DUNGEON_TILE - 1, DUNGEON_TILE - 1);
    }

    // Particles.
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;

    // Hurt flash: brief red wash over the frame (fades fast).
    if (this.hurtT > 0) {
      ctx.fillStyle = `rgba(255, 60, 60, ${(this.hurtT / HURT_FLASH_SEC) * 0.32})`;
      ctx.fillRect(0, 0, W, H);
    }

    // --- layer 2: overhead torch flames (flicker) -----------------------------
    for (let i = 0; i < this.torches.length; i++) {
      const t = this.torches[i];
      const jitter = Math.sin(this.time * 9 + i * 1.7) > 0 ? 0 : 1;
      const torchImg = frame('torch', i);
      if (torchImg) ctx.drawImage(torchImg, t.x * DUNGEON_TILE, t.y * DUNGEON_TILE + jitter);
      else this.blit('torch', t.x * DUNGEON_TILE, t.y * DUNGEON_TILE + jitter);
    }

    // Torchlight vignette (two radial gradients over the whole frame).
    const vignette = ctx.createRadialGradient(this.px, this.py, 30, this.px, this.py, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}
