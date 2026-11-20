-- Multiple professors per guild + per-book game modes.
--
-- Additive and idempotent: guilds.teacher_id stays the guild OWNER (nothing is
-- dropped or renamed), every existing guild is backfilled as an 'owner' row so
-- single-teacher guilds behave exactly as before, and books keep their current
-- gameplay because game_mode defaults to 'classic'.

CREATE TABLE IF NOT EXISTS guild_teachers (
  guild_id   uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'professor' CHECK (role IN ('owner', 'professor')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, teacher_id)
);

-- A teacher may belong to only one guild (owner or professor).
CREATE UNIQUE INDEX IF NOT EXISTS guild_teachers_teacher_unique
  ON guild_teachers (teacher_id);

-- Backfill: the founding teacher of every existing guild is its owner.
-- DISTINCT ON keeps the migration safe even on a database that somehow has
-- two guilds for one teacher (the oldest guild keeps them, the unique teacher
-- index below would otherwise reject the second row), and ON CONFLICT keeps
-- re-runs cheap.
INSERT INTO guild_teachers (guild_id, teacher_id, role)
SELECT DISTINCT ON (g.teacher_id) g.id, g.teacher_id, 'owner'
FROM guilds g
ORDER BY g.teacher_id, g.created_at ASC, g.id
ON CONFLICT DO NOTHING;

-- Professor invite code: separate from the student passcode so students can
-- never join as a professor (and vice versa). Old guilds get theirs lazily on
-- first read by the owner, so this migration needs no code generator.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS professor_passcode text;

CREATE UNIQUE INDEX IF NOT EXISTS guilds_professor_passcode_unique
  ON guilds (professor_passcode)
  WHERE professor_passcode IS NOT NULL;

-- Per-book game mode (how students PLAY the tome). Separate from map_mode
-- (visual style) and quiz_mode (question subject). 'classic' = today's game.
ALTER TABLE books ADD COLUMN IF NOT EXISTS game_mode text NOT NULL DEFAULT 'classic';

ALTER TABLE books DROP CONSTRAINT IF EXISTS books_game_mode_valid;
ALTER TABLE books ADD CONSTRAINT books_game_mode_valid
  CHECK (game_mode IN ('classic', 'survival', 'speedrun', 'boss'));
