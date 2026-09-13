// Sanity check for M5: plugin registry routing.
import { initPlugins, listPlugins, resolvePluginFor, pluginById, promptDirectiveFor } from '../src/plugins/index.js';
import { detectQuizMode } from '../src/services/contentGenerator.js';

initPlugins();
console.log('registered:', listPlugins().map((p) => `${p.id}@${p.version}`));
console.log('detect python_chapter1_code.pdf →', resolvePluginFor('python_chapter1_code.pdf', 'Chapter 1').id);
console.log('detect world_history.pdf      →', resolvePluginFor('world_history.pdf', 'World History').id);
console.log('byId programming              →', pluginById('programming').id);
console.log('byId bogus (falls back)       →', pluginById('does_not_exist').id);
console.log('detectQuizMode (route)        →', detectQuizMode('python_chapter1_code.pdf'), detectQuizMode('biology.pdf'));
const directive = promptDirectiveFor(pluginById('programming'), { chapter: { id: 'x', bookId: 'b', idx: 0, title: 't', text: '', codeBlocks: [] }, targetCount: null, perChapterTarget: 12 });
console.log('programming directive starts  →', JSON.stringify(directive.slice(0, 40)));
