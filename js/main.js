/**
 * main.js — Application bootstrap.
 *
 * Wires the save file, header, background particles, toast host, router
 * and the global pause overlay, then hands control to the router.
 */

import { store } from './core/storage.js';
import { bus, EVENTS } from './core/events.js';
import { Router, ROUTES } from './core/router.js';
import { gameManager, GAME_STATE } from './core/game.js';
import { header } from './ui/header.js';
import { particles } from './ui/particles.js';
import { initToast, toast } from './ui/toast.js';
import { audio } from './ui/audio.js';

/* ---------- boot ---------- */

store.load();
initToast();

const router = new Router({ routes: ROUTES, header, defaultRoute: 'menu' });
header.init(router);
particles.init('particle-canvas');

setupAudioUnlock();
setupPauseOverlay(router);
setupNavigationIntents(router);
setupKeyboard(router);

router.start();

// Expose a small handle for debugging in the console.
window.MemoryMaster = { router, store, gameManager, bus, EVENTS };

/* ---------- audio needs a user gesture ---------- */

function setupAudioUnlock() {
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/* ---------- pause overlay ---------- */

function setupPauseOverlay(router) {
  const overlay = document.getElementById('pause-overlay');
  const show = () => overlay?.classList.remove('hidden');
  const hide = () => overlay?.classList.add('hidden');

  const openPause = () => {
    if (router.currentName !== 'game') return false;
    if (gameManager.state !== GAME_STATE.PLAYING) return false;
    gameManager.pauseGame();
    show();
    return true;
  };

  const resume = () => {
    hide();
    gameManager.resumeGame();
  };

  bus.on('ui:pause-pressed', () => {
    audio.play('click');
    if (!overlay?.classList.contains('hidden')) return resume();
    if (!openPause()) toast('Nothing to pause', 'info', 1200);
  });

  document.getElementById('btn-resume')?.addEventListener('click', () => {
    audio.play('click');
    resume();
  });

  document.getElementById('btn-restart')?.addEventListener('click', () => {
    audio.play('click');
    hide();
    const levelId = gameManager.level ? gameManager.level.id : 1;
    router.navigate('game', { levelId });
  });

  document.getElementById('btn-quit')?.addEventListener('click', () => {
    audio.play('click');
    hide();
    gameManager.destroyTimers();
    router.navigate('menu');
  });

  // Never leave the overlay up across a screen change or game end.
  bus.on(EVENTS.SCREEN_ENTER, hide);
  gameManager.on(EVENTS.GAME_OVER, hide);

  // Auto-pause when the player switches tabs mid-round.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) openPause();
  });
}

/* ---------- header navigation intents ---------- */

function setupNavigationIntents(router) {
  bus.on('ui:home-pressed', () => {
    audio.play('click');
    if (router.currentName === 'game') {
      // Ask before abandoning a round in progress.
      if (gameManager.state === GAME_STATE.PLAYING) gameManager.pauseGame();
      document.getElementById('pause-overlay')?.classList.remove('hidden');
      return;
    }
    router.navigate('menu');
  });
}

/* ---------- keyboard shortcuts ---------- */

function setupKeyboard(router) {
  document.addEventListener('keydown', (e) => {
    // `e.target` is not always an Element (a keydown routed at the document has
    // no matches()), and `e.key` is undefined for some IME and hardware events.
    const target = e.target;
    if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return;
    if (typeof e.key !== 'string') return;
    // Let browser and OS shortcuts through untouched.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();

    if (e.key === 'Escape' || key === 'p') {
      if (router.currentName === 'game') {
        e.preventDefault();
        bus.emit('ui:pause-pressed', {});
      } else if (router.currentName !== 'menu' && e.key === 'Escape') {
        router.navigate('menu');
      }
      return;
    }

    if (key === 'm' && router.currentName !== 'game') {
      router.navigate('menu');
    }
  });
}
