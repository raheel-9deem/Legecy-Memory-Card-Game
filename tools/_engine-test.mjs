/**
 * Headless engine assertion suite. Run against the .mjs mirror built by
 * _build-check.mjs so plain Node can import the browser modules.
 *   node tools/_build-check.mjs ./js /tmp/mmc
 *   node tools/_engine-test.mjs /tmp/mmc
 */

const ROOT = process.argv[2];
const mod = (p) => import(new URL(`file:///${ROOT.replace(/^\/+/, '')}/${p}`).href);

// --- minimal browser stubs the engine + storage touch ---
globalThis.window = { innerWidth: 1280, innerHeight: 800 };
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

const { LEVELS, TOTAL_LEVELS, getLevel, hasNextLevel, calculateStars, starCriteria, themeForLevel } =
  await mod('core/levels.mjs');
const { THEMES, THEME_IDS, getTheme, randomThemeId } = await mod('data/themes.mjs');
const { GameManager, GAME_STATE, Card, GameBoard, HARD_MODE_TIME } = await mod('core/game.mjs');
const { EVENTS, bus } = await mod('core/events.mjs');
const { STORE_ITEMS, STORE_TABS, COMING_SOON, getStoreItem } = await mod('data/store-items.mjs');
const { store } = await mod('core/storage.mjs');
const { COIN_RULES, calculateCoins, coinBreakdown, coinBank } = await mod('core/coins.mjs');
const { timerColor, TimerRing, formatClock } = await mod('ui/timer-ring.mjs');

const SAVE_KEY = 'memory-master:save:v2';

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const group = (name) => console.log('\n== ' + name + ' ==');

/* ---------------------------------------------------------------- */
group('100 levels, grids exactly as specified');
ok(TOTAL_LEVELS === 100, `TOTAL_LEVELS is 100 (got ${TOTAL_LEVELS})`);

/** Fill a contiguous id range with one grid, so the map stays readable. */
const span = (from, to, rows, cols) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, [rows, cols]]));

const SPEC = {
  1: [2, 2], 2: [2, 2], 3: [2, 2],
  4: [2, 3], 5: [2, 3], 6: [2, 3],
  7: [4, 3], 8: [4, 3], 9: [4, 3], 10: [4, 3],
  11: [4, 4], 12: [4, 4], 13: [4, 4], 14: [4, 4], 15: [4, 4],
  16: [4, 5], 17: [4, 5], 18: [4, 5],
  19: [6, 5], 20: [6, 5],
  ...span(21, 32, 4, 8),
  ...span(33, 44, 6, 6),
  ...span(45, 56, 5, 8),
  ...span(57, 70, 6, 8),
  ...span(71, 80, 7, 8),
  ...span(81, 100, 8, 8),
};
let gridOk = true, pairOk = true, fieldOk = true;
const SPEC_COUNT = Object.keys(SPEC).length;
for (const [id, [r, c]] of Object.entries(SPEC)) {
  const l = getLevel(Number(id));
  if (l.rows !== r || l.cols !== c) { gridOk = false; console.log(`     L${id}: ${l.rows}x${l.cols} expected ${r}x${c}`); }
  if (l.pairs !== (r * c) / 2) { pairOk = false; console.log(`     L${id}: ${l.pairs} pairs expected ${(r * c) / 2}`); }
  if (!(l.timeLimit > 0) || typeof l.requiredCoins !== 'number' || !l.theme || !l.difficulty) {
    fieldOk = false; console.log(`     L${id}: missing a required field`);
  }
}
ok(SPEC_COUNT === 100, `the spec map covers all 100 levels (got ${SPEC_COUNT})`);
ok(gridOk, 'every level matches the requested grid size');
ok(pairOk, 'pairs === rows*cols/2 on every level');
ok(fieldOk, 'every level carries timeLimit, requiredCoins, theme, difficulty');
ok(LEVELS.every((l) => (l.rows * l.cols) % 2 === 0), 'every grid holds an even card count');
ok(LEVELS.every((l) => THEME_IDS.includes(l.theme)), 'every level theme resolves to a real symbol set');
ok(LEVELS.every((l) => l.requiredCoins >= 0), 'coin gates are non-negative');
ok(LEVELS.every((l) => ['easy', 'medium', 'hard', 'expert', 'master', 'grandmaster'].includes(l.difficulty)),
  'difficulty labels are valid');
ok(getLevel(999).id === 1 && getLevel(undefined).id === 1, 'getLevel falls back to level 1 on a bad id');
ok(hasNextLevel(99) && !hasNextLevel(100), 'level 100 is the last level');
ok(getLevel(44).difficulty === 'expert' && getLevel(45).difficulty === 'master', 'the master band opens at level 45');
ok(getLevel(80).difficulty === 'master' && getLevel(81).difficulty === 'grandmaster',
  'the grandmaster band opens at level 81');
ok(getLevel(19).difficulty === 'expert' && getLevel(18).difficulty === 'hard', 'the original 20 levels keep their difficulty bands');
ok(getLevel(70).pairs === 24 && getLevel(80).pairs === 28 && getLevel(100).pairs === 32,
  'the ladder climbs 24 -> 28 -> 32 pairs and tops out at 32');
// The ceiling is bounded by the symbol supply: a board with more pairs than a
// theme has symbols would deal the same emoji as two different pairs.
const minSupply = Math.min(...THEME_IDS.map((id) => getTheme(id).symbols.length));
ok(LEVELS.every((l) => l.pairs <= minSupply),
  `no level asks for more pairs than the thinnest theme can supply (${minSupply})`);

group('time limits decrease within each grid tier');
const tiers = new Map();
LEVELS.forEach((l) => {
  const k = `${l.rows}x${l.cols}`;
  tiers.set(k, [...(tiers.get(k) || []), l]);
});
let tierDesc = true;
for (const [k, ls] of tiers) {
  for (let i = 1; i < ls.length; i++) {
    if (ls[i].timeLimit >= ls[i - 1].timeLimit) {
      tierDesc = false;
      console.log(`     ${k}: L${ls[i].id} (${ls[i].timeLimit}s) not tighter than L${ls[i - 1].id} (${ls[i - 1].timeLimit}s)`);
    }
  }
}
ok(tierDesc, 'timeLimit strictly tightens with each level inside a tier');
ok(LEVELS.every((l) => l.timeLimit / l.pairs >= 5), 'every level allows at least 5s per pair (stays playable)');
ok(LEVELS.every((l) => l.requiredCoins >= 0), 'no level asks for a negative coin balance');
ok(LEVELS[0].requiredCoins === 0, 'level 1 has no coin gate');

group('emoji themes');
ok(THEME_IDS.length >= 10, `${THEME_IDS.length} themes available (spec named 9 + "and more")`);
for (const want of ['fruits', 'animals', 'space', 'food', 'sports', 'tech', 'flags', 'shapes', 'music']) {
  ok(THEME_IDS.includes(want), `theme "${want}" exists`);
}
let symOk = true, dupOk = true;
for (const id of THEME_IDS) {
  const t = THEMES[id];
  if (t.symbols.length < 24) { symOk = false; console.log(`     ${id}: only ${t.symbols.length} symbols`); }
  if (new Set(t.symbols).size !== t.symbols.length) { dupOk = false; console.log(`     ${id}: duplicate symbols`); }
}
ok(symOk, 'every theme has >= 24 symbols (the 6x8 board needs 24 pairs)');
ok(dupOk, 'no theme repeats a symbol');
ok(getTheme('nope').id === 'fruits', 'getTheme falls back on an unknown id');

const easyPicks = new Set(Array.from({ length: 120 }, () => randomThemeId('easy')));
ok([...easyPicks].every((id) => THEMES[id].spread === 'easy'), 'easy levels only draw gentle themes');
ok(!easyPicks.has('flags') && !easyPicks.has('shapes'), 'easy levels never draw flags or shapes');
const autoPicks = new Set(Array.from({ length: 120 }, () => themeForLevel(getLevel(12), 'auto')));
ok(autoPicks.size > 1, `auto mode varies the theme per round (${autoPicks.size} distinct in 120 rolls)`);
ok([...autoPicks].every((id) => THEME_IDS.includes(id)), 'every auto roll is a real theme');
ok(themeForLevel(getLevel(12), 'flags') === 'flags', 'an explicitly equipped theme is respected');

group('deck integrity across all 70 levels');
let deckOk = true, posOk = true, symbolsOk = true;
for (const level of LEVELS) {
  const g = new GameManager();
  g.init({ levelId: level.id, themeId: 'fruits' });
  const cards = g.board.cards;
  if (cards.length !== level.pairs * 2) { deckOk = false; console.log(`     L${level.id}: deck of ${cards.length}`); }
  const counts = {};
  cards.forEach((c) => { counts[c.pairId] = (counts[c.pairId] || 0) + 1; });
  if (Object.values(counts).some((n) => n !== 2)) { deckOk = false; console.log(`     L${level.id}: a pairId is not exactly twice`); }
  if (new Set(cards.map((c) => c.position)).size !== cards.length) posOk = false;
  if (new Set(cards.map((c) => c.symbol)).size !== level.pairs) symbolsOk = false;
  g.destroy();
}
ok(deckOk, 'every level builds exact pairs of two');
ok(posOk, 'board positions are unique on every level');
ok(symbolsOk, 'distinct symbol count === pair count on every level');

group('Card and GameBoard units');
const c1 = new Card({ id: 0, pairId: 0, symbol: 'A', position: 0 });
const c2 = new Card({ id: 1, pairId: 0, symbol: 'A', position: 1 });
ok(c1.flip() === true && c1.isFlipped, 'flip() turns a face-down card and reports true');
ok(c1.flip() === false, 'flip() refuses an already-flipped card');
ok(c1.matches(c2) && !c1.matches(c1), 'matches() pairs by pairId and never with itself');
c1.setMatched();
ok(c1.isMatched && c1.isFaceUp && c1.unflip() === false, 'a matched card stays face up');
c1.reset();
ok(!c1.isMatched && !c1.isFlipped, 'reset() clears both flags');
const b = new GameBoard({ rows: 4, cols: 4, symbols: ['a', 'b', 'c'] });
ok(b.cards.length === 16 && b.pairsTotal === 8, 'GameBoard sizes itself from rows x cols');
ok(b.cards.every((c) => ['a', 'b', 'c'].includes(c.symbol)), 'a short symbol list cycles rather than crashing');

group('countdown starts on the FIRST FLIP, not on startGame');
const g = new GameManager();
let starts = 0;
g.on(EVENTS.TIMER_START, () => starts++);
g.init({ levelId: 5, themeId: 'fruits' });
g.startGame();
ok(g.state === GAME_STATE.PLAYING, 'startGame opens the board for play');
ok(g.clockStarted === false, 'the clock is NOT running before the first flip');
ok(g._timerId === null, 'no interval is armed before the first flip');
ok(starts === 0, 'no timer:start event before the first flip');
const budget = g.timeLeft;
ok(budget === getLevel(5).timeLimit, 'timeLeft is parked at the level budget');
await wait(1300);
ok(g.timeLeft === budget, `no time lost while the player reads the grid (${budget} -> ${g.timeLeft})`);
g.flipCard(g.board.cards[0].id);
ok(g.clockStarted === true, 'the first flip starts the clock');
ok(starts === 1, 'timer:start fired exactly once');
ok(g._timerId !== null, 'the interval is armed after the first flip');
await wait(1150);
ok(g.timeLeft === budget - 1, `one second elapsed (${budget} -> ${g.timeLeft})`);
g.flipCard(g.board.cards[1].id);
await wait(50);
ok(starts === 1, 'later flips never restart the clock');
g.destroy();

group('match: green-glow keep, points, combo');
const g2 = new GameManager();
g2.init({ levelId: 7, themeId: 'fruits' });
g2.startGame();
const pairsOf = (board) => {
  const m = new Map();
  board.cards.forEach((c) => m.set(c.pairId, [...(m.get(c.pairId) || []), c]));
  return [...m.values()];
};
const allPairs = pairsOf(g2.board);
let matchEvents = 0, comboSeen = [];
g2.on(EVENTS.PAIR_MATCH, (e) => { matchEvents++; comboSeen.push(e.detail.combo); });
const [pa, pb] = allPairs[0];
g2.flipCard(pa.id);
g2.flipCard(pb.id);
ok(matchEvents === 1, 'a matching pair emits pair:match');
ok(pa.isMatched && pb.isMatched, 'both cards stay matched (face up with the glow class)');
ok(pa.isFaceUp && pb.isFaceUp, 'matched cards never flip back');
ok(g2.score === 100, `a first match scores 100 (got ${g2.score})`);
ok(g2.locked === true, 'the board is locked during the match animation');
const spare = g2.board.cards.find((c) => !c.isMatched);
ok(g2.flipCard(spare.id) === false, 'clicks are rejected while the board is locked');
await wait(450);
ok(g2.locked === false, 'the lock releases after the match delay');

group('combo multiplier climbs on consecutive matches');
for (const [x, y] of allPairs.slice(1, 4)) {
  g2.locked = false;
  g2.flipCard(x.id);
  g2.flipCard(y.id);
}
ok(JSON.stringify(comboSeen) === '[1,2,3,4]', `combo climbs 1,2,3,4 (got ${comboSeen})`);
ok(g2.score === 100 + 200 + 300 + 400, `score adds 100 x combo each time (got ${g2.score})`);
ok(g2.bestCombo === 4, 'bestCombo is tracked');
g2.destroy();

group('mismatch: 1 second hold, then flip back, combo reset');
const g3 = new GameManager();
g3.init({ levelId: 7, themeId: 'fruits' });
g3.startGame();
const p3 = pairsOf(g3.board);
// build a genuine mismatch from two different pairs
const m1 = p3[0][0], m2 = p3[1][0];
let mismatchEvents = 0, unflips = 0;
g3.on(EVENTS.PAIR_MISMATCH, () => mismatchEvents++);
g3.on(EVENTS.CARD_UNFLIP, () => unflips++);
// earn a combo first so we can watch it reset
g3.flipCard(p3[2][0].id); g3.flipCard(p3[2][1].id);
await wait(450);
ok(g3.combo === 1, 'combo is 1 after one match');
const t0 = process.hrtime.bigint();
g3.flipCard(m1.id);
g3.flipCard(m2.id);
ok(mismatchEvents === 1, 'a non-matching pair emits pair:mismatch');
ok(g3.combo === 0, 'combo resets to 0 on a mismatch');
ok(g3.locked === true, 'the board locks during the red shake');
ok(g3.flipCard(p3[3][0].id) === false, 'clicks are rejected during the shake');
await wait(700);
ok(m1.isFlipped && m2.isFlipped && unflips === 0, 'the pair is still visible at 700ms (inside the 1s hold)');
await wait(420);
const heldMs = Number(process.hrtime.bigint() - t0) / 1e6;
ok(!m1.isFlipped && !m2.isFlipped, 'the pair flips back after the hold');
ok(unflips === 1, 'card:unflip fired exactly once');
ok(heldMs >= 1000, `the hold lasted at least 1000ms (measured ${heldMs.toFixed(0)}ms)`);
ok(g3.locked === false, 'the board unlocks after the flip-back');
g3.destroy();

group('pause / resume / reset');
const g4 = new GameManager();
g4.init({ levelId: 8, themeId: 'fruits' });
g4.startGame();
g4.flipCard(g4.board.cards[0].id);
g4.pauseGame();
ok(g4.state === GAME_STATE.PAUSED && g4._timerId === null, 'pauseGame stops the clock');
const held = g4.timeLeft;
await wait(1200);
ok(g4.timeLeft === held, 'no time drains while paused');
g4.resumeGame();
ok(g4.state === GAME_STATE.PLAYING && g4._timerId !== null, 'resumeGame restarts the already-started clock');
g4.resetGame();
ok(g4.moves === 0 && g4.score === 0 && g4.combo === 0, 'resetGame clears the round counters');
ok(g4.clockStarted === false && g4._timerId === null, 'resetGame parks the clock again for a fresh first flip');
ok(g4.timeLeft === getLevel(8).timeLimit, 'resetGame restores the full time budget');
ok(g4.board.cards.every((c) => !c.isFlipped && !c.isMatched), 'resetGame deals a face-down board');
g4.destroy();

group('Game Over on timeout');
const g5 = new GameManager();
g5.init({ levelId: 1, themeId: 'fruits' });
g5.startGame();
let over = null;
g5.on(EVENTS.GAME_OVER, (e) => { over = e.detail; });
g5.flipCard(g5.board.cards[0].id);
g5.timeLeft = 1;
await wait(1200);
ok(over !== null, 'game:over fires when the clock reaches 0');
ok(over && over.won === false && over.result === 'lost', 'the payload reports a loss');
ok(over && over.stars === 0 && over.coins === 0, 'a loss pays no stars and no coins');
ok(g5.state === GAME_STATE.LOST, 'state is LOST');
ok(g5._timerId === null, 'the interval is cleared on game over');
ok(over && over.matched < over.total, 'the payload carries matched/total for the "pairs still hidden" line');
g5.destroy();

group('win path');
const g6 = new GameManager();
g6.init({ levelId: 2, themeId: 'fruits' });
g6.startGame();
let win = null;
g6.on(EVENTS.GAME_OVER, (e) => { win = e.detail; });
for (const [x, y] of pairsOf(g6.board)) {
  g6.locked = false;
  g6.flipCard(x.id);
  g6.flipCard(y.id);
}
await wait(500);
ok(win && win.won === true, 'clearing every pair wins the round');
ok(win && win.stars === 3, `a flawless clear earns 3 stars (got ${win && win.stars})`);
ok(win && win.coins > 0, `coins are awarded (${win && win.coins})`);
ok(win && win.timeUsed >= 0, 'timeUsed is reported');
g6.destroy();

group('power-ups');
const g7 = new GameManager();
g7.init({ levelId: 9, themeId: 'fruits', powerups: { hint: 1, freeze: 1, shuffle: 1 } });
g7.startGame();
let hintShown = 0, hintHidden = 0, shuffled = 0;
g7.on(EVENTS.HINT_SHOW, () => hintShown++);
g7.on(EVENTS.HINT_HIDE, () => hintHidden++);
g7.on(EVENTS.BOARD_SHUFFLE, () => shuffled++);
ok(g7.usePowerup('hint') === true && hintShown === 1, 'hint reveals the hidden cards');
ok(g7.usePowerup('shuffle') === true && shuffled === 1, 'shuffle re-orders the board');
ok(g7.board.cards.length === getLevel(9).pairs * 2, 'shuffle preserves the deck size');
ok(g7.usePowerup('nonsense') === false, 'an unknown power-up is rejected');
g7.flipCard(g7.board.cards[0].id);
g7.usePowerup('freeze');
const frozenAt = g7.timeLeft;
await wait(1150);
ok(g7.isFrozen === true, 'freeze reports frozen while active');
ok(g7.timeLeft === frozenAt, `the clock holds while frozen (${frozenAt} -> ${g7.timeLeft})`);
await wait(1900);
ok(hintHidden === 1, 'hint:hide fires after the hint duration');
g7.destroy();

group('3-star rating: clear / under half the clock / under 2x pairs moves');
const L = getLevel(10);                       // 6 pairs, 56s
const run = (moves, timeLeft) => ({ pairs: L.pairs, moves, timeLeft, timeLimit: L.timeLimit });
ok(calculateStars(run(6, L.timeLimit)) === 3, 'flawless run = 3 stars');
ok(calculateStars(run(20, L.timeLimit * 0.7)) === 2, 'fast but sloppy = 2 stars (time only)');
ok(calculateStars(run(6, L.timeLimit * 0.1)) === 2, 'slow but efficient = 2 stars (moves only)');
ok(calculateStars(run(40, 1)) === 1, 'scraped through = 1 star, never zero on a clear');
ok(calculateStars(run(6, 0)) >= 1, 'winning on the last tick still earns the completion star');
// Boundaries: both tests are strict "<".
ok(calculateStars(run(6, L.timeLimit / 2)) === 2,
  'spending exactly half the clock misses the time star');
ok(calculateStars(run(L.pairs * 2, L.timeLimit)) === 2,
  `exactly ${L.pairs * 2} moves misses the move star`);
ok(calculateStars(run(L.pairs * 2 - 1, L.timeLimit)) === 3, 'one move under the cap earns it');

const detail = starCriteria(run(20, L.timeLimit * 0.7));
ok(detail.criteria.length === 3, 'starCriteria reports all three tests, met or not');
ok(detail.criteria.map((c) => c.key).join(',') === 'clear,time,moves', 'criteria keep star order');
ok(detail.criteria[0].met === true, 'the completion star is always the first and always met');
ok(detail.criteria.every((c) => c.label && c.detail), 'every criterion carries a label and a detail line');
ok(detail.total === detail.criteria.filter((c) => c.met).length, 'total matches the met criteria');

group('coin payout: base 10 + 5/second left + 2/combo match');
ok(COIN_RULES.base === 10 && COIN_RULES.perSecondLeft === 5 && COIN_RULES.perComboMatch === 2,
  'the published rates are 10 / 5 / 2');
ok(calculateCoins({ timeLeft: 0, comboMatches: 0 }).total === 10, 'a bare clear pays the 10 base');
ok(calculateCoins({ timeLeft: 12, comboMatches: 0 }).total === 10 + 60, '12s left adds 60');
ok(calculateCoins({ timeLeft: 0, comboMatches: 3 }).total === 10 + 6, '3 combo matches add 6');
ok(calculateCoins({ timeLeft: 12, comboMatches: 3 }).total === 76, 'the three parts sum (10+60+6)');
ok(calculateCoins({ timeLeft: 12.9, comboMatches: 3.7 }).total === 76, 'part-seconds and part-combos floor');
ok(calculateCoins({ timeLeft: -5, comboMatches: -2 }).total === 10, 'negatives clamp to zero, never below base');
ok(calculateCoins({ timeLeft: 40, comboMatches: 4, won: false }).total === 0, 'a loss pays nothing');
ok(calculateCoins().total === 10, 'calculateCoins() survives no arguments');

const purse = calculateCoins({ timeLeft: 12, comboMatches: 3 });
ok(purse.base === 10 && purse.time === 60 && purse.combo === 6, 'the purse itemises each part');
ok(coinBreakdown(purse).length === 3, 'the breakdown lists base, time and combo');
ok(coinBreakdown(calculateCoins({ timeLeft: 0, comboMatches: 0 })).length === 1,
  'the breakdown drops rows worth nothing');
ok(coinBreakdown(purse).reduce((s, r) => s + r.value, 0) === purse.total,
  'the breakdown rows add up to the total paid');

group('combo matches counted by the engine, then paid');
const g8 = new GameManager();
g8.init({ levelId: 1, themeId: 'fruits' });    // 2x2, 2 pairs
g8.startGame();
let overPayload = null;
g8.on(EVENTS.GAME_OVER, (e) => { overPayload = e.detail; });
const byPair = new Map();
g8.board.cards.forEach((c) => {
  if (!byPair.has(c.pairId)) byPair.set(c.pairId, []);
  byPair.get(c.pairId).push(c);
});
for (const [, [a, b2]] of byPair) {
  g8.flipCard(a.id);
  g8.flipCard(b2.id);
  await wait(430);                             // MATCH_DELAY + margin
}
ok(overPayload !== null, 'clearing the board ends the round');
ok(overPayload.won === true && overPayload.result === 'won', 'the payload reports a win');
ok(overPayload.comboMatches === 1, 'the first match of a streak is not a combo; the second is');
ok(overPayload.moves === 2, 'a perfect 2-pair run takes 2 moves');
ok(overPayload.stars === 3, 'a perfect run scores 3 stars');
ok(overPayload.purse.combo === 2, 'that one combo match pays 2');
ok(overPayload.coins === overPayload.purse.total, 'the headline coin figure is the purse total');
ok(overPayload.coins === 10 + overPayload.purse.seconds * 5 + 2, 'the payout follows the published rule');
ok(overPayload.timeUsed === getLevel(1).timeLimit - overPayload.timeLeft, 'timeUsed mirrors the clock');
ok(Array.isArray(overPayload.starDetail) && overPayload.starDetail.length === 3,
  'the win screen is handed the per-star detail');
g8.destroy();

group('progress: unlocking, records and player data in localStorage');
memStore.clear();
store.reset();
store.load();
ok(store.state.unlockedLevel === 1, 'a fresh save starts its progress marker at level 1');
ok(store.isUnlocked(1) && store.isUnlocked(2), 'and level 2 is open anyway — nothing is locked');
ok(typeof store.state.player.createdAt === 'string', 'the player record is stamped on first load');
ok(typeof store.state.player.lastPlayed === 'string', 'lastPlayed is stamped every session');

let unlockEvents = 0;
bus.on(EVENTS.LEVEL_UNLOCKED, () => unlockEvents++);
const w1 = store.recordWin(1, { stars: 2, time: 12, moves: 5 });
ok(w1.unlockedLevel === 2 && store.isUnlocked(2), 'clearing a level unlocks the next one');
ok(unlockEvents === 1, 'the unlock is announced on the bus');
ok(store.getLevelRecord(1).bestTime === 12 && store.getLevelRecord(1).bestMoves === 5,
  'the first clear records the best time and moves');
ok(w1.isNewTimeRecord === false, 'a first clear is not reported as beating a previous time');
ok(w1.isNewStarRecord === true, 'a first clear is a new star record');

const w2 = store.recordWin(1, { stars: 1, time: 20, moves: 9 });
ok(store.getLevelRecord(1).stars === 2, 'a worse run never lowers the star record');
ok(store.getLevelRecord(1).bestTime === 12, 'a slower run never overwrites the best time');
ok(store.getLevelRecord(1).clearCount === 2, 'clearCount counts every clear');
ok(w2.unlockedLevel === null, 'replaying a cleared level unlocks nothing new');
ok(store.state.unlockedLevel === 2, 'and does not roll progression backwards');

const w3 = store.recordWin(1, { stars: 3, time: 8, moves: 3 });
ok(w3.isNewStarRecord && w3.isNewTimeRecord, 'a better run reports both new records');
ok(store.getLevelRecord(1).stars === 3 && store.getLevelRecord(1).bestTime === 8, 'and banks them');

const saved = JSON.parse(memStore.get(SAVE_KEY));
ok(saved.unlockedLevel === 2, 'progression is written to localStorage');
ok(saved.levels['1'].stars === 3 && saved.levels['1'].bestTime === 8, 'per-level records are written too');
ok(typeof saved.player.createdAt === 'string', 'the player block is part of the save file');

store.recordWin(TOTAL_LEVELS, { stars: 3, time: 30, moves: 20 });
ok(store.state.unlockedLevel <= TOTAL_LEVELS, 'clearing the last level cannot unlock a 21st');
ok(hasNextLevel(TOTAL_LEVELS) === false, 'and hasNextLevel agrees there is nothing after it');

group('coin bank persists across sessions');
memStore.clear();
store.reset();
store.load();
const before = coinBank.total;
let earned = null;
bus.on(EVENTS.COINS_EARNED, (e) => { earned = e.detail; });
coinBank.award(75, { levelId: 3 });
ok(coinBank.total === before + 75, `award() adds to the balance (${before} -> ${coinBank.total})`);
ok(earned && earned.amount === 75 && earned.total === coinBank.total, 'coins:earned carries the delta and new total');
ok(coinBank.lifetimeEarned === 75, 'lifetime earnings accumulate separately from the balance');
ok(coinBank.award(0) === coinBank.total && coinBank.award(-40) === coinBank.total,
  'awarding nothing (or a negative) is a no-op');
ok(JSON.parse(memStore.get(SAVE_KEY)).coins === before + 75, 'the new balance is written to localStorage');

const banked = coinBank.total;
store.state.coins = 0;                         // wipe only the in-memory copy
store.load();                                  // re-read the save file, as a new session would
ok(coinBank.total === banked, 'the balance survives a reload from localStorage');
ok(coinBank.lifetimeEarned === 75, 'so does the lifetime total');
ok(coinBank.canAfford(banked) && !coinBank.canAfford(banked + 1), 'canAfford reads the restored balance');
ok(coinBank.spend(banked) === true && coinBank.total === 0, 'spend() draws the balance down');
ok(coinBank.spend(1) === false, 'spend() refuses to overdraw');

group('timer ring: green -> red ramp');
ok(timerColor(1).tone === 'safe' && timerColor(1).stroke === '#37e2a0', 'a full clock is green');
ok(timerColor(0.5).tone === 'warn', 'half a clock is amber');
ok(timerColor(0.25).tone === 'low', 'a quarter clock is orange');
ok(timerColor(0.05).tone === 'critical' && timerColor(0.05).stroke === '#ff5470', 'nearly out is red');
ok(timerColor(0).tone === 'critical', 'an empty clock is red');
const ramp = [1, 0.7, 0.5, 0.3, 0.1, 0].map((f) => timerColor(f).tone);
ok(JSON.stringify(ramp) === '["safe","safe","warn","low","critical","critical"]', `the ramp is monotone green->red (${ramp})`);
ok(formatClock(75) === '1:15' && formatClock(0) === '0:00' && formatClock(-4) === '0:00', 'clock formatting clamps at zero');
const markup = TimerRing.markup();
ok(markup.includes('timer-ring-arc') && markup.includes('stroke-dasharray'), 'ring markup carries a dash-array arc');
ok(markup.includes('role="timer"'), 'the ring is announced as a timer');
ok(new TimerRing().reset(60) instanceof TimerRing, 'reset() is safe before attach (no DOM)');

group('every level is enterable');
store.load();
// The two things that used to withhold a level: an empty purse and no progress.
store.state.coins = 0;
store.state.unlockedLevel = 1;
const refused = LEVELS.filter((l) => !store.canPlay(l.id).ok);
ok(refused.length === 0,
  `all ${LEVELS.length} levels are enterable at 0 coins from a fresh save (${refused.length} refused)`);
ok(LEVELS.every((l) => store.isUnlocked(l.id)), 'and every level id reports as unlocked');
ok(LEVELS.every((l) => l.requiredCoins === 0), 'no level definition carries a coin gate');
ok(store.canPlay(LEVELS.length).ok === true, 'the last level is enterable without clearing the 69 before it');
ok(store.state.coins === 0, 'entering a level costs nothing');
// A bad id is still refused — that is the only remaining refusal branch, and it
// has to report a reason rather than throw.
ok(store.canPlay(0).ok === false && store.canPlay(0).reason === 'unknown', 'id 0 is not a level');
ok(store.canPlay(LEVELS.length + 1).ok === false, 'an id past the last level is not a level');

group('store catalogue');
const themeItems = STORE_ITEMS.filter((i) => i.kind === 'theme');
ok(themeItems.every((i) => i.id === 'auto' || THEME_IDS.includes(i.id)), 'every theme item maps to a real symbol set');
ok(themeItems.some((i) => i.id === 'auto' && i.price === 0), 'the random/auto theme is free');
ok(new Set(STORE_ITEMS.map((i) => i.id)).size === STORE_ITEMS.length, 'no duplicate store ids');
ok(STORE_ITEMS.every((i) => i.price >= 0 && i.name && i.desc && i.icon), 'store entries are complete');
ok(THEME_IDS.every((id) => themeItems.some((i) => i.id === id)), 'every theme is purchasable');

group('coming-soon teasers');
ok(COMING_SOON.length === 4, `four teasers are declared (${COMING_SOON.length})`);
ok(COMING_SOON.every((i) => i.name && i.desc && i.icon && i.eta && i.price > 0),
  'every teaser has a name, blurb, icon, price and ETA');
ok(new Set(COMING_SOON.map((i) => i.id)).size === 4, 'no duplicate teaser ids');
// The whole point of keeping them out of STORE_ITEMS: the purchase path cannot
// see them, so no crafted id or stray click can buy vapour.
ok(COMING_SOON.every((i) => !STORE_ITEMS.some((s) => s.id === i.id)),
  'no teaser appears in the real catalogue');
ok(COMING_SOON.every((i) => getStoreItem(i.id) === null),
  'getStoreItem refuses to resolve a teaser id');
store.state.coins = 100000;
const soonBuy = store.purchase({ id: 'soon-remove-timer', kind: 'upgrade', price: 400 });
ok(soonBuy.ok === false || !store.owns('soon-remove-timer'),
  'a hand-rolled teaser purchase does not grant ownership');
ok(store.state.coins === 100000 || soonBuy.ok === false, 'and does not spend coins');
ok(STORE_TABS.some((t) => t.key === 'soon'), 'the store declares a Coming Soon tab');
// The other half of resolving against the catalogue: a lied-about price is ignored.
const realItem = STORE_ITEMS.find((i) => i.kind === 'cardBack' && i.price > 0);
store.state.owned = store.state.owned.filter((id) => id !== realItem.id);
store.state.coins = 100000;
store.purchase({ id: realItem.id, kind: realItem.kind, price: 1 });
ok(store.state.coins === 100000 - realItem.price,
  `a tampered price is ignored (charged ${realItem.price}, not 1)`);
ok(store.owns(realItem.id), 'the genuine item is still granted');
ok(store.purchase(realItem.id).reason === 'owned', 'purchase accepts a bare id too');
ok(store.getSetting('notifyUpdates') === false, 'the notify preference starts off');
store.setSetting('notifyUpdates', true);
store.load();
ok(store.getSetting('notifyUpdates') === true, 'and survives a reload');

group('hard mode is a property of the round, not the caller');
const hm = new GameManager();
hm.init({ levelId: 10, themeId: 'fruits', hardMode: true });
const hmLevel = getLevel(10);
const expectBudget = Math.max(10, Math.round(hmLevel.timeLimit * HARD_MODE_TIME));
ok(hm.timeBudget === expectBudget,
  `hard mode squeezes the clock to ${Math.round(HARD_MODE_TIME * 100)}% (${hmLevel.timeLimit}s -> ${hm.timeBudget}s)`);
ok(hm.timeLeft === hm.timeBudget, 'the round starts on the squeezed budget');
ok(hm.snapshot().timeLimit === hm.timeBudget,
  'the snapshot reports the clock the player got, not the level definition');
ok(hm.snapshot().hardMode === true, 'and flags the round as hard mode');
// Every screen measures "time to spare" and star 2 against snapshot().timeLimit,
// so a soft round must still report the paper budget untouched.
const soft = new GameManager();
soft.init({ levelId: 10, themeId: 'fruits' });
ok(soft.timeBudget === hmLevel.timeLimit, 'a normal round runs on the level budget');
ok(soft.snapshot().hardMode === false, 'and is not flagged');
soft.destroy();
hm.destroy();

// The floor matters at the shallow end: 75% of a 30s level is 22s, but nothing
// may ever hand out a clock too short to finish the board on.
let budgetsOk = true;
for (const level of LEVELS) {
  const probe = new GameManager();
  probe.init({ levelId: level.id, themeId: 'fruits', hardMode: true });
  if (probe.timeBudget < 10 || probe.timeBudget > level.timeLimit) budgetsOk = false;
  probe.destroy();
}
ok(budgetsOk, `all ${TOTAL_LEVELS} levels keep a hard-mode clock between 10s and their own budget`);

group('the hard-mode bonus is inside the payout, not bolted on after');
const purseSoft = calculateCoins({ timeLeft: 30, comboMatches: 4, won: true });
const purseHard = calculateCoins({ timeLeft: 30, comboMatches: 4, won: true, hardMode: true });
ok(purseSoft.bonus === 0, 'a normal round has no bonus line');
ok(purseHard.bonus > 0, 'a hard round does');
ok(purseHard.total === purseSoft.total + purseHard.bonus,
  'and the bonus is the only difference between the two totals');
ok(purseHard.total === Math.round(purseSoft.total * COIN_RULES.hardModeMultiplier),
  `the multiplier applies to the whole payout (${purseSoft.total} -> ${purseHard.total})`);
// This is the bug the move fixed: the win screen itemises the purse, so the rows
// have to add up to the headline figure the player was actually paid.
const sum = (rows) => rows.reduce((n, r) => n + r.value, 0);
ok(sum(coinBreakdown(purseHard)) === purseHard.total,
  `the itemised rows sum to the hard-mode total (${sum(coinBreakdown(purseHard))} = ${purseHard.total})`);
ok(sum(coinBreakdown(purseSoft)) === purseSoft.total, 'and to the normal total');
ok(coinBreakdown(purseHard).some((r) => /hard mode/i.test(r.label)), 'the bonus gets its own row');
ok(!coinBreakdown(purseSoft).some((r) => /hard mode/i.test(r.label)), 'which is absent otherwise');
ok(calculateCoins({ timeLeft: 40, comboMatches: 9, won: false, hardMode: true }).total === 0,
  'a loss pays nothing, hard mode or not');

group('a pair matched on the final tick is still a clear');
const gTick = new GameManager();
gTick.init({ levelId: 1, themeId: 'fruits' });   // 2 pairs, the shortest round
gTick.startGame();
let tickEnd = null;
gTick.on(EVENTS.GAME_OVER, (e) => { tickEnd = e.detail; });
const tickPairs = pairsOf(gTick.board);
gTick.flipCard(tickPairs[0][0].id);
gTick.flipCard(tickPairs[0][1].id);
await wait(450);
// Land the last pair, then expire the clock inside the match-resolve window.
// _resolveMatch holds the board before it checks for completion, so the tick
// gets there first — it has to ask the board rather than assume a loss.
gTick.timeLeft = 1;
gTick.flipCard(tickPairs[1][0].id);
gTick.flipCard(tickPairs[1][1].id);
gTick._tick();
ok(tickEnd && tickEnd.won === true, 'the round is won, not lost, when the clock and the last pair collide');
ok(gTick.state === GAME_STATE.WON, 'and the engine settles in the WON state');
await wait(450);
ok(tickEnd && tickEnd.result === 'won', 'the deferred completion check does not overwrite it');
gTick.destroy();
// The inverse: an unfinished board on a zero clock is still a loss.
const gLose = new GameManager();
gLose.init({ levelId: 7, themeId: 'fruits' });
gLose.startGame();
let loseEnd = null;
gLose.on(EVENTS.GAME_OVER, (e) => { loseEnd = e.detail; });
gLose.timeLeft = 1;
gLose._tick();
ok(loseEnd && loseEnd.won === false, 'an incomplete board on a dead clock loses');
gLose.destroy();

group('power-ups refuse to fire while the board is locked');
const gLock = new GameManager();
gLock.init({ levelId: 9, themeId: 'fruits' });
gLock.startGame();
const lockPairs = pairsOf(gLock.board);
gLock.flipCard(lockPairs[0][0].id);
gLock.flipCard(lockPairs[0][1].id);
ok(gLock.locked === true, 'a match locks the board for its animation');
// Both of these hold references to positions that an unflip timer is about to
// read back, so neither may run mid-resolve.
const orderBefore = gLock.board.cards.map((c) => `${c.id}@${c.position}`).join(',');
ok(gLock.usePowerup('shuffle') === false, 'shuffle is refused while locked');
ok(gLock.usePowerup('hint') === false, 'hint is refused while locked');
ok(gLock.board.cards.map((c) => `${c.id}@${c.position}`).join(',') === orderBefore,
  'and the deck is left exactly where it was');
await wait(450);
ok(gLock.usePowerup('shuffle') === true, 'both work again once the lock releases');
// Nothing fires after the round is over either — the gameplay screen only docks
// a unit when the engine says yes, so a false here is what keeps the stock honest.
gLock.gameOver('lost');
ok(gLock.usePowerup('hint') === false && gLock.usePowerup('freeze') === false,
  'and neither fires once the round has ended');
gLock.destroy();

group('progress is tracked but never withholds');
// `unlockedLevel` survives as *progress* — level select marks the tile the
// player is up to and scrolls to it. What it must not do any more is decide
// what is playable, so a save sitting at level 1 still opens level 70.
store.load();
store.state.unlockedLevel = 1;
store.state.coins = 0;
ok(store.canPlay(TOTAL_LEVELS).ok === true, 'a save parked at level 1 can still enter level 70');
const clear7 = store.recordWin(7, { stars: 3, time: 20, moves: 12 });
ok(store.state.unlockedLevel === 8, 'clearing a level still advances the progress marker');
ok(clear7.unlockedLevel === 8, 'and still reports the advance so the win screen can announce it');
// Clearing out of order must not walk the marker backwards.
store.recordWin(3, { stars: 1, time: 40, moves: 30 });
ok(store.state.unlockedLevel === 8, 'clearing an earlier level does not drag the marker back');
const last = store.recordWin(TOTAL_LEVELS - 1, { stars: 3, time: 30, moves: 24 });
ok(store.state.unlockedLevel === TOTAL_LEVELS && last.unlockedLevel === TOTAL_LEVELS,
  'clearing the second-to-last level walks the marker onto the last one');
const past = store.recordWin(TOTAL_LEVELS, { stars: 3, time: 30, moves: 24 });
ok(store.state.unlockedLevel === TOTAL_LEVELS && past.unlockedLevel === null,
  'and clearing the last level leaves it there rather than running past the ladder');
ok(store.canPlay(1).requiredCoins === 0, 'no level asks for a balance');

group('audio settings survive an old save file');
// `volume` did not exist when v2 saves were first written. A missing key must
// read as full volume — defaulting to 0 would ship a silent game to anyone who
// had played before the slider existed.
memStore.set(SAVE_KEY, JSON.stringify({ coins: 5, settings: { sound: true } }));
store.load();
ok(store.getSetting('volume') === 1, 'a save file with no volume key reads as full volume');
ok(store.getSetting('sound') === true, 'and keeps the settings it did carry');
store.setSetting('volume', 0.4);
store.load();
ok(store.getSetting('volume') === 0.4, 'a chosen volume persists across a reload');
store.setSetting('volume', 0);
store.load();
ok(store.getSetting('volume') === 0,
  'and zero survives too — it must not be mistaken for a missing value');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);
