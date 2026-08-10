/**
 * win.js — End-of-round screen (victory and defeat share this layout).
 */

import { getLevel, hasNextLevel, TOTAL_LEVELS } from '../core/levels.js';
import { header, formatTime } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { confetti } from '../ui/effects.js';

let unsubs = [];

export default {
  title: 'Results',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render(params = {}) {
    const won = !!params.won;
    const levelId = Number(params.levelId) || 1;
    const level = getLevel(levelId);
    const stars = Number(params.stars) || 0;
    const moves = Number(params.moves) || 0;
    const coins = Number(params.coins) || 0;
    const timeUsed = Number(params.timeUsed) || 0;
    const matched = Number(params.matched) || 0;
    const total = Number(params.total) || level.pairs;

    const starRow = [1, 2, 3]
      .map((n) => `<span class="star ${stars >= n ? 'earned' : ''}">★</span>`)
      .join('');

    const subtitle = won
      ? stars === 3
        ? 'Flawless memory. Three stars!'
        : `Level ${levelId} cleared — try for ${3 - stars} more star${3 - stars > 1 ? 's' : ''}.`
      : `The clock beat you with ${total - matched} pair${total - matched === 1 ? '' : 's'} still hidden.`;

    const nextUnlocked = won && hasNextLevel(levelId);
    const allDone = won && !hasNextLevel(levelId);

    return `
      <div class="glass-card result-card">
        <h2 class="result-title ${won ? '' : 'lose'}">${won ? 'Level Clear' : 'Game Over'}</h2>
        <p class="result-sub">${subtitle}</p>

        ${won ? `<div class="result-stars">${starRow}</div>` : '<div class="result-timeout">⏳</div>'}

        <div class="result-stats">
          <div class="result-stat">
            <span class="result-stat-value">${moves}</span>
            <span class="result-stat-label">Moves</span>
          </div>
          <div class="result-stat">
            <span class="result-stat-value">${formatTime(timeUsed)}</span>
            <span class="result-stat-label">Time</span>
          </div>
          <div class="result-stat">
            <span class="result-stat-value">${matched}/${total}</span>
            <span class="result-stat-label">Pairs</span>
          </div>
        </div>

        ${won ? `<div class="coin-reward"><span>🪙</span><span>+${coins} coins</span></div>` : ''}
        ${params.isNewStarRecord ? '<p class="result-sub" style="color:var(--gold)">★ New personal best!</p>' : ''}
        ${allDone ? '<p class="result-sub" style="color:var(--cyan)">🏆 Every level cleared — you are a Memory Master.</p>' : ''}

        <div class="result-actions">
          ${nextUnlocked
            ? `<button class="btn-primary" data-action="next">Next Level →</button>`
            : ''}
          <button class="${nextUnlocked ? 'btn-secondary' : 'btn-primary'}" data-action="replay">
            ${won ? 'Play Again' : 'Retry Level'}
          </button>
          <button class="btn-secondary" data-action="levels">Level Select</button>
          <button class="btn-ghost" data-action="menu">Main Menu</button>
        </div>
      </div>
    `;
  },

  mount(el, params, router) {
    // Direct hit on #/win with no round data — send the player home.
    // Deferred: the router is still mid-navigation on this tick.
    if (!params || params.won === undefined) {
      setTimeout(() => router.navigate('menu', {}, { replace: true }), 0);
      return;
    }

    const levelId = Number(params.levelId) || 1;
    header.setLevel(levelId);

    if (params.won) {
      confetti({ count: params.stars === 3 ? 130 : 80 });
    }

    const onClick = (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      audio.play('click');

      switch (action) {
        case 'next':   router.navigate('game', { levelId: Math.min(levelId + 1, TOTAL_LEVELS) }); break;
        case 'replay': router.navigate('game', { levelId }); break;
        case 'levels': router.navigate('levels'); break;
        case 'menu':   router.navigate('menu'); break;
      }
    };

    el.addEventListener('click', onClick);
    unsubs.push(() => el.removeEventListener('click', onClick));
  },

  unmount() {
    unsubs.forEach((fn) => fn());
    unsubs = [];
  },
};
