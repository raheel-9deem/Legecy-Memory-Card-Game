/**
 * Regression suite for the per-use power-up coin fee.
 *
 * Guards the rule that firing a power-up during a round costs coins from the
 * live balance (on top of the stocked inventory): each use demands BOTH a unit
 * in stock AND the useCost; the engine is asked first so a refusal (locked
 * board, fully matched, etc.) burns neither a unit nor any coins.
 *
 * The coin charge itself lives in the gameplay screen's usePowerup(), which
 * cannot run headless (it touches the DOM). This suite mirrors that exact
 * decision flow against the real store, coinBank, POWERUP_META and engine so
 * the rule is locked down regardless of where it is enforced.
 *
 *   node tools/_build-win.mjs         # windows-safe mirror into ./scratch-mmc
 *   node tools/_powerup-coin-test.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', 'scratch-mmc');
const mod = (p) => import(new URL(`file:///${ROOT.replace(/^\/+/, '')}/${p}`).href);

globalThis.window = { innerWidth: 1280, innerHeight: 800 };
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

const { GameManager } = await mod('core/game.mjs');
const { EVENTS } = await mod('core/events.mjs');
const { store } = await mod('core/storage.mjs');
const { coinBank } = await mod('core/coins.mjs');
const { POWERUP_META } = await mod('data/store-items.mjs');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
};
const group = (name) => console.log('\n== ' + name + ' ==');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const managers = [];
/** A ready-to-play GameManager on a fresh level. */
const freshGame = (levelId = 9) => {
  const g = new GameManager();
  g.init({ levelId, powerups: { hint: 5, freeze: 5, shuffle: 5 } });
  g.startGame();
  managers.push(g);
  return g;
};

/**
 * The pure decision the gameplay screen makes for a power-up use, lifted out
 * of the DOM. Returns { fired, unitSpent, coinsSpent }. Mirrors
 * gameplay.usePowerup() line for line.
 */
function tryUse(key, g) {
  const meta = POWERUP_META[key];
  const count = store.powerupCount(key);
  const cost = meta.useCost || 0;
  if (!count) return { fired: false, unitSpent: false, coinsSpent: 0, reason: 'nostock' };
  if (cost && !store.canAfford(cost)) return { fired: false, unitSpent: false, coinsSpent: 0, reason: 'nofunds' };
  if (!g.usePowerup(key)) return { fired: false, unitSpent: false, coinsSpent: 0, reason: 'engine-refused' };
  store.usePowerup(key);
  if (cost) store.spendCoins(cost);
  return { fired: true, unitSpent: true, coinsSpent: cost, reason: '' };
}

const resetStore = (coins) => {
  store.reset();
  store.state.coins = coins;
  store.state.powerups = { hint: 5, freeze: 5, shuffle: 5 };
};

group('every power-up has a per-use coin fee');
for (const key of ['hint', 'freeze', 'shuffle']) {
  ok(typeof POWERUP_META[key].useCost === 'number' && POWERUP_META[key].useCost > 0,
    `${key} charges ${POWERUP_META[key].useCost} coins per use`);
}

group('a successful use spends one unit and the coin fee');
for (const key of ['hint', 'freeze', 'shuffle']) {
  resetStore(1000);
  const g = freshGame();
  const unitsBefore = store.powerupCount(key);
  const coinsBefore = coinBank.total;
  const cost = POWERUP_META[key].useCost;

  const r = tryUse(key, g);
  ok(r.fired, `${key}: fire accepted`);
  ok(r.unitSpent, `${key}: a stocked unit is consumed`);
  ok(r.coinsSpent === cost, `${key}: ${cost} coins charged (spent ${r.coinsSpent})`);
  ok(store.powerupCount(key) === unitsBefore - 1, `${key}: stock dropped by one`);
  ok(coinBank.total === coinsBefore - cost, `${key}: balance dropped by exactly the fee`);
}

group('refused when the balance is too low (unit still in stock)');
{
  resetStore(POWERUP_META.hint.useCost - 1);   // one coin short of a hint
  const g = freshGame();
  const before = coinBank.total;
  const r = tryUse('hint', g);
  ok(!r.fired && r.reason === 'nofunds', 'hint refused for lack of coins, not stock');
  ok(store.powerupCount('hint') === 5, 'the unit is NOT burned when coins are short');
  ok(coinBank.total === before, 'and no coins are spent');
  ok(g.board.cards.every((c) => !c.isFlipped), 'the board is untouched');
}

group('refused when no unit is stocked (coins still available)');
{
  resetStore(1000);
  store.state.powerups.hint = 0;
  const g = freshGame();
  const before = coinBank.total;
  const r = tryUse('hint', g);
  ok(!r.fired && r.reason === 'nostock', 'hint refused for lack of stock');
  ok(store.powerupCount('hint') === 0, 'stock stays at zero');
  ok(coinBank.total === before, 'no coins spent with nothing stocked');
}

group('engine refusal burns neither unit nor coins');
{
  resetStore(1000);
  const g = freshGame();
  // Lock the board with an unresolved mismatch — hint is refused mid-resolution.
  const a = g.board.cards.find((c) => c.pairId === 0);
  const b = g.board.cards.find((c) => c.pairId === 1);
  g.flipCard(a.id);
  g.flipCard(b.id);
  ok(g.locked === true, 'board locks on a mismatch');

  const before = coinBank.total;
  const r = tryUse('hint', g);
  ok(!r.fired && r.reason === 'engine-refused', 'hint refused because the engine locked the board');
  ok(store.powerupCount('hint') === 5, 'the unit is preserved on an engine refusal');
  ok(coinBank.total === before, 'and the coin fee is preserved too');
}

group('the last coin can finish a streak of uses');
{
  resetStore(POWERUP_META.shuffle.useCost * 2);
  const g = freshGame();
  const r1 = tryUse('shuffle', g);
  const r2 = tryUse('shuffle', g);
  ok(r1.fired && r2.fired, 'two shuffles fire back-to-back');
  ok(coinBank.total === 0, 'the balance is drained to exactly zero after two fees');
  // A third shuffle is now blocked by coins, though a unit is still stocked.
  const r3 = tryUse('shuffle', g);
  ok(!r3.fired && r3.reason === 'nofunds', 'a third use is blocked by coins, not stock');
  ok(store.powerupCount('shuffle') === 3, 'the remaining unit is untouched');
}

group('freeze coin charge does not affect the freeze itself');
{
  resetStore(1000);
  const g = freshGame();
  g.flipCard(g.board.cards[0].id);            // start the clock
  await wait(1150);
  const timeBefore = g.timeLeft;
  const r = tryUse('freeze', g);
  ok(r.fired, 'freeze fires');
  await wait(1100);
  ok(g.isFrozen === true, 'freeze is active regardless of the coin charge');
  ok(g.timeLeft === timeBefore, 'the clock holds while frozen');
  ok(coinBank.total === 1000 - POWERUP_META.freeze.useCost, 'the fee was still deducted');
}

managers.forEach((g) => g.destroy());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
