// Sanity check for the plugin registry: built-ins, routing, fallbacks.
import { initPlugins, listPlugins, resolvePluginFor, pluginById, promptDirectiveFor, validateWithPlugin } from '../src/plugins/index.js';

initPlugins();
console.log('registered:', listPlugins().map((p) => `${p.id}@${p.version}`));
console.log('detect python_chapter1_code.pdf →', resolvePluginFor('python_chapter1_code.pdf', 'Chapter 1').id);
console.log('detect spanish_vocab.pdf        →', resolvePluginFor('spanish_vocab.pdf', 'Spanish Vocab').id);
console.log('detect french_lang.pdf          →', resolvePluginFor('french_lang.pdf', 'French').id);
console.log('detect world_history.pdf        →', resolvePluginFor('world_history.pdf', 'World History').id);
console.log('byId language                   →', pluginById('language').id);
console.log('byId bogus (falls back)         →', pluginById('does_not_exist').id);
console.log('detectQuizMode routing          →', resolvePluginFor('python_chapter1_code.pdf', 'c').id, '/', resolvePluginFor('biology.pdf', 'b').id);

const ctx = { chapter: { id: 'x', bookId: 'b', idx: 0, title: 't', text: '', codeBlocks: [] }, targetCount: null, perChapterTarget: 12 };
const langDirective = promptDirectiveFor(pluginById('language'), ctx);
console.log('language directive starts       →', JSON.stringify(langDirective.slice(0, 40)));

// Language plugin vetoes code-carrying challenges.
const lang = pluginById('language');
const vetoed = validateWithPlugin(lang, { type: 'predict_output', prompt: 'x', code: 'print(1)', options: null, correctAnswer: '1', explanation: '', difficulty: 'easy' }, ctx);
const kept = validateWithPlugin(lang, { type: 'fill_in_blank', prompt: 'x', code: null, options: null, correctAnswer: 'hola', explanation: '', difficulty: 'easy' }, ctx);
console.log('language vetoes code challenge  →', vetoed === null);
console.log('language keeps vocab challenge  →', kept !== null);
