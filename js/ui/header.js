/**
 * header.js — Base-layout header controller.
 *
 * Owns the coin counter, level indicator, timer, move counter and the
 * home/pause buttons. Screens declare what they need via their
 * `header` config; the router hands it to apply().
 */

import { bus, EVENTS } from '../core/events.js';
import { store } from '../core/storage.js';

/**
 * `timer` and `moves` are separate flags: the gameplay screen shows the
 * countdown in its corner ring, so it asks for moves without the timer pill.
 * `gameStats: true` is still honoured as a shorthand for both.
 */
const DEFAULT_CONFIG = { show: true, home: false, pause: false, timer: false, moves: false, level: true };

class HeaderController {
  init(router) {
    this.router = router;

    this.el          = document.getElementById('main-header');
    this.titleEl     = document.getElementById('header-title');
    this.coinEl      = document.getElementById('coin-value');
    this.coinPill    = this.coinEl ? this.coinEl.closest('.stat-pill') : null;
    this.levelPill   = document.getElementById('level-display');
    this.levelEl     = document.getElementById('level-value');
    this.timerPill   = document.getElementById('timer-display');
    this.timerEl     = document.getElementById('timer-value');
    this.movesPill   = document.getElementById('moves-display');
    this.movesEl     = document.getElementById('moves-value');
    this.homeBtn     = document.getElementById('btn-menu');
    this.pauseBtn    = document.getElementById('btn-pause');

    this.homeBtn?.addEventListener('click', () => {
      bus.emit('ui:home-pressed', {});
    });
    this.pauseBtn?.addEventListener('click', () => {
      bus.emit('ui:pause-pressed', {});
    });

    this.setCoins(store.coins);
    bus.on(EVENTS.COINS_CHANGED, (e) => this.setCoins(e.detail.coins, e.detail.delta));
    bus.on(EVENTS.SAVE_RESET, () => this.setCoins(store.coins));

    return this;
  }

  /** Apply a screen's header requirements. */
  apply(config = {}, { title } = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (config.gameStats !== undefined) {
      if (config.timer === undefined) cfg.timer = config.gameStats;
      if (config.moves === undefined) cfg.moves = config.gameStats;
    }

    this.el?.classList.toggle('hidden', !cfg.show);
    if (this.titleEl && title) this.titleEl.textContent = title;

    this.homeBtn?.classList.toggle('hidden', !cfg.home);
    this.pauseBtn?.classList.toggle('hidden', !cfg.pause);
    this.levelPill?.classList.toggle('hidden', !cfg.level);
    this.timerPill?.classList.toggle('hidden', !cfg.timer);
    this.movesPill?.classList.toggle('hidden', !cfg.moves);

    if (!cfg.timer) {
      this.setTimer(0);
      this.timerPill?.classList.remove('warn');
    }
    if (!cfg.moves) this.setMoves(0);
  }

  setCoins(value, delta = 0) {
    if (!this.coinEl) return;
    this.coinEl.textContent = Number(value).toLocaleString();
    if (delta > 0 && this.coinPill) {
      this.coinPill.classList.remove('bump');
      void this.coinPill.offsetWidth;          // restart the animation
      this.coinPill.classList.add('bump');
    }
  }

  setLevel(value) {
    if (this.levelEl) this.levelEl.textContent = value;
  }

  setTimer(seconds) {
    if (!this.timerEl) return;
    this.timerEl.textContent = formatTime(seconds);
    this.timerPill?.classList.toggle('warn', seconds > 0 && seconds <= 10);
  }

  setMoves(value) {
    if (this.movesEl) this.movesEl.textContent = value;
  }
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Singleton header controller. */
export const header = new HeaderController();
