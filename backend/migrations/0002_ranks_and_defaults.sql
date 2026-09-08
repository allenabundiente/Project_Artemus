-- ============================================================
-- 0002 — Rank tiers & defaults for guild term settings
-- ============================================================

-- Rank thresholds (cumulative score per term). Teachers may override these per
-- guild in a future update; these are the global defaults.
CREATE TABLE IF NOT EXISTS rank_tiers (
  name       text PRIMARY KEY,          -- copper | iron | gold | diamond | mythril
  min_score  integer NOT NULL,
  color      text NOT NULL,
  ord        integer NOT NULL
);

INSERT INTO rank_tiers (name, min_score, color, ord) VALUES
  ('copper',  0,    '#c86a3c', 0),
  ('iron',    500,  '#9aa0a8', 1),
  ('gold',    1000, '#ffec27', 2),
  ('diamond', 2000, '#8fd7ff', 3),
  ('mythril', 3500, '#b7c9ff', 4)
ON CONFLICT (name) DO NOTHING;

-- Global default term settings, used for solo adventurers and as guild fallbacks.
-- Shape (stored per guild in guilds.term_settings, keyed by term):
-- {
--   "prelims": { "timeLimitSeconds": 900, "pointsMultiplier": 1.0,
--                "difficultyMix": { "easy": 70, "medium": 30, "hard": 0 },
--                "monsterDifficulty": "easy" },
--   ...
-- }
CREATE TABLE IF NOT EXISTS default_term_settings (
  term      academic_term PRIMARY KEY,
  settings  jsonb NOT NULL
);

INSERT INTO default_term_settings (term, settings) VALUES
  ('prelims', '{"timeLimitSeconds": 900, "pointsMultiplier": 1.0, "difficultyMix": {"easy": 70, "medium": 30, "hard": 0}, "monsterDifficulty": "easy"}'::jsonb),
  ('midterms','{"timeLimitSeconds": 720, "pointsMultiplier": 1.25, "difficultyMix": {"easy": 50, "medium": 40, "hard": 10}, "monsterDifficulty": "medium"}'::jsonb),
  ('semis',   '{"timeLimitSeconds": 600, "pointsMultiplier": 1.5, "difficultyMix": {"easy": 30, "medium": 50, "hard": 20}, "monsterDifficulty": "medium"}'::jsonb),
  ('finals',  '{"timeLimitSeconds": 480, "pointsMultiplier": 2.0, "difficultyMix": {"easy": 20, "medium": 50, "hard": 30}, "monsterDifficulty": "hard"}'::jsonb)
ON CONFLICT (term) DO NOTHING;
