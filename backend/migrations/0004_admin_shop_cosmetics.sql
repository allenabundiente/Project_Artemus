-- Admin, shop, cosmetics, feature locks, map config.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';

-- Global feature locks: admin can gate any unstable area behind "the hall".
CREATE TABLE IF NOT EXISTS app_features (
  key        text PRIMARY KEY,
  label      text NOT NULL,
  locked     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_features (key, label) VALUES
  ('shop', 'The Shop'),
  ('wardrobe', 'Character Wardrobe'),
  ('leaderboard', 'Leaderboard'),
  ('admin_panel', 'Admin Panel'),
  ('llm_generation', 'AI Challenge Generation')
ON CONFLICT (key) DO NOTHING;

-- Shop catalog (cosmetics only — never gameplay power).
CREATE TABLE IF NOT EXISTS shop_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  category    text NOT NULL CHECK (category IN ('hair','armor','helmet','pack')),
  kind        text NOT NULL,
  price       integer NOT NULL CHECK (price >= 0),
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per (user, item) once purchased.
CREATE TABLE IF NOT EXISTS user_items (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- Per-user avatar (wardrobe) preferences.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS coins_spent integer NOT NULL DEFAULT 0;

-- Map (theme) configuration: global default + per-guild overrides.
CREATE TABLE IF NOT EXISTS map_config (
  scope      text PRIMARY KEY CHECK (scope IN ('global')),
  mode       text NOT NULL DEFAULT 'random_by_difficulty'
             CHECK (mode IN ('fixed', 'random_by_difficulty')),
  fixed_theme text NOT NULL DEFAULT 'dungeon',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO map_config (scope) VALUES ('global') ON CONFLICT DO NOTHING;

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS map_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
