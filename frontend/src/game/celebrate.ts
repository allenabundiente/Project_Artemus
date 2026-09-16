// Treasure-drop purchase celebration: a dimmed overlay with a big treasure
// chest, an arcing coin fountain, a parchment banner, and a chiptune fanfare —
// the game itself already teaches this visual language (chest = treasure,
// coin fountain = payout).
//
// Usage: import { celebratePurchase } from '../game/celebrate'; then call it
// right after the server confirms a purchase. Fire-and-forget: it manages its
// own lifecycle, removes itself from the DOM, and bumps every coin HUD.

import { sfx } from './sfx';
import { spriteDataUrl } from './sprites';
import { bumpHudCoins } from './hudCoins';

const CHEST = spriteDataUrl('chest');
const COIN = spriteDataUrl('coin');

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ChestTier {
  /** Minimum price (in coins) that earns this tier. */
  threshold: number;
  heading: string;
  sub: string;
  coins: number;
  sfxMode: 'single' | 'double' | 'fanfare';
}

const TIERS: ChestTier[] = [
  { threshold: 0, heading: 'TREASURE!', sub: 'A new set is yours forever.', coins: 12, sfxMode: 'single' },
  { threshold: 100, heading: 'GRAND TREASURE!', sub: 'A royal set joins your wardrobe.', coins: 22, sfxMode: 'double' },
  { threshold: 250, heading: 'MYTHIC TREASURE!', sub: 'The kingdom bows to your new regalia.', coins: 36, sfxMode: 'fanfare' },
];

function tierFor(price: number): ChestTier {
  let tier = TIERS[0];
  for (const t of TIERS) if (price >= t.threshold) tier = t;
  return tier;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  el: HTMLImageElement;
}

function makeCoin(): Coin {
  const el = document.createElement('img');
  el.src = COIN;
  el.alt = '';
  el.className = 'celebrate-coin';
  return { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, el };
}

function playFanfare(mode: ChestTier['sfxMode']): void {
  sfx.coin();
  if (mode === 'single') return;
  sfx.select();
  if (mode === 'double') {
    sfx.coin();
    return;
  }
  sfx.victory();
}

/**
 * 7-DAY STREAK BONUS — the daily-flame milestone payout. Shares the purchase
 * celebration's coin fountain and HUD bump, but the banner reads like the
 * kingdom itself noticed: a flame medallion instead of a chest, and the coin
 * count scales with the streak length paying out.
 *
 * Fired from the quest-complete flow when the server reports streakBonus > 0.
 * Fire-and-forget, self-cleaning, reduced-motion aware — same contract as
 * celebratePurchase.
 */
export function celebrateStreakBonus(opts: { streak: number; bonus: number; balance: number }): void {
  if (typeof document === 'undefined') return;

  bumpHudCoins(opts.balance);
  if (REDUCED) {
    sfx.victory();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'celebrate-overlay';

  const panel = document.createElement('div');
  panel.className = 'celebrate-panel';

  const flame = document.createElement('div');
  flame.className = 'celebrate-chest celebrate-flame';
  flame.textContent = '🔥';

  const banner = document.createElement('div');
  banner.className = 'celebrate-banner';

  const heading = document.createElement('p');
  heading.className = 'celebrate-heading';
  heading.textContent = `${opts.streak}-DAY STREAK!`;

  const sub = document.createElement('p');
  sub.className = 'celebrate-sub';
  sub.textContent = `Your daily flame earns ${opts.bonus} bonus coins.`;

  banner.append(heading, sub);
  panel.append(flame, banner);
  overlay.append(panel);
  document.body.append(overlay);

  sfx.coin();
  window.setTimeout(() => sfx.select(), 180);
  window.setTimeout(() => sfx.victory(), 420);

  // Coin fountain from the flame — a modest burst, then a second wave, since
  // this payout is pure bonus on top of the quest's own treasure.
  const coins: Coin[] = [];
  const spawn = (count: number) => {
    for (let i = 0; i < count; i++) {
      const c = makeCoin();
      const side = i % 2 === 0 ? 1 : -1;
      c.vx = side * (40 + Math.random() * 130);
      c.vy = -(240 + Math.random() * 200);
      c.vr = side * (180 + Math.random() * 240);
      c.el.style.left = '50%';
      panel.append(c.el);
      coins.push(c);
    }
  };
  spawn(24);
  window.setTimeout(() => spawn(16), 380);

  const GRAVITY = 900;
  let last = performance.now();
  let running = true;
  const step = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const c of coins) {
      c.vy += GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.rot}deg)`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  const dismiss = () => {
    running = false;
    overlay.classList.add('celebrate-out');
    window.setTimeout(() => overlay.remove(), 260);
  };
  overlay.addEventListener('click', dismiss);
  window.setTimeout(dismiss, 2800);
}

export function celebratePurchase(opts: { itemName: string; price: number; coins: number }): void {
  if (typeof document === 'undefined') return;
  const tier = tierFor(opts.price);

  // Respect reduced-motion and the 🔊 mute gate (sfx.ac() handles muting):
  // still fire the HUD bump so the coin counter stays honest everywhere.
  bumpHudCoins(opts.coins);
  if (REDUCED) {
    playFanfare(tier.sfxMode);
    return;
  }

  // --- build the overlay -------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'celebrate-overlay';

  const panel = document.createElement('div');
  panel.className = 'celebrate-panel';

  const chest = document.createElement('img');
  chest.src = CHEST;
  chest.alt = 'Treasure chest';
  chest.className = 'celebrate-chest';

  const banner = document.createElement('div');
  banner.className = 'celebrate-banner';

  const heading = document.createElement('p');
  heading.className = 'celebrate-heading';
  heading.textContent = tier.heading;

  const sub = document.createElement('p');
  sub.className = 'celebrate-sub';
  sub.textContent = `${opts.itemName} — ${tier.sub}`;

  banner.append(heading, sub);
  panel.append(chest, banner);
  overlay.append(panel);
  document.body.append(overlay);

  playFanfare(tier.sfxMode);

  // --- coin fountain -------------------------------------------------------------
  // A light rAF-driven particle system over the panel: coins launch from the
  // chest, arc under gravity, and spin. Zero dependencies, self-cleaning.
  const coins: Coin[] = [];
  const spawnCoins = (count: number) => {
    for (let i = 0; i < count; i++) {
      const c = makeCoin();
      // Launch from the chest mouth: fan left/right, stronger up for the arcs.
      const side = i % 2 === 0 ? 1 : -1;
      c.vx = side * (40 + Math.random() * 130);
      c.vy = -(240 + Math.random() * 200);
      c.vr = side * (180 + Math.random() * 240);
      c.el.style.left = '50%';
      panel.append(c.el);
      coins.push(c);
    }
  };
  const burst = () => spawnCoins(tier.coins);
  burst();
  if (tier.sfxMode !== 'single') window.setTimeout(burst, 350);

  const GRAVITY = 900; // px/s²
  let last = performance.now();
  let running = true;
  const step = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const c of coins) {
      c.vy += GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.rot}deg)`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  // --- lifecycle -------------------------------------------------------------------
  const dismiss = () => {
    running = false;
    overlay.classList.add('celebrate-out');
    window.setTimeout(() => overlay.remove(), 260);
  };
  overlay.addEventListener('click', dismiss);
  window.setTimeout(dismiss, 2600);
}
