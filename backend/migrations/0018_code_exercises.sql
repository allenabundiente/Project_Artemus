-- ============================================================
-- 0018: code_exercise challenges (write-and-run coding tasks)
-- ============================================================
-- Programming chapters can now carry real coding exercises: the student writes
-- a program, the server runs it against the exercise's own tests, and only a
-- server-verified pass counts. Every column is nullable, so all existing rows
-- and all six old challenge types stay valid and untouched.

ALTER TYPE challenge_type ADD VALUE IF NOT EXISTS 'code_exercise';

-- Judge0 language key ('javascript', 'python', …).
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS language text;
-- Preloaded editor contents, with a TODO for the student to fill in.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS starter_code text;
-- [{ name, stdin, expectedStdout, hidden }] — never sent to students in full.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS tests jsonb;
-- The teacher/reference program used to verify the exercise at generation time.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS reference_solution text;
