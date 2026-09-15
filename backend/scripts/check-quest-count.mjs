// Quick sanity checks for the per-book quest count helpers (M2).
import { clampTargetCount, perChapterTarget } from '../src/services/contentGenerator.js';

console.log('clamp:', {
  null: clampTargetCount(null),
  empty: clampTargetCount(''),
  zero: clampTargetCount(0),
  frac: clampTargetCount(7.4),
  huge: clampTargetCount(9999),
});
console.log('perChapter:', {
  split: perChapterTarget(30, 4), // ceil(30/4) = 8
  auto: perChapterTarget(null, 5),
  noChapters: perChapterTarget(3, 0),
  single: perChapterTarget(12, 1),
});
