-- Quest-fail accounting: runs that end out of lives or out of time record how
-- many coins were gathered during the run, the random penalty applied, and the
-- net coins that actually reached the balance. Success rows keep
-- coins_awarded and zero out the fail fields.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins_gathered integer NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS coins_penalty integer NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS net_coins integer NOT NULL DEFAULT 0;

-- How a failed run ended (NULL for normal completions).
ALTER TABLE scores ADD COLUMN IF NOT EXISTS fail_reason text
  CHECK (fail_reason IN ('out_of_lives', 'out_of_time'));

-- Teacher/guild-roster reports will want failed runs quickly.
CREATE INDEX IF NOT EXISTS idx_scores_fail_reason ON scores (fail_reason) WHERE fail_reason IS NOT NULL;
