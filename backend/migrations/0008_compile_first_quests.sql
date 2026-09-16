-- Compile-first content generation + code-completion quests.
--
-- 1. chapters.compiled — the Pass-1 "compiled lesson" summary (topicType,
--    keyConcepts, importantCodePatterns, minorDetails) stored ALONGSIDE the
--    raw parsed text/code so every later generation is traceable to what the
--    compile step flagged as important, and so regenerations can reuse the
--    compile output instead of re-billing the Pass-1 call.
-- 2. challenge_type gains 'code_completion_quest' — one whole program from
--    the lesson as a single quest; each removed blank becomes one monster
--    encounter and the final (hardest) blank is the quest's boss checkpoint.

ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS compiled jsonb;

DO $$ BEGIN
  CREATE TYPE challenge_type AS ENUM
    ('multiple_choice', 'predict_output', 'spot_the_bug', 'fill_in_blank', 'code_completion_quest');
EXCEPTION
  WHEN duplicate_object THEN
    -- Enum already exists (0001 ran with the wider set): widen it in place.
    ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'code_completion_quest';
END $$;
