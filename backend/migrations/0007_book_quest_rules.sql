-- Per-tome quest rules (teachers): cap how many chapters a PDF yields and
-- schedule when it is playable. NULL = no limit / always available.
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS quest_limit integer,
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_until timestamptz;

-- A limit, when set, must be sane (0 would lock the whole book; cap at 500).
ALTER TABLE books
  DROP CONSTRAINT IF EXISTS books_quest_limit_check;
ALTER TABLE books
  ADD CONSTRAINT books_quest_limit_check CHECK (quest_limit IS NULL OR (quest_limit >= 1 AND quest_limit <= 500));
