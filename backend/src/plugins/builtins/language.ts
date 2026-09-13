import type { QuizGeneratorPlugin, GenerationContext } from '../types.js';
import type { GeneratedChallenge } from '../types.js';

const LANGUAGE_DIRECTIVE = `

LANGUAGE MODE: treat the chapter as language-learning material. Favor these angles, all grounded in THIS chapter's own vocabulary and sentences:
- fill_in_blank — remove one target-language word from a real sentence from the text; the answer is that word.
- multiple_choice — "what does <word> mean?" with same-part-of-speech distractors drawn from the chapter's vocabulary; also grammar-choice questions ("which form completes this sentence?").
- short_answer — translation prompts both directions: translate a short phrase from the text into the learner's language, or translate a simple prompt into the target language.
- true_false — statements about meaning, gender/plural forms, or usage, subtly flipped from the text.
Distractors must be words/phrases from THIS chapter — same part of speech where possible, never invented words, never "all of the above".`;

/**
 * LANGUAGE — vocab blanks, translation prompts, and grammar drills for
 * language-learning books. Detected by filename convention (`*_lang.pdf`,
 * `*_vocab.pdf`, …) or forced explicitly via the teacher's mode override
 * pipeline; configured like every other plugin.
 */
const languagePlugin: QuizGeneratorPlugin = {
  id: 'language',
  name: 'Language Learning',
  version: '1.0.0',
  description: 'Vocabulary blanks, translation prompts, and grammar drills from the chapter\u2019s own sentences.',

  detect: ({ filename, env }) => {
    // Marker anywhere in the stem (spanish_vocab_ch1.pdf, lang_notes_v2.pdf),
    // so version/number suffixes don't break detection.
    const pattern = env.QUESTBOOK_LANGUAGE_FILE_PATTERN ?? '(?:[_-](?:lang|language|vocab)(?:[_-]|$))';
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      console.warn(`[plugins:language] invalid QUESTBOOK_LANGUAGE_FILE_PATTERN (${pattern}); using default`);
      re = /(?:[_-](?:lang|language|vocab)(?:[_-]|$))/i;
    }
    return re.test(filename.replace(/\.pdf$/i, ''));
  },

  promptDirective: () => LANGUAGE_DIRECTIVE,

  validateChallenge: (c: GeneratedChallenge, ctx: GenerationContext): GeneratedChallenge | null => {
    // Code snippets are noise in a language book — a "code" challenge here
    // means the LLM misunderstood the material. Veto it.
    if (c.code) return null;
    void ctx;
    return c;
  },
};

export default languagePlugin;
