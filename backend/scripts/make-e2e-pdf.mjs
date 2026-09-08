// Generates the same tiny fake 3-chapter PDF as make-sample-pdf.mjs, but
// returns the bytes in memory for the e2e script's upload step. Simplest
// reliable approach: run make-sample-pdf.mjs in a child process and read the
// file it deterministically writes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function mkSamplePdf() {
  execFileSync(process.execPath, [path.join(here, 'make-sample-pdf.mjs')], { cwd: here });
  return fs.readFileSync(path.join(here, 'sample-book.pdf'));
}
