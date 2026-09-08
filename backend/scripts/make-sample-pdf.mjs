// Generates sample-book.pdf: a tiny fake "programming book" with chapters,
// body text, and Courier code blocks — used to smoke-test the parser.
import fs from 'node:fs';

const pages = [];

function page(lines) {
  // lines: [{ text, font: 'H'|'C', size }]
  pages.push(lines);
}

page([
  { text: 'Learning Python Basics', font: 'H', size: 20 },
  { text: 'Chapter 1: Variables and Types', font: 'H', size: 16 },
  { text: 'A variable is a named location in memory that stores a value.', font: 'H', size: 12 },
  { text: 'In Python, you create a variable by assigning a value to a name.', font: 'H', size: 12 },
  { text: 'An integer is a whole number. A string is a sequence of characters.', font: 'H', size: 12 },
  { text: 'age = 25', font: 'C', size: 11 },
  { text: 'name = "Ada"', font: 'C', size: 11 },
  { text: 'print(name, age)', font: 'C', size: 11 },
  { text: 'The print function writes its arguments to the console.', font: 'H', size: 12 },
]);

page([
  { text: 'Chapter 2: Functions', font: 'H', size: 16 },
  { text: 'A function is a reusable block of code that performs one task.', font: 'H', size: 12 },
  { text: 'Functions help you avoid repeating yourself and make code testable.', font: 'H', size: 12 },
  { text: 'def greet(name):', font: 'C', size: 11 },
  { text: '    return "Hello, " + name', font: 'C', size: 11 },
  { text: 'message = greet("World")', font: 'C', size: 11 },
  { text: 'print(message)', font: 'C', size: 11 },
  { text: 'The return statement sends a value back to the caller.', font: 'H', size: 12 },
]);

page([
  { text: 'Chapter 3: Loops', font: 'H', size: 16 },
  { text: 'A for loop repeats a block of code once for each item in a sequence.', font: 'H', size: 12 },
  { text: 'A while loop repeats as long as its condition remains true.', font: 'H', size: 12 },
  { text: 'for i in range(3):', font: 'C', size: 11 },
  { text: '    print(i)', font: 'C', size: 11 },
  { text: 'count = 0', font: 'C', size: 11 },
  { text: 'while count < 3:', font: 'C', size: 11 },
  { text: '    count = count + 1', font: 'C', size: 11 },
  { text: 'Loops can be nested inside other loops.', font: 'H', size: 12 },
]);

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const objects = [];
// 1: catalog, 2: pages, then per page: page obj + content obj; fonts last.
const fontRegularId = 3 + pages.length * 2;
const fontMonoId = fontRegularId + 1;

objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;

pages.forEach((lines, i) => {
  const pageId = 3 + i * 2;
  const contentId = pageId + 1;
  objects[pageId] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontMonoId} 0 R >> >> ` +
    `/Contents ${contentId} 0 R >>`;
  let stream = 'BT';
  let y = 720;
  for (const line of lines) {
    const font = line.font === 'C' ? '/F2' : '/F1';
    stream += ` ${font} ${line.size} Tf 1 0 0 1 72 ${y} Tm (${esc(line.text)}) Tj`;
    y -= line.size + 10;
  }
  stream += ' ET';
  objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
});

objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
objects[fontMonoId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 1; i < objects.length; i++) {
  offsets[i] = pdf.length;
  pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefStart = pdf.length;
const maxId = objects.length - 1;
pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= maxId; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync(new URL('./sample-book.pdf', import.meta.url), pdf, 'latin1');
console.log(`Wrote sample-book.pdf (${pages.length} pages, ${pdf.length} bytes)`);