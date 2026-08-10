/**
 * menu.js — Main menu screen.
 *
 * Neon title, glass buttons and a settings modal. The floating-particle
 * backdrop lives behind every screen (see ui/particles.js).
 */

import { store } from '../core/storage.js';
import { TOTAL_LEVELS } from '../core/levels.js';
import { header } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast } from '../ui/toast.js';

let cleanup = [];

export default {
  title: 'Memory Master',
  header: { show: true, home: false, pause: false, timer: false, moves: false, level: true },

  render() {
    const cleared = store.clearedCount;
    const stars = store.totalStars;
    const combo = store.state.stats.bestCombo;

    return `
      <div class="menu-inner">
        <div>
          <h1 class="neon-title">Memory<span class="word-2">Master</span></h1>
          <p class="menu-tagline">Flip · Match · Remember</p>
        </div>

        <div class="menu-buttons">
          <button class="btn-primary menu-play" data-action="play">
            <span>▶</span><span>Play</span>
          </button>
          <button class="btn-secondary" data-action="store">
            <span>🛍️</span><span>Store</span>
          </button>
          <button class="btn-secondary" data-action="settings">
            <span>⚙️</span><span>Settings</span>
          </button>
        </div>

        <div class="menu-stats">
          <div class="menu-stat">
            <span class="menu-stat-value">${cleared}<span style="opacity:.4;font-size:.7em">/${TOTAL_LEVELS}</span></span>
            <span class="menu-stat-label">Cleared</span>
          </div>
          <div class="menu-stat">
            <span class="menu-stat-value">⭐ ${stars}</span>
            <span class="menu-stat-label">Stars</span>
          </div>
          <div class="menu-stat">
            <span class="menu-stat-value">×${combo}</span>
            <span class="menu-stat-label">Best combo</span>
          </div>
        </div>
      </div>
    `;
  },

  mount(el, params, router) {
    header.setLevel(store.state.unlockedLevel);

    const onClick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      audio.play('click');

      switch (btn.dataset.action) {
        case 'play':     router.navigate('levels'); break;
        case 'store':    router.navigate('store'); break;
        case 'settings': openSettings(); break;
      }
    };

    el.addEventListener('click', onClick);
    cleanup.push(() => el.removeEventListener('click', onClick));
  },

  unmount() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    closeSettings();
  },
};

/* ---------- settings modal ---------- */

let settingsEl = null;

function openSettings() {
  if (settingsEl) return;

  settingsEl = document.createElement('div');
  settingsEl.className = 'overlay';
  settingsEl.innerHTML = `
    <div class="glass-card modal-card">
      <h2>Settings</h2>

      ${toggleRow('sound', 'Sound effects', 'Flips, matches and fanfares', store.getSetting('sound'))}
      ${toggleRow('particles', 'Background particles', 'Turn off to save battery', store.getSetting('particles'))}
      ${toggleRow('hardMode', 'Hard mode', 'Tighter timers, bigger rewards', store.getSetting('hardMode'))}

      <button class="btn-secondary" data-settings="reset">Reset progress</button>
      <button class="btn-primary" data-settings="close">Done</button>
    </div>
  `;

  settingsEl.addEventListener('click', (e) => {
    if (e.target === settingsEl) return closeSettings();

    const toggle = e.target.closest('input[data-setting]');
    if (toggle) {
      store.setSetting(toggle.dataset.setting, toggle.checked);
      audio.play('click');
      return;
    }

    const action = e.target.closest('[data-settings]')?.dataset.settings;
    if (action === 'close') {
      audio.play('click');
      closeSettings();
    } else if (action === 'reset') {
      if (confirm('Erase all levels, stars and coins?')) {
        store.reset();
        closeSettings();
        toast('Progress reset', 'info');
        window.location.reload();
      }
    }
  });

  document.body.appendChild(settingsEl);
}

function closeSettings() {
  settingsEl?.remove();
  settingsEl = null;
}

function toggleRow(key, label, desc, checked) {
  return `
    <div class="setting-row">
      <div>
        <div class="setting-label">${label}</div>
        <div class="setting-desc">${desc}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''} aria-label="${label}">
        <span class="switch-track"></span>
      </label>
    </div>
  `;
}
