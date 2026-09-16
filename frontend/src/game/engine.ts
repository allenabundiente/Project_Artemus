import type { Challenge } from '../types';
import { sfx } from './sfx';
import { resolveTheme, type Theme } from './themes';
import { composeAvatar, type AvatarConfig, type AvatarFrame } from './avatar';
import type { SpriteAnimation } from './animations';
import type { QuestPlan } from './questPlan';

export const VIRTUAL_W = 320;
export const VIRTUAL_H = 180;
/** Canvas backing-store scale: 2 → 640×360 backing for crisper scaled art. */
export const RENDER_SCALE = 2;
export const BACKING_W = VIRTUAL_W * RENDER_SCALE;
export const BACKING_H = VIRTUAL_H * RENDER_SCALE;

export interface Monster {
  x: number;
  minX: number;
  maxX: number;
  /** Distinct challenges dealt to this monster — one per heart (no repeats within the run). */
  queue: Challenge[];
  hp: number;
  maxHp: number;
  index: number;
}

export interface LevelLayout {
  width: number;
  groundY: number;
  groundH: number;
  coins: { x: number; y: number }[];
  pits: { x: number; w: number }[];
  monsters: Monster[];
  flagX: number;
}

export interface EngineState {
  lives: number;
  score: number;
}

export interface EngineCallbacks {
  onMonsterHit(monsterIndex: number): void;
  onBossEncounter(): void;
  onGameOver(): void;
  onStateChange(state: EngineState): void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  /** Puff rendering flag (grows + fades); absent = classic 2px spark. */
  puff?: boolean;
  /** Puff start radius. */
  r?: number;
}

const GRAVITY = 620; // px/s^2
// Pacing pass: brisker run, slightly floatier jump to match the higher speed,
// faster monster patrols — the player should sweep a quest without long slogs.
const MOVE_SPEED = 165; // px/s (was 132)
const JUMP_VEL = -240; // px/s (was -225)
const PLAYER_W = 12;
const PLAYER_H = 14;
const MONSTER_PATROL_SPEED = 44; // px/s (was 30)

export class ArcadeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: LevelLayout;
  private sprites: Record<string, HTMLImageElement>;
  private theme: Theme;
  /** Registered animation clips (admin-managed), keyed by clip name. */
  private animations: Map<string, SpriteAnimation> = new Map();
  /** Monster index → clip name, resolved from the roster at construction. */
  private monsterAnims: (string | null)[] = [];
  /** Player customization (wardrobe); undefined = classic hero sprite. */
  private avatar?: AvatarConfig;
  private monsterSprites: string[];
  private cb: EngineCallbacks;

  private px = 60;
  private py = 0;
  private vy = 0;
  private onGround = true;
  private facing: 1 | -1 = 1;
  private invuln = 0;
  private animT = 0;
  /** Time left showing the hurt pose after a hit (0 = not hurt). */
  private hurtT = 0;
  /** True once the run is lost — holds the death pose on screen. */
  private deadPose = false;
  /** Which run-cycle frame index was last drawn — footfall = stride-beat changes. */
  private lastRunFrame = -1;
  private running = false;
  private paused = false;
  private lastT = 0;
  private sawFrame = false;
  private usingTimer = false;
  private timerToken = 0;

  private lives = 3;
  private score = 0;
  private checkpointX = 60;
  /** Coins picked up this run — the only pool a fail penalty may draw from. */
  private coinsCollected = 0;

  private collected: Set<number> = new Set();
  private defeated: Set<number> = new Set();
  private bugDirs: number[] = [];
  private particles: Particle[] = [];
  private camX = 0;
  private time = 0;
  private levelDone = false;
  private pendingMonster: number | null = null;

  private keys: Set<string> = new Set();
  /** Live touch-control state, OR-merged with keyboard input (mobile/tablet). */
  private touch: { left: boolean; right: boolean; jump: boolean } = { left: false, right: false, jump: false };

  constructor(
    canvas: HTMLCanvasElement,
    layout: LevelLayout,
    sprites: Record<string, HTMLImageElement>,
    cb: EngineCallbacks,
    themeId?: string,
    avatar?: AvatarConfig,
    animations?: SpriteAnimation[],
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.layout = layout;
    // 640×360 backing store; all game code keeps drawing in 320×180 units and
    // the 2× transform crisply doubles every pixel (smoothing stays off).
    canvas.width = VIRTUAL_W * RENDER_SCALE;
    canvas.height = VIRTUAL_H * RENDER_SCALE;
    this.ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.cb = cb;
    this.theme = resolveTheme(themeId);
    // Apply the theme's sprite overrides, then keep every other slot from the
    // preloaded manifest sprites.
    const merged: Record<string, HTMLImageElement> = { ...sprites };
    for (const [slot, file] of Object.entries(this.theme.spriteOverrides ?? {})) {
      const img = sprites[file] ?? sprites[slot];
      if (img) merged[slot] = img;
    }
    this.sprites = merged;
    this.monsterSprites = this.theme.monsters ?? ['enemy_goblin', 'enemy_slime', 'enemy_bat'];
    this.avatar = avatar;
    // Register animation clips. A clip whose name matches a monster sprite
    // slot (e.g. 'dragon_flap' for slot 'dragon_flap') plays on the monsters
    // that use that slot; clips are picked in roster order like sprite slots.
    for (const anim of animations ?? []) this.animations.set(anim.name, anim);
    const clipNames = [...this.animations.keys()];
    this.monsterAnims = this.layout.monsters.map((_m, i) => {
      const slot = this.monsterSprites[i % this.monsterSprites.length];
      const match = clipNames.find((n) => n === slot || slot.startsWith(n));
      return match ?? null;
    });
    this.py = layout.groundY - PLAYER_H;
    this.bugDirs = layout.monsters.map(() => (Math.random() < 0.5 ? 1 : -1) as 1 | -1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    requestAnimationFrame(this.rafLoop);
    // If the window is occluded (or headless), rAF never fires. Fall back to
    // a timer-driven loop after a short grace period so the game keeps running.
    window.setTimeout(() => {
      if (this.running && !this.sawFrame) {
        this.usingTimer = true;
        const token = ++this.timerToken;
        const tick = () => {
          if (!this.running || token !== this.timerToken) return;
          this.loop(performance.now());
          window.setTimeout(tick, 16);
        };
        tick();
      }
    }, 300);
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    // A dialog opening mid-press must not leave a held touch stuck on.
    if (p) this.touch = { left: false, right: false, jump: false };
  }

  /** Called by the on-screen touch controls; merged with keyboard in `input`. */
  setTouchInput(t: Partial<{ left: boolean; right: boolean; jump: boolean }>): void {
    this.touch = { ...this.touch, ...t };
  }

  /** Clear every touch flag (e.g. when the level or a dialog unmounts them). */
  clearTouchInput(): void {
    this.touch = { left: false, right: false, jump: false };
  }

  addScore(n: number): void {
    this.score += n;
    this.cb.onStateChange({ lives: this.lives, score: this.score });
  }

  /** Coins gathered during the current run (for the fail-penalty accounting). */
  getCoinsCollected(): number {
    return this.coinsCollected;
  }

  /** Player takes one damage (wrong answer in battle, pit, etc.). */
  damage(): void {
    this.hitPlayer();
  }

  /** Reset lives/score/positions for a fresh attempt at the same level. */
  resetLevel(): void {
    this.lives = 3;
    this.score = 0;
    this.checkpointX = 60;
    this.coinsCollected = 0;
    this.px = 60;
    this.py = this.layout.groundY - PLAYER_H;
    this.vy = 0;
    this.onGround = true;
    this.invuln = 1.2;
    this.hurtT = 0;
    this.deadPose = false;
    this.collected.clear();
    this.defeated.clear();
    this.levelDone = false;
    this.pendingMonster = null;
    for (let i = 0; i < this.layout.monsters.length; i++) {
      this.layout.monsters[i].hp = this.layout.monsters[i].maxHp;
    }
    this.cb.onStateChange({ lives: this.lives, score: this.score });
  }

  /** Record one landed hit on monster i (removes a heart, persists across retreats). */
  hitMonster(i: number): void {
    const m = this.layout.monsters[i];
    if (m && m.hp > 0) m.hp -= 1;
  }

  /** Current hearts of monster i (so a re-encounter resumes where it left off). */
  getMonsterHp(i: number): number {
    return this.layout.monsters[i]?.hp ?? 0;
  }

  /** Called after the player wins a battle against monster i. */
  monsterDefeated(i: number): void {
    this.defeated.add(i);
    const m = this.layout.monsters[i];
    if (m) {
      this.checkpointX = Math.max(this.checkpointX, m.x + 10);
      this.burst(m.x, this.layout.groundY - 14, 16, this.theme.particleHit ?? '#00e436');
      this.burst(m.x, this.layout.groundY - 14, 10, this.theme.particleScore ?? '#ffec27');
    }
    this.addScore(50);
    this.pendingMonster = null;
  }

  /** Called after the player loses/retreats a battle: bounce back with brief invulnerability. */
  retreatFromBattle(): void {
    this.pendingMonster = null;
    this.px = Math.max(10, this.px - 26);
    this.py = this.layout.groundY - PLAYER_H - 6;
    this.vy = -140;
    this.onGround = false;
    this.invuln = 1.4;
  }

  /**
   * Retreat from the BOSS: re-arm the gate (touching it re-opens the fight)
   * and bounce the player back in front of it, with brief invulnerability.
   */
  retreatFromBoss(): void {
    this.pendingMonster = null;
    this.levelDone = false;
    this.px = Math.max(10, this.layout.flagX - 50);
    this.py = this.layout.groundY - PLAYER_H - 6;
    this.vy = -140;
    this.onGround = false;
    this.invuln = 1.4;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Only capture game keys while the level is actively playing; while a
    // dialog (challenge, battle, results) is open the player may be typing —
    // swallow nothing so text input (including spaces) works normally.
    if (!this.paused) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code ?? e.key)) {
        e.preventDefault();
      }
      this.keys.add(e.code ?? e.key);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code ?? e.key);
    // A dialog opening mid-jump can leave jump stuck on; drop W/ArrowUp on any
    // keyup while paused so the knight doesn't keep bouncing afterward.
    if (this.paused && (e.code === 'KeyW' || e.code === 'ArrowUp')) {
      this.keys.delete('KeyW');
      this.keys.delete('ArrowUp');
    }
  };

  private get input(): { left: boolean; right: boolean; jump: boolean } {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA') || this.touch.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || this.touch.right;
    // Jump is W only — Space is reserved for typing in the answer input.
    const jump = k.has('KeyW') || k.has('ArrowUp') || this.touch.jump;
    return { left, right, jump };
  }

  /** rAF callback. If rAF starts firing again after the timer took over, hand control back. */
  private rafLoop = (t: number): void => {
    if (!this.running) return;
    this.sawFrame = true;
    if (this.usingTimer) {
      this.usingTimer = false;
      this.timerToken++; // kills the timer loop
    }
    this.loop(t);
    if (this.running && !this.usingTimer) {
      requestAnimationFrame(this.rafLoop);
    }
  };

  private loop = (t: number): void => {
    if (!this.running) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    }
    this.render();
  };

  // --- simulation ------------------------------------------------------------

  private update(dt: number): void {
    const inp = this.input;

    // horizontal
    if (inp.left && !inp.right) {
      this.px -= MOVE_SPEED * dt;
      this.facing = -1;
    } else if (inp.right && !inp.left) {
      this.px += MOVE_SPEED * dt;
      this.facing = 1;
    }
    this.px = Math.max(0, Math.min(this.px, this.layout.width - PLAYER_W));

    // jump
    if (inp.jump && this.onGround) {
      this.vy = JUMP_VEL;
      this.onGround = false;
      sfx.jump();
    }

    // vertical
    this.vy += GRAVITY * dt;
    this.py += this.vy * dt;
    const groundTop = this.layout.groundY - PLAYER_H;
    if (this.py >= groundTop) {
      this.py = groundTop;
      this.vy = 0;
      this.onGround = true;
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    this.animT += dt;

    // Run-cycle footfalls: emit a dust puff each time the cycle wraps past a
    // stride beat (frame 1 and frame 3 boundaries).
    if (this.onGround && this.input.left !== this.input.right && this.hurtT <= 0) {
      const frameIdx = Math.floor(this.animT * 10) % 4;
      if ((frameIdx === 1 || frameIdx === 3) && this.lastRunFrame !== frameIdx) {
        this.dustPuff();
      }
      this.lastRunFrame = frameIdx;
    } else {
      this.lastRunFrame = -1;
    }

    const playerCx = this.px + PLAYER_W / 2;
    const playerCy = this.py + PLAYER_H / 2;

    // coins
    for (let i = 0; i < this.layout.coins.length; i++) {
      if (this.collected.has(i)) continue;
      const c = this.layout.coins[i];
      if (Math.abs(c.x - playerCx) < 12 && Math.abs(c.y - playerCy) < 12) {
        this.collected.add(i);
        this.coinsCollected += 1;
        this.addScore(10);
        this.burst(c.x, c.y, 6, this.theme.particleScore ?? '#ffec27');
        sfx.coin();
      }
    }

    // monsters patrol + collide → battle
    if (this.pendingMonster === null) {
      for (let i = 0; i < this.layout.monsters.length; i++) {
        if (this.defeated.has(i)) continue;
        const m = this.layout.monsters[i];
        m.x += this.bugDirs[i] * MONSTER_PATROL_SPEED * dt;
        if (m.x < m.minX) {
          m.x = m.minX;
          this.bugDirs[i] = 1;
        } else if (m.x > m.maxX) {
          m.x = m.maxX;
          this.bugDirs[i] = -1;
        }
        if (this.invuln <= 0 && !this.levelDone) {
          const mx = m.x - 8;
          const my = this.layout.groundY - 16;
          if (playerCx > mx - 4 && playerCx < mx + 20 && playerCy > my - 12 && playerCy < my + 16) {
            this.pendingMonster = i;
            sfx.hit();
            this.cb.onMonsterHit(i);
            break;
          }
        }
      }
    }

    // flag → boss encounter
    if (!this.levelDone && playerCx > this.layout.flagX) {
      this.levelDone = true;
      sfx.bossRoar();
      this.cb.onBossEncounter();
    }

    // pits
    for (const pit of this.layout.pits) {
      if (playerCx > pit.x && playerCx < pit.x + pit.w && this.py + PLAYER_H > this.layout.groundY + 14) {
        this.fellInPit();
        break;
      }
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // camera
    this.camX = Math.max(0, Math.min(this.px - 110, this.layout.width - VIRTUAL_W));
  }

  private hitPlayer(): void {
    if (this.levelDone) return; // already dead — a same-tick burst must not re-kill
    this.lives--;
    this.cb.onStateChange({ lives: this.lives, score: this.score });
    sfx.hit();
    this.invuln = 1.2;
    this.vy = -120;
    this.onGround = false;
    if (this.lives <= 0) {
      this.levelDone = true;
      this.deadPose = true;
      this.cb.onGameOver();
    } else {
      this.hurtT = 0.45; // recoil knockback shows the hurt pose
    }
  }

  private fellInPit(): void {
    this.hitPlayer();
    if (this.lives > 0) this.respawn();
  }

  respawn(): void {
    this.px = this.checkpointX;
    this.py = this.layout.groundY - PLAYER_H;
    this.vy = 0;
    this.onGround = true;
    this.invuln = 1.2;
  }

  private burst(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 50;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color,
      });
    }
  }

  /** Soft dust puff kicked up under the player's feet on a run footfall. */
  private dustPuff(): void {
    const footY = this.layout.groundY;
    for (let i = 0; i < 3; i++) {
      const dir = i === 0 ? -1 : i === 1 ? 1 : 0;
      this.particles.push({
        x: this.px + PLAYER_W / 2 + dir * 3 + (Math.random() * 2 - 1),
        y: footY - 1,
        vx: dir * (10 + Math.random() * 14),
        vy: -(6 + Math.random() * 10),
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.55,
        color: this.theme.dustColor ?? 'rgba(196, 178, 152, 0.7)',
        puff: true,
        r: 1 + Math.random() * 1.5,
      });
    }
  }

  // --- rendering --------------------------------------------------------------

  /** Hurt/death poses always render — the invulnerability blink must not hide them. */
  private get showPoseOverride(): boolean {
    return this.deadPose || this.hurtT > 0;
  }

  /** Draw the player with a red hit-flash overlay while the hurt pose plays. */
  private drawPlayerTinted(name: string, x: number, y: number): void {
    const img = this.sprites[name];
    const flashing = this.hurtT > 0 && !this.deadPose;
    if (!img || !img.complete) {
      this.drawSprite(name, x, y);
      return;
    }
    if (!flashing) {
      this.ctx.drawImage(img, Math.round(x), Math.round(y));
      return;
    }
    // Damage flash: the sprite plus a red silhouette at half-strength,
 // pulsing between 0.25 and 0.5 alpha at ~16 Hz.
    const c = this.ctx;
    c.save();
    c.drawImage(img, Math.round(x), Math.round(y));
    const tintCanvas = this.tintCanvas;
    if (tintCanvas.width !== img.width || tintCanvas.height !== img.height) {
      tintCanvas.width = img.width;
      tintCanvas.height = img.height;
    }
    const tctx = tintCanvas.getContext('2d')!;
    tctx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
    tctx.globalCompositeOperation = 'source-over';
    tctx.drawImage(img, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = '#ff004d';
    tctx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
    tctx.globalCompositeOperation = 'source-over';
    const pulse = 0.25 + 0.25 * (Math.sin(this.time * 100) > 0 ? 1 : 0);
    c.globalAlpha = pulse;
    c.drawImage(tintCanvas, Math.round(x), Math.round(y));
    c.globalAlpha = 1;
    c.restore();
  }

  /** Scratch canvas reused for the hurt-pose red silhouette. */
  private tintCanvas: HTMLCanvasElement = document.createElement('canvas');

  private drawSprite(name: string, x: number, y: number): void {
    const img = this.sprites[name];
    if (img && img.complete) {
      this.ctx.drawImage(img, Math.round(x), Math.round(y));
    } else {
      this.ctx.fillStyle = '#ff004d';
      this.ctx.fillRect(Math.round(x), Math.round(y), 8, 8);
    }
  }

  private render(): void {
    const c = this.ctx;
    const th = this.theme;
    c.imageSmoothingEnabled = false;
    // sky
    c.fillStyle = th.sky;
    c.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

    // stars / fireflies
    c.fillStyle = th.stars;
    for (let i = 0; i < 40; i++) {
      const sx = (i * 137.5 + Math.floor(this.camX * 0.1)) % VIRTUAL_W;
      const sy = (i * 53.7) % 70;
      c.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
    }

    // parallax: distant silhouettes, then near layer
    c.fillStyle = th.farHills;
    for (let i = -1; i < 3; i++) {
      const hx = i * 200 - ((this.camX * 0.35) % 200);
      c.fillRect(Math.floor(hx), 110, 200, 70);
      // battlements
      for (let bx = 0; bx < 5; bx++) c.fillRect(Math.floor(hx + 20 + bx * 36), 102, 16, 8);
    }
    c.fillStyle = th.nearHills;
    for (let i = -1; i < 3; i++) {
      const hx = i * 160 - ((this.camX * 0.6) % 160);
      c.fillRect(Math.floor(hx), 128, 160, 52);
      c.fillRect(Math.floor(hx + 60), 118, 14, 10);
      c.fillRect(Math.floor(hx + 120), 122, 14, 6);
    }

    const groundTop = this.layout.groundY;

    // pits
    c.fillStyle = th.pit;
    for (const pit of this.layout.pits) {
      c.fillRect(Math.round(pit.x - this.camX), groundTop, pit.w, this.layout.groundH);
    }

    // floor
    c.fillStyle = th.floorTop;
    c.fillRect(0, groundTop, VIRTUAL_W, 4);
    c.fillStyle = th.floorBody;
    c.fillRect(0, groundTop + 4, VIRTUAL_W, this.layout.groundH - 4);
    c.fillStyle = th.floorSpeckle;
    for (let i = 0; i < 30; i++) {
      const gx = (i * 47 + Math.floor(this.camX * 0.9)) % VIRTUAL_W;
      const gy = groundTop + 8 + (i * 13) % (this.layout.groundH - 12);
      c.fillRect(Math.floor(gx), gy, 4, 2);
    }

    // coins
    const pulse = Math.sin(this.time * 5);
    for (let i = 0; i < this.layout.coins.length; i++) {
      if (this.collected.has(i)) continue;
      const coin = this.layout.coins[i];
      const w = Math.max(4, Math.round(10 * (1 - Math.abs(pulse) * 0.6)));
      const x = Math.round(coin.x - this.camX - w / 2);
      const y = Math.round(coin.y - 5);
      c.fillStyle = '#e8b43c';
      c.fillRect(x, y, w, 10);
      c.fillStyle = '#d97d2b';
      c.fillRect(x + 1, y + 2, 2, 6);
    }

    // monsters (theme's patrol roster, cycling by index) with hp pips, gentle bob.
    // A monster whose slot matches a registered animation clip plays the clip
    // instead of a static PNG (admin-managed via the Animations manager).
    for (let i = 0; i < this.layout.monsters.length; i++) {
      if (this.defeated.has(i)) continue;
      const m = this.layout.monsters[i];
      const slot = this.monsterSprites[i % this.monsterSprites.length];
      const mx = Math.round(m.x - 8 - this.camX);
      const bob = Math.round(Math.sin(this.time * 3 + i) * 2);
      const animName = this.monsterAnims[i];
      let my: number;
      if (animName) {
        // Animated monster: frame steps at the clip's fps; the sprite itself
        // carries the motion, so the sine bob is replaced by a tiny hop on
        // every loop wrap for a lively cadence.
        const anim = this.animations.get(animName)!;
        const t = this.time * anim.fps;
        const fi = anim.loop
          ? Math.floor(t) % anim.frames.length
          : Math.min(Math.floor(t), anim.frames.length - 1);
        const wrapPhase = t % anim.frames.length;
        const hop = anim.loop && wrapPhase < 1 ? -1 : 0;
        my = groundTop - 16 + hop;
        const frameName = anim.frames[fi];
        // Theme sprite swaps apply to animation frames too (e.g. a volcano
        // dragon whose flap frames were replaced per-map).
        const img = this.sprites[this.theme.spriteOverrides?.[frameName] ?? frameName];
        if (img && img.complete) {
          c.drawImage(img, mx, Math.round(my));
        } else {
          this.drawSprite(slot, mx, my); // frames missing → static fallback
        }
      } else {
        my = groundTop - 16 + bob;
        this.drawSprite(slot, mx, my);
      }
      // Remaining hearts above the monster (one heart per hit it can take).
      // Uses the shared pixel heart sprites; falls back to flat pips if the
      // images have not loaded yet.
      const heartFull = this.sprites['heart'];
      const heartEmpty = this.sprites['heart_empty'];
      for (let h = 0; h < m.maxHp; h++) {
        const hx = mx + 2 + h * 8;
        const hy = my - 10;
        const img = h < m.hp ? heartFull : heartEmpty;
        if (img && img.complete) {
          c.drawImage(img, hx, hy, 7, 6);
        } else {
          c.fillStyle = h < m.hp ? th.hpFilled : th.hpEmpty;
          c.fillRect(hx, hy + 2, 6, 3);
        }
      }
    }

    // standing torches every ~220px of world space: a pole planted in the
    // floor with a base and sconce cup, flame on top (sprite when available,
    // drawn flame otherwise). The old code drew only the flame, which hovered
    // in mid-air 64px above the floor.
    for (let tx = 160; tx < this.layout.width; tx += 220) {
      const sx = Math.round(tx - this.camX);
      if (sx > -12 && sx < VIRTUAL_W) {
        const flicker = Math.sin(this.time * 9 + tx) * 1.5;
        // pole from the floor up to just under the flame, plus a small base
        c.fillStyle = th.torchPole ?? '#4a2f16';
        c.fillRect(sx + 5, groundTop - 63, 2, 63);
        c.fillRect(sx + 3, groundTop - 4, 6, 4);
        // sconce cup under the flame
        c.fillStyle = th.torchSconce ?? '#3a2c22';
        c.fillRect(sx + 3, groundTop - 66, 6, 3);
        const img = this.sprites['torch'];
        if (img && img.complete) {
          // 24×20 torch: flame tip up top, handle ending at the sconce cup.
          this.ctx.drawImage(img, sx - 7, Math.round(groundTop - 84 + flicker * 0.3));
        } else {
          c.fillStyle = '#ffa13d';
          c.fillRect(sx + 3, Math.round(groundTop - 74 + flicker), 5, 6);
        }
      }
    }

    // castle gate (quest end) — 48px-tall keep rises from the floor
    this.drawSprite('castle_gate', this.layout.flagX - this.camX, groundTop - 48);

    // player — wardrobe-composited avatar when configured, classic hero otherwise
    const showPose = this.deadPose ? 'dead' : this.hurtT > 0 ? 'hurt' : null;
    const flashing = this.hurtT > 0 && !this.deadPose;
    if (this.invuln <= 0 || this.showPoseOverride || Math.floor(this.time * 12) % 2 === 0) {
      const animFrame: AvatarFrame = showPose ?? (!this.onGround ? 'jump' : !this.input.left && !this.input.right ? 'idle' : (['run1', 'run2', 'run3', 'run4'] as const)[Math.floor(this.animT * 10) % 4]);
      if (this.avatar) {
        const composed = composeAvatar(animFrame, this.avatar, this.sprites);
        const sx = Math.round(this.px - this.camX);
        const sy = Math.round(this.py);
        if (flashing) {
          // Red hit-flash on the composed avatar: silhouette the fresh canvas.
          const tcv = this.tintCanvas;
          if (tcv.width !== composed.width || tcv.height !== composed.height) {
            tcv.width = composed.width;
            tcv.height = composed.height;
          }
          const tctx = tcv.getContext('2d')!;
          tctx.globalCompositeOperation = 'source-over';
          tctx.clearRect(0, 0, tcv.width, tcv.height);
          tctx.drawImage(composed, 0, 0);
          tctx.globalCompositeOperation = 'source-in';
          tctx.fillStyle = '#ff004d';
          tctx.fillRect(0, 0, tcv.width, tcv.height);
          tctx.globalCompositeOperation = 'source-over';
          c.drawImage(composed, sx, sy);
          c.globalAlpha = Math.sin(this.time * 100) > 0 ? 0.5 : 0.25;
          c.drawImage(tcv, sx, sy);
          c.globalAlpha = 1;
        } else {
          c.drawImage(composed, sx, sy);
        }
      } else {
        const frame = showPose === 'dead' ? 'player_dead' : showPose === 'hurt' ? 'player_hurt' : !this.onGround ? 'player_jump' : this.animState();
        this.drawPlayerTinted(frame, this.px - this.camX, this.py);
      }
    }

    // particles (classic sparks + soft dust puffs)
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      if (p.puff) {
        c.globalAlpha = alpha * 0.8;
        c.fillStyle = p.color;
        const r = (p.r ?? 1.5) * (1 + (1 - alpha) * 1.8);
        c.beginPath();
        c.arc(Math.round(p.x - this.camX), Math.round(p.y), r, 0, Math.PI * 2);
        c.fill();
      } else {
        c.globalAlpha = alpha;
        c.fillStyle = p.color;
        c.fillRect(Math.round(p.x - this.camX), Math.round(p.y), 2, 2);
      }
    }
    c.globalAlpha = 1;
  }

  private animState(): string {
    const moving = this.input.left || this.input.right;
    if (!moving) return 'player_idle';
    return ['player_run1', 'player_run2', 'player_run3', 'player_run4'][Math.floor(this.animT * 10) % 4];
  }
}

// --- deterministic level layout generation -----------------------------------

export function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >> 7), t | 61);
    return ((t ^ (t >> 14)) >>> 0) / 4294967296;
  };
}

export function buildLayout(chapterId: string, plan: QuestPlan): LevelLayout {
  // Hash the uuid chapterId into a 31-bit seed for deterministic layouts.
  let h = 0;
  for (let i = 0; i < chapterId.length; i++) {
    h = (Math.imul(31, h) + chapterId.charCodeAt(i)) | 0;
  }
  const rnd = mulberry32(Math.abs(h) + 13);
  // Pacing pass: encounters sit closer together than the old 420px gap so
  // there is less downtime walking between monsters.
  const SPACING = 320;
  const queues = plan.monsterQueues;
  const n = queues.length;
  const width = 1100 + n * SPACING;
  const groundY = 150;
  const groundH = 30;
  const monsters: Monster[] = [];
  const pits: { x: number; w: number }[] = [];
  const coins: { x: number; y: number }[] = [];

  const monsterXs: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round(300 + i * SPACING + rnd() * 110);
    monsterXs.push(x);
    const queue = queues[i];
    monsters.push({
      x,
      minX: x - 70,
      maxX: x + 70,
      queue,
      hp: queue.length,
      maxHp: queue.length,
      index: i,
    });
  }

  const pitCount = Math.min(2 + (n >= 4 ? 1 : 0), 3);
  let guard = 0;
  while (pits.length < pitCount && guard++ < 200) {
    const x = Math.round(180 + rnd() * (width - 480));
    const w = Math.round(46 + rnd() * 24);
    const overlapsMonster = monsterXs.some((mx) => mx > x - w - 70 && mx < x + w + 70);
    const overlapsPit = pits.some((p) => p.x < x + w + 40 && x < p.x + p.w + 40);
    if (!overlapsMonster && !overlapsPit) pits.push({ x, w });
  }

  // coin clusters between monsters
  const clusterSpots: number[] = [80, ...monsterXs.map((mx) => mx - 140), ...monsterXs.map((mx) => mx + 110), width - 180];
  for (let i = 0; i < clusterSpots.length; i++) {
    const base = clusterSpots[i];
    if (base < 40 || base > width - 40) continue;
    const count = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < count; j++) {
      const x = base + j * 14;
      const inPit = pits.some((p) => x > p.x - 10 && x < p.x + p.w + 10);
      if (!inPit) coins.push({ x, y: groundY - 12 });
    }
  }

  const flagX = width - 60;
  return { width, groundY, groundH, coins, pits, monsters, flagX };
}