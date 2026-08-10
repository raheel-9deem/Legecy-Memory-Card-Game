/**
 * levels.js — 20 level definitions plus progression maths.
 *
 * Grid tiers (rows × cols):
 *    1–3   2×2  →  2 pairs
 *    4–6   2×3  →  3 pairs
 *    7–10  4×3  →  6 pairs
 *   11–15  4×4  →  8 pairs
 *   16–18  4×5  → 10 pairs
 *   19–20  6×5  → 15 pairs
 *
 * `time` tightens with every level inside a tier, then resets upward when
 * the grid grows — a 15-pair board cannot be cleared in a 2-pair board's
 * clock, so the squeeze is per tier rather than strictly monotonic.
 *
 * `requiredCoins` is a balance gate, not a purchase: you need that many
 * coins in your pocket to enter, and they are not spent.
 */

import { randomThemeId } from '../data/themes.js';

const TIERS = [
  //          rows cols  per-level time budget            coin gate
  { levels: [1, 3],   rows: 2, cols: 2, times: [30, 25, 20],             coins: [0, 0, 0] },
  { levels: [4, 6],   rows: 2, cols: 3, times: [42, 36, 30],             coins: [0, 0, 25] },
  { levels: [7, 10],  rows: 4, cols: 3, times: [78, 70, 63, 56],         coins: [50, 75, 100, 150] },
  { levels: [11, 15], rows: 4, cols: 4, times: [104, 96, 89, 82, 74],    coins: [200, 250, 300, 350, 400] },
  { levels: [16, 18], rows: 4, cols: 5, times: [124, 112, 100],          coins: [500, 600, 700] },
  { levels: [19, 20], rows: 6, cols: 5, times: [175, 158],               coins: [850, 1000] },
];

function difficultyFor(id) {
  if (id <= 6)  return 'easy';
  if (id <= 12) return 'medium';
  if (id <= 18) return 'hard';
  return 'expert';
}

/** Default (preferred) theme per level — the random picker overrides it in Auto mode. */
const THEME_ROTATION = [
  'fruits', 'animals', 'space', 'food', 'sports', 'tech', 'transport', 'nature',
  'weather', 'music', 'fruits', 'animals', 'shapes', 'space', 'food',
  'flags', 'tech', 'shapes', 'flags', 'shapes',
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
      theme: THEME_ROTATION[id - 1] || 'fruits',
      difficulty: difficultyFor(id),
      reward: 20 + pairs * 8 + id * 4,
      label: `${tier.rows} × ${tier.cols}`,
    });
  }
  return out;
});

export const TOTAL_LEVELS = LEVELS.length;

export function getLevel(id) {
  return LEVELS.find((l) => l.id === Number(id)) || LEVELS[0];
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
 * Star rating: move efficiency first, time remaining second.
 * 3 stars = near-perfect recall, 1 star = cleared it at all.
 */
export function calculateStars({ pairs, moves, timeLeft, timeLimit }) {
  const moveRatio = moves / pairs;                        // 1.0 == flawless
  const timeRatio = timeLimit > 0 ? timeLeft / timeLimit : 1;

  if (moveRatio <= 1.45 && timeRatio >= 0.4) return 3;
  if (moveRatio <= 2.2  && timeRatio >= 0.15) return 2;
  return 1;
}

/** Coins awarded for clearing a level. */
export function calculateReward({ level, stars, timeLeft, combo = 0 }) {
  const base       = level.reward;
  const starBonus  = (stars - 1) * Math.round(level.reward * 0.35);
  const timeBonus  = Math.round(timeLeft * 0.6);
  const comboBonus = combo * 5;
  return Math.max(0, base + starBonus + timeBonus + comboBonus);
}
