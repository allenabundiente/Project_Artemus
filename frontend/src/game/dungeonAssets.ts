// Loader for the top-down dungeon's real pixel-art asset pack (the classic
// "2D Pixel Dungeon Asset Pack", user-supplied) copied to public/dungeon/.
//
// Everything here degrades gracefully: if the atlas fails to load the engine
// falls back to the authored grids in dungeonTileset.ts, and if an individual
// animation frame is missing only that animation falls back. The pack's
// tileset is a 160×160 atlas of 16×16 tiles; the tiles we use were identified
// from the sheet layout:
//   (1,0) brick wall face   (1,4) brown wall cap    (1,1) interior floor
//   (6,4) wooden pillar     (9,3) ladder/exit       (4,7) shield banner
//
// Character sheets: every column of a character sheet is one 16×16 walk frame
// with a 16×16 jump/hurt frame directly below it. hero.png col 0 is the free
// knight; Dungeon_Character_2.png (character2.png) holds four more heroes in
// cols 0–3 — the pack's other designs, sold as buyable characters in the shop.

export interface DungeonAssets {
  /** 160×160 tileset atlas. */
  atlas: HTMLImageElement;
  /** 112×64 character sheet: knight at (0,0), walk pose at (0,2). */
  hero: HTMLImageElement;
  /** Named 16×16 animation frames, e.g. frames.get('skeleton') → 4 images. */
  frames: Map<string, HTMLImageElement[]>;
}

const ATLAS_TILES = {
  wall: [16, 0],
  wallTop: [16, 64],
  floor: [16, 16],
  pillar: [96, 64],
  exit: [144, 48],
  banner: [64, 112],
} as const;

const FRAME_SETS = [
  'skeleton', 'vampire', 'skull', 'priest',
  'chest', 'chest_open', 'peaks', 'torch', 'key', 'coin',
] as const;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Cut one 16×16 tile out of the atlas into its own canvas (for ctx.drawImage of single tiles). */
function atlasTile(atlas: HTMLImageElement, sx: number, sy: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, sx, sy, 16, 16, 0, 0, 16, 16);
  return c;
}

export interface LoadedDungeonAssets extends DungeonAssets {
  /** Single-tile canvases cut from the atlas, keyed by ATLAS_TILES names. */
  tiles: Record<keyof typeof ATLAS_TILES, HTMLCanvasElement>;
  /** Knight poses scrubbed clean of the sheet's registration diamonds: [idle, walk]. */
  heroPoses: [HTMLCanvasElement, HTMLCanvasElement];
  /** Buyable characters: id → [walk, jump] scrubbed 16×16 canvases. */
  chars: Map<string, [HTMLCanvasElement, HTMLCanvasElement]>;
}

/** The hero designs players can own. `sheet` PNGs live in /dungeon/. */
export interface DungeonCharacterDef {
  id: string;
  name: string;
  /** Sheet file (without extension) in public/dungeon/. */
  sheet: 'hero' | 'character2';
  /** Sheet column holding this character's walk frame (jump frame sits below). */
  col: number;
  price: number;
  description: string;
}

export const DUNGEON_CHARACTERS: DungeonCharacterDef[] = [
  { id: 'knight',    name: 'Free Knight',  sheet: 'hero',       col: 0, price: 0,  description: 'The classic depths-delver. Every hero starts here.' },
  { id: 'wanderer',  name: 'Hooded Wanderer', sheet: 'character2', col: 0, price: 60, description: 'A silent traveller whose lantern never gutters.' },
  { id: 'warden',    name: 'Brimward Warden', sheet: 'character2', col: 1, price: 90, description: 'Wide-brimmed keeper of the deep roads.' },
  { id: 'sword_squire', name: 'Sword Squire', sheet: 'character2', col: 2, price: 120, description: 'Fresh to the order, sharp of blade and spirit.' },
  { id: 'rogue_blade', name: 'Rogue Blade',  sheet: 'character2', col: 3, price: 150, description: 'A duelist who learned the dark alleys first.' },
];

export function findDungeonCharacter(id: string): DungeonCharacterDef | undefined {
  return DUNGEON_CHARACTERS.find((c) => c.id === id);
}

/**
 * A character-sheet column carries cyan/red diamond registration marks at the
 * cell corners (same treatment as the hero sheet). Crop both 16×16 frames and
 * scrub those marker colors — the characters' own palettes have no bright
 * cyan or crimson — so they never show in-game.
 */
function sheetPoses(sheet: HTMLImageElement, col: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const cut = (row: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, col * 16, row * 16, 16, 16, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      const cyan = b > 170 && g > 130 && r < 130;
      const crimson = r > 160 && g < 90 && b < 90;
      if (a > 0 && (cyan || crimson)) px[i + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  };
  return [cut(0), cut(1)];
}

function heroCell(sheet: HTMLImageElement, col: number, row: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, col * 16, row * 16, 16, 16, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    const cyan = b > 170 && g > 130 && r < 130;
    const crimson = r > 160 && g < 90 && b < 90;
    if (a > 0 && (cyan || crimson)) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

let cache: LoadedDungeonAssets | null = null;

/** Load the pack (cached). Resolves to null when the atlas is unavailable. */
export async function loadDungeonAssets(): Promise<LoadedDungeonAssets | null> {
  if (cache) return cache;
  const atlas = await loadImage('/dungeon/tileset.png');
  if (!atlas) return null;
  const hero = (await loadImage('/dungeon/hero.png')) ?? atlas;
  const char2 = (await loadImage('/dungeon/character2.png')) ?? hero;

  const tiles = Object.fromEntries(
    Object.entries(ATLAS_TILES).map(([name, [sx, sy]]) => [name, atlasTile(atlas, sx, sy)]),
  ) as LoadedDungeonAssets['tiles'];

  const frames = new Map<string, HTMLImageElement[]>();
  await Promise.all(
    FRAME_SETS.map(async (set) => {
      const imgs = await Promise.all([1, 2, 3, 4].map((i) => loadImage(`/dungeon/${set}_${i}.png`)));
      const ok = imgs.filter((i): i is HTMLImageElement => i !== null);
      if (ok.length > 0) frames.set(set, ok);
    }),
  );

  // Buyable characters: cut + scrub every sheet column the catalog names.
  const sheetImgs = new Map<string, HTMLImageElement>([['hero', hero], ['character2', char2]]);
  const chars = new Map<string, [HTMLCanvasElement, HTMLCanvasElement]>();
  for (const def of DUNGEON_CHARACTERS) {
    const sheet = sheetImgs.get(def.sheet);
    if (sheet) chars.set(def.id, sheetPoses(sheet, def.col));
  }

  cache = { atlas, hero, frames, tiles, heroPoses: [heroCell(hero, 0, 0), heroCell(hero, 0, 2)], chars };
  return cache;
}

/**
 * Pack animation frame for a live-rendered 16×16 set (monster, chest, key…),
 * shared by the dungeon engine and the map editor preview. Returns null when
 * the pack has no frames for that set.
 */
export function packFrame(
  assets: LoadedDungeonAssets | null,
  set: string,
  timeSec: number,
  offset = 0,
): HTMLImageElement | null {
  const arr = assets?.frames.get(set);
  if (!arr || arr.length === 0) return null;
  return arr[(Math.floor(timeSec * 6) + offset) % arr.length];
}
