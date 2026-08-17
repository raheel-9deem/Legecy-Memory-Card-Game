/**
 * gameplay.js — The board screen.
 *
 * Renders from the engine's snapshot and then reacts purely to engine
 * events. No game rules live here — only DOM.
 */

import { gameManager } from '../core/game.js';
import { bus, EVENTS } from '../core/events.js';
import { store } from '../core/storage.js';
import { coinBank } from '../core/coins.js';
import { getLevel } from '../core/levels.js';
import { getCardBack, POWERUP_META } from '../data/store-items.js';
import { header } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast } from '../ui/toast.js';
import { comboFlash, flyCoins, matchSparks } from '../ui/effects.js';
import { timerRing, TimerRing } from '../ui/timer-ring.js';

const POWERUP_ORDER = ['hint', 'freeze', 'shuffle'];
/** Smallest card the 32-pair boards may shrink to before the board scrolls. */
const MIN_CARD_W = 34;
const MIN_CARD_H = 44;

let unsubs = [];
let boardEl = null;
let wrapEl = null;
let progressEl = null;
let routerRef = null;
let levelId = 1;
let resizeHandler = null;
/** rAF handle for the coalesced re-layout — see scheduleLayout(). */
let layoutRaf = null;
/** Guards the deferred navigation while the coin payout is in flight. */
let mounted = false;

export default {
  title: 'Playing',
  // The countdown lives in the corner ring on this screen, so the header
  // shows moves only — no duplicate timer pill.
  header: { show: true, home: true, pause: true, timer: false, moves: true, level: true },

  render(params = {}) {
    levelId = Number(params.levelId) || store.currentLevel;
    const level = getLevel(levelId);

    const powerupBtns = POWERUP_ORDER.map((key) => {
      const meta = POWERUP_META[key];
      const count = store.powerupCount(key);
      const cost = meta.useCost || 0;
      // The button only lights up when the player can actually fire it:
      // a stocked unit AND the per-use coin fee.
      const ready = count > 0 && (cost === 0 || store.canAfford(cost));
      const costPill = cost
        ? `<span class="powerup-cost" data-cost="${key}">🪙${cost}</span>`
        : '';
      return `
        <button class="powerup-btn" data-powerup="${key}" ${ready ? '' : 'disabled'}
                aria-label="${meta.name} power-up, costs ${cost} coins">
          <span>${meta.icon}</span>
          <span>${meta.name}</span>
          ${costPill}
          <span class="powerup-count" data-count="${key}">${count}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="board-wrap" id="board-wrap">
        ${TimerRing.markup()}
        <div id="game-board" role="grid" aria-label="Memory board, level ${level.id}"></div>
      </div>
      <div class="game-bar">${powerupBtns}</div>
    `;
  },

  mount(el, params, router) {
    // A locked level can still be asked for: a stale #/game hash, the back
    // button after a reset, a hand-typed URL. Refuse it here rather than dealing
    // a board that has not been earned — no board, no clock, no coins. The
    // router is still mid-navigation on this tick, so the bounce is deferred
    // (same reason as the win screen's direct-hit guard).
    const entry = store.canPlay(levelId);
    if (!entry.ok) {
      toast(
        entry.reason === 'locked'
          ? `Level ${levelId} is locked — clear level ${entry.requiredLevel} first`
          : `Level ${levelId} does not exist`,
        'error'
      );
      audio.play('error');
      setTimeout(() => router.navigate('levels', {}, { replace: true }), 0);
      return;
    }

    routerRef = router;
    mounted = true;
    boardEl = el.querySelector('#game-board');
    wrapEl = el.querySelector('#board-wrap');
    progressEl = el.querySelector('#progress-fill');
    timerRing.attach(el);

    header.setLevel(levelId);
    header.setMoves(0);

    // ---- engine subscriptions (before init so we catch GAME_INIT) ----
    unsubs.push(
      gameManager.on(EVENTS.GAME_INIT, (e) => renderBoard(e.detail)),
      gameManager.on(EVENTS.CARD_FLIP, onCardFlip),
      gameManager.on(EVENTS.TIMER_START, onTimerStart),
      gameManager.on(EVENTS.PAIR_MATCH, onPairMatch),
      gameManager.on(EVENTS.PAIR_MISMATCH, onPairMismatch),
      gameManager.on(EVENTS.CARD_UNFLIP, onCardUnflip),
      gameManager.on(EVENTS.GAME_TICK, onTick),
      gameManager.on(EVENTS.GAME_PROGRESS, onProgress),
      gameManager.on(EVENTS.BOARD_SHUFFLE, onShuffle),
      gameManager.on(EVENTS.HINT_SHOW, onHintShow),
      gameManager.on(EVENTS.HINT_HIDE, onHintHide),
      gameManager.on(EVENTS.GAME_OVER, onGameOver),
      gameManager.on(EVENTS.GAME_PAUSE, () => timerRing.setStateText('paused')),
      gameManager.on(EVENTS.GAME_RESUME, () =>
        timerRing.setStateText(gameManager.clockStarted ? 'remaining' : 'tap a card')),
      bus.on(EVENTS.POWERUPS_CHANGED, syncPowerupButtons),
      // A power-up use also spends coins, so the disabled state must re-evaluate
      // when the balance drops too low to afford the next use.
      bus.on(EVENTS.COINS_CHANGED, syncPowerupButtons)
    );

    // ---- board interaction ----
    const onBoardClick = (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      gameManager.flipCard(card.dataset.id);
    };
    boardEl.addEventListener('click', onBoardClick);
    unsubs.push(() => boardEl.removeEventListener('click', onBoardClick));

    // ---- power-ups ----
    const onBarClick = (e) => {
      const btn = e.target.closest('[data-powerup]');
      if (!btn) return;
      usePowerup(btn.dataset.powerup);
    };
    el.addEventListener('click', onBarClick);
    unsubs.push(() => el.removeEventListener('click', onBarClick));

    // ---- responsive board ----
    // A drag-resize fires dozens of events a second and each re-layout reads
    // clientWidth/clientHeight, so measuring inline would thrash layout. Coalesce
    // to one measurement per frame.
    resizeHandler = scheduleLayout;
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', resizeHandler);

    // ---- start the round ----
    store.recordPlay();
    gameManager.init({
      levelId,
      themeId: store.state.equipped.theme,
      cardBackId: store.state.equipped.cardBack,
      powerups: { ...store.powerups },
      // The engine owns the squeeze, so the star tests and the "time to spare"
      // line measure against the clock the player actually got.
      hardMode: !!store.getSetting('hardMode'),
    });

    // The ring shows the full budget at rest; the clock waits for the first flip.
    timerRing.reset(gameManager.timeLeft);
    header.setTimer(gameManager.timeLeft);
    gameManager.startGame();
  },

  unmount() {
    mounted = false;
    unsubs.forEach((fn) => fn());
    unsubs = [];
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('orientationchange', resizeHandler);
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = null;
    gameManager.destroyTimers();
    timerRing.detach();
    boardEl = wrapEl = progressEl = null;
  },
};

/* ============================================================
   Rendering
   ============================================================ */

function renderBoard(snapshot) {
  if (!boardEl) return;
  const back = getCardBack(snapshot.cardBackId);

  // .card-front is the face-down side ('?'); .card-back holds the emoji.
  boardEl.innerHTML = snapshot.cards
    .map((card, i) => `
      <button class="card" data-id="${card.id}" role="gridcell"
              style="animation-delay:${Math.min(i * 22, 520)}ms"
              aria-label="Hidden card ${i + 1}">
        <div class="card-inner">
          <div class="card-face card-front" style="background:${back.css}">
            <span class="card-symbol">?</span>
            <span class="card-back-icon">${back.icon}</span>
          </div>
          <div class="card-face card-back">${card.symbol}</div>
        </div>
      </button>
    `)
    .join('');

  layoutBoard(snapshot.rows, snapshot.cols);
  setProgress(0);
  header.setMoves(0);
}

/** One re-layout per animation frame, however many resize events arrive. */
function scheduleLayout() {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = null;
    layoutBoard(gameManager.board?.rows, gameManager.board?.cols);
  });
}

/** Fit the grid to the available space on any screen size. */
function layoutBoard(rows, cols) {
  if (!boardEl || !wrapEl || !rows || !cols) return;

  const gap = window.innerWidth < 620 ? 6 : 10;
  const availH = wrapEl.clientHeight;
  let availW = wrapEl.clientWidth;
  if (availW <= 0 || availH <= 0) return;

  const ratio = 1.3;                                  // card height / width
  const fit = (width) => {
    let cw = (width - gap * (cols - 1)) / cols;
    let ch = cw * ratio;
    const maxCh = (availH - gap * (rows - 1)) / rows;
    if (ch > maxCh) {
      ch = maxCh;
      cw = ch / ratio;
    }
    return { cw, ch };
  };

  let { cw, ch } = fit(availW);

  // The countdown ring floats over the top-right corner. If the board is wide
  // enough to reach it, inset both sides so the grid stays centred and clear.
  const ring = wrapEl.querySelector('.timer-ring');
  const ringW = ring ? ring.offsetWidth + 10 : 0;
  const boardW = cols * cw + gap * (cols - 1);
  if (ringW && boardW > availW - ringW * 2) {
    availW = Math.max(120, availW - ringW * 2);
    ({ cw, ch } = fit(availW));
  }

  // Floors keep an 8×8 board legible on a phone, but they can push the grid past
  // the wrap — so let the board scroll rather than spill under the game bar.
  const finalCw = Math.max(MIN_CARD_W, Math.floor(cw));
  const finalCh = Math.max(MIN_CARD_H, Math.floor(ch));
  boardEl.style.setProperty('--cols', cols);
  boardEl.style.setProperty('--board-gap', `${gap}px`);
  boardEl.style.setProperty('--cw', `${finalCw}px`);
  boardEl.style.setProperty('--ch', `${finalCh}px`);

  const needsW = cols * finalCw + gap * (cols - 1);
  const needsH = rows * finalCh + gap * (rows - 1);
  wrapEl.classList.toggle('cramped', needsW > availW + 1 || needsH > availH + 1);
}

function cardEl(id) {
  return boardEl ? boardEl.querySelector(`.card[data-id="${id}"]`) : null;
}

function setProgress(percent) {
  if (progressEl) progressEl.style.width = `${percent}%`;
}

/* ============================================================
   Engine event handlers
   ============================================================ */

function onCardFlip(e) {
  const { card, moves } = e.detail;
  const node = cardEl(card.id);
  if (node) {
    node.classList.add('flipped');
    node.setAttribute('aria-label', `Card ${card.symbol}`);
  }
  header.setMoves(moves);
  audio.play('flip');
}

function onPairMatch(e) {
  const { cards, combo, moves } = e.detail;
  const nodes = [];
  cards.forEach((c) => {
    const node = cardEl(c.id);
    if (!node) return;
    nodes.push(node);
    node.classList.remove('flipped');
    node.classList.add('matched', 'match-pop');
    node.setAttribute('aria-label', `Matched ${c.symbol}`);
    setTimeout(() => node.classList.remove('match-pop'), 600);
  });

  // Bigger burst as a combo builds, capped so a long run stays readable.
  matchSparks(nodes, { count: Math.min(24, 12 + combo * 3) });

  header.setMoves(moves);
  combo > 1 ? audio.combo(combo) : audio.play('match');
  if (combo >= 2) comboFlash(`Combo ×${combo}`);
}

function onPairMismatch(e) {
  const { cards, moves } = e.detail;
  cards.forEach((c) => cardEl(c.id)?.classList.add('mismatch'));
  header.setMoves(moves);
  audio.play('mismatch');

  boardEl?.classList.add('shake');
  setTimeout(() => boardEl?.classList.remove('shake'), 420);
}

function onCardUnflip(e) {
  e.detail.cards.forEach((c) => {
    const node = cardEl(c.id);
    if (!node) return;
    node.classList.remove('flipped', 'mismatch');
    node.setAttribute('aria-label', 'Hidden card');
  });
}

/** First flip of the round — the countdown begins here, not on mount. */
function onTimerStart() {
  timerRing.start();
}

function onTick(e) {
  const { timeLeft, frozen } = e.detail;
  timerRing.setFrozen(frozen);
  timerRing.update(timeLeft);
  header.setTimer(timeLeft);
  if (!frozen && timeLeft === 10) toast('10 seconds left!', 'error', 1600);
  // A heartbeat under the last ten seconds. Skipped while frozen — the whole
  // point of Freeze is that the clock is not the thing to worry about.
  if (!frozen && timeLeft > 0 && timeLeft <= 10) audio.countdown();
}

function onProgress(e) {
  setProgress(e.detail.percent);
}

function onShuffle(e) {
  if (!boardEl) return;
  // Re-append nodes in their new position order.
  [...e.detail.cards]
    .sort((a, b) => a.position - b.position)
    .forEach((c) => {
      const node = cardEl(c.id);
      if (node) boardEl.appendChild(node);
    });
  toast('Board shuffled', 'info', 1400);
}

function onHintShow(e) {
  e.detail.cards.forEach((c) => cardEl(c.id)?.classList.add('flipped', 'hint-glow'));
}

function onHintHide() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.hint-glow').forEach((node) => {
    node.classList.remove('hint-glow');
    // Re-hide only what the engine still holds face-down: the player may have
    // genuinely flipped a hinted card while it was glowing, and that flip wins.
    const card = gameManager.board?.getCard(node.dataset.id);
    if (card && !card.isFaceUp) node.classList.remove('flipped');
  });
}

function onGameOver(e) {
  const d = e.detail;
  const level = getLevel(levelId);
  // The purse already carries the hard-mode bonus (see core/coins.js), so the
  // itemised rows on the win screen sum to exactly this number.
  const coins = d.coins;
  let record = null;
  let balanceBefore = coinBank.total;

  if (d.won) {
    record = store.recordWin(levelId, { stars: d.stars, time: d.timeUsed, moves: d.moves });
    balanceBefore = coinBank.total;
    coinBank.award(coins, { levelId, purse: d.purse });
    store.recordMatchStats({ matches: d.total, combo: d.bestCombo });
    // A three-star clear gets the longer flourish — see audio.perfect().
    audio.levelComplete(d.stars);
  } else {
    audio.gameOver();
  }

  const goToResults = () => {
    // The player may have hit Home while the coins were still in the air.
    if (!mounted) return;
    routerRef?.navigate('win', {
      won: d.won,
      levelId,
      stars: d.stars,
      starDetail: d.starDetail,
      coins,
      purse: d.purse,
      moves: d.moves,
      score: d.score,
      bestCombo: d.bestCombo,
      comboMatches: d.comboMatches,
      timeUsed: d.timeUsed,
      // The clock the round actually ran on, not the level's paper budget —
      // they differ under hard mode.
      timeLimit: d.timeLimit,
      hardMode: d.hardMode,
      matched: d.matched,
      total: d.total,
      pairs: level.pairs,
      isNewStarRecord: record?.isNewStarRecord || false,
      isNewTimeRecord: record?.isNewTimeRecord || false,
      unlockedLevel: record?.unlockedLevel || null,
    });
  };

  // Let the coins land in the counter before the board is torn down. flyCoins
  // returns 0 (and fires straight away) when there is nothing to animate or
  // the player prefers reduced motion, so this never stalls.
  if (d.won && coins > 0) {
    const flightMs = flyCoins({ from: wrapEl, amount: coins, onDone: goToResults });
    // The balance was banked (and the header set) the moment it was awarded;
    // roll the display up so the number climbs with the arriving coins.
    if (flightMs) header.rollCoins(balanceBefore, coinBank.total, flightMs * 0.85);
  } else {
    goToResults();
  }
}

/* ============================================================
   Power-ups
   ============================================================ */

function usePowerup(key) {
  const meta = POWERUP_META[key];
  const count = store.powerupCount(key);

  // A use demands BOTH a stocked unit and the per-use coin fee. Report the
  // binding constraint so the player knows what to fix.
  if (!count) {
    audio.play('error');
    toast(`No ${meta.name} left — buy more in the store`, 'error');
    return;
  }
  const cost = meta.useCost || 0;
  if (cost && !store.canAfford(cost)) {
    audio.play('error');
    toast(`Need 🪙 ${cost} to use ${meta.name}`, 'error');
    return;
  }

  // Ask the engine first: if it refuses (locked board, fully matched, etc.)
  // nothing is spent — no unit, no coins.
  if (!gameManager.usePowerup(key)) {
    audio.play('error');
    return;
  }

  // The engine accepted it, so dock one stocked unit…
  store.usePowerup(key);
  // …and charge the per-use coin fee from the live balance.
  if (cost) store.spendCoins(cost);
  // Each power-up has its own cue, so the confirmation is audible without
  // looking away from the board; 'powerup' stays the fallback for anything
  // without a dedicated sound.
  audio.play(POWERUP_ORDER.includes(key) ? key : 'powerup');

  if (key === 'freeze') toast('Clock frozen for 10 seconds', 'success', 1600);
}

function syncPowerupButtons() {
  POWERUP_ORDER.forEach((key) => {
    const meta = POWERUP_META[key];
    const count = store.powerupCount(key);
    const cost = meta.useCost || 0;
    const ready = count > 0 && (cost === 0 || store.canAfford(cost));

    const badge = document.querySelector(`[data-count="${key}"]`);
    if (badge) badge.textContent = count;

    const btn = document.querySelector(`[data-powerup="${key}"]`);
    if (btn) btn.disabled = !ready;
  });
}
