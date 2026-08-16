/**
 * win.js — End-of-round screen (victory and defeat share this layout).
 *
 * Everything shown here arrives as navigation params from the gameplay screen;
 * this module never recomputes a payout or a star count, so the numbers on
 * screen are exactly the ones that were banked.
 */

import { getLevel, hasNextLevel, TOTAL_LEVELS } from '../core/levels.js';
import { coinBreakdown } from '../core/coins.js';
import { header, formatTime } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { confetti } from '../ui/effects.js';

/** Delay between star reveals — must match --i arithmetic in style.css. */
const STAR_STEP = 260;

let unsubs = [];

function starRow(stars) {
  return [1, 2, 3]
    .map((n) => `<span class="star ${stars >= n ? 'earned' : ''}" style="--i:${n - 1}">★</span>`)
    .join('');
}

/** Which of the three tests passed, so a missed star is explained, not guessed. */
function criteriaList(detail) {
  if (!Array.isArray(detail) || !detail.length) return '';
  const rows = detail
    .map((c, i) => `
      <li class="${c.met ? 'met' : 'missed'}" style="--i:${i}">
        <span class="crit-mark">${c.met ? '★' : '☆'}</span>
        <span class="crit-text">
          <span class="crit-label">${c.label}</span>
          <span class="crit-detail">${c.detail}</span>
        </span>
      </li>`)
    .join('');
  return `<ul class="star-criteria">${rows}</ul>`;
}

/** Itemised coin payout. Falls back to the bare total if no purse was passed. */
function coinPanel(coins, purse) {
  const rows = purse
    ? coinBreakdown(purse)
        .map((r) => `
          <div class="coin-row">
            <span class="coin-row-label">${r.label}<em>${r.detail}</em></span>
            <span class="coin-row-value">+${r.value}</span>
          </div>`)
        .join('')
    : '';

  return `
    <div class="coin-reward"><span>🪙</span><span>+${coins} coins</span></div>
    ${rows ? `<div class="coin-breakdown">${rows}</div>` : ''}
  `;
}

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
    const score = Number(params.score) || 0;
    const bestCombo = Number(params.bestCombo) || 0;
    const timeUsed = Number(params.timeUsed) || 0;
    const timeLimit = Number(params.timeLimit) || level.timeLimit;
    const matched = Number(params.matched) || 0;
    const total = Number(params.total) || level.pairs;
    const missing = total - matched;

    const subtitle = won
      ? stars === 3
        ? 'Flawless memory. Three stars!'
        : `Level ${levelId} cleared with ${formatTime(Math.max(0, timeLimit - timeUsed))} to spare — ${3 - stars} star${3 - stars > 1 ? 's' : ''} still out there.`
      : `The clock beat you with ${missing} pair${missing === 1 ? '' : 's'} still hidden.`;

    const nextUnlocked = won && hasNextLevel(levelId);
    const allDone = won && !hasNextLevel(levelId);

    return `
      <div class="glass-card result-card">
        <h2 class="result-title ${won ? '' : 'lose'}">${won ? 'Level Clear' : 'Game Over'}</h2>
        <p class="result-sub">${subtitle}</p>

        ${won
          ? `<div class="result-stars" role="img" aria-label="${stars} of 3 stars earned">${starRow(stars)}</div>
             ${criteriaList(params.starDetail)}`
          : '<div class="result-timeout">⏳</div>'}

        <div class="result-stats">
          <div class="result-stat">
            <span class="result-stat-value">${formatTime(timeUsed)}</span>
            <span class="result-stat-label">Time</span>
          </div>
          <div class="result-stat">
            <span class="result-stat-value">${moves}</span>
            <span class="result-stat-label">Moves</span>
          </div>
          <div class="result-stat">
            <span class="result-stat-value">${won ? coins : `${matched}/${total}`}</span>
            <span class="result-stat-label">${won ? 'Coins' : 'Pairs'}</span>
          </div>
        </div>

        <p class="result-meta">Score ${score.toLocaleString()} · best combo ×${bestCombo || 1} · ${matched}/${total} pairs</p>

        ${won ? coinPanel(coins, params.purse) : ''}

        ${params.unlockedLevel
          ? `<p class="result-unlock">🔓 Level ${params.unlockedLevel} unlocked</p>`
          : ''}
        ${params.isNewStarRecord ? '<p class="result-record">★ New star record for this level!</p>' : ''}
        ${params.isNewTimeRecord ? `<p class="result-record">⏱ New best time — ${formatTime(timeUsed)}</p>` : ''}
        ${allDone ? '<p class="result-sub" style="color:var(--cyan)">🏆 Every level cleared — you are a Memory Master.</p>' : ''}

        <div class="result-actions">
          ${nextUnlocked
            ? '<button class="btn-primary" data-action="next">Play Next Level →</button>'
            : ''}
          <button class="${nextUnlocked ? 'btn-secondary' : 'btn-primary'}" data-action="replay">
            ${won ? 'Play Again' : 'Retry Level'}
          </button>
          <button class="btn-secondary" data-action="levels">Level Select</button>
          <button class="btn-ghost" data-action="menu">Return to Menu</button>
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
      // One chime per star, landing with each reveal and climbing a fourth each
      // time, so three stars arrive as a rising figure rather than three of the
      // same note.
      for (let i = 0; i < (Number(params.stars) || 0); i++) {
        const id = setTimeout(() => audio.starEarned(i), 160 + i * STAR_STEP);
        unsubs.push(() => clearTimeout(id));
      }
      // The unlock is the real reward on a first clear — give it its own cue,
      // after the stars have finished so it is not buried under them.
      if (params.unlockedLevel) {
        const stars = Number(params.stars) || 0;
        const id = setTimeout(() => audio.play('unlock'), 260 + stars * STAR_STEP);
        unsubs.push(() => clearTimeout(id));
      }
    }

    const onClick = (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      audio.play('click');

      switch (action) {
        case 'next': {
          // Every level is open, so this only clamps at the last one.
          router.navigate('game', { levelId: Math.min(levelId + 1, TOTAL_LEVELS) });
          break;
        }
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
