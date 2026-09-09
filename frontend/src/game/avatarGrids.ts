// Pixel grids for avatar parts — PURE overlays: transparent ('.') everywhere
// the part has no pixels, so compositing cape → body → armor → hair → helmet
// works and the recolor pass only ever touches the part's own pixels.
//
// Conventions:
//   '.'  transparent (shows the layer beneath)
//   'k'  outline (near-black, untinted by recolor — it stays dark)
//   'H'  recolorable LIGHT zone (garment base)
//   'h'  recolorable SHADE zone (garment shadow / folds)
//   'm'  metal (untinted: steel, buckles)
//   'y'  gold trim (untinted)
//   'w'  eye white / highlight
//   'b'  eye pupil
//   'S'  skin (untinted, face/hands)
//
// The recolor pass maps H → tint, h → tint×0.72 (see game/avatar.ts). Every
// patch is 16 wide; head patches are 6 rows (rows 2–7, frame-stable), torso
// patches are 8 rows (rows 8–15) and ARE frame-aware where the torso moves.
// A cape set uses the same 8-row torso patch art for all frames (it hangs).

import type { SpriteDef } from './spriteGrids.js';

const FRAMES = ['idle', 'run1', 'run2', 'jump'] as const;

// --- canonical body bases (16 rows: rows 0–7 head, 8–15 torso) ----------------

const M_HEAD = [
  '................',
  '................',
  '.....kkkkk......',
  '....kSSSSSk.....',
  '....kSkSkSk.....',
  '....kwSbwSk.....',
  '....kSSSSSk.....',
  '.....kSSSk......',
];

const F_HEAD = M_HEAD; // same face; silhouettes differ via hair

// Torsos per frame (row 8..15). 'H' here is the DEFAULT tunic and gets the
// player's banner color; skin stays natural.
const M_TORSO_IDLE = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '...kHkHHHkHk....',
  '...kHkHHHkHk....',
  '....kHHHHHk.....',
  '....kSk.kSk.....',
  '....kSk.kSk.....',
  '....kMk.kMk.....',
];

const M_TORSO_RUN = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '...kHkHHHkHk....',
  '...kHkHHHkHk....',
  '....kHHHHHk.....',
  '...kSk...kSk....',
  '..kSk.....kSk...',
  '..kk.......kk...',
];

const M_TORSO_JUMP = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '...kHkHHHkHk....',
  '...kHkHHHkHk....',
  '....kHHHHHk.....',
  '....kSk.kSk.....',
  '...kSk...kSk....',
  '...kk.....kk....',
];

const F_TORSO_IDLE = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '..kSkHHHHHkSk...',
  '..kSkHHHHHkSk...',
  '....kHHHHHk.....',
  '....kSk.kSk.....',
  '....kSk.kSk.....',
  '....kMk.kMk.....',
];

const F_TORSO_RUN = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '..kSkHHHHHkSk...',
  '..kSkHHHHHkSk...',
  '....kHHHHHk.....',
  '...kSk...kSk....',
  '..kSk.....kSk...',
  '..kk.......kk...',
];

const F_TORSO_JUMP = [
  '....kkkkkkk.....',
  '...kHHHHHHHk....',
  '..kSkHHHHHkSk...',
  '..kSkHHHHHkSk...',
  '....kHHHHHk.....',
  '....kSk.kSk.....',
  '...kSk...kSk....',
  '...kk.....kk....',
];

function torsoFor(sex: 'male' | 'female', frame: string): string[] {
  if (sex === 'male') {
    if (frame === 'run1' || frame === 'run2') return M_TORSO_RUN;
    if (frame === 'jump') return M_TORSO_JUMP;
    return M_TORSO_IDLE;
  }
  if (frame === 'run1' || frame === 'run2') return F_TORSO_RUN;
  if (frame === 'jump') return F_TORSO_JUMP;
  return F_TORSO_IDLE;
}

// --- head patches (rows 2–7, frame-stable) ------------------------------------

const HAIR_HEAD: Record<string, Record<'male' | 'female', string[]>> = {
  short: {
    male: [
      '.....kkkkk......',
      '....kHHHHHk.....',
      '....kHkSkSk.....',
      '....kwSbwSk.....',
      '................',
      '................',
    ],
    female: [
      '.....kkkkk......',
      '....kHHHHHk.....',
      '...kHHkSkHHk....',
      '....kwSbwSk.....',
      '................',
      '................',
    ],
  },
  long: {
    male: [
      '.....kkkkk......',
      '....kHHHHHk.....',
      '...kHHkSkHHk....',
      '...kHwSbwSHk....',
      '...kHkSSSkHk....',
      '...kHSSSSSHk....',
    ],
    female: [
      '.....kkkkk......',
      '....kHHHHHk.....',
      '..kHHHkSkHHHk...',
      '..kHHwSbwSHHk...',
      '..kHHkSSSkHHk...',
      '..kHkSSSSSkHk...',
    ],
  },
  topknot: {
    male: [
      '......kkk.......',
      '.....kHHHk......',
      '....kHkSkHk.....',
      '....kwSbwSk.....',
      '................',
      '................',
    ],
    female: [
      '......kkk.......',
      '.....kHHHk......',
      '....kHkSkHHk....',
      '...kHkwSbwSk....',
      '...kH.......k...',
      '...kH.......k...',
    ],
  },
};

const HELM_HEAD: Record<string, Record<'male' | 'female', string[]>> = {
  kettle: {
    male: [
      '.....kkkkk......',
      '...kkHHHHHkk....',
      '..kHHHHHHHHHk...',
      '....kSkSkSk.....',
      '....kwSbwSk.....',
      '................',
    ],
    female: [
      '.....kkkkk......',
      '...kkHHHHHkk....',
      '..kHHHHHHHHHk...',
      '....kSkSkSk.....',
      '....kwSbwSk.....',
      '................',
    ],
  },
  great: {
    male: [
      '.....kkkkk......',
      '....kHHHHHk.....',
      '....kHHHHHk.....',
      '....kmkkkmk.....',
      '....kHHHHHk.....',
      '....kkkkkkk.....',
    ],
    female: [
      '......yyy.......',
      '....kkHHHkk.....',
      '....kHHHHHk.....',
      '....kmkkkmk.....',
      '....kHHHHHk.....',
      '....kkkkkkk.....',
    ],
  },
};

// --- capes (torso-window overlays, rows 8–15; hang behind the body) -----------

// Pure 8-row patches that sit 1px WIDER than the torso on each side, so the
// cape peeks past the shoulders and shows through the gap between the legs.
const CAPE_TORSO: Record<string, string[]> = {
  cloth: [
    '..khhhhhhhhhk...',
    '..khhHhhhhhhk...',
    '..khhHhhhhhhk...',
    '..khhHhhhhhhk...',
    '...khHhhhhhk....',
    '...khhHhhhhk....',
    '....khhHhhk.....',
    '....khhhhk......',
  ],
  silk: [
    '..khhhhhhhhhk...',
    '..khyHHHHhyhk...',
    '..khyHHHHhyhk...',
    '..khyHHHHhyhk...',
    '...kyHHHHyk.....',
    '...kyHHHHyk.....',
    '....kyHHyk......',
    '.....kyHk.......',
  ],
};

// --- assembly -------------------------------------------------------------------

/** Full 16-row canonical body: head rows 0–7 + frame torso rows 8–15. */
function bodyFull(sex: 'male' | 'female', f: string): string[] {
  return [...(sex === 'male' ? M_HEAD : F_HEAD), ...torsoFor(sex, f)];
}

/** A pure 16-row overlay sprite: `patch` placed at `fromRow`, transparent elsewhere. */
function patchAt(patch: string[], fromRow: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) rows.push(y >= fromRow && y < fromRow + patch.length ? (patch[y - fromRow] ?? '') : '................');
  return rows;
}

const out: SpriteDef[] = [];

// Hair & helmets: pure patches over head rows 2–7 (frame-stable).
for (const [set, bySex] of Object.entries(HAIR_HEAD)) {
  for (const sex of ['male', 'female'] as const) {
    for (const f of FRAMES) {
      out.push({ name: `avatar_hair_${set}_${sex}_${f}`, grid: patchAt(bySex[sex], 2) });
    }
  }
}
for (const [set, bySex] of Object.entries(HELM_HEAD)) {
  for (const sex of ['male', 'female'] as const) {
    for (const f of FRAMES) {
      out.push({ name: `avatar_helmet_${set}_${sex}_${f}`, grid: patchAt(bySex[sex], 2) });
    }
  }
}

// Armor: pure 5-row chest patches (absolute rows 8–12). Arms/legs (rows 13–15
// and the arm columns) stay transparent so the body's frame animation shows
// through untouched.
const ARMOR_CHEST: Record<string, string[]> = {
  tunic: [
    '....kkkkkkk.....',
    '...kHHHHHHHk....',
    '...kHkHHHkHk....',
    '...kHkHHHkHk....',
    '....kHyyyHk.....', // gold-buckled belt
  ],
  leather: [
    '....kkkkkkk.....',
    '...khhhhhhhk....',
    '...khkmhmkhk....', // steel buckles down the front
    '...khkmhmkhk....',
    '....khhhhhk.....',
  ],
  plate: [
    '....kkkkkkk.....',
    '...kyyyyyyyk....', // gold-trimmed collar
    '...kmkmmmkmk....',
    '...kmkmmmkmk....',
    '....kyyyyyk.....', // gold belt
  ],
};
for (const [set, chest] of Object.entries(ARMOR_CHEST)) {
  for (const sex of ['male', 'female'] as const) {
    for (const f of FRAMES) {
      out.push({ name: `avatar_armor_${set}_${sex}_${f}`, grid: patchAt(chest, 8) });
    }
  }
}

// Capes: pure 8-row patches (rows 8–15), identical across frames — they hang
// behind the body, visible past the shoulders and between the legs.
for (const [set, capePatch] of Object.entries(CAPE_TORSO)) {
  for (const sex of ['male', 'female'] as const) {
    for (const f of FRAMES) {
      out.push({ name: `avatar_cape_${set}_${sex}_${f}`, grid: patchAt(capePatch, 8) });
    }
  }
}

// Body bases (full 16 rows: head + torso).
for (const f of FRAMES) {
  out.push({ name: `avatar_body_male_${f}`, grid: bodyFull('male', f) });
  out.push({ name: `avatar_body_female_${f}`, grid: bodyFull('female', f) });
}

export const AVATAR_GRIDS: SpriteDef[] = out;
