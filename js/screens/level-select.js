/**
 * level-select.js — Scrollable grid of all 100 levels, grouped by difficulty.
 *
 * The ladder is walked in order: level 1 is open on a fresh save, and clearing a
 * level opens the next one. A locked tile is still drawn — the number, the board
 * size and the difficulty band are the whole point of looking ahead — but it
 * carries a padlock, is marked `aria-disabled`, and answers a click with the
 * level that has to be cleared first rather than going silently dead.
 *
 * Cleared tiles stay open forever, so any earlier level can be replayed for a
 * better time or the star that was missed.
 *
 * The tiles are banded rather than poured into one 100-cell grid: at that length
 * an unbroken run of numbers gives the player nothing to navigate by, and the
 * jump in board size between bands is the most useful landmark there is.
 */

import { store } from '../core/storage.js';
import { LEVELS, TOTAL_LEVELS } from '../core/levels.js';
import { getTheme } from '../data/themes.js';
import { header, formatTime } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast } from '../ui/toast.js';

/** Human label per difficulty band. Keys match level.difficulty exactly. */
const BAND_META = {
  easy:        { label: 'Warm-up',     blurb: 'Small boards, generous clocks' },
  medium:      { label: 'Steady',      blurb: 'More pairs, less slack' },
  hard:        { label: 'Sharp',       blurb: 'The clock starts to bite' },
  expert:      { label: 'Expert',      blurb: 'Big boards and lookalike symbol sets' },
  master:      { label: 'Master',      blurb: '40+ cards — the deep end' },
  grandmaster: { label: 'Grandmaster', blurb: '64 cards, 32 pairs — the summit' },
};

let cleanup = [];

/**
 * One level tile: cleared, current, or locked behind the level below it.
 * The lock line names that level, so the tile explains itself before it is
 * even clicked.
 */
function renderCard(level, index) {
  const rec = store.getLevelRecord(level.id);
  const entry = store.canPlay(level.id);
  const locked = !entry.ok;
  const isCurrent = level.id === store.state.unlockedLevel && !rec.cleared;

  const classes = ['level-card'];
  if (rec.cleared) classes.push('completed');
  if (isCurrent) classes.push('current');
  if (locked) classes.push('locked');

  const stars = [1, 2, 3]
    .map((n) => `<span class="star ${rec.stars >= n ? 'earned' : ''}">★</span>`)
    .join('');

  const best = rec.bestTime != null
    ? `<span class="level-best">⏱ ${formatTime(rec.bestTime)}</span>`
    : '<span class="level-best empty">⏱ —:—</span>';

  const footer = locked
    ? `<span class="level-lock">🔒 Clear ${entry.requiredLevel}</span>`
    : best;

  const label = [
    `Level ${level.id}`,
    `${level.pairs} pairs`,
    locked
      ? `locked — clear level ${entry.requiredLevel} to unlock`
      : rec.cleared
        ? `${rec.stars} of 3 stars, best time ${formatTime(rec.bestTime)}`
        : 'unlocked, not cleared yet',
  ].join(', ');

  return `
    <button class="${classes.join(' ')}"
            data-level="${level.id}"
            ${locked ? 'aria-disabled="true"' : ''}
            style="animation-delay:${Math.min(index * 35, 420)}ms"
            title="${locked ? `Locked — clear level ${entry.requiredLevel} first` : `${getTheme(level.theme).name} · ${formatTime(level.timeLimit)}`}"
            aria-label="${label}">
      <span class="difficulty-tag ${level.difficulty}">${level.difficulty}</span>
      <span class="level-num">${locked ? '🔒' : level.id}</span>
      <span class="level-size">${level.label} · ${formatTime(level.timeLimit)}</span>
      ${footer}
      <span class="level-stars">${stars}</span>
    </button>
  `;
}

/**
 * Levels in id order, split into consecutive runs of the same difficulty.
 *
 * Derived from the level table rather than hard-coded ranges, so re-tiering a
 * level in core/levels.js moves it between bands here with no edit.
 */
function bands() {
  const out = [];
  for (const level of LEVELS) {
    const last = out[out.length - 1];
    if (last && last.difficulty === level.difficulty) last.levels.push(level);
    else out.push({ difficulty: level.difficulty, levels: [level] });
  }
  return out;
}

export default {
  title: 'Select Level',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render() {
    // One running index across all bands so the stagger reads as a single
    // cascade down the page instead of restarting at every heading.
    let index = 0;

    const sections = bands().map((band) => {
      const meta = BAND_META[band.difficulty] || { label: band.difficulty, blurb: '' };
      const first = band.levels[0].id;
      const last = band.levels[band.levels.length - 1].id;
      const cleared = band.levels.filter((l) => store.getLevelRecord(l.id).cleared).length;
      const cards = band.levels.map((level) => renderCard(level, index++)).join('');

      return `
        <section class="level-band" data-difficulty="${band.difficulty}">
          <div class="level-band-head">
            <h3>${meta.label}</h3>
            <span class="level-band-range">Levels ${first}–${last}</span>
            <span class="level-band-blurb">${meta.blurb}</span>
            <span class="level-band-count">${cleared}/${band.levels.length}</span>
          </div>
          <div class="level-grid">${cards}</div>
        </section>
      `;
    }).join('');

    return `
      <div class="screen-head">
        <h2 class="text-grad">Select Level</h2>
        <p>${store.clearedCount} of ${TOTAL_LEVELS} cleared · ⭐ ${store.totalStars} of ${TOTAL_LEVELS * 3} stars earned</p>
      </div>
      <div class="scroll-y" style="flex:1;min-height:0">${sections}</div>
    `;
  },

  mount(el, params, router) {
    header.setLevel(store.state.unlockedLevel);

    const onClick = (e) => {
      const card = e.target.closest('[data-level]');
      if (!card) return;

      audio.play('click');
      router.navigate('game', { levelId: Number(card.dataset.level) });
    };

    el.addEventListener('click', onClick);
    cleanup.push(() => el.removeEventListener('click', onClick));

    // Bring the level the player is up to into view. scrollIntoView() walks
    // every scrollable ancestor, which on a 70-tile grid also scrolled the page
    // itself and dragged the sticky header out of place — so drive the one
    // container directly and centre the tile in it.
    const target = el.querySelector('.level-card.current');
    const scroller = el.querySelector('.scroll-y');
    if (target && scroller) {
      const t = target.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const delta = (t.top - s.top) - (s.height - t.height) / 2;
      scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
    }
  },

  unmount() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  },
};
