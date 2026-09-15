-- ============================================================
-- 0005 — Richer question types (M3: quiz generation quality)
-- ============================================================
-- Add true_false and short_answer to the challenge_type enum so generated
-- quests mix four comprehension angles instead of keyword-only recall.
-- Additive: existing rows and code paths are untouched.

ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'true_false';
ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'short_answer';
