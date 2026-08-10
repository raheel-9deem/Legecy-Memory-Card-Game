/**
 * Static wiring check: does everything the code references actually exist?
 *   node tools/_wiring-check.mjs .
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] || '.');
let pass = 0;
const failures = [];
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg + (extra ? '\n         ' + extra : '')); }
};
const group = (n) => console.log('\n== ' + n + ' ==');

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext) && !name.startsWith('_')) out.push(p);
  }
  return out;
}
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

const jsFiles = walk(join(ROOT, 'js'), '.js');
const html = read(join(ROOT, 'index.html'));
const css = read(join(ROOT, 'css', 'style.css'));
const allJs = jsFiles.map((p) => ({ path: p, src: read(p) }));
const allSrc = allJs.map((f) => f.src).join('\n');

/* ---------------------------------------------------------------- */
group('file layout');
for (const f of [
  'index.html', 'css/style.css', 'js/main.js',
  'js/core/game.js', 'js/core/levels.js', 'js/core/events.js',
  'js/core/router.js', 'js/core/storage.js', 'js/core/coins.js',
  'js/data/themes.js', 'js/data/store-items.js',
  'js/screens/menu.js', 'js/screens/level-select.js', 'js/screens/gameplay.js',
  'js/screens/store.js', 'js/screens/win.js',
  'js/ui/header.js', 'js/ui/audio.js', 'js/ui/toast.js',
  'js/ui/effects.js', 'js/ui/particles.js', 'js/ui/timer-ring.js',
]) {
  ok(existsSync(join(ROOT, f)), `${f} exists`);
}
ok(!existsSync(join(ROOT, 'js/data/levels.js')), 'the old js/data/levels.js is gone');
ok(!/data\/levels\.js/.test(allSrc), 'nothing still imports js/data/levels.js');

group('every relative import resolves');
let importOk = true;
for (const { path, src } of allJs) {
  const specs = [...src.matchAll(/(?:from|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    const target = resolve(dirname(path), spec);
    if (!existsSync(target)) {
      importOk = false;
      console.log(`     ${rel(path)} -> ${spec} (missing)`);
    }
  }
}
ok(importOk, 'every relative import in every module points at a real file');

group('named imports exist as exports');
const exportsOf = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((part) => {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    });
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
};
let namedOk = true;
for (const { path, src } of allJs) {
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(path), m[2]);
    if (!existsSync(target)) continue;
    const available = exportsOf(read(target));
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !available.has(name)) {
        namedOk = false;
        console.log(`     ${rel(path)} imports { ${name} } from ${m[2]} — not exported`);
      }
    }
  }
}
ok(namedOk, 'every named import is actually exported by its module');

group('EVENTS keys');
const eventsSrc = read(join(ROOT, 'js/core/events.js'));
const eventKeys = new Set([...eventsSrc.matchAll(/^\s{2}([A-Z0-9_]+):\s*'/gm)].map((m) => m[1]));
ok(eventKeys.has('TIMER_START'), 'EVENTS.TIMER_START is declared');
let evOk = true;
for (const { path, src } of allJs) {
  if (path.endsWith('events.js')) continue;
  for (const m of src.matchAll(/EVENTS\.([A-Z0-9_]+)/g)) {
    if (!eventKeys.has(m[1])) { evOk = false; console.log(`     ${rel(path)} uses undeclared EVENTS.${m[1]}`); }
  }
}
ok(evOk, `every EVENTS.* reference is declared (${eventKeys.size} events)`);
const eventValues = [...eventsSrc.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
ok(new Set(eventValues).size === eventValues.length, 'no two events share an event-name string');

group('CSS classes referenced from JS/HTML exist in style.css');
const cssClasses = new Set([...css.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
// Class names as they appear in class="..." attributes inside template literals.
const used = new Set();
for (const src of [html, ...allJs.map((f) => f.src)]) {
  for (const m of src.matchAll(/class="([^"${}]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && used.add(c));
  }
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/'([A-Za-z][A-Za-z0-9_-]*)'/g)) used.add(s[1]);
  }
}
const IGNORE = new Set(['hidden', 'active', 'flipped', 'matched', 'owned', 'equipped']); // state hooks checked below
const missing = [...used].filter((c) => !cssClasses.has(c));
ok(missing.length === 0, `all ${used.size} referenced CSS classes are styled`, missing.join(', '));

group('new UI classes are styled');
for (const c of [
  'timer-ring', 'timer-ring-track', 'timer-ring-arc', 'timer-ring-face',
  'timer-ring-value', 'timer-ring-state', 'card-symbol', 'card-back-icon',
  'card-front', 'card-back', 'card-inner', 'card-face',
  'level-gate', 'gated', 'result-timeout', 'board-wrap', 'mismatch',
]) {
  ok(cssClasses.has(c), `.${c} has a rule in style.css`);
}
ok(/@keyframes\s+mismatch-shake/.test(css), '@keyframes mismatch-shake exists');
ok(/@keyframes\s+matched-glow/.test(css), '@keyframes matched-glow exists');
ok(/@keyframes\s+timer-alarm/.test(css), '@keyframes timer-alarm exists');

group('card flip contract');
ok(/--t-flip:\s*600ms/.test(css), 'the flip animation is 600ms (0.6s)');
ok(/--ease-flip:\s*cubic-bezier/.test(css), 'the flip uses an easing curve');
ok(/\.card-inner\s*\{[^}]*transform-style:\s*preserve-3d/s.test(css), '.card-inner uses preserve-3d');
ok(/backface-visibility:\s*hidden/.test(css), 'card faces hide their backface');
ok(/perspective:/.test(css), 'the board sets a perspective');
const gameplaySrc = read(join(ROOT, 'js/screens/gameplay.js'));
ok(/card-front[^]*?card-symbol">\?/s.test(gameplaySrc), 'the front face renders the "?" symbol');
ok(/card-back">\$\{card\.symbol\}/.test(gameplaySrc), 'the back face renders the emoji');

group('animation-fill-mode does not kill :hover');
// `both`/`forwards` on an entrance animation locks transform and defeats :hover.
// Strip comments first — the explanatory notes in style.css name the very
// keywords being searched for.
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const hoverBlocks = ['.card', '.level-card', '.store-item', '.menu-buttons > *:nth-child(1)'];
let fillOk = true;
for (const sel of hoverBlocks) {
  const re = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*?animation:([^;]*);`, 's');
  const m = cssBare.match(re);
  if (m && /\b(both|forwards)\b/.test(m[1])) {
    fillOk = false;
    console.log(`     ${sel} entrance animation uses a locking fill-mode:${m[1]}`);
  }
}
ok(fillOk, 'hoverable blocks use a non-locking animation fill-mode');

group('header contract');
const headerSrc = read(join(ROOT, 'js/ui/header.js'));
ok(/timer:\s*(false|true)/.test(headerSrc), 'header config has a timer flag');
ok(/moves:\s*(false|true)/.test(headerSrc), 'header config has a moves flag');
let screenHdrOk = true;
for (const name of ['menu', 'level-select', 'gameplay', 'store', 'win']) {
  const src = read(join(ROOT, 'js/screens', name + '.js'));
  if (!/header:\s*\{[^}]*timer:[^}]*moves:[^}]*\}/s.test(src)) {
    screenHdrOk = false;
    console.log(`     screens/${name}.js does not declare timer + moves`);
  }
}
ok(screenHdrOk, 'every screen declares the timer/moves header contract');
ok(!/\bgameStats\s*:/.test(allSrc.replace(headerSrc, '')), 'no screen still uses the old gameStats flag');
ok(!/gameStats/.test(read(join(ROOT, 'js/core/router.js'))), 'router docs no longer mention gameStats');

group('gameplay wiring');
ok(/EVENTS\.TIMER_START/.test(gameplaySrc), 'gameplay subscribes to TIMER_START');
ok(/timerRing\.attach/.test(gameplaySrc) && /timerRing\.detach/.test(gameplaySrc), 'the ring is attached on mount and detached on unmount');
ok(/timerRing\.reset\(/.test(gameplaySrc), 'the ring is parked at the full budget before play');
ok(/TimerRing\.markup\(\)/.test(gameplaySrc), 'the ring markup is rendered into the board wrap');
ok(/timer:\s*false/.test(gameplaySrc), 'the header timer pill is off on the board (the ring owns the clock)');

group('index.html');
ok(/type="module"/.test(html) && /js\/main\.js/.test(html), 'index.html boots js/main.js as a module');
ok(/id="app"|id="screen"/.test(html), 'index.html has the screen mount point');
ok(/css\/style\.css/.test(html), 'index.html links the stylesheet');
ok(/Poppins/.test(html) || /Poppins/.test(css), 'Poppins is loaded');
const scriptTags = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
ok(scriptTags.every((s) => /^https?:/.test(s) || existsSync(join(ROOT, s))), 'every script src resolves', scriptTags.join(', '));

group('no stray debug or TODO');
ok(!/console\.log\(/.test(allSrc), 'no console.log left in shipped modules');
ok(!/\bTODO\b|\bFIXME\b/.test(allSrc), 'no TODO/FIXME left in shipped modules');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
process.exit(0);
