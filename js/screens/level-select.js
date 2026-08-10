/**
 * level-select.js — Scrollable grid of all 20 levels.
 *
 * Every card carries the level number, the coin balance it gates on, the
 * player's best clear time and the stars earned. Level 1 is open from a fresh
 * save; the rest unlock as the previous one is cleared (see storage.recordWin).
 */

import { store } from '../core/storage.js';
import { LEVELS, TOTAL_LEVELS } from '../core/levels.js';
import { getTheme } from '../data/themes.js';
import { header, formatTime } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast } from '../ui/toast.js';

let cleanup = [];

/** One level tile. */
function renderCard(level, index) {
  const rec = store.getLevelRecord(level.id);
  const gate = store.canPlay(level.id);
  const locked = !store.isUnlocked(level.id);
  const tooPoor = !locked && gate.reason === 'coins';
  const isCurrent = level.id === store.state.unlockedLevel && !rec.cleared;

  const classes = ['level-card'];
  if (locked) classes.push('locked');
  if (tooPoor) classes.push('gated');
  if (rec.cleared) classes.push('completed');
  if (isCurrent) classes.push('current');

  const stars = [1, 2, 3]
    .map((n) => `<span class="star ${rec.stars >= n ? 'earned' : ''}">★</span>`)
    .join('');

  // The gate is a balance you must hold, not a fee — show it whenever the
  // level asks for one, tinted red only when the player is short.
  const req = level.requiredCoins
    ? `<span class="level-req ${tooPoor ? 'unmet' : ''}">🪙 ${level.requiredCoins}</span>`
    : '';

  const best = rec.bestTime != null
    ? `<span class="level-best">⏱ ${formatTime(rec.bestTime)}</span>`
    : '<span class="level-best empty">⏱ —:—</span>';

  const label = [
    `Level ${level.id}`,
    locked ? 'locked' : null,
    tooPoor ? `needs a balance of ${level.requiredCoins} coins` : null,
    rec.cleared ? `${rec.stars} of 3 stars, best time ${formatTime(rec.bestTime)}` : 'not cleared yet',
  ].filter(Boolean).join(', ');

  return `
    <button class="${classes.join(' ')}"
            data-level="${level.id}"
            ${locked || tooPoor ? 'aria-disabled="true"' : ''}
            style="animation-delay:${Math.min(index * 35, 420)}ms"
            title="${getTheme(level.theme).name} · ${formatTime(level.timeLimit)}"
            aria-label="${label}">
      <span class="difficulty-tag ${level.difficulty}">${level.difficulty}</span>
      ${req}
      ${locked
        ? '<span class="level-lock">🔒</span>'
        : `<span class="level-num">${level.id}</span>`}
      <span class="level-size">${level.label} · ${formatTime(level.timeLimit)}</span>
      ${best}
      <span class="level-stars">${stars}</span>
    </button>
  `;
}

export default {
  title: 'Select Level',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render() {
    const cards = LEVELS.map(renderCard).join('');

    return `
      <div class="screen-head">
        <h2 class="text-grad">Select Level</h2>
        <p>${store.clearedCount} of ${TOTAL_LEVELS} cleared · ⭐ ${store.totalStars} of ${TOTAL_LEVELS * 3} stars earned</p>
      </div>
      <div class="scroll-y" style="flex:1;min-height:0">
        <div class="level-grid">${cards}</div>
      </div>
    `;
  },

  mount(el, params, router) {
    header.setLevel(store.state.unlockedLevel);

    const onClick = (e) => {
      const card = e.target.closest('[data-level]');
      if (!card) return;

      const levelId = Number(card.dataset.level);
      const gate = store.canPlay(levelId);
      if (!gate.ok) {
        audio.play('error');
        toast(
          gate.reason === 'locked'
            ? 'Clear the previous level to unlock this one'
            : `Level ${levelId} needs a balance of 🪙 ${gate.requiredCoins} to enter`,
          'error'
        );
        return;
      }
      audio.play('click');
      router.navigate('game', { levelId });
    };

    el.addEventListener('click', onClick);
    cleanup.push(() => el.removeEventListener('click', onClick));

    // Bring the level the player is up to into view on a long grid.
    const current = el.querySelector('.level-card.current') || el.querySelector('.level-card.locked');
    if (current) current.scrollIntoView({ block: 'nearest' });
  },

  unmount() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  },
};
