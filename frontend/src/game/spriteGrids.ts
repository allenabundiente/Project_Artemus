// Canonical pixel-art definitions — medieval theme. Each sprite is an array of
// strings; every character maps to one palette color ('.' = transparent).
// These grids are the single source of truth: scripts/generate-sprites.ts
// renders them to PNG files in public/sprites/, and the game falls back to
// drawing them directly if a PNG fails to load.

export const PALETTE: Record<string, [number, number, number]> = {
  k: [0x14, 0x0d, 0x0a], // near-black outline (torch-lit dark)
  b: [0x2a, 0x1f, 0x2e], // deep dungeon purple-brown (night/dungeon sky)
  p: [0x4f, 0x2a, 0x25], // deep red-brown (dungeon brick)
  g: [0x3f, 0x5d, 0x3a], // mossy dark green
  n: [0x8b, 0x5a, 0x2b], // wood brown
  d: [0x5c, 0x55, 0x4e], // stone grey
  l: [0xb8, 0xb2, 0xa6], // light stone
  w: [0xf2, 0xe8, 0xd5], // parchment white
  r: [0xa8, 0x2a, 0x2a], // deep heraldic red
  o: [0xd9, 0x7d, 0x2b], // torch orange
  y: [0xe8, 0xb4, 0x3c], // gold
  G: [0x6f, 0x9c, 0x3d], // goblin green
  B: [0x7f, 0xb3, 0xcb], // steel blue
  v: [0x8a, 0x7f, 0x9e], // dusty lavender
  P: [0xc9, 0x5d, 0x7a], // rose (banners)
  c: [0xd8, 0xb9, 0x8a], // parchment/skin
  m: [0x9d, 0xd1, 0xff], // mythril silvery-blue
  M: [0x53, 0x3a, 0x1e], // dark wood
  s: [0x70, 0x6a, 0x62], // mid stone
  t: [0xff, 0xa1, 0x3d], // torch flame
  e: [0x3a, 0x2c, 0x22], // earth dark
  // Avatar recolor channels (see game/avatar.ts): green-dominant pixels are
  // the "chroma" the wardrobe tints — bright H takes the tint, darker h takes
  // the tint's shade. Everything else (skin, metal, gold, outlines) passes
  // through untouched.
  H: [0x00, 0xe4, 0x36], // recolorable LIGHT garment zone
  h: [0x00, 0x8a, 0x22], // recolorable SHADE garment zone
  S: [0xd8, 0xb9, 0x8a], // skin (same tone as 'c', named for avatar grids)
};

export interface SpriteDef {
  name: string;
  grid: string[];
}

export const SPRITES: SpriteDef[] = [
  {
    // The adventurer: helmeted knight with a sword at the ready.
    name: 'player_idle',
    grid: [
      '................',
      '................',
      '.....kkkkk......',
      '....klllllk.....',
      '....klkklkk.....',
      '....kwwkwwk.....',
      '....kcccck......',
      '....kccccck.....',
      '.....kkkkk......',
      '....klllllk..y..',
      '...klllllllk.y..',
      '...kllrrlllkky..',
      '...kllrrlllkyk..',
      '....klllllk..y..',
      '....kMMkMMk..k..',
      '....kMMkMMk.....',
    ],
  },
  {
    name: 'player_run1',
    grid: [
      '................',
      '................',
      '.....kkkkk......',
      '....klllllk.....',
      '....klkklkk.....',
      '....kwwkwwk.....',
      '....kcccck......',
      '....kccccck.....',
      '.....kkkkk......',
      '....klllllk..y..',
      '...klllllllk.y..',
      '...kllrrlllkky..',
      '...kllrrlllkyk..',
      '....klllllk..y..',
      '...kMMkMMk...k..',
      '.....kMMk.......',
    ],
  },
  {
    name: 'player_run2',
    grid: [
      '................',
      '................',
      '.....kkkkk......',
      '....klllllk.....',
      '....klkklkk.....',
      '....kwwkwwk.....',
      '....kcccck......',
      '....kccccck.....',
      '.....kkkkk......',
      '....klllllk..y..',
      '...klllllllk.y..',
      '...kllrrlllkky..',
      '...kllrrlllkyk..',
      '....klllllk..y..',
      '....kMMkMMk..k..',
      '......kMMk......',
    ],
  },
  {
    name: 'player_jump',
    grid: [
      '................',
      '................',
      '.....kkkkk......',
      '....klllllk.....',
      '....klkklkk.....',
      '....kwwkwwk.....',
      '....kcccck......',
      '....kccccck.....',
      '.....kkkkk......',
      '....klllllk..y..',
      '...klllllllk.y..',
      '...kllrrlllkky..',
      '...kllrrlllkyk..',
      '....klllllk..y..',
      '...kMMk..kMMk...',
      '...kMMk..kMMk...',
    ],
  },
  {
    // Goblin blob monster.
    name: 'enemy_goblin',
    grid: [
      '................',
      '.....kk..kk.....',
      '......k..k......',
      '.....kGGGGk.....',
      '....kGGGGGGk....',
      '...kGGwGGwGGk...',
      '...kGGkGGkGGk...',
      '...kGGGGGGGGk...',
      '....kGrrrrGk....',
      '....kGGGGGGk....',
      '.....kGkkGk.....',
      '....kGk..kGk....',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    // Slime monster.
    name: 'enemy_slime',
    grid: [
      '................',
      '................',
      '................',
      '......kkkk......',
      '....kkGGGGkk....',
      '...kGGGGGGGGk...',
      '..kGGwGGGGwGGk..',
      '..kGGkGGGGkGGk..',
      '..kGGGGGGGGGGk..',
      '.kGGGGGGGGGGGGk.',
      '.kGGGkkkkkkGGGk.',
      '.kkkkkkkkkkkkkk.',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    // Cave bat monster.
    name: 'enemy_bat',
    grid: [
      '................',
      '................',
      '..kk........kk..',
      '.kppk......kppk.',
      '.kppppk..kppppk.',
      '..kppppkkppppk..',
      '...kppppppppk...',
      '....kpwppppwk...',
      '....kpppppppk...',
      '.....kpk..kpk...',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    // Legacy alias kept so old saved layouts still render.
    name: 'enemy_bug',
    grid: [
      '................',
      '.....kk..kk.....',
      '......k..k......',
      '.....kGGGGk.....',
      '....kGGGGGGk....',
      '...kGGwGGwGGk...',
      '...kGGkGGkGGk...',
      '...kGGGGGGGGk...',
      '....kGrrrrGk....',
      '....kGGGGGGk....',
      '.....kGkkGk.....',
      '....kGk..kGk....',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    // The dungeon boss: a horned dungeon brute.
    name: 'boss',
    grid: [
      '........................',
      '...kk..............kk...',
      '..krrk............krrk..',
      '..krrrk..........krrrk..',
      '...krrkkkkkkkkkkkkrrk...',
      '....kkrrrrrrrrrrrrkk....',
      '.....krrrrrrrrrrrrrk....',
      '....krrrrrrrrrrrrrrrk...',
      '....krrwwrrrrrrwwrrrk...',
      '....krrwerrrrrrwerrrk...',
      '....krrrrrrrrrrrrrrrk...',
      '....krrrrkkkkkkrrrrrk...',
      '....krrrrkyyyykrrrrrk...',
      '....krrrrkkkkkkrrrrrk...',
      '....krrrrrrrrrrrrrrrk...',
      '....krrrrrkkkkrrrrrrk...',
      '....krrrrrrrrrrrrrrrk...',
      '.....krrrrrrrrrrrrrk....',
      '....krrrkrrrrrrrrkrrrk..',
      '...krrk..krrrrrrk..krrk.',
      '...kkk...krrrrrrk...kkk.',
      '..........kkkkkk........',
      '........................',
      '........................',
    ],
  },
  {
    // Legacy alias for the old boss name.
    name: 'bookworm',
    grid: [
      '................',
      '.....kk..kk.....',
      '......k..k......',
      '.....kGGGGk.....',
      '....kGGGGGGk....',
      '...kGGwGGwGGk...',
      '...kGGkGGkGGk...',
      '...kGGGGGGGGk...',
      '....kGrrrrGk....',
      '....kGGGGGGk....',
      '.....kGkkGk.....',
      '....kGk..kGk....',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    name: 'bookworm_hurt',
    grid: [
      '................',
      '.....kk..kk.....',
      '......k..k......',
      '.....krrrrk.....',
      '....krrrrrrk....',
      '...krrwrrwrrk...',
      '...krrkrrkrrk...',
      '...krrrrrrrrk...',
      '....kryyyyrk....',
      '....krrrrrrk....',
      '.....kryyrk.....',
      '....krk..krk....',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    // Treasure chest — rewards at quest's end.
    name: 'chest',
    grid: [
      '................',
      '................',
      '..kkkkkkkkkkkk..',
      '.kMMMMMMMMMMMMk.',
      '.kMyMyMyMyMyMk..',
      '.kMMMMMMMMMMMMk.',
      '.kMMMMMMkMMMMMk.',
      '.kkkkkkkkkkkkkk.',
      '.kMMMMMkyykMMMk.',
      '.kMMMMMkyykMMMk.',
      '.kMMMMMMkkMMMMk.',
      '.kMMMMMMMMMMMMk.',
      '.kMMMMMMMMMMMMk.',
      '..kkkkkkkkkkkk..',
      '................',
      '................',
    ],
  },
  {
    // Castle gate — the quest's end (replaces the flag).
    name: 'castle_gate',
    grid: [
      'kkkkkkkkkkkkkkkk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'kllllllllllllllk',
      'klllllpppppllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'klllllppkkpllllk',
      'kkkkkkkkkkkkkkkk',
      'kkkkkkkkkkkkkkkk',
    ],
  },
  {
    // Legacy alias for the old flag name.
    name: 'flag',
    grid: [
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '..........yyyy..',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
      '...........kk...',
    ],
  },
  {
    // Wall torch — dungeon ambience.
    name: 'torch',
    grid: [
      '.....tt.....',
      '....tott....',
      '....tott....',
      '.....tt.....',
      '.....MM.....',
      '.....MM.....',
      '.....MM.....',
      '.....MM.....',
      '.....MM.....',
      '.....MM.....',
    ],
  },
  {
    // Medieval coin — gold with a crown stamp.
    name: 'coin',
    grid: [
      '.....yy......',
      '...yyyyyy....',
      '..yyyyyyyy...',
      '.yyyykyyyyy..',
      '.yyykkkyyyy..',
      '.yyyykkyyyyy.',
      '.yyyyyyyyyyy.',
      '.yyyyyyyyyyy.',
      '..yyyyyyyy...',
      '...yyyyyy....',
      '.....yy......',
      '.............',
    ],
  },
  {
    name: 'heart',
    grid: [
      '..rr....rr..',
      '.rrrr..rrrr.',
      'rrrrrrrrrrrr',
      'rrrrrrrrrrrr',
      'rrrrrrrrrrrr',
      '.rrrrrrrrrr.',
      '..rrrrrrrr..',
      '...rrrrrr...',
      '............',
    ],
  },
  {
    name: 'heart_empty',
    grid: [
      '..dd....dd..',
      '.dddd..dddd.',
      'dddddddddddd',
      'dddddddddddd',
      'dddddddddddd',
      '.dddddddddd.',
      '..dddddddd..',
      '...dddddd...',
      '............',
    ],
  },
  {
    // Rank badges — shield crests, color-coded per tier.
    name: 'badge_mythril',
    grid: [
      'kmmmmmmmmmmk',
      'kmmmmwwmmmmk',
      'kmmmmwwmmmmk',
      'kmmmwwwwmmmk',
      'kmmmmwwmmmmk',
      'kmmmmwwmmmmk',
      '.kmmmmmmmmk.',
      '..kmmmmmmk..',
      '...kmmmmk...',
      '....kmmk....',
      '.....kk.....',
    ],
  },
  {
    name: 'badge_diamond',
    grid: [
      'kBBBBBBBBBBk',
      'kBBBmwwBBBBk',
      'kBBBmwwBBBBk',
      'kBBBwwwwBBBk',
      'kBBBBwwBBBBk',
      'kBBBBwwBBBBk',
      '.kBBBBBBBBk.',
      '..kBBBBBBk..',
      '...kBBBBk...',
      '....kBBk....',
      '.....kk.....',
    ],
  },
  {
    name: 'badge_gold',
    grid: [
      'kyyyyyyyyyyk',
      'kyyyyooyyyyk',
      'kyyyyooyyyyk',
      'kyyyoooooyyk',
      'kyyyyooyyyyk',
      'kyyyyooyyyyk',
      '.kyyyyyyyyk.',
      '..kyyyyyyk..',
      '...kyyyyk...',
      '....kyyk....',
      '.....kk.....',
    ],
  },
  {
    name: 'badge_iron',
    grid: [
      'kllllllllllk',
      'kllllddllllk',
      'kllllddllllk',
      'klllddddlllk',
      'kllllddllllk',
      'kllllddllllk',
      '.kllllllllk.',
      '..kllllllk..',
      '...kllllk...',
      '....kllk....',
      '.....kk.....',
    ],
  },
  {
    name: 'badge_copper',
    grid: [
      'kooooooooook',
      'koooonnooook',
      'koooonnooook',
      'kooonnnnoook',
      'koooonnooook',
      'koooonnooook',
      '.kooooooook.',
      '..kooooook..',
      '...koooook..',
      '....kook....',
      '.....kk.....',
    ],
  },
];

export function getSprite(name: string): SpriteDef {
  const s = SPRITES.find((x) => x.name === name);
  if (!s) throw new Error(`Unknown sprite: ${name}`);
  return s;
}

/** Render a sprite grid into { width, height, rgba } where rgba is RGBA bytes. */
export function renderGrid(grid: string[]): { width: number; height: number; rgba: Uint8Array } {
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      const i = (y * width + x) * 4;
      if (ch === '.') {
        rgba[i + 3] = 0;
      } else {
        const [r, g, b] = PALETTE[ch] ?? PALETTE.k;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}
