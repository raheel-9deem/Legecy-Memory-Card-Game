/**
 * game.js — Core game engine.
 *
 * Three classes, no DOM:
 *   Card        — one card's identity and flip state
 *   GameBoard   — the deck: generation, shuffling, match checking
 *   GameManager — orchestration: lifecycle, timer, scoring, events
 *
 * The engine is entirely event-driven. It never touches the document;
 * screens subscribe to events and render from the payloads.
 */

import { EventBus, EVENTS } from './events.mjs';
import { getLevel, starCriteria, themeForLevel } from './levels.mjs';
import { calculateCoins } from './coins.mjs';
import { getTheme } from '../data/themes.mjs';
import { POWERUP_META } from '../data/store-items.mjs';

/** Time a mismatched pair stays visible before flipping back. */
const MISMATCH_DELAY = 1000;
/** Time the board stays locked after a match (for the pop animation). */
const MATCH_DELAY = 380;

export const GAME_STATE = {
  IDLE:    'idle',
  READY:   'ready',
  PLAYING: 'playing',
  PAUSED:  'paused',
  WON:     'won',
  LOST:    'lost',
};

/* ============================================================
   Card
   ============================================================ */

export class Card {
  /**
   * @param {{id:number, pairId:number, symbol:string, position:number}} config
   */
  constructor({ id, pairId, symbol, position }) {
    this.id = id;
    this.pairId = pairId;
    this.symbol = symbol;
    this.position = position;
    this.isFlipped = false;
    this.isMatched = false;
  }

  /** @returns {boolean} true if the flip actually happened. */
  flip() {
    if (this.isFlipped || this.isMatched) return false;
    this.isFlipped = true;
    return true;
  }

  unflip() {
    if (this.isMatched) return false;
    this.isFlipped = false;
    return true;
  }

  setMatched() {
    this.isMatched = true;
    this.isFlipped = true;
  }

  /** Does this card pair with another? */
  matches(other) {
    return !!other && other !== this && other.pairId === this.pairId;
  }

  get isFaceUp() { return this.isFlipped || this.isMatched; }

  reset() {
    this.isFlipped = false;
    this.isMatched = false;
  }

  toJSON() {
    const { id, pairId, symbol, position, isFlipped, isMatched } = this;
    return { id, pairId, symbol, position, isFlipped, isMatched };
  }
}

/* ============================================================
   GameBoard
   ============================================================ */

export class GameBoard {
  /**
   * @param {{rows:number, cols:number, symbols:string[]}} config
   */
  constructor({ rows, cols, symbols }) {
    this.rows = rows;
    this.cols = cols;
    this.symbols = symbols;
    /** @type {Card[]} — index === board position */
    this.cards = [];
    this.build();
  }

  get size()       { return this.rows * this.cols; }
  get pairsTotal() { return this.size / 2; }

  /** Create a fresh shuffled deck of pairs. */
  build() {
    const pairCount = this.pairsTotal;
    const pool = GameBoard.shuffle([...this.symbols]).slice(0, pairCount);

    // Not enough symbols for a big board? Cycle through them.
    while (pool.length < pairCount) pool.push(this.symbols[pool.length % this.symbols.length]);

    const deck = [];
    pool.forEach((symbol, pairId) => {
      deck.push({ pairId, symbol }, { pairId, symbol });
    });

    this.cards = GameBoard.shuffle(deck).map(
      (c, position) => new Card({ id: position, pairId: c.pairId, symbol: c.symbol, position })
    );
    return this.cards;
  }

  /** Fisher–Yates, non-mutating on the caller's array reference order. */
  static shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  getCard(id) { return this.cards.find((c) => c.id === Number(id)) || null; }

  get flippedCards()  { return this.cards.filter((c) => c.isFlipped && !c.isMatched); }
  get matchedCount()  { return this.cards.filter((c) => c.isMatched).length / 2; }
  get isComplete()    { return this.cards.every((c) => c.isMatched); }

  /** Re-order the still-unmatched cards among their own positions. */
  shuffleUnmatched() {
    const open = this.cards.filter((c) => !c.isMatched);
    const positions = GameBoard.shuffle(open.map((c) => c.position));
    open.forEach((card, i) => { card.position = positions[i]; });
    this.cards.sort((a, b) => a.position - b.position);
    return this.cards;
  }

  flipAllDown() {
    this.cards.forEach((c) => c.unflip());
  }

  reset() {
    this.build();
    return this.cards;
  }
}

/* ============================================================
   GameManager
   ============================================================ */

export class GameManager extends EventBus {
  constructor() {
    super();
    this.state = GAME_STATE.IDLE;
    /** @type {GameBoard|null} */
    this.board = null;
    this.level = null;
    this.moves = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    /** Matches that extended a streak — the 2nd, 3rd, … in a row. Pays coins. */
    this.comboMatches = 0;
    this.timeLeft = 0;
    this.elapsed = 0;
    this.locked = false;
    this._timerId = null;
    this._timeouts = new Set();
    this._frozenUntil = 0;
    this._clockStarted = false;
  }

  /* ---------- lifecycle ---------- */

  /**
   * Prepare a level. Does not start the clock — the first flip does that.
   * @param {{levelId:number, themeId?:string, cardBackId?:string, powerups?:object}} config
   *   themeId of 'auto' (the default) draws a random symbol set for this round.
   */
  init({ levelId = 1, themeId = 'auto', cardBackId = 'back-nebula', powerups = {} } = {}) {
    this.destroyTimers();

    this.level = getLevel(levelId);
    this.themePreference = themeId;
    this.themeId = themeForLevel(this.level, themeId);
    this.cardBackId = cardBackId;
    this.powerups = { ...powerups };

    const { symbols } = getTheme(this.themeId);
    const [rows, cols] = this._orientGrid(this.level.rows, this.level.cols);
    this.board = new GameBoard({ rows, cols, symbols });

    this.moves = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboMatches = 0;
    this.elapsed = 0;
    this.timeLeft = this.level.timeLimit;
    this.locked = false;
    this._frozenUntil = 0;
    this._clockStarted = false;
    this.state = GAME_STATE.READY;

    this.emit(EVENTS.GAME_INIT, this.snapshot());
    return this;
  }

  /** Portrait screens get the taller orientation so cards stay large. */
  _orientGrid(rows, cols) {
    const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    if (portrait && cols > rows) return [cols, rows];
    if (!portrait && rows > cols) return [cols, rows];
    return [rows, cols];
  }

  /**
   * Open the board for play. The countdown does NOT begin here — it starts
   * on the first card flip, so nobody loses time to a slow read of the grid.
   */
  startGame() {
    if (this.state !== GAME_STATE.READY && this.state !== GAME_STATE.PAUSED) return this;
    this.state = GAME_STATE.PLAYING;
    if (this._clockStarted) this._startTimer();
    this.emit(EVENTS.GAME_START, this.snapshot());
    return this;
  }

  pauseGame() {
    if (this.state !== GAME_STATE.PLAYING) return this;
    this.state = GAME_STATE.PAUSED;
    this._stopTimer();
    this.emit(EVENTS.GAME_PAUSE, this.snapshot());
    return this;
  }

  resumeGame() {
    if (this.state !== GAME_STATE.PAUSED) return this;
    this.state = GAME_STATE.PLAYING;
    if (this._clockStarted) this._startTimer();
    this.emit(EVENTS.GAME_RESUME, this.snapshot());
    return this;
  }

  /** Rebuild the same level from scratch. */
  resetGame() {
    const levelId = this.level ? this.level.id : 1;
    this.init({
      levelId,
      themeId: this.themePreference,
      cardBackId: this.cardBackId,
      powerups: this.powerups,
    });
    this.emit(EVENTS.GAME_RESET, this.snapshot());
    return this;
  }

  /**
   * End the round.
   * @param {'won'|'lost'} result
   */
  gameOver(result = 'lost') {
    if (this.state === GAME_STATE.WON || this.state === GAME_STATE.LOST) return this;
    this.state = result === 'won' ? GAME_STATE.WON : GAME_STATE.LOST;
    this._stopTimer();
    this.locked = true;

    const won = result === 'won';
    const run = {
      pairs: this.board.pairsTotal,
      moves: this.moves,
      timeLeft: this.timeLeft,
      timeLimit: this.level.timeLimit,
    };
    const rating = won ? starCriteria(run) : { total: 0, criteria: [] };
    const purse = calculateCoins({
      timeLeft: this.timeLeft,
      comboMatches: this.comboMatches,
      won,
    });

    const payload = {
      ...this.snapshot(),
      result,
      won,
      stars: rating.total,
      starDetail: rating.criteria,
      coins: purse.total,
      purse,
      timeUsed: this.level.timeLimit - this.timeLeft,
    };
    this.emit(EVENTS.GAME_OVER, payload);
    return this;
  }

  /* ---------- interaction ---------- */

  /**
   * Flip a card by id and resolve any resulting pair.
   * @returns {boolean} whether the flip was accepted
   */
  flipCard(id) {
    if (this.state !== GAME_STATE.PLAYING || this.locked) return false;

    const card = this.board.getCard(id);
    if (!card || !card.flip()) return false;

    // The countdown begins on the very first flip of the round.
    if (!this._clockStarted) {
      this._clockStarted = true;
      this._startTimer();
      this.emit(EVENTS.TIMER_START, {
        timeLeft: this.timeLeft,
        timeLimit: this.level.timeLimit,
      });
    }

    this.emit(EVENTS.CARD_FLIP, { card: card.toJSON(), ...this.snapshot() });

    const open = this.board.flippedCards;
    if (open.length < 2) return true;

    this.moves += 1;
    this.locked = true;
    const [first, second] = open;

    if (first.matches(second)) {
      this._resolveMatch(first, second);
    } else {
      this._resolveMismatch(first, second);
    }
    return true;
  }

  _resolveMatch(first, second) {
    first.setMatched();
    second.setMatched();
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    // The first match of a streak is not a combo; every one after it is.
    if (this.combo >= 2) this.comboMatches += 1;
    this.score += 100 * this.combo;

    this.emit(EVENTS.PAIR_MATCH, {
      cards: [first.toJSON(), second.toJSON()],
      combo: this.combo,
      comboMatches: this.comboMatches,
      ...this.snapshot(),
    });
    this._emitProgress();

    this._defer(() => {
      this.locked = false;
      if (this.board.isComplete) {
        this.score += Math.round(this.timeLeft * 10);
        this.gameOver('won');
      }
    }, MATCH_DELAY);
  }

  _resolveMismatch(first, second) {
    this.combo = 0;
    this.score = Math.max(0, this.score - 10);

    this.emit(EVENTS.PAIR_MISMATCH, {
      cards: [first.toJSON(), second.toJSON()],
      ...this.snapshot(),
    });

    this._defer(() => {
      first.unflip();
      second.unflip();
      this.locked = false;
      this.emit(EVENTS.CARD_UNFLIP, {
        cards: [first.toJSON(), second.toJSON()],
        ...this.snapshot(),
      });
    }, MISMATCH_DELAY);
  }

  /* ---------- power-ups ---------- */

  /**
   * @param {'hint'|'freeze'|'shuffle'} key
   * @returns {boolean} whether it fired
   */
  usePowerup(key) {
    if (this.state !== GAME_STATE.PLAYING) return false;

    if (key === 'hint') {
      // Never while a pair is resolving — the unflip timer would fight the hint.
      if (this.locked) return false;
      const targets = this._hintTargets();
      if (!targets.length) return false;
      this.emit(EVENTS.HINT_SHOW, { cards: targets.map((c) => c.toJSON()) });
      this._defer(() => this.emit(EVENTS.HINT_HIDE, {}), POWERUP_META.hint.duration);
    } else if (key === 'freeze') {
      this._frozenUntil = this.elapsed + POWERUP_META.freeze.duration / 1000;
    } else if (key === 'shuffle') {
      this.board.shuffleUnmatched();
      this.emit(EVENTS.BOARD_SHUFFLE, { cards: this.board.cards.map((c) => c.toJSON()) });
    } else {
      return false;
    }

    this.emit(EVENTS.POWERUP_USED, { key, ...this.snapshot() });
    return true;
  }

  get isFrozen() { return this.elapsed < this._frozenUntil; }

  /**
   * Which cards a hint should expose.
   *
   * Holding one card, the hint answers the only question worth asking: where
   * is its partner? With nothing flipped there is no question yet, so it
   * offers one complete pair instead. It never exposes the whole board —
   * that would hand over the round rather than help with it.
   *
   * @returns {Card[]} 1 card (the partner) or 2 (a fresh pair); [] if neither exists
   */
  _hintTargets() {
    const hidden = this.board.cards.filter((c) => !c.isFaceUp);
    if (!hidden.length) return [];

    const open = this.board.flippedCards;
    if (open.length === 1) {
      const partner = hidden.find((c) => c.matches(open[0]));
      if (partner) return [partner];
    }

    // Nothing useful in hand — surface one random unmatched pair.
    const pairIds = [...new Set(hidden.map((c) => c.pairId))];
    for (const pairId of GameBoard.shuffle(pairIds)) {
      const pair = hidden.filter((c) => c.pairId === pairId);
      if (pair.length === 2) return pair;
    }
    return [];
  }

  /** Has the countdown begun (i.e. has any card been flipped)? */
  get clockStarted() { return this._clockStarted; }

  /* ---------- timer ---------- */

  _startTimer() {
    this._stopTimer();
    this._timerId = setInterval(() => this._tick(), 1000);
  }

  _stopTimer() {
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = null;
  }

  _tick() {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.elapsed += 1;

    if (!this.isFrozen) this.timeLeft = Math.max(0, this.timeLeft - 1);

    this.emit(EVENTS.GAME_TICK, {
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      frozen: this.isFrozen,
      ...this.snapshot(),
    });

    if (this.timeLeft <= 0) this.gameOver('lost');
  }

  _emitProgress() {
    this.emit(EVENTS.GAME_PROGRESS, {
      matched: this.board.matchedCount,
      total: this.board.pairsTotal,
      percent: (this.board.matchedCount / this.board.pairsTotal) * 100,
      ...this.snapshot(),
    });
  }

  /* ---------- utilities ---------- */

  /** setTimeout that can be cleaned up wholesale on teardown. */
  _defer(fn, ms) {
    const id = setTimeout(() => {
      this._timeouts.delete(id);
      fn();
    }, ms);
    this._timeouts.add(id);
    return id;
  }

  destroyTimers() {
    this._stopTimer();
    this._timeouts.forEach(clearTimeout);
    this._timeouts.clear();
  }

  destroy() {
    this.destroyTimers();
    this.state = GAME_STATE.IDLE;
    this.board = null;
  }

  /** Plain, serialisable view of the current round. */
  snapshot() {
    return {
      state: this.state,
      level: this.level,
      moves: this.moves,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      comboMatches: this.comboMatches,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      timeLimit: this.level ? this.level.timeLimit : 0,
      clockStarted: this._clockStarted,
      matched: this.board ? this.board.matchedCount : 0,
      total: this.board ? this.board.pairsTotal : 0,
      cards: this.board ? this.board.cards.map((c) => c.toJSON()) : [],
      rows: this.board ? this.board.rows : 0,
      cols: this.board ? this.board.cols : 0,
      themeId: this.themeId,
      cardBackId: this.cardBackId,
    };
  }
}

/** Shared game instance used by the gameplay screen. */
export const gameManager = new GameManager();
