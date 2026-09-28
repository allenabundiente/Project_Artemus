-- ============================================================
-- 0009 — Top-down dungeon quest mode ("The Depths")
--
-- Adds a per-book map mode that chooses how a chapter renders:
--   'classic'  → the original side-scrolling arcade quest
--   'topdown'  → the top-down dungeon crawler (grid rooms, 3 event types)
-- null behaves like 'classic' for every existing book.
--
-- Also adds dungeon_maps: one generated top-down dungeon per chapter, stored
-- as validated JSON. A chapter is regenerated only on explicit request.
-- ============================================================

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS map_mode text NOT NULL DEFAULT 'classic'
  CHECK (map_mode IN ('classic', 'topdown'));

CREATE TABLE IF NOT EXISTS dungeon_maps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id   uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  map          jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dungeon_maps_chapter ON dungeon_maps (chapter_id);
