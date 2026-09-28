// Top-down dungeon map generator ("The Depths").
//
// Turns a chapter into a structured, playable map JSON:
//   MONSTER_GATE — fast recall / multiple choice guarding a corridor
//   RUNE_SOCKET  — ordering/sequence puzzle on a pedestal
//   CHEST_LOCK   — word completion (Hangaroo style) chest
//
// LLM mode: one strict-JSON call per chapter (reuses the shared llmClient).
// Heuristic mode: derives events from the chapter's own text and existing
// challenges so the game is fully playable with no API key.
//
// Every map passes validateDungeonMap() before it is stored — malformed LLM
// output falls back to the heuristic builder instead of ever reaching a player.

import { callLlm, isLlmConfigured } from './llmClient.js';
import type { ChapterRow, CodeBlock } from '../db/types.js';

export type DungeonEventType = 'monster_gate' | 'rune_socket' | 'chest_lock';

export interface DungeonEvent {
  event_id: string;
  type: DungeonEventType;
  grid_position: { x: number; y: number };
  data: {
    // monster_gate
    question?: string;
    options?: string[];
    correct_index?: number;
    damage_on_fail?: number;
    enemy_sprite?: string;
    // rune_socket
    prompt?: string;
    scrambled_items?: string[];
    correct_sequence?: string[];
    // chest_lock
    target_word?: string;
    hint?: string;
    allowed_mistakes?: number;
    reward?: string;
  };
}

export interface DungeonMap {
  quest_meta: {
    title: string;
    category: 'GENERAL' | 'CODING';
    recommended_tileset: string;
  };
  map_dimensions: { width: number; height: number };
  dungeon_events: DungeonEvent[];
  /** Optional spike-trap tiles — passable but harmful unless surging. */
  traps?: { x: number; y: number }[];
}

const MAP_W = 16;
const MAP_H = 16;
const MAX_EVENTS = 8;

export interface DungeonGenerationOptions {
  category: 'general' | 'programming' | 'language';
  /** Existing challenges for the chapter — reused by the heuristic builder. */
  challenges?: { type: string; prompt: string; options: string[] | null; correctAnswer: string; difficulty: string }[];
}

const SYSTEM_PROMPT = `You are an expert retro game level designer and instructional design AI. Your task is to process an educational text payload and convert it into a structured Top-Down Dungeon Quest JSON format.

DOCUMENT TYPE: {{CATEGORY}}

INSTRUCTIONS:
1. Analyze the input text and extract key concepts, definitions, logic sequences, or code blocks.
2. Structure the output into a playable 2D Top-Down Dungeon Map layout.
3. Assign quest elements to interactive tile objects:
   - "monster_gate": Fast-paced recall/multiple choice. Impasses guarded by enemies that require a quick correct answer to pass.
   - "rune_socket": Sequence/Ordering puzzle. Used for chronologies (General) or code block arrangements (Coding).
   - "chest_lock": Word/Term completion (Hangaroo style). Used for key terms, syntax, or vocabulary.
4. Keep question text clear, concise, and direct for fast-paced gameplay.
5. Place events on a 16x16 grid (positions 1..14 so nothing sits on the border walls). Do not overlap positions. Use at most 8 events, at least one of each type when the content allows.
6. Optionally add a "traps" array of up to 8 { "x", "y" } grid positions for spike traps. Traps must not overlap events or the spawn corner (x <= 3 and y <= 3). Spike traps are passable but hurt — place them to force careful routing, or in front of monster gates so a SURGE-charged shield is the fast way through.

OUTPUT FORMAT REQUIREMENTS:
Return ONLY a valid JSON object matching this schema. Do not include markdown code block formatting or intro text.
{
  "quest_meta": { "title": string, "category": "GENERAL" | "CODING", "recommended_tileset": "dungeon_dark" },
  "map_dimensions": { "width": 16, "height": 16 },
  "traps": [{ "x": number, "y": number }],
  "dungeon_events": [
    {
      "event_id": string,
      "type": "monster_gate" | "rune_socket" | "chest_lock",
      "grid_position": { "x": number, "y": number },
      "data": {
        // monster_gate: { "question": string, "options": string[4], "correct_index": 0-3, "damage_on_fail": number }
        // rune_socket:  { "prompt": string, "scrambled_items": string[], "correct_sequence": string[] }
        // chest_lock:   { "prompt": string, "target_word": string (single word, A-Z only), "hint": string, "allowed_mistakes": number }
      }
    }
  ]
}`;

function sliceChapterText(chapter: ChapterRow, max = 4500): string {
  const code = (Array.isArray(chapter.codeBlocks) ? (chapter.codeBlocks as CodeBlock[]) : [])
    .map((c) => c?.code ?? '').filter(Boolean).join('\n\n');
  const text = `${chapter.text}\n\n${code}`.trim();
  return text.slice(0, max);
}

/** The chapter's code blocks as plain code strings (empty when none). */
function codeLines(chapter: ChapterRow): string[] {
  return (Array.isArray(chapter.codeBlocks) ? (chapter.codeBlocks as CodeBlock[]) : [])
    .map((c) => c?.code ?? '')
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 6 && l.length <= 60);
}

// --- validation ---------------------------------------------------------------

function isFiniteInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= lo && v <= hi;
}

function cleanText(v: unknown, max = 240): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Validate + normalize an untrusted map object (from the LLM). Returns a clean
 * DungeonMap or null when the shape is unusable. Position/event-id fixes are
 * applied silently; events with unusable data are dropped one by one.
 */
export function validateDungeonMap(raw: unknown): DungeonMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const meta = (obj.quest_meta ?? {}) as Record<string, unknown>;
  if (!Array.isArray(obj.dungeon_events) || obj.dungeon_events.length === 0) return null;

  const events: DungeonEvent[] = [];
  const used = new Set<string>();
  let nextIdx = 1;

  for (const rawEvt of obj.dungeon_events.slice(0, MAX_EVENTS)) {
    if (!rawEvt || typeof rawEvt !== 'object') continue;
    const e = rawEvt as Record<string, unknown>;
    const type = e.type;
    const d = (e.data ?? {}) as Record<string, unknown>;

    // Keep only positions in 1..14, de-duplicated (border cells stay walls).
    const gp = (e.grid_position ?? {}) as Record<string, unknown>;
    let x = isFiniteInt(gp.x, 1, MAP_W - 2) ? gp.x : -1;
    let y = isFiniteInt(gp.y, 1, MAP_H - 2) ? gp.y : -1;
    if (x < 0 || y < 0 || used.has(`${x},${y}`)) {
      // Re-seat onto the next free grid cell (snake left→right, top→bottom).
      for (let i = 1; i <= (MAP_W - 2) * (MAP_H - 2); i++) {
        const row = Math.floor((i - 1) / (MAP_W - 2)) + 1;
        const col = ((i - 1) % (MAP_W - 2)) + 1;
        if (!used.has(`${col},${row}`)) { x = col; y = row; break; }
      }
      if (x < 0 || y < 0) break;
    }
    used.add(`${x},${y}`);

    const id = cleanText(e.event_id, 40) || `event_${String(nextIdx).padStart(2, '0')}`;
    const eventId = used.size && events.some((ev) => ev.event_id === id) ? `${id}_${nextIdx}` : id;
    nextIdx++;

    if (type === 'monster_gate') {
      const options = Array.isArray(d.options) ? d.options.map((o) => cleanText(o, 120)).filter(Boolean) : [];
      const correct = isFiniteInt(d.correct_index, 0, options.length - 1) ? d.correct_index : -1;
      const question = cleanText(d.question, 400);
      if (question.length < 3 || options.length < 2 || correct < 0) continue;
      events.push({
        event_id: eventId, type: 'monster_gate', grid_position: { x, y },
        data: {
          question, options, correct_index: correct,
          damage_on_fail: isFiniteInt(d.damage_on_fail, 1, 3) ? d.damage_on_fail : 1,
          enemy_sprite: cleanText(d.enemy_sprite, 40) || 'enemy_goblin',
        },
      });
    } else if (type === 'rune_socket') {
      const seq = Array.isArray(d.correct_sequence) ? d.correct_sequence.map((s) => cleanText(s, 120)).filter(Boolean) : [];
      if (seq.length < 2 || seq.length > 6) continue;
      const prompt = cleanText(d.prompt, 300) || 'Arrange the blocks in the correct order:';
      // Rebuild the scramble from the correct sequence so a mismatched LLM
      // scramble can never make the puzzle unsolvable.
      const scrambled = seq.slice().sort(() => Math.random() - 0.5);
      if (scrambled.every((s, i) => s === seq[i])) scrambled.reverse();
      events.push({
        event_id: eventId, type: 'rune_socket', grid_position: { x, y },
        data: { prompt, scrambled_items: scrambled, correct_sequence: seq },
      });
    } else if (type === 'chest_lock') {
      const word = cleanText(d.target_word, 24).toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length < 3 || word.length > 14) continue;
      events.push({
        event_id: eventId, type: 'chest_lock', grid_position: { x, y },
        data: {
          target_word: word,
          hint: cleanText(d.hint ?? d.prompt, 300) || 'Complete the word.',
          allowed_mistakes: isFiniteInt(d.allowed_mistakes, 1, 6) ? d.allowed_mistakes : 3,
          reward: cleanText(d.reward, 40) || 'Gold',
        },
      });
    }
  }

  if (events.length === 0) return null;

  // Traps (optional from the LLM): clamp in-bounds, dedupe against each other
  // and against event tiles, keep the spawn corner and portal mouth clear.
  const trapsOut: { x: number; y: number }[] = [];
  const trapRaw = Array.isArray(obj.traps) ? obj.traps : [];
  for (const rawTrap of trapRaw.slice(0, 12)) {
    if (!rawTrap || typeof rawTrap !== 'object') continue;
    const t = rawTrap as Record<string, unknown>;
    if (!isFiniteInt(t.x, 1, MAP_W - 2) || !isFiniteInt(t.y, 1, MAP_H - 2)) continue;
    if (t.x <= 3 && t.y <= 3) continue; // spawn corner
    if (t.x >= MAP_W - 4 && t.y >= MAP_H - 4) continue; // portal corner
    const key = `${t.x},${t.y}`;
    if (used.has(key) || trapsOut.some((p) => p.x === t.x && p.y === t.y)) continue;
    trapsOut.push({ x: t.x, y: t.y });
  }

  const category = cleanText(meta.category, 10).toUpperCase() === 'CODING' ? 'CODING' : 'GENERAL';
  return {
    quest_meta: {
      title: cleanText(meta.title, 120) || 'The Depths',
      category,
      recommended_tileset: cleanText(meta.recommended_tileset, 40) || 'dungeon_dark',
    },
    map_dimensions: { width: MAP_W, height: MAP_H },
    dungeon_events: events,
    ...(trapsOut.length > 0 ? { traps: trapsOut } : {}),
  };
}

// --- heuristic builder ---------------------------------------------------------

const STOPWORDS = new Set(['THE', 'AND', 'FOR', 'WITH', 'THAT', 'THIS', 'FROM', 'HAVE', 'NOT', 'ARE', 'WAS', 'BUT', 'YOU', 'YOUR', 'ITS', 'INTO', 'WHEN', 'EACH', 'WHICH', 'THEIR', 'SAID', 'WILL', 'ABOUT', 'OUT', 'MANY', 'THEN', 'THEM', 'THESE', 'SOME', 'HER', 'SHE', 'HIM', 'HAS', 'ONE', 'ALL', 'CAN', 'HER', 'WHO', 'MORE', 'USE', 'TWO', 'HOW', 'WHAT', 'WERE']);

function candidateKeywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toUpperCase().match(/[A-Z][A-Z_]{3,17}/g) ?? []) {
    const w = raw.replace(/_+$/, '');
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

/** Split a list into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.filter((c) => c.length >= 2);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9`])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24 && s.length <= 220);
}

/**
 * Deterministic, dependency-free map builder. Uses the chapter's own
 * challenges for monster gates where available, keywords for chest locks, and
 * sentence fragments for rune sockets. Always yields a playable map.
 */
export function generateHeuristicMap(chapter: ChapterRow, opts: DungeonGenerationOptions): DungeonMap {
  const coding = opts.category === 'programming';
  const events: DungeonEvent[] = [];
  let slot = 0;
  const place = (): { x: number; y: number } => {
    // Snake path placement: walk the grid in reading order — feels like a
    // route. Skip the top-left spawn corner so the hero never spawns on a
    // marker (the engine also re-seats its spawn defensively).
    let x = 1;
    let y = 1;
    do {
      const row = Math.floor(slot / (MAP_W - 2));
      const col = slot % (MAP_W - 2);
      x = row % 2 === 0 ? col + 1 : MAP_W - 2 - col;
      y = Math.min(MAP_H - 2, row + 1);
      slot += 2;
    } while (x <= 2 && y <= 2);
    return { x, y };
  };

  // 1) Monster gates from the chapter's existing challenges (reuse real quiz items).
  for (const c of opts.challenges ?? []) {
    if (events.length >= MAX_EVENTS - 2) break;
    if (c.type === 'multiple_choice' && Array.isArray(c.options) && c.options.length >= 2) {
      const idx = c.options.findIndex((o) => o.trim() === c.correctAnswer.trim());
      if (idx >= 0) {
        events.push({
          event_id: `event_${String(events.length + 1).padStart(2, '0')}`,
          type: 'monster_gate',
          grid_position: place(),
          data: { question: c.prompt, options: c.options.slice(0, 4), correct_index: idx, damage_on_fail: 1, enemy_sprite: 'enemy_goblin' },
        });
      }
    } else if ((c.type === 'true_false' || c.type === 'predict_output') && c.options && c.options.length >= 2) {
      const idx = c.options.findIndex((o) => o.trim() === c.correctAnswer.trim());
      if (idx >= 0) {
        events.push({
          event_id: `event_${String(events.length + 1).padStart(2, '0')}`,
          type: 'monster_gate',
          grid_position: place(),
          data: { question: c.prompt, options: c.options.slice(0, 4), correct_index: idx, damage_on_fail: 1, enemy_sprite: 'enemy_slime' },
        });
      }
    }
  }

  // 2) Chest locks from frequent keywords (or code identifiers for coding books).
  const codeText = (Array.isArray(chapter.codeBlocks) ? (chapter.codeBlocks as CodeBlock[]) : [])
    .map((c) => c?.code ?? '').join('\n');
  const source = coding && codeText.trim() ? codeText : chapter.text;
  for (const word of candidateKeywords(source, 8)) {
    if (events.length >= MAX_EVENTS - 1) break;
    if (events.some((e) => e.type === 'chest_lock' && e.data.target_word === word)) continue;
    events.push({
      event_id: `event_${String(events.length + 1).padStart(2, '0')}`,
      type: 'chest_lock',
      grid_position: place(),
      data: { target_word: word, hint: `A key term from "${chapter.title}".`, allowed_mistakes: 3, reward: 'Gold' },
    });
  }

  // 3) Rune sockets from sentence fragments (general) or code lines (coding).
  //    Coding mode groups consecutive code lines into 3-line blocks to reorder.
  const lines: string[][] = coding
    ? chunk(codeLines(chapter), 3)
    : splitSentences(chapter.text).flatMap((s) => {
        const words = s.split(' ');
        if (words.length < 8) return [];
        const mid = Math.ceil(words.length / 3);
        return [[words.slice(0, mid).join(' '), words.slice(mid, mid * 2).join(' '), words.slice(mid * 2).join(' ')]];
      }).filter((parts) => parts.every((p) => p.length >= 3));
  if (lines.length === 0 && chapter.text.length > 60) {
    const sentence = splitSentences(chapter.text)[0] ?? chapter.text.slice(0, 90);
    const mid = Math.ceil(sentence.length / 2);
    const cut = sentence.indexOf(' ', mid);
    lines.push([sentence.slice(0, cut > 0 ? cut : mid).trim(), sentence.slice(cut > 0 ? cut : mid).trim()]);
  }
  for (const parts of lines.slice(0, Math.max(0, MAX_EVENTS - events.length))) {
    if (parts.length < 2) continue;
    const seq = parts.map((p) => p.trim()).filter(Boolean);
    if (seq.length < 2) continue;
    const scrambled = seq.slice().sort(() => Math.random() - 0.5);
    if (scrambled.every((s, i) => s === seq[i])) scrambled.reverse();
    events.push({
      event_id: `event_${String(events.length + 1).padStart(2, '0')}`,
      type: 'rune_socket',
      grid_position: place(),
      data: {
        prompt: coding ? 'Arrange the code blocks into a working sequence:' : 'Restore the sentence in the correct order:',
        scrambled_items: scrambled,
        correct_sequence: seq,
      },
    });
  }

  if (events.length === 0) {
    // Absolute last resort: one gate + one chest from whatever text exists.
    const kw = candidateKeywords(chapter.text, 1)[0] ?? 'QUEST';
    events.push({
      event_id: 'event_01',
      type: 'monster_gate',
      grid_position: place(),
      data: { question: `What is this chapter, "${chapter.title}", about?`, options: [chapter.title, 'Nothing in particular', 'A different subject', 'Unrelated topics'], correct_index: 0, damage_on_fail: 1, enemy_sprite: 'enemy_goblin' },
    });
    events.push({
      event_id: 'event_02',
      type: 'chest_lock',
      grid_position: place(),
      data: { target_word: kw, hint: `A key term from "${chapter.title}".`, allowed_mistakes: 3, reward: 'Gold' },
    });
  }

  // Every floor deserves at least one combat encounter. Chapters whose only
  // generated challenges lack options (e.g. fill-in-the-blank fallbacks) would
  // otherwise produce a gateless, chest-only crawl.
  if (!events.some((e) => e.type === 'monster_gate') && events.length < MAX_EVENTS) {
    events.push({
      event_id: `event_${String(events.length + 1).padStart(2, '0')}`,
      type: 'monster_gate',
      grid_position: place(),
      data: { question: `What is this chapter, "${chapter.title}", about?`, options: [chapter.title, 'Nothing in particular', 'A different subject', 'Unrelated topics'], correct_index: 0, damage_on_fail: 1, enemy_sprite: 'enemy_skeleton' },
    });
  }

  const traps = placeTraps(events, chapter.id);
  return {
    quest_meta: {
      title: `The Depths of ${chapter.title}`,
      category: coding ? 'CODING' : 'GENERAL',
      recommended_tileset: 'dungeon_dark',
    },
    map_dimensions: { width: MAP_W, height: MAP_H },
    dungeon_events: events.slice(0, MAX_EVENTS),
    ...(traps.length > 0 ? { traps } : {}),
  };
}

/**
 * Deterministic spike-trap placement for heuristic maps: ring each monster
 * gate with one trap (the shielded-sprint shortcut), then fill a few corridor
 * tiles. Never touches the spawn corner (x<=3 && y<=3) or the portal corner.
 */
function placeTraps(events: DungeonEvent[], seedText: string): { x: number; y: number }[] {
  let seed = 0x51ed;
  for (const ch of seedText) seed = (Math.imul(31, seed) + ch.charCodeAt(0)) | 0;
  const rand = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };
  const taken = new Set(events.map((e) => `${e.grid_position.x},${e.grid_position.y}`));
  const traps: { x: number; y: number }[] = [];
  const tryAdd = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x > MAP_W - 2 || y > MAP_H - 2) return;
    if (x <= 3 && y <= 3) return; // spawn corner
    if (x >= MAP_W - 4 && y >= MAP_H - 4) return; // portal corner
    const key = `${x},${y}`;
    if (taken.has(key)) return;
    taken.add(key);
    traps.push({ x, y });
  };
  // One trap beside each monster gate.
  for (const e of events) {
    if (e.type !== 'monster_gate') continue;
    const { x, y } = e.grid_position;
    const spots: [number, number][] = [[x, y - 1], [x + 1, y], [x - 1, y], [x, y + 1]];
    for (const [sx, sy] of spots) {
      if (!taken.has(`${sx},${sy}`)) { tryAdd(sx, sy); break; }
    }
    if (traps.length >= 6) break;
  }
  // Corridor filler.
  let guard = 0;
  while (traps.length < 9 && guard < 80) {
    guard++;
    tryAdd(1 + Math.floor(rand() * (MAP_W - 2)), 1 + Math.floor(rand() * (MAP_H - 2)));
  }
  return traps;
}

// --- LLM path ------------------------------------------------------------

export interface DungeonGenerationResult {
  map: DungeonMap;
  mode: 'llm' | 'heuristic';
}

export async function generateDungeonMap(
  chapter: ChapterRow,
  opts: DungeonGenerationOptions,
): Promise<DungeonGenerationResult> {
  if (isLlmConfigured()) {
    try {
      const category = opts.category === 'programming' ? 'CODING' : 'GENERAL';
      const system = SYSTEM_PROMPT.replace('{{CATEGORY}}', category);
      const user =
        `Create a top-down dungeon from this content:\n\n` +
        `CHAPTER TITLE: ${chapter.title}\n\n${sliceChapterText(chapter)}`;
      const text = await callLlm(system, user, 3000);
      // Tolerate models that wrap JSON in prose or fences.
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1));
        const map = validateDungeonMap(parsed);
        if (map) return { map, mode: 'llm' };
      }
    } catch (e) {
      console.error(`[dungeon] chapter "${chapter.title}" LLM generation failed, using heuristics:`, (e as Error).message);
    }
  }
  return { map: generateHeuristicMap(chapter, opts), mode: 'heuristic' };
}
