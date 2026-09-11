# CodeBook Arcade — Asset & Cosmetics Guide

Everything you need to add your own sprites, map themes, and characters — without
breaking the game. Written for friends contributing art; no engine knowledge required.

---

## 1. The mental model (read this first)

The game simulates a tiny **320×180 pixel world**, drawn onto a **640×360 canvas** (2× backing scale, nearest-neighbor) and scaled up with `image-rendering: pixelated` — so player/monster art is authored at 32×32 for crisp extra detail while the physics grid stays 16px-class. Every piece of
art has a **safety net**:

```
            ┌──────────────────────────────────────────────┐
            │            public/sprites/*.png              │   ← what players see
            │   (PNG, RGBA, exact slot size, e.g. 16×16)   │
            └───────────────────┬──────────────────────────┘
                                │  PNG missing / fails to load?
                                ▼
            ┌──────────────────────────────────────────────┐
            │  src/game/spriteGrids.ts  (text pixel grids) │   ← built-in fallback
            │  '....kkkk....'  → rasterized on a canvas    │
            └──────────────────────────────────────────────┘
```

**You can never "break" the art.** If your PNG is missing or corrupt, the game quietly
falls back to the built-in grid art. Worst case, an unknown sprite name draws a tiny
red square — nobody crashes.

There are exactly **three ways** to contribute, from easiest to most powerful:

| What you want to do | What you touch | Code needed? |
|---|---|---|
| Replace a character/monster/item's look | one PNG in `public/sprites/` | ❌ none |
| Add a whole map look (palette + sprite swaps) | one block in `src/game/themes.ts` | paste a block |
| Add a brand-new thing (new monster, new hat…) | PNG + one line in `spriteGrids.ts` | 1–2 lines |

---

## 2. Format rules (the only hard requirements)

Every game sprite is a **PNG with transparency (RGBA)** at the **exact size of the slot**
it fills. The full slot table lives in `public/sprites/manifest.json` (auto-generated).
Current slots:

| Slot | Size | What it is |
|---|---|---|
| `player_idle`, `player_run1`–`player_run4`, `player_jump`, `player_hurt`, `player_dead` | 32×32 | The hero's 8 poses: 4-frame run cycle + jump, hurt, death |
| `enemy_goblin`, `enemy_slime`, `enemy_bat`, `enemy_bug` | 32×32 | Patrol monsters (cycle by level position) |
| `boss`, `bookworm`, `bookworm_hurt` | 32×32 | Boss battle sprites |
| `castle_gate`, `flag`, `gate_open`, `gate_locked` | 16×24 | Level exit markers |
| `chest`, `coin`, `torch` | 16×16 / 13×12 / 12×10 | Pickups & décor |
| `heart`, `heart_empty` | 12×9 | HUD lives |
| `badge_*` (copper/iron/gold/diamond/mythril) | 12×11 | Rank badges (leaderboard) |

Rules that actually matter:

1. **PNG, RGBA, transparent background.** No JPEG (no transparency), no white matte
   around the character.
2. **Match the slot's exact dimensions.** The engine draws 1 art pixel = 1 world pixel;
   a 20×20 image in a 16×16 slot will be clipped/overlap its neighbors.
3. **Keep the subject roughly filling the frame** and the feet at the bottom edge for
   ground-standing characters (player, monsters) — they stand on the floor line.
4. **Readability at 3–4× zoom**: strong silhouettes, 2–3 shades per material, dark
   outline. If it's mushy when zoomed to 400% in your editor, it will be mushy in game.
5. **Filename = slot name**, lowercase with underscores: `enemy_goblin.png`.

Recommended tools (all free): **Aseprite** (paid-ish, the standard), **Piskel**
(piskelapp.com, in-browser), **LibreSprite**, or GIMP/Photoshop with a 16×16 canvas
and 1px pencil. Set your editor to "nearest neighbor" scaling *before* zooming.

---

## 3. Recipe A — Restyle a character or monster (zero code)

1. Open `public/sprites/manifest.json`, find the slot and its size (say
   `enemy_goblin`, 16×16).
2. Make a 16×16 transparent PNG of your goblin (or wizard frog, or angry rubber duck).
3. Save it as `frontend/public/sprites/enemy_goblin.png`, **overwriting the old one**.
4. Hard-refresh the browser (Ctrl+Shift+R). Done — the new look is live, and the
   battle screen uses the same PNG automatically.

That's the whole recipe. Your art is also safe in git — the PNGs are committed, so
your friend's duck becomes a pull request with one file changed.

> Want *both* the goblin and the duck depending on the map? Don't overwrite — add a
> new slot (Recipe C) and swap it in per-theme (Recipe B).

---

## 4. Recipe B — Add a map theme (a whole new look, one paste)

The engine reads **all** scenery colors from the theme registry,
`frontend/src/game/themes.ts` — sky, stars, both parallax layers, floor, pits, HP pips,
even which monster sprites patrol. Adding a theme is one block in `THEMES`:

```ts
export const VOLCANO: Theme = {
  id: 'volcano',            // URL id — lowercase, unique
  name: 'Ember Depths',     // shown in pickers
  sky: '#2a0f0a',
  stars: '#ffb347',         // becomes drifting embers
  farHills: '#571c12',      // distant volcanoes
  nearHills: '#3a1410',     // near rock ridges
  pit: '#000000',
  floorTop: '#8a4a2b',
  floorBody: '#40201a',
  floorSpeckle: '#5c2f24',
  hpFilled: '#a82a2a',
  hpEmpty: '#5c2f24',
  // optional extras:
  particleHit: '#ff7b39',                       // defeat-burst color
  monsters: ['enemy_bug', 'enemy_bat', 'enemy_goblin'], // who patrols here
  spriteOverrides: { castle_gate: 'gate_open' }, // swap any slot, per-theme
};

export const THEMES: Theme[] = [DUNGEON, FOREST, VOLCANO];  // ← add yours
```

Preview it instantly on any quest by opening the game with `?theme=volcano` in the URL:

```
http://localhost:5173/?theme=volcano
```

No `?theme=` param → the default **Dungeon Night** look, exactly as before.
`spriteOverrides` values are slot→PNG-filename pairs; the file must exist in
`public/sprites/` (add it via Recipe C if it's brand new).

---

## 5. Recipe C — Add a brand-new thing (new monster, item, character)

New *content* needs the engine to know the slot exists. Two small edits:

**1. Add the slot** to `frontend/src/game/spriteGrids.ts`. You can skip drawing a grid
if you'll ship a PNG, but the grid doubles as documentation *and* offline fallback, so
even a 2-line placeholder is worth it:

```ts
{
  name: 'enemy_wizard',
  grid: [
    '....kkkk....',
    '...kwwwwk...',
    '...kwkkwk...',   // yes, you can paste a 12-row grid of strings
    // ... more rows, every row same width, '.' = transparent
  ],
},
```

Grid rules: every string is one pixel row, every character one pixel, `.` transparent,
letters look up colors in `PALETTE` at the top of the file (add your own letter →
`[r, g, b]` if you need a new color). All rows should be the same length.

**2. Generate the PNG + manifest:**

```bash
cd frontend && npm run sprites
```

This renders every grid to `public/sprites/<name>.png` and regenerates
`manifest.json`. Now replace the generated PNG with your real art (Recipe A) — same
name, same size — and it's a proper slot: preloadable, theme-swappable, documented.

**3. Use it** — reference it where content is built:
- New patrol monster → add its slot name to a theme's `monsters` array (Recipe B).
- One-off art → load it through `loadSprites()` (it reads every manifest slot) and
  `drawSprite('enemy_wizard', x, y)` in `engine.ts`.
- UI art (portraits, banners) → just drop the PNG in `public/sprites/` (or
  `public/`) and use `<img src="/sprites/your_art.png">` with
  `imageRendering: 'pixelated'` — no engine involvement.

---

## 6. Cosmetics roadmap — how to make hats/skins *player-chosen* later

Right now art is global. The registry is already structured for the next step —
"cosmetic packs" a player or teacher can select — with no schema redesign:

1. **Packs:** a pack is just `{ id, name, spriteOverrides: {...} }` — the same shape a
   theme uses. Add `frontend/src/game/cosmetics.ts` exporting a `PACKS` array and a
   `resolvePack(id)` like `themes.ts` has.
2. **Selection:** store the chosen pack id on the user (one text column on `users`,
   via a new Supabase migration `0004_cosmetics.sql`), return it from `/api/me`, and
   pass it into `new ArcadeEngine(...)` alongside `themeId` (the constructor already
   accepts and merges overrides — reuse `theme.spriteOverrides` logic for packs).
3. **Priority:** pack overrides win over theme overrides; theme wins over base art.
4. **Unlocks:** coins already exist server-side. A teacher-granted or coin-priced pack
   is one join table away — no engine changes at all.

---

## 7. Map design — what's themable today vs. what's engine work

Themed today (colors + sprite swaps, zero code):
sky, stars, parallax silhouettes, floor/pits/speckles, HP pips, particle colors,
which monsters patrol, and swapping any existing sprite per theme.

Still engine-level (needs a small PR to `engine.ts`/`buildLayout`):
platforms/multi-height floors, moving hazards, background props placement, weather
particles, non-flat terrain. `buildLayout()` is deterministic per chapter (seeded
from the chapter id), so any new layout knobs should also come from the theme
object — keep the pattern: **new capability = new optional Theme field, not new
hardcoded constants**.

---

## 8. Contributor checklist (PR-ready)

- [ ] PNG is RGBA with transparency, exact slot size (`manifest.json` is truth)
- [ ] Filename matches the slot name exactly, lowercase
- [ ] Feet at frame bottom for ground characters; subject fills the frame
- [ ] Zoomed to 400%, still readable (strong silhouette, dark outline)
- [ ] If it's a new slot: grid entry added, `npm run sprites` run, `manifest.json` updated
- [ ] If it's a theme: unique `id`, added to `THEMES`, tested via `?theme=<id>`
- [ ] Typecheck: `cd frontend && npx tsc --noEmit` (only needed if you touched `.ts`)
- [ ] One PR per pack/theme so review (and rollback) is trivial

**Testing without running anything:** `npm run dev`, open any quest, append
`?theme=your_theme` — if your art loads, the manifest slot exists and the size is
right. If you see the grid-art fallback, your PNG is missing/misnamed. If you see a
red square, the slot name doesn't exist in the manifest at all.
