/**
 * Regression suite for the hint power-up.
 *
 * Guards the fix for: pressing Reveal while holding one card opened every
 * face-down card on the board instead of just its partner.
 *
 *   node tools/_build-check.mjs ./js /tmp/mmc
 *   node tools/_hint-test.mjs /tmp/mmc
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

const { GameManager } = await mod('core/game.mjs');
const { EVENTS } = await mod('core/events.mjs');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
};
const group = (name) => console.log('\n== ' + name + ' ==');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const managers = [];
const fresh = (levelId = 19) => {
  const g = new GameManager();
  g.init({ levelId, powerups: { hint: 5 } });
  g.startGame();
  managers.push(g);
  return g;
};

/* Level 19 is 6×5 — 15 pairs, 30 cards. A regression that reveals the whole
   board is unmistakable against a target of 1 or 2. */

group('hint while holding one card');
{
  const g = fresh();
  let shown = null;
  g.on(EVENTS.HINT_SHOW, (e) => { shown = e.detail.cards; });

  const first = g.board.cards[0];
  g.flipCard(first.id);

  ok(g.usePowerup('hint') === true, 'hint fires');
  ok(shown && shown.length === 1, `reveals exactly 1 card, got ${shown ? shown.length : 'none'} of 30`);
  ok(shown && shown[0].pairId === first.pairId, 'the revealed card is the partner');
  ok(shown && shown[0].id !== first.id, 'partner is not the card already in hand');
}

group('hint with an untouched board');
{
  const g = fresh();
  let shown = null;
  g.on(EVENTS.HINT_SHOW, (e) => { shown = e.detail.cards; });

  ok(g.usePowerup('hint') === true, 'hint fires');
  ok(shown && shown.length === 2, `reveals exactly 2 cards, got ${shown ? shown.length : 'none'} of 30`);
  ok(shown && shown[0].pairId === shown[1].pairId, 'the two revealed cards are a genuine pair');
}

group('hint is visual only');
{
  const g = fresh();
  g.usePowerup('hint');
  ok(g.board.cards.every((c) => !c.isFlipped), 'no engine card is flipped by a hint');
  ok(g.board.flippedCards.length === 0, 'flippedCards stays empty, so the next real flip is still "first"');
}

group('hint refused mid-resolution');
{
  const g = fresh();
  const a = g.board.cards.find((c) => c.pairId === 0);
  const b = g.board.cards.find((c) => c.pairId === 1);
  g.flipCard(a.id);
  g.flipCard(b.id);                       // mismatch → board locks

  ok(g.locked === true, 'board locks after a mismatch');
  ok(g.usePowerup('hint') === false, 'hint refused while locked, so the power-up is not burned');
}

group('hint on the final pair');
{
  const g = fresh(1);                     // 2×2 → 2 pairs
  let shown = null;
  g.on(EVENTS.HINT_SHOW, (e) => { shown = e.detail.cards; });

  const pair = g.board.cards.filter((c) => c.pairId === 0);
  g.flipCard(pair[0].id);
  g.flipCard(pair[1].id);                 // match
  await wait(450);                        // let MATCH_DELAY clear the lock

  ok(g.usePowerup('hint') === true, 'hint fires with one pair left');
  ok(shown && shown.length === 2, 'shows 2 cards');
  ok(shown && shown.every((c) => !c.isMatched), 'already-matched cards are never re-revealed');
}

group('hint when nothing is left to reveal');
{
  const g = fresh(1);
  g.board.cards.forEach((c) => c.setMatched());
  ok(g.usePowerup('hint') === false, 'hint refused on a fully matched board');
}

managers.forEach((g) => g.destroy());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
