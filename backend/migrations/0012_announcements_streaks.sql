-- ============================================================
-- 0012: Announcements + Personal Streaks
-- ============================================================

-- 1. Announcements: one-way teacher → guild broadcast (notice board).
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id    uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) > 0 AND char_length(title) <= 200),
  message     text NOT NULL CHECK (char_length(message) > 0 AND char_length(message) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_guild_created
  ON announcements(guild_id, created_at DESC);

-- 2. Personal streaks: consecutive-day quest tracking on the user row.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_streak  int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak  int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_date date DEFAULT NULL;
