// Sanity check for M3: heuristic mix includes the new question types.
import { generateHeuristically } from '../src/services/contentGenerator.js';

const chapter = {
  id: 'x',
  bookId: 'b',
  idx: 0,
  title: 'Variables in C#',
  text: 'A variable is a named location in memory that stores a value. A namespace is a container that groups related classes. An integer is a whole number type that holds values without decimals. A string is a sequence of characters used to store text.',
  codeBlocks: [],
};

const out = generateHeuristically(chapter, 20);
const types = {};
for (const c of out.challenges) types[c.type] = (types[c.type] ?? 0) + 1;
console.log('types:', types, 'total:', out.challenges.length);
const tf = out.challenges.find((c) => c.type === 'true_false');
console.log('sample TF:', tf?.prompt.slice(0, 95), '→', tf?.correctAnswer);
const sa = out.challenges.find((c) => c.type === 'short_answer');
console.log('sample SA:', sa?.prompt.slice(0, 120), '→', sa?.correctAnswer);
