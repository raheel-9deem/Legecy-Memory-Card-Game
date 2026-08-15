/**
 * Regression suite for the "all cards reveal after a match" bug.
 *
 * The bug: PAIR_MATCH / PAIR_MISMATCH / CARD_UNFLIP payloads were built as
 * `{ cards: [first, second], ...this.snapshot() }`. snapshot() also carries a
 * `cards` key holding the ENTIRE board, so the spread overwrote the two-card
 * array — every consumer of e.detail.cards then acted on every card.
 * The visible symptom: matching a pair flipped the whole board face up.
 *
 * Fix: spread snapshot() FIRST, then set the event-specific keys, so the
 * narrow payload always wins. This suite pins that contract for every
 * pair-resolution event on a full 8-pair board.
 *
 *   node tools/_build-win.mjs
 *   node tools/_reveal-payload-test.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', 'scratch-mmc');
const mod = (p) => import(new URL(`file:///${ROOT.replace(/^\/+/, '')}/${p}`).href);

globalThis.window = { innerWidth: 1280, innerHeight: 800 };
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { GameManager } = await mod('core/game.mjs');
const { EVENTS } = await mod('core/events.mjs');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { failures.push(msg); console.log('  FAIL ' + msg); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const managers = [];
const freshGame = () => {
  const g = new GameManager();
  g.init({ levelId: 11, powerups: { hint: 5, freeze: 5, shuffle: 5 } });
  g.startGame();
  managers.push(g);
  return g;
};

group('PAIR_MATCH cards array contains exactly the matched pair');
{
  const g = freshGame();
  const seen = [];
  g.on(EVENTS.PAIR_MATCH, (e) => seen.push(e.detail.cards));
  const [a] = g.board.cards.filter((c) => c.pairId === 0);
  const b = g.board.cards.find((c) => c.pairId === 0 && c.id !== a.id);
  g.flipCard(a.id);
  g.flipCard(b.id);
  await wait(750);

  ok(seen.length === 1, 'exactly one pair:match fired');
  ok(Array.isArray(seen[0]), 'the payload cards is an array');
  ok(seen[0].length === 2, `cards array has 2 entries, not the whole board (got ${seen[0].length})`);
  ok(new Set(seen[0].map((c) => c.id)).size === 2, 'the two ids are distinct');
  ok(seen[0].every((c) => c.id === a.id || c.id === b.id), 'only the matched pair is in the payload');
  ok(seen[0].every((c) => c.isMatched), 'both payload cards report matched=true');
}

group('PAIR_MISMATCH cards array contains exactly the mismatched pair');
{
  const g = freshGame();
  const seen = [];
  g.on(EVENTS.PAIR_MISMATCH, (e) => seen.push(e.detail.cards));
  const a = g.board.cards.find((c) => c.pairId === 0);
  const b = g.board.cards.find((c) => c.pairId === 1);
  g.flipCard(a.id);
  g.flipCard(b.id);
  await wait(750);

  ok(seen.length === 1, 'exactly one pair:mismatch fired');
  ok(seen[0].length === 2, `cards array has 2 entries, not the whole board (got ${seen[0].length})`);
  ok(new Set(seen[0].map((c) => c.id)).size === 2, 'the two ids are distinct');
  ok(seen[0].every((c) => c.id === a.id || c.id === b.id), 'only the mismatched pair is in the payload');
}

group('CARD_UNFLIP cards array contains exactly the unflipped pair');
{
  const g = freshGame();
  const seen = [];
  g.on(EVENTS.CARD_UNFLIP, (e) => seen.push(e.detail.cards));
  const a = g.board.cards.find((c) => c.pairId === 0);
  const b = g.board.cards.find((c) => c.pairId === 1);
  g.flipCard(a.id);
  g.flipCard(b.id);
  await wait(1500);

  ok(seen.length === 1, 'exactly one card:unflip fired');
  ok(seen[0].length === 2, `cards array has 2 entries, not the whole board (got ${seen[0].length})`);
  ok(new Set(seen[0].map((c) => c.id)).size === 2, 'the two ids are distinct');
}

group('a full clear never emits a multi-card PAIR_MATCH (whole-board regression)');
{
  const g = freshGame();
  const totalPairs = g.board.pairsTotal;
  const seen = [];
  g.on(EVENTS.PAIR_MATCH, (e) => seen.push(e.detail.cards));
  const byPair = {};
  g.board.cards.forEach((c) => (byPair[c.pairId] ??= []).push(c));
  for (const pid of Object.keys(byPair)) {
    const [x, y] = byPair[pid];
    g.flipCard(x.id);
    g.flipCard(y.id);
    await wait(750);
  }
  ok(seen.length === totalPairs, `one pair:match per pair (got ${seen.length}/${totalPairs})`);
  ok(seen.every((arr) => arr.length === 2), 'EVERY match payload carries exactly 2 cards — never the whole board');
}

group('a pairwise mismatch never emits a multi-card payload across many mismatches');
{
  const g = freshGame();
  const seen = [];
  g.on(EVENTS.PAIR_MISMATCH, (e) => seen.push(e.detail.cards));
  // Flip every card against a non-partner deliberately.
  const cards = g.board.cards;
  for (let i = 0; i < cards.length - 1; i += 2) {
    g.flipCard(cards[i].id);
    g.flipCard(cards[i + 1].id);
    await wait(1500); // let the 1s hold + unflip expire before the next pair
  }
  ok(seen.every((arr) => arr.length === 2), 'EVERY mismatch payload carries exactly 2 cards');
}

function group(name) { console.log('\n== ' + name + ' =='); }

managers.forEach((g) => g.destroy());
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
