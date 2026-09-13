-- Admin audit log + sprite content versioning.
--
-- admin_audit_log: who did what in the admin panel (sprite uploads/restores,
-- theme edits, shop item changes, animation edits, feature locks, and admin
-- account management). Insert-only, newest first in the UI.
--
-- admin_assets.version: bumped on every sprite/theme/animation write so
-- GET /api/sprites/:name can serve a strong ETag and the frontend can build
-- ?v= cache-busting URLs — admin re-uploads show up instantly without relying
-- on Cache-Control: no-cache.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action     text NOT NULL,
  target     text NOT NULL DEFAULT '',
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON admin_audit_log (created_at DESC);

ALTER TABLE admin_assets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
