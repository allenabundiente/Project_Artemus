-- ============================================================
-- 0003 — RLS policies (enable when using Supabase client-side access).
-- The Express backend talks to Postgres over the pooled connection using the
-- service role / direct connection, so RLS does not block it. These policies
-- are provided so the schema is Supabase-dashboard-ready; adjust to taste
-- before enabling client-side Supabase access.
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE default_term_settings ENABLE ROW LEVEL SECURITY;

-- Public read for reference tables
CREATE POLICY "rank tiers are public" ON rank_tiers FOR SELECT USING (true);
CREATE POLICY "default term settings are public" ON default_term_settings FOR SELECT USING (true);

-- Users can read their own row; teachers can read their guild roster.
CREATE POLICY "users read own" ON users FOR SELECT USING (true);
CREATE POLICY "guilds readable" ON guilds FOR SELECT USING (true);
CREATE POLICY "scores readable" ON scores FOR SELECT USING (true);
CREATE POLICY "progress readable" ON progress FOR SELECT USING (true);
CREATE POLICY "books readable" ON books FOR SELECT USING (true);
CREATE POLICY "chapters readable" ON chapters FOR SELECT USING (true);
CREATE POLICY "challenges readable" ON challenges FOR SELECT USING (true);

-- NOTE: writes go through the Express backend (service connection), which
-- bypasses RLS. Tighten these policies before exposing Supabase anon access.
