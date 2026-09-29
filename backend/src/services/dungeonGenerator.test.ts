// Unit tests for the dungeon map generator (node:test, run with tsx):
//   cd backend && npm test
//
// Covers the three failure surfaces the LLM path can produce — malformed
// output, out-of-bounds/duplicate positions, unusable event data — plus the
// heuristic builder's guarantees for empty, general, and coding chapters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDungeonMap, generateHeuristicMap } from './dungeonGenerator.js';
import type { DungeonMap } from './dungeonGenerator.js';
import type { ChapterRow } from '../db/types.js';

function chapter(over: Partial<ChapterRow> = {}): ChapterRow {
  return {
    id: 'ch_test',
    bookId: 'book_test',
    idx: 0,
    title: 'Loops in Python',
    text: '',
    codeBlocks: [],
    compiled: null,
    ...over,
  };
}

/** A minimal valid monster_gate event. */
function gate(x: number, y: number, id = 'event_01') {
  return {
    event_id: id,
    type: 'monster_gate',
    grid_position: { x, y },
    data: {
      question: 'Which operator performs integer division in Python?',
      options: ['/', '//', '%', '**'],
      correct_index: 1,
      damage_on_fail: 1,
    },
  };
}

const IN_RANGE = (v: number) => v >= 1 && v <= 14;

// --- validateDungeonMap: rejection paths --------------------------------------

test('validateDungeonMap rejects null, primitives, and shapeless objects', () => {
  assert.equal(validateDungeonMap(null), null);
  assert.equal(validateDungeonMap(42), null);
  assert.equal(validateDungeonMap('nope'), null);
  assert.equal(validateDungeonMap({}), null);
  assert.equal(validateDungeonMap({ quest_meta: { title: 'x' } }), null);
  assert.equal(validateDungeonMap({ dungeon_events: [] }), null);
});

test('validateDungeonMap drops events with unusable data, yielding null when none survive', () => {
  // Garbage entries only → no map.
  const garbage = validateDungeonMap({
    dungeon_events: [null, 42, 'junk', {}, { type: 'monster_gate', grid_position: { x: 2, y: 2 }, data: {} }],
  });
  assert.equal(garbage, null);

  // A gate without options is dropped; a valid sibling keeps the map alive.
  const partial = validateDungeonMap({
    dungeon_events: [
      { type: 'monster_gate', grid_position: { x: 2, y: 2 }, data: { question: 'Q only, no options' } },
      gate(3, 3, 'event_02'),
    ],
  });
  assert.ok(partial);
  assert.equal(partial.dungeon_events.length, 1);
  assert.equal(partial.dungeon_events[0].event_id, 'event_02');
});

test('validateDungeonMap re-seats out-of-bounds and duplicate positions', () => {
  const map = validateDungeonMap({
    dungeon_events: [
      gate(0, 0, 'a'), // border → re-seat
      gate(99, -5, 'b'), // far out → re-seat
      gate(5, 5, 'c'), // fine
      gate(5, 5, 'd'), // duplicate → re-seat
    ],
  });
  assert.ok(map);
  assert.equal(map.dungeon_events.length, 4);
  const seen = new Set<string>();
  for (const e of map.dungeon_events) {
    assert.ok(IN_RANGE(e.grid_position.x), `x ${e.grid_position.x} out of range`);
    assert.ok(IN_RANGE(e.grid_position.y), `y ${e.grid_position.y} out of range`);
    const key = `${e.grid_position.x},${e.grid_position.y}`;
    assert.ok(!seen.has(key), `duplicate position ${key}`);
    seen.add(key);
  }
});

test('validateDungeonMap rebuilds rune scrambles from the correct sequence', () => {
  const seq = ['for i', 'in range(5):', 'print(i)'];
  const map = validateDungeonMap({
    dungeon_events: [
      {
        type: 'rune_socket',
        grid_position: { x: 4, y: 4 },
        data: { prompt: 'Order the loop:', scrambled_items: ['garbage', 'totally wrong'], correct_sequence: seq },
      },
    ],
  });
  assert.ok(map);
  const ev = map.dungeon_events[0];
  assert.equal(ev.type, 'rune_socket');
  assert.deepEqual(ev.data.correct_sequence, seq);
  // The scrambled list must be a permutation of the correct sequence — a
  // mismatched LLM scramble can never make the puzzle unsolvable.
  assert.deepEqual([...(ev.data.scrambled_items ?? [])].sort(), [...seq].sort());
});

test('validateDungeonMap sanitizes chest words and drops too-short ones', () => {
  const map = validateDungeonMap({
    dungeon_events: [
      { type: 'chest_lock', grid_position: { x: 6, y: 6 }, data: { target_word: ' mito-chondria! ', prompt: 'p' } },
      { type: 'chest_lock', grid_position: { x: 7, y: 6 }, data: { target_word: 'AB' } }, // too short → dropped
      { type: 'chest_lock', grid_position: { x: 8, y: 6 }, data: { target_word: 'RECURSION' } },
    ],
  });
  assert.ok(map);
  assert.equal(map.dungeon_events.length, 2);
  assert.equal(map.dungeon_events[0].data.target_word, 'MITOCHONDRIA');
  assert.equal(map.dungeon_events[1].data.target_word, 'RECURSION');
});

test('validateDungeonMap keeps at most 8 events', () => {
  const events = Array.from({ length: 12 }, (_, i) => gate(2 + (i % 12), 2 + Math.floor(i / 12) + 2, `g${i}`));
  const map = validateDungeonMap({ dungeon_events: events });
  assert.ok(map);
  assert.equal(map.dungeon_events.length, 8);
});

test('validateDungeonMap filters traps: bounds, corners, and event overlap', () => {
  const map = validateDungeonMap({
    traps: [
      { x: 0, y: 0 }, // out of bounds → dropped
      { x: 2, y: 2 }, // spawn corner → dropped
      { x: 13, y: 13 }, // portal corner → dropped
      { x: 5, y: 5 }, // overlaps the gate below → dropped
      { x: 8, y: 8 }, // valid
      { x: 8, y: 8 }, // duplicate → dropped
    ],
    dungeon_events: [gate(5, 5)],
  });
  assert.ok(map);
  assert.deepEqual(map.traps, [{ x: 8, y: 8 }]);
});

test('validateDungeonMap applies meta fallbacks', () => {
  const map: DungeonMap = validateDungeonMap({ dungeon_events: [gate(2, 2)] })!;
  assert.ok(map);
  assert.equal(map.quest_meta.title, 'The Depths');
  assert.equal(map.quest_meta.category, 'GENERAL');
  assert.equal(map.quest_meta.recommended_tileset, 'dungeon_dark');
  assert.deepEqual(map.map_dimensions, { width: 16, height: 16 });
});

// --- generateHeuristicMap -----------------------------------------------------

test('heuristic builder yields a playable map even for a completely empty chapter', () => {
  const map = generateHeuristicMap(chapter({ title: 'Untitled Fragment', text: '' }), { category: 'general' });
  assert.ok(map.dungeon_events.length >= 2, 'needs at least a gate and a chest');
  const types = map.dungeon_events.map((e) => e.type);
  assert.ok(types.includes('monster_gate'));
  assert.ok(types.includes('chest_lock'));
  assert.ok(map.traps && map.traps.length > 0, 'traps are placed even on last-resort maps');
});

test('heuristic builder turns existing multiple-choice challenges into monster gates', () => {
  const map = generateHeuristicMap(
    chapter({
      text: 'Python loops repeat work. A for loop iterates over sequences.',
    }),
    {
      category: 'general',
      challenges: [
        {
          type: 'multiple_choice',
          prompt: 'What does range(5) produce?',
          options: ['0..4', '1..5', 'nothing'],
          correctAnswer: '0..4',
          difficulty: 'easy',
        },
      ],
    },
  );
  const gates = map.dungeon_events.filter((e) => e.type === 'monster_gate');
  assert.ok(gates.length >= 1);
  const g = gates[0];
  assert.equal(g.data.question, 'What does range(5) produce?');
  assert.ok((g.data.correct_index ?? -1) >= 0);
  assert.equal(g.data.options?.[g.data.correct_index ?? -1], '0..4');
});

test('heuristic builder groups coding code lines into rune sockets', () => {
  const map = generateHeuristicMap(
    chapter({
      text: 'Iteration with for loops.',
      codeBlocks: [{ code: 'for i in range(5):\n    print(i)\n    pass', context: 'basic loop' }],
    }),
    { category: 'programming' },
  );
  const runes = map.dungeon_events.filter((e) => e.type === 'rune_socket');
  assert.ok(runes.length >= 1, 'coding chapters get code-line ordering puzzles');
  const seq = runes[0].data.correct_sequence ?? [];
  assert.ok(seq.length >= 2);
  for (const line of seq) {
    assert.ok(line.length >= 6 && line.length <= 60, `line too short/long: ${JSON.stringify(line)}`);
  }
});

test('heuristic maps round-trip through the validator with clean geometry', () => {
  const heur = generateHeuristicMap(
    chapter({
      text: 'Recursion happens when a function calls itself. Every recursive function needs a base case to stop. The call stack grows with each recursive call.',
      codeBlocks: [{ code: 'def fact(n):\n    return n * fact(n - 1)', context: 'recursion' }],
    }),
    { category: 'programming', challenges: [] },
  );
  assert.equal(heur.map_dimensions.width, 16);
  assert.equal(heur.map_dimensions.height, 16);

  const clean = validateDungeonMap(heur);
  assert.ok(clean, 'heuristic output must always validate');
  const eventKeys = new Set(heur.dungeon_events.map((e) => `${e.grid_position.x},${e.grid_position.y}`));
  for (const e of clean.dungeon_events) {
    assert.ok(IN_RANGE(e.grid_position.x) && IN_RANGE(e.grid_position.y));
    assert.ok(eventKeys.has(`${e.grid_position.x},${e.grid_position.y}`), 'validator must not relocate heuristic events');
  }
});

test('heuristic traps never sit on events, the spawn corner, or the portal corner', () => {
  const map = generateHeuristicMap(
    chapter({ text: 'Water cycles through evaporation, condensation, and precipitation. The sun drives the entire water cycle. Clouds form during condensation.' }),
    { category: 'general' },
  );
  assert.ok(map.traps);
  const eventKeys = new Set(map.dungeon_events.map((e) => `${e.grid_position.x},${e.grid_position.y}`));
  for (const t of map.traps) {
    assert.ok(IN_RANGE(t.x) && IN_RANGE(t.y), `trap ${t.x},${t.y} in bounds`);
    assert.ok(!(t.x <= 3 && t.y <= 3), 'no traps on the spawn corner');
    assert.ok(!(t.x >= 12 && t.y >= 12), 'no traps on the portal corner');
    assert.ok(!eventKeys.has(`${t.x},${t.y}`), 'no traps under events');
  }
});
