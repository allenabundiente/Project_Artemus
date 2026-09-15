-- ============================================================
-- 0011: Guild Chat, Announcements, and Personal Streaks
-- ============================================================

-- 1. Guild Chat Messages
-- Scoped strictly by guildId — never cross-guild.
CREATE TABLE IF NOT EXISTS guild_messages (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id    uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     text NOT NULL CHECK (char_length(message) > 0 AND char_length(message) <= 1000),
  created_at  timestamptz DEFAULT now()
);

-- Fast lookups by guild (most common query: fetch recent messages)
CREATE INDEX IF NOT EXISTS idx_guild_messages_guild_created
  ON guild_messages(guild_id, created_at DESC);

-- RLS: members can only see their own guild's messages
ALTER TABLE guild_messages ENABLE ROW LEVEL SECURITY;

-- 2. Announcements (one-way teacher → guild broadcast)
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id    uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) > 0 AND char_length(title) <= 200),
  message     text NOT NULL CHECK (char_length(message) > 0 AND char_length(message) <= 2000),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_guild_created
  ON announcements(guild_id, created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- 3. Personal Streak Tracking
-- Added to users table for clean separation.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_streak int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active_date date DEFAULT NULL;

-- Streak bonus constant (coins awarded every 7 consecutive days)
-- Sensible default: 50 coins (meaningfully larger than average quest reward)
-- This is a config value; update it in the app code if needed.
