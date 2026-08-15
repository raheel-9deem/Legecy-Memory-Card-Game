import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = resolve(__dirname, '..', 'js');
const OUT = resolve(__dirname, '..', 'scratch-mmc');

rmSync(OUT, { recursive: true, force: true });

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js')) continue;
    const rel = relative(SRC, p).replace(/\\/g, '/').replace(/\.js$/, '.mjs');
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const code = readFileSync(p, 'utf8')
      .replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.js(['"])/g, '$1.mjs$2')
      .replace(/(import\(\s*['"]\.{1,2}\/[^'"]+)\.js(['"])/g, '$1.mjs$2');
    writeFileSync(dest, code);
  }
}
walk(SRC);
console.log('copied to', OUT);
