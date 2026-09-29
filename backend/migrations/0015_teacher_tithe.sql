-- ============================================================
-- 0015: scores.teacher_tithe — the teacher's 10% cut, per quest
-- ============================================================
-- The teacher-tithe feature credits the guild teacher 10% of the coins a
-- student earns on each COMPLETED quest (inside the settlement transaction).
-- Record that cut on the score row itself so the teacher ledger
-- (GET /api/guilds/mine/tithe) sums what was actually collected instead of
-- re-deriving the formula in SQL. 0 on failed runs and teacher-less guilds.

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS teacher_tithe integer NOT NULL DEFAULT 0;
