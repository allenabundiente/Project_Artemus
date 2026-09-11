// Sanity checks: every row in every grid has the same width, and every
// non-'.' character maps to a palette entry. Run: node scripts/validate-grids.mjs
import { SPRITES, PALETTE } from '../src/game/spriteGrids.js';
import { AVATAR_GRIDS } from '../src/game/avatarGrids.js';

let bad = 0;
for (const s of [...SPRITES, ...AVATAR_GRIDS]) {
  const w = s.grid[0].length;
  s.grid.forEach((row, i) => {
    if (row.length !== w) { console.error(`${s.name}: row ${i} width ${row.length} != ${w}`); bad++; }
    for (const ch of row) if (ch !== '.' && !PALETTE[ch]) { console.error(`${s.name}: row ${i} unknown char '${ch}'`); bad++; }
  });
}
if (bad) { console.error(`FAILED: ${bad} issues`); process.exit(1); }
console.log(`OK: ${SPRITES.length + AVATAR_GRIDS.length} grids valid`);
