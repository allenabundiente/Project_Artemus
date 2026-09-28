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
  /** Hero poses scrubbed clean of the sheet's registration diamonds: [idle, walk]. */
  heroPoses: [HTMLCanvasElement, HTMLCanvasElement];
}

/**
 * The character sheet carries cyan/red diamond registration marks at cell
 * corners. Crop one 16×16 cell and scrub those marker colors (the knight's
 * own palette has no bright cyan or crimson) so they never show in-game.
 */
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

  cache = { atlas, hero, frames, tiles, heroPoses: [heroCell(hero, 0, 0), heroCell(hero, 0, 2)] };
  return cache;
}
