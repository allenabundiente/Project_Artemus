-- Admin-uploaded assets live in the database, not on disk. Deploy platforms
-- with ephemeral filesystems (Render free tier) wipe local writes on every
-- deploy; this keeps admin sprite uploads, animation clips, and custom map
-- themes alive across redeploys. Disk writes remain as a best-effort mirror
-- for local dev but are never the source of truth.
CREATE TABLE IF NOT EXISTS admin_assets (
  key        text PRIMARY KEY,
  mime       text NOT NULL DEFAULT 'application/octet-stream',
  bytes      bytea,
  json       jsonb,
  size       integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Note: existing disk-era custom themes (backend/data/custom-themes.json) are
-- imported once at server boot by backend/src/db/assets.ts, which can actually
-- read the backend's own filesystem (unlike the DB server).
