-- ============================================================
-- 0014: challenges.quest — code-completion quest payloads
-- ============================================================
-- The compile-first generator (0008) stores code_completion_quest challenges
-- as a full program plus removable blanks. insertChallenge() has written that
-- payload into a challenges.quest jsonb column since the quest-rules work,
-- but no earlier migration ever created the column — fresh databases and
-- Render 500 on generation with "column quest of relation challenges does
-- not exist". Create it here so every deployment carries it.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS quest jsonb;
