-- ============================================================
-- 0006 — Quiz mode per book (universal topics + programming mode)
-- ============================================================
-- 'general'      — any subject: definitions, concepts, recall (default)
-- 'programming'  — code-reading, output prediction, bug-spotting, blanks
-- Auto-detected from the filename at upload (see contentGenerator.ts
-- detectQuizMode), overridable by the teacher per book. Existing rows get
-- 'general', which is exactly how they behaved before this column existed.

ALTER TABLE books ADD COLUMN IF NOT EXISTS quiz_mode text NOT NULL DEFAULT 'general';
ALTER TABLE books ADD CONSTRAINT books_quiz_mode_valid
  CHECK (quiz_mode IN ('general', 'programming'));
