// Dev-only: ASCII-render a few grids for quick visual review. Run:
//   npx tsx scripts/review-grids.ts
import { SPRITES } from '../src/game/spriteGrids.js';

for (const name of ['player_idle', 'player_run2', 'player_hurt', 'player_dead', 'enemy_goblin', 'boss', 'chest', 'coin', 'torch', 'castle_gate']) {
  const g = SPRITES.find((s) => s.name === name)!.grid;
  console.log(`--- ${name} ---`);
  for (const row of g.map((r) => r.replace(/\.+$/, ''))) if (row) console.log(row);
}
