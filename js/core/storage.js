/**
 * storage.js — Persistent save file (localStorage) + coin economy.
 *
 * All mutations emit events on the global bus so the header, store and
 * level select stay in sync without polling.
 */

import { bus, EVENTS } from './events.js';
import { TOTAL_LEVELS } from './levels.js';
import { getStoreItem } from '../data/store-items.js';

const SAVE_KEY = 'memory-master:save:v2';

function defaults() {
  return {
    coins: 150,
    unlockedLevel: 1,
    /** levelId -> { stars, bestTime, bestMoves, cleared, clearCount } */
    levels: {},
    owned: ['back-nebula', 'auto', 'fruits'],
    equipped: { cardBack: 'back-nebula', theme: 'auto' },
    powerups: { hint: 2, freeze: 1, shuffle: 1 },
    settings: { sound: true, volume: 1, particles: true, hardMode: false, notifyUpdates: false },
    stats: { gamesPlayed: 0, gamesWon: 0, totalMatches: 0, bestCombo: 0 },
    /** Cross-session player record. */
    player: { createdAt: null, lastPlayed: null, totalCoinsEarned: 0 },
  };
}

class SaveStore {
  constructor() {
    this.state = defaults();
    this._available = true;
  }

  // ---------- persistence ----------

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Shallow-merge so new fields in future versions get defaults.
        this.state = {
          ...defaults(),
          ...parsed,
          equipped: { ...defaults().equipped, ...(parsed.equipped || {}) },
          powerups: { ...defaults().powerups, ...(parsed.powerups || {}) },
          settings: { ...defaults().settings, ...(parsed.settings || {}) },
          stats:    { ...defaults().stats,    ...(parsed.stats    || {}) },
          player:   { ...defaults().player,   ...(parsed.player   || {}) },
          levels:   parsed.levels || {},
          owned:    Array.isArray(parsed.owned) ? parsed.owned : defaults().owned,
        };
      }
    } catch (err) {
      console.warn('[storage] could not read save, starting fresh:', err);
      this._available = false;
      this.state = defaults();
    }

    this._repairProgress();

    // Stamp the player record on first run and on every session start.
    const now = new Date().toISOString();
    if (!this.state.player.createdAt) this.state.player.createdAt = now;
    this.state.player.lastPlayed = now;
    this.save();

    return this.state;
  }

  /**
   * Reconcile the unlock marker with the cleared levels on disk.
   *
   * Two saves need this. One was written while every level was open, so it can
   * hold clears far above its `unlockedLevel` — re-locking those would take
   * levels away from a player who had already beaten them. The other is simply
   * corrupt (hand-edited, or a failed write): a missing, non-numeric or
   * out-of-range marker would otherwise lock level 1 as well.
   *
   * The rule is "one past the furthest clear, and never below 1 or above the
   * last level", so it can only ever hand back access, never remove it.
   */
  _repairProgress() {
    const cleared = Object.entries(this.state.levels)
      .filter(([, rec]) => rec && rec.cleared)
      .map(([id]) => Number(id))
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= TOTAL_LEVELS);

    const earnedFloor = cleared.length ? Math.min(Math.max(...cleared) + 1, TOTAL_LEVELS) : 1;
    const stored = Number(this.state.unlockedLevel);
    const safe = Number.isInteger(stored) ? Math.min(Math.max(stored, 1), TOTAL_LEVELS) : 1;

    this.state.unlockedLevel = Math.max(safe, earnedFloor);
  }

  save() {
    if (!this._available) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
      bus.emit(EVENTS.PROGRESS_SAVED, { state: this.state });
    } catch (err) {
      console.warn('[storage] save failed:', err);
      this._available = false;
    }
  }

  reset() {
    this.state = defaults();
    this.save();
    bus.emit(EVENTS.SAVE_RESET, { state: this.state });
    bus.emit(EVENTS.COINS_CHANGED, { coins: this.state.coins, delta: 0 });
  }

  // ---------- coins ----------

  get coins() { return this.state.coins; }

  addCoins(amount) {
    const delta = Math.max(0, Math.round(amount));
    if (!delta) return this.state.coins;
    this.state.coins += delta;
    this.save();
    bus.emit(EVENTS.COINS_CHANGED, { coins: this.state.coins, delta });
    return this.state.coins;
  }

  spendCoins(amount) {
    const cost = Math.max(0, Math.round(amount));
    if (this.state.coins < cost) return false;
    this.state.coins -= cost;
    this.save();
    bus.emit(EVENTS.COINS_CHANGED, { coins: this.state.coins, delta: -cost });
    return true;
  }

  canAfford(amount) { return this.state.coins >= amount; }

  // ---------- level progress ----------

  getLevelRecord(id) {
    return this.state.levels[id] ||
      { stars: 0, bestTime: null, bestMoves: null, cleared: false, clearCount: 0 };
  }

  /**
   * Is this level open for play?
   *
   * `unlockedLevel` is the furthest level the player has reached, and it *is* a
   * permission: level 1 on a fresh save, and one more with every first clear.
   * Everything above it is locked, so the ladder is walked in order.
   */
  isUnlocked(id) {
    const n = Number(id);
    return Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS && n <= this.state.unlockedLevel;
  }

  /**
   * Full entry check for a level.
   *
   * Refusals carry the reason so the caller can explain it rather than just
   * going dead: `unknown` for an id that is not a level at all, `locked` for a
   * real level the player has not climbed to yet. `requiredLevel` is the level
   * that has to be cleared to open it — the one immediately below.
   *
   * @returns {{ok:boolean, reason:''|'unknown'|'locked', requiredLevel:number,
   *            requiredCoins:number}}
   */
  canPlay(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_LEVELS) {
      return { ok: false, reason: 'unknown', requiredLevel: 0, requiredCoins: 0 };
    }
    if (n > this.state.unlockedLevel) {
      return { ok: false, reason: 'locked', requiredLevel: n - 1, requiredCoins: 0 };
    }
    return { ok: true, reason: '', requiredLevel: 0, requiredCoins: 0 };
  }

  /** The furthest level open for play — where "Continue" should drop the player. */
  get currentLevel() {
    return Math.min(Math.max(1, Number(this.state.unlockedLevel) || 1), TOTAL_LEVELS);
  }

  get totalStars() {
    return Object.values(this.state.levels).reduce((sum, r) => sum + (r.stars || 0), 0);
  }

  get clearedCount() {
    return Object.values(this.state.levels).filter((r) => r.cleared).length;
  }

  /**
   * Record a win: bank the best-ever stars/time/moves and unlock the next
   * level. Only ever improves an existing record.
   * @returns {{record:object, isNewStarRecord:boolean, isNewTimeRecord:boolean,
   *            unlockedLevel:number|null}}
   */
  recordWin(id, { stars, time, moves }) {
    const levelId = Number(id);
    const prev = this.getLevelRecord(levelId);
    const record = {
      cleared: true,
      stars: Math.max(prev.stars || 0, stars),
      bestTime: prev.bestTime == null ? time : Math.min(prev.bestTime, time),
      bestMoves: prev.bestMoves == null ? moves : Math.min(prev.bestMoves, moves),
      clearCount: (prev.clearCount || 0) + 1,
    };
    this.state.levels[levelId] = record;

    const isNewStarRecord = record.stars > (prev.stars || 0);
    const isNewTimeRecord = prev.bestTime != null && time < prev.bestTime;

    // Clearing a level unlocks the next one.
    let unlockedLevel = null;
    if (levelId >= this.state.unlockedLevel && levelId < TOTAL_LEVELS) {
      this.state.unlockedLevel = levelId + 1;
      unlockedLevel = this.state.unlockedLevel;
    }

    this.state.stats.gamesWon += 1;
    this.save();

    if (unlockedLevel) bus.emit(EVENTS.LEVEL_UNLOCKED, { levelId: unlockedLevel });
    return { record, isNewStarRecord, isNewTimeRecord, unlockedLevel };
  }

  recordPlay() {
    this.state.stats.gamesPlayed += 1;
    this.save();
  }

  recordMatchStats({ matches = 0, combo = 0 }) {
    this.state.stats.totalMatches += matches;
    this.state.stats.bestCombo = Math.max(this.state.stats.bestCombo, combo);
    this.save();
  }

  // ---------- inventory ----------

  owns(itemId) { return this.state.owned.includes(itemId); }

  /**
   * Buy a catalogue item.
   *
   * The caller's object is never trusted: the id is resolved against the real
   * catalogue and the **catalogue's** price is charged. That way a fabricated
   * item (a Coming Soon teaser, say) cannot be bought, and a tampered `price`
   * cannot undercut the real one. Accepts an id or an item object.
   *
   * @returns {{ok:boolean, reason?:'unknown'|'owned'|'funds'}}
   */
  purchase(item) {
    const entry = getStoreItem(typeof item === 'string' ? item : item?.id);
    if (!entry) return { ok: false, reason: 'unknown' };

    if (entry.kind !== 'powerup' && this.owns(entry.id)) return { ok: false, reason: 'owned' };
    if (!this.spendCoins(entry.price)) return { ok: false, reason: 'funds' };

    if (entry.kind === 'powerup') {
      this.addPowerup(entry.id, entry.amount || 1);
    } else {
      this.state.owned.push(entry.id);
      this.save();
    }
    bus.emit(EVENTS.ITEM_PURCHASED, { item: entry });
    return { ok: true };
  }

  equip(slot, itemId) {
    if (!this.owns(itemId)) return false;
    this.state.equipped[slot] = itemId;
    this.save();
    bus.emit(EVENTS.ITEM_EQUIPPED, { slot, itemId });
    return true;
  }

  isEquipped(slot, itemId) { return this.state.equipped[slot] === itemId; }

  // ---------- power-ups ----------

  get powerups() { return this.state.powerups; }

  powerupCount(key) { return this.state.powerups[key] || 0; }

  addPowerup(key, amount = 1) {
    this.state.powerups[key] = (this.state.powerups[key] || 0) + amount;
    this.save();
    bus.emit(EVENTS.POWERUPS_CHANGED, { powerups: this.state.powerups });
  }

  usePowerup(key) {
    if (!this.powerupCount(key)) return false;
    this.state.powerups[key] -= 1;
    this.save();
    bus.emit(EVENTS.POWERUPS_CHANGED, { powerups: this.state.powerups });
    return true;
  }

  // ---------- settings ----------

  getSetting(key) { return this.state.settings[key]; }

  setSetting(key, value) {
    this.state.settings[key] = value;
    this.save();
    bus.emit(EVENTS.SETTING_CHANGED, { key, value });
  }
}

/** Singleton save store. */
export const store = new SaveStore();
