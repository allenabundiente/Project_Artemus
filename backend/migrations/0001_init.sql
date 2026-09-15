-- ============================================================
-- QuestBook — core schema (Supabase-compatible Postgres)
-- Run in Supabase SQL editor in order: 0001, then 0002, then 0003.
-- ============================================================

-- ---------- ENUMS ----------
CREATE TYPE user_role AS ENUM ('teacher', 'student');
CREATE TYPE challenge_type AS ENUM ('multiple_choice', 'predict_output', 'spot_the_bug', 'fill_in_blank');
CREATE TYPE challenge_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE academic_term AS ENUM ('prelims', 'midterms', 'semis', 'finals');

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role         user_role NOT NULL DEFAULT 'student',
  guild_id     uuid,                -- nullable: solo adventurers have none
  coins        integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- GUILDS ----------
CREATE TABLE IF NOT EXISTS guilds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  passcode      text NOT NULL UNIQUE,
  teacher_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_guild ON users (guild_id);

-- ---------- BOOKS / CHAPTERS / CHALLENGES ----------
CREATE TABLE IF NOT EXISTS books (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  filename   text NOT NULL,
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  guild_id   uuid REFERENCES guilds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_books_owner ON books (owner_id);
CREATE INDEX IF NOT EXISTS idx_books_guild ON books (guild_id);

CREATE TABLE IF NOT EXISTS chapters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx         integer NOT NULL,
  title       text NOT NULL,
  text        text NOT NULL,
  code_blocks jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters (book_id, idx);

CREATE TABLE IF NOT EXISTS challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id     uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  type           challenge_type NOT NULL,
  prompt         text NOT NULL,
  code           text,
  options        jsonb,
  correct_answer text NOT NULL,
  explanation    text NOT NULL,
  difficulty     challenge_difficulty NOT NULL,
  ord            integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_book ON challenges (book_id);
CREATE INDEX IF NOT EXISTS idx_challenges_chapter ON challenges (chapter_id, ord);

-- ---------- PROGRESS (per user per book) ----------
CREATE TABLE IF NOT EXISTS progress (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id            uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  completed_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  score              integer NOT NULL DEFAULT 0,
  best_streak        integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);

-- ---------- SCORES (per completed quest; term-scoped) ----------
CREATE TABLE IF NOT EXISTS scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id      uuid REFERENCES chapters(id) ON DELETE SET NULL,
  guild_id        uuid REFERENCES guilds(id) ON DELETE SET NULL,
  raw_score       integer NOT NULL,
  mistakes        integer NOT NULL DEFAULT 0,
  time_seconds    integer NOT NULL DEFAULT 0,
  finished        boolean NOT NULL DEFAULT true,
  lives_remaining integer NOT NULL DEFAULT 0,
  term            academic_term NOT NULL DEFAULT 'prelims',
  coins_awarded   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scores_user_term ON scores (user_id, term, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_guild_term ON scores (guild_id, term, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores (user_id, created_at DESC);

-- Keep guild_id on scores in sync with the user's membership at insert time.
CREATE OR REPLACE FUNCTION set_score_guild() RETURNS trigger AS $$
BEGIN
  IF NEW.guild_id IS NULL THEN
    SELECT guild_id INTO NEW.guild_id FROM users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_score_guild ON scores;
CREATE TRIGGER trg_set_score_guild
  BEFORE INSERT ON scores
  FOR EACH ROW EXECUTE FUNCTION set_score_guild();

-- Keep books.updated_at on progress rows fresh (informational).
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_progress ON progress;
CREATE TRIGGER trg_touch_progress
  BEFORE UPDATE ON progress
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
