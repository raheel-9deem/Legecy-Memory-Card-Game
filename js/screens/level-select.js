/**
 * level-select.js — Grid of levels with lock state and star ratings.
 */

import { store } from '../core/storage.js';
import { LEVELS, TOTAL_LEVELS } from '../core/levels.js';
import { getTheme } from '../data/themes.js';
import { header, formatTime } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast } from '../ui/toast.js';

let cleanup = [];

export default {
  title: 'Select Level',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render() {
    const unlocked = store.state.unlockedLevel;

    const cards = LEVELS.map((level, i) => {
      const rec = store.getLevelRecord(level.id);
      const gate = store.canPlay(level.id);
      const locked = level.id > unlocked;
      const tooPoor = !locked && gate.reason === 'coins';
      const isCurrent = level.id === unlocked && !rec.cleared;

      const classes = ['level-card'];
      if (locked) classes.push('locked');
      if (tooPoor) classes.push('gated');
      if (rec.cleared) classes.push('completed');
      if (isCurrent) classes.push('current');

      const stars = [1, 2, 3]
        .map((n) => `<span class="star ${rec.stars >= n ? 'earned' : ''}">★</span>`)
        .join('');

      const footer = tooPoor
        ? `<span class="level-gate">🪙 ${level.requiredCoins}</span>`
        : `<span class="level-stars">${stars}</span>`;

      return `
        <button class="${classes.join(' ')}"
                data-level="${level.id}"
                ${locked || tooPoor ? 'aria-disabled="true"' : ''}
                style="animation-delay:${Math.min(i * 35, 420)}ms"
                title="${getTheme(level.theme).name} · ${formatTime(level.timeLimit)}"
                aria-label="Level ${level.id}${locked ? ' (locked)' : ''}${tooPoor ? ` (needs ${level.requiredCoins} coins)` : ''}">
          <span class="difficulty-tag ${level.difficulty}">${level.difficulty}</span>
          ${locked
            ? '<span class="level-lock">🔒</span>'
            : `<span class="level-num">${level.id}</span>`}
          <span class="level-size">${level.label} · ${formatTime(level.timeLimit)}</span>
          ${footer}
        </button>
      `;
    }).join('');

    return `
      <div class="screen-head">
        <h2 class="text-grad">Select Level</h2>
        <p>${store.clearedCount} of ${TOTAL_LEVELS} cleared · ⭐ ${store.totalStars} stars earned</p>
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
  },

  unmount() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  },
};
