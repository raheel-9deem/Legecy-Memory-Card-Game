/**
 * Every level, played to the end.
 *
 * The rest of the suite checks the engine against a handful of representative
 * levels. This one takes the claim literally: all 100 levels are in the game and
 * every one of them can be dealt, solved and paid out. It is the test that would
 * have caught a tier whose grid has no legal deal, a theme with too few symbols
 * for a 32-pair board, or a clock too short to be winnable.
 *
 * Note that a level being *playable* and a level being *open* are two different
 * claims. The engine deals any level it is handed — the sequential lock lives in
 * storage.canPlay(), which the screens consult and the engine does not. So the
 * playthroughs below deliberately bypass the lock, and the lock gets its own
 * group.
 *
 *   node tools/_build-win.mjs
 *   node tools/_all-levels-test.mjs <mirror>
 *
 * Speed: a real clear waits MATCH_DELAY (380ms) per pair, and there are 1993
 * pairs across the ladder — twelve minutes of sleeping. So `_defer` is replaced
 * per instance with a synchronous call. The engine's own completion check still
 * runs, unmodified, inside that callback; only the sleep is skipped.
 */

const ROOT = process.argv[2];
const mod = (p) => import(new URL(`file:///${ROOT.replace(/^\/+/, '')}/${p}`).href);

globalThis.window = { innerWidth: 1280, innerHeight: 800 };
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

const { GameManager, GAME_STATE } = await mod('core/game.mjs');
const { LEVELS, TOTAL_LEVELS, calculateStars } = await mod('core/levels.mjs');
const { THEME_IDS, getTheme } = await mod('data/themes.mjs');
const { store } = await mod('core/storage.mjs');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
};
const group = (name) => console.log('\n== ' + name + ' ==');

/**
 * Play one level from the first flip to the win, choosing the correct partner
 * every time. Returns what the round reported, or the reason it could not run.
 */
function playThrough(level, themeId, portrait = false) {
  // `_orientGrid` transposes a grid on a portrait screen so cards stay large,
  // and it reads the window at init time — so the shape is set here, per round.
  globalThis.window.innerWidth = portrait ? 420 : 1280;
  globalThis.window.innerHeight = portrait ? 900 : 800;

  const g = new GameManager();
  // Synchronous deferrals — see the note at the top of the file.
  g._defer = (fn) => { fn(); return 0; };

  let ended = null;
  g.init({ levelId: level.id, themeId });
  g.startGame();
  g.on('game:over', (e) => { ended = e.detail; });

  const deck = g.board.cards;
  const dealt = deck.length;

  // Group by the value that decides a match, then flip each group as a pair.
  const bySymbol = new Map();
  for (const c of deck) {
    const key = c.symbol ?? c.value ?? c.pairId;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key).push(c);
  }

  let mismatches = 0;
  for (const [, group_] of bySymbol) {
    if (group_.length !== 2) { mismatches++; continue; }
    g.flipCard(group_[0].id);
    g.flipCard(group_[1].id);
  }

  const result = {
    dealt,
    groups: bySymbol.size,
    oddGroups: mismatches,
    moves: g.moves,
    matched: deck.filter((c) => c.isMatched).length,
    complete: g.board.isComplete,
    state: g.state,
    rows: g.board.rows,
    cols: g.board.cols,
    positions: new Set(deck.map((c) => c.position)).size,
    ended,
  };
  g.destroy();
  return result;
}

group(`all ${TOTAL_LEVELS} levels are dealt correctly`);
ok(TOTAL_LEVELS === 70, `the ladder is 70 levels long (${TOTAL_LEVELS})`);
ok(LEVELS.length === TOTAL_LEVELS, 'and the table holds one definition per level');
ok(new Set(LEVELS.map((l) => l.id)).size === TOTAL_LEVELS, 'with no duplicate or missing id');
ok(LEVELS.every((l, i) => l.id === i + 1), 'ids run 1..70 in order, with no gap to fall through');

const dealFaults = [];
for (const level of LEVELS) {
  const cards = level.rows * level.cols;
  if (cards % 2 !== 0) dealFaults.push(`L${level.id}: ${level.rows}x${level.cols} is an odd grid`);
  if (level.pairs * 2 !== cards) dealFaults.push(`L${level.id}: ${level.pairs} pairs != ${cards} cards`);
  // Every theme must be able to fill the biggest board it can be handed.
  for (const id of THEME_IDS) {
    const supply = getTheme(id).symbols.length;
    if (supply < level.pairs) dealFaults.push(`L${level.id}: theme "${id}" has ${supply} symbols for ${level.pairs} pairs`);
  }
  if (level.timeLimit / level.pairs < 5) dealFaults.push(`L${level.id}: ${level.timeLimit}s for ${level.pairs} pairs is under 5s/pair`);
}
ok(dealFaults.length === 0, `every level has an even grid, a matching pair count, enough symbols in every theme and 5s+ per pair${dealFaults.length ? ' — ' + dealFaults.slice(0, 4).join('; ') : ''}`);

group('every level can be entered');
store.load();
store.reset();
store.state.coins = 0;
const barred = LEVELS.filter((l) => !store.canPlay(l.id).ok);
ok(barred.length === 0, `nothing refuses entry on a fresh, broke save (${barred.map((l) => l.id).join(',') || 'none'})`);

group('every level can be played to a win');
// Each level is played twice: on its own default theme on a desktop-shaped
// screen, and on a different symbol set on a phone-shaped one — where every
// non-square grid comes back transposed. A level is never declared playable on
// the strength of one lucky deal in one orientation.
const playFaults = [];
const starTotals = { 1: 0, 2: 0, 3: 0 };
let transposed = 0;
for (const level of LEVELS) {
  const runs = [
    { themeId: level.theme, portrait: false },
    { themeId: THEME_IDS[level.id % THEME_IDS.length], portrait: true },
  ];
  for (const { themeId, portrait } of runs) {
    const r = playThrough(level, themeId, portrait);
    const cards = level.rows * level.cols;
    const where = `L${level.id}/${themeId}/${portrait ? 'portrait' : 'landscape'}`;
    const why = [];
    if (r.dealt !== cards) why.push(`dealt ${r.dealt} of ${cards}`);
    if (r.oddGroups) why.push(`${r.oddGroups} symbol(s) not dealt as a pair`);
    if (r.groups !== level.pairs) why.push(`${r.groups} distinct symbols for ${level.pairs} pairs`);
    // Two cards sharing a grid position would stack invisibly on the board.
    if (r.positions !== cards) why.push(`${r.positions} distinct positions for ${cards} cards`);
    if (r.rows * r.cols !== cards) why.push(`grid ${r.rows}x${r.cols} does not hold ${cards} cards`);
    if (r.matched !== cards) why.push(`only ${r.matched} cards ended matched`);
    if (!r.complete) why.push('board never reported complete');
    if (r.state !== GAME_STATE.WON) why.push(`ended in state "${r.state}" rather than won`);
    if (!r.ended || r.ended.won !== true) why.push('no won:true game-over event');
    if (r.moves !== level.pairs) why.push(`${r.moves} moves for ${level.pairs} pairs`);
    if (r.ended && !(r.ended.coins > 0)) why.push('paid out no coins');
    if (why.length) playFaults.push(`${where}: ${why.join(', ')}`);
    if (r.ended && r.ended.stars) starTotals[r.ended.stars] = (starTotals[r.ended.stars] || 0) + 1;
    if (portrait && r.rows > r.cols && level.cols > level.rows) transposed++;
  }
}
ok(playFaults.length === 0,
  `all ${LEVELS.length} levels cleared on two themes and both orientations — ${LEVELS.length * 2} rounds, 0 faults${playFaults.length ? ' — ' + playFaults.slice(0, 5).join(' | ') : ''}`);
const wide = LEVELS.filter((l) => l.cols > l.rows).length;
ok(transposed === wide,
  `all ${wide} wide grids come back taller than they are wide on a phone (${transposed})`);

// A perfect run is every pair found first try, so it should score 3 stars on
// every level. If a level's clock is so tight that a flawless clear cannot make
// the half-time star, that level is mis-tuned rather than broken.
ok(starTotals[3] === LEVELS.length * 2,
  `a flawless clear scores 3 stars on every level (3★ ${starTotals[3]}, 2★ ${starTotals[2] || 0}, 1★ ${starTotals[1] || 0})`);
ok(calculateStars({ pairs: 24, moves: 24, timeLeft: 200, timeLimit: 230 }) === 3,
  'and the star maths agrees on the largest board');

console.log(`\n${pass} passed, ${failures.length} failed`);
failures.forEach((f) => console.log('  - ' + f));
if (failures.length) process.exit(1);
