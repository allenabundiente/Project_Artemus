-- ============================================================
-- 0007 — 'language' quiz mode (plugin-aware book routing)
-- ============================================================
-- The plugin registry gained a language-learning generator; books detected as
-- language material (spanish_vocab.pdf, french_lang.pdf, …) now persist
-- 'language' so generation routes through the language plugin. Existing rows
-- are untouched.

ALTER TABLE books DROP CONSTRAINT IF EXISTS books_quiz_mode_valid;
ALTER TABLE books ADD CONSTRAINT books_quiz_mode_valid
  CHECK (quiz_mode IN ('general', 'programming', 'language'));
