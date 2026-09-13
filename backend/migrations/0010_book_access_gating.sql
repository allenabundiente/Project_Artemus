-- Per-book access gating + quest-chapter limiting.
--
-- locked / available_from / available_until: a teacher can take a tome out of
-- play entirely (locked) or time-limit it (availability window). NULL bounds
-- mean unbounded on that side. Defaults keep existing books unlocked.
--
-- quest_chapters: how many of the PDF's chapters become playable quests
-- (null = auto, up to 12). Generation only processes the first N chapters, so
-- "1-2 long quests per PDF" is also the efficiency lever — fewer, longer
-- quests instead of one node per chapter.
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_until timestamptz,
  ADD COLUMN IF NOT EXISTS quest_chapters integer CHECK (quest_chapters IS NULL OR quest_chapters BETWEEN 1 AND 12);
