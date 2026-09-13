-- ============================================================
-- 0004 — Per-book quest count (teacher-controlled generation size)
-- ============================================================
-- Teachers choose how many challenges to generate for a specific PDF.
-- NULL means "auto" — the generator picks a sensible amount per chapter.
-- Additive change only: existing rows keep NULL and behave exactly as before.

ALTER TABLE books ADD COLUMN IF NOT EXISTS quest_count integer;

-- Keep the value inside the supported range even if someone edits it by hand.
ALTER TABLE books ADD CONSTRAINT books_quest_count_range
  CHECK (quest_count IS NULL OR (quest_count >= 1 AND quest_count <= 500));
