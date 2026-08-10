// Copies every js/**/*.js into a scratch tree as .mjs so plain `node` can
// import them, rewriting relative import specifiers to match.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3];

rmSync(OUT, { recursive: true, force: true });

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const rel = p.slice(SRC.length + 1).replace(/\.js$/, '.mjs');
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const code = readFileSync(p, 'utf8').replace(
      /(from\s+['"]\.{1,2}\/[^'"]+)\.js(['"])/g,
      '$1.mjs$2'
    ).replace(
      /(import\(\s*['"]\.{1,2}\/[^'"]+)\.js(['"])/g,
      '$1.mjs$2'
    );
    writeFileSync(dest, code);
  }
}
walk(SRC);
console.log('copied');
