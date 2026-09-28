// Data access for the top-down dungeon mode: per-chapter generated maps and
// the per-book map mode ('classic' | 'topdown').

import { query, queryOne, execute } from './db.js';
import type { DungeonMap } from '../services/dungeonGenerator.js';

export type BookMapMode = 'classic' | 'topdown';

export async function getMapMode(bookId: string): Promise<BookMapMode> {
  const row = await queryOne<{ map_mode: string | null }>(
    `SELECT map_mode FROM books WHERE id = $1`, [bookId],
  );
  return row?.map_mode === 'topdown' ? 'topdown' : 'classic';
}

export async function setMapMode(bookId: string, mode: BookMapMode): Promise<BookMapMode> {
  const row = await queryOne<{ map_mode: string }>(
    `UPDATE books SET map_mode = $2 WHERE id = $1 RETURNING map_mode`, [bookId, mode],
  );
  return row?.map_mode === 'topdown' ? 'topdown' : 'classic';
}

/** The latest generated dungeon for a chapter (null when none exists yet). */
export async function getDungeonMap(chapterId: string): Promise<DungeonMap | null> {
  const row = await queryOne<{ map: unknown }>(
    `SELECT map FROM dungeon_maps WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [chapterId],
  );
  return (row?.map as DungeonMap | undefined) ?? null;
}

export async function insertDungeonMap(chapterId: string, map: DungeonMap): Promise<void> {
  await query(
    `INSERT INTO dungeon_maps (chapter_id, map) VALUES ($1, $2::jsonb)`,
    [chapterId, JSON.stringify(map)],
  );
}

/** Drop every stored dungeon map for a book (regeneration). */
export async function deleteDungeonMapsForBook(bookId: string): Promise<void> {
  await execute(
    `DELETE FROM dungeon_maps WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = $1)`,
    [bookId],
  );
}

/** Count generated maps for a book (for generate progress reporting). */
export async function countDungeonMapsForBook(bookId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM dungeon_maps WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = $1)`,
    [bookId],
  );
  return row ? Number(row.n) : 0;
}
