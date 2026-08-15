/**
 * levels.js — 70 level definitions plus progression maths.
 *
 * Grid tiers (rows × cols):
 *    1–3   2×2  →  2 pairs
 *    4–6   2×3  →  3 pairs
 *    7–10  4×3  →  6 pairs
 *   11–15  4×4  →  8 pairs
 *   16–18  4×5  → 10 pairs
 *   19–20  6×5  → 15 pairs
 *   21–32  4×8  → 16 pairs
 *   33–44  6×6  → 18 pairs
 *   45–56  5×8  → 20 pairs
 *   57–70  6×8  → 24 pairs
 *
 * The ladder past level 20 keeps climbing rather than revisiting a smaller
 * board: every new tier holds more pairs than the 15 of levels 19–20.
 *
 * `time` tightens with every level inside a tier, then resets upward when
 * the grid grows — a 24-pair board cannot be cleared in a 2-pair board's
 * clock, so the squeeze is per tier rather than strictly monotonic. Every
 * level still allows at least 5 seconds per pair.
 *
 * `requiredCoins` is a balance gate, not a purchase: you need that many
 * coins in your pocket to enter, and they are not spent.
 */

import { randomThemeId, THEME_IDS } from '../data/themes.js';

/** A tier's descending clock: `count` budgets from `from`, −`step` each level. */
function ramp(from, count, step = 6) {
  return Array.from({ length: count }, (_, i) => from - i * step);
}

/**
 * Balance gates for the levels added past the original 20: a gentle climb of
 * 60 coins per level, 1100 at level 21 up to 4040 at level 70. A single clear
 * on these large boards pays several times the 60-coin step, so the curve
 * never turns into a grind.
 */
function gates(startId, count) {
  return Array.from({ length: count }, (_, i) => 1100 + 60 * (startId - 21 + i));
}

const TIERS = [
  //          rows cols  per-level time budget            coin gate
  { levels: [1, 3],   rows: 2, cols: 2, times: [30, 25, 20],             coins: [0, 0, 0] },
  { levels: [4, 6],   rows: 2, cols: 3, times: [42, 36, 30],             coins: [0, 0, 25] },
  { levels: [7, 10],  rows: 4, cols: 3, times: [78, 70, 63, 56],         coins: [50, 75, 100, 150] },
  { levels: [11, 15], rows: 4, cols: 4, times: [104, 96, 89, 82, 74],    coins: [200, 250, 300, 350, 400] },
  { levels: [16, 18], rows: 4, cols: 5, times: [124, 112, 100],          coins: [500, 600, 700] },
  { levels: [19, 20], rows: 6, cols: 5, times: [175, 158],               coins: [850, 1000] },

  // The 50 levels added past the original 20. Each tier holds more pairs than
  // the 15 of levels 19–20, so the ladder only ever climbs.
  { levels: [21, 32], rows: 4, cols: 8, times: ramp(150, 12),            coins: gates(21, 12) },
  { levels: [33, 44], rows: 6, cols: 6, times: ramp(168, 12),            coins: gates(33, 12) },
  { levels: [45, 56], rows: 5, cols: 8, times: ramp(190, 12),            coins: gates(45, 12) },
  { levels: [57, 70], rows: 6, cols: 8, times: ramp(230, 14),            coins: gates(57, 14) },
];

function difficultyFor(id) {
  if (id <= 6)  return 'easy';
  if (id <= 12) return 'medium';
  if (id <= 18) return 'hard';
  if (id <= 44) return 'expert';
  return 'master';
}

/**
 * Default (preferred) theme per level — the random picker overrides it in Auto
 * mode, so this is the set you get with a specific theme *un*equipped and Auto
 * off. One entry per level, deliberately spelled out rather than derived: the
 * rotation leans on the readable sets early and the lookalike ones (shapes,
 * flags, tech) late, which no modulo expression would express.
 */
const THEME_ROTATION = [
  // 1–20 — the original ladder, unchanged.
  'fruits', 'animals', 'space', 'food', 'sports', 'tech', 'transport', 'nature',
  'weather', 'music', 'fruits', 'animals', 'shapes', 'space', 'food',
  'flags', 'tech', 'shapes', 'flags', 'shapes',
  // 21–30
  'tech', 'animals', 'shapes', 'weather', 'food', 'flags', 'music', 'space', 'nature', 'transport',
  // 31–40
  'shapes', 'fruits', 'flags', 'tech', 'weather', 'sports', 'music', 'nature', 'shapes', 'transport',
  // 41–50
  'flags', 'tech', 'nature', 'music', 'shapes', 'weather', 'transport', 'flags', 'tech', 'music',
  // 51–60
  'shapes', 'nature', 'weather', 'flags', 'transport', 'tech', 'music', 'shapes', 'flags', 'weather',
  // 61–70
  'tech', 'nature', 'shapes', 'music', 'flags', 'transport', 'weather', 'shapes', 'tech', 'flags',
];

export const LEVELS = TIERS.flatMap((tier) => {
  const [start, end] = tier.levels;
  const out = [];
  for (let id = start; id <= end; id++) {
    const i = id - start;
    const pairs = (tier.rows * tier.cols) / 2;
    out.push({
      id,
      rows: tier.rows,
      cols: tier.cols,
      pairs,
      timeLimit: tier.times[i],
      requiredCoins: tier.coins[i],
      theme: THEME_ROTATION[id - 1] || THEME_IDS[(id - 1) % THEME_IDS.length],
      difficulty: difficultyFor(id),
      label: `${tier.rows} × ${tier.cols}`,
    });
  }
  return out;
});

export const TOTAL_LEVELS = LEVELS.length;

/**
 * id → level. Level select builds 70 tiles and asks storage.canPlay() for each,
 * so a linear scan per lookup turned the grid render quadratic. A Map keeps it
 * flat.
 */
const BY_ID = new Map(LEVELS.map((l) => [l.id, l]));

export function getLevel(id) {
  return BY_ID.get(Number(id)) || LEVELS[0];
}

export function hasNextLevel(id) {
  return Number(id) < TOTAL_LEVELS;
}

/** Resolve which emoji set a round should use. */
export function themeForLevel(level, preference = 'auto') {
  if (preference && preference !== 'auto') return preference;
  return randomThemeId(level.difficulty);
}

/**
 * The three stars, each an independent test:
 *
 *   ★1  cleared the level at all
 *   ★2  finished in under half the time limit
 *   ★3  finished in fewer than 2 × pairs moves
 *
 * Stars 2 and 3 are independent, so a fast-but-sloppy clear and a
 * slow-but-efficient one both score 2. Every criterion is reported so the
 * win screen can show exactly which one was missed.
 *
 * @param {{pairs:number, moves:number, timeLeft:number, timeLimit:number}} run
 * @returns {{total:number, criteria:Array<{key:string,label:string,met:boolean,detail:string}>}}
 */
export function starCriteria({ pairs, moves, timeLeft, timeLimit }) {
  const timeUsed  = Math.max(0, timeLimit - timeLeft);
  const halfClock = timeLimit / 2;
  const moveCap   = pairs * 2;

  const criteria = [
    {
      key: 'clear',
      label: 'Level cleared',
      met: true,
      detail: `all ${pairs} pairs matched`,
    },
    {
      key: 'time',
      label: `Finished under ${formatClock(halfClock)}`,
      met: timeLimit > 0 && timeUsed < halfClock,
      detail: `took ${formatClock(timeUsed)} of ${formatClock(timeLimit)}`,
    },
    {
      key: 'moves',
      label: `Fewer than ${moveCap} moves`,
      met: moves < moveCap,
      detail: `used ${moves} move${moves === 1 ? '' : 's'}`,
    },
  ];

  return { total: criteria.filter((c) => c.met).length, criteria };
}

/** Star count only (1–3). See starCriteria for the per-star detail. */
export function calculateStars(run) {
  return starCriteria(run).total;
}

/** m:ss — kept local so levels.js stays free of UI imports. */
function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
