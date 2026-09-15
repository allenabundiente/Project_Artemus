-- ============================================================
-- 0011: Guild Chat
-- ============================================================
-- Guild-scoped messages for the polling chat panel. Strictly
-- guild-scoped — every query filters by guild_id, and the cascade
-- removes history when a guild (or member) is deleted.

CREATE TABLE IF NOT EXISTS guild_messages (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id    uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     text NOT NULL CHECK (char_length(message) > 0 AND char_length(message) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Strictly-monotonic delivery order. Timestamps alone cannot order polling
  -- safely (same-microsecond collisions, precision loss through JSON), and
  -- uuid tiebreakers sort randomly — seq gives the chat cursor one exact key.
  seq         bigint GENERATED ALWAYS AS IDENTITY
);

-- Most common query: recent messages for one guild, oldest-first display.
CREATE INDEX IF NOT EXISTS idx_guild_messages_guild_created
  ON guild_messages(guild_id, created_at DESC);

-- Admin feature-lock toggle (RoyalGate "chat"), seeded unlocked.
INSERT INTO app_features (key, label) VALUES ('chat', 'Guild Chat')
ON CONFLICT (key) DO NOTHING;
