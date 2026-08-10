/**
 * storage.js — Persistent save file (localStorage) + coin economy.
 *
 * All mutations emit events on the global bus so the header, store and
 * level select stay in sync without polling.
 */

import { bus, EVENTS } from './events.js';
import { TOTAL_LEVELS, getLevel } from './levels.js';

const SAVE_KEY = 'memory-master:save:v2';

function defaults() {
  return {
    coins: 150,
    unlockedLevel: 1,
    /** levelId -> { stars, bestTime, bestMoves, cleared } */
    levels: {},
    owned: ['back-nebula', 'auto', 'fruits'],
    equipped: { cardBack: 'back-nebula', theme: 'auto' },
    powerups: { hint: 2, freeze: 1, shuffle: 1 },
    settings: { sound: true, particles: true, hardMode: false },
    stats: { gamesPlayed: 0, gamesWon: 0, totalMatches: 0, bestCombo: 0 },
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
          levels:   parsed.levels || {},
          owned:    Array.isArray(parsed.owned) ? parsed.owned : defaults().owned,
        };
      }
    } catch (err) {
      console.warn('[storage] could not read save, starting fresh:', err);
      this._available = false;
      this.state = defaults();
    }
    return this.state;
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
    return this.state.levels[id] || { stars: 0, bestTime: null, bestMoves: null, cleared: false };
  }

  isUnlocked(id) { return Number(id) <= this.state.unlockedLevel; }

  /**
   * Full entry check for a level: progression *and* the coin balance gate.
   * `requiredCoins` is a balance you must hold, not a fee that gets spent.
   * @returns {{ok:boolean, reason:''|'locked'|'coins', requiredCoins:number}}
   */
  canPlay(id) {
    const requiredCoins = getLevel(id).requiredCoins || 0;
    if (!this.isUnlocked(id)) return { ok: false, reason: 'locked', requiredCoins };
    if (this.state.coins < requiredCoins) return { ok: false, reason: 'coins', requiredCoins };
    return { ok: true, reason: '', requiredCoins };
  }

  get totalStars() {
    return Object.values(this.state.levels).reduce((sum, r) => sum + (r.stars || 0), 0);
  }

  get clearedCount() {
    return Object.values(this.state.levels).filter((r) => r.cleared).length;
  }

  /** Record a win; only improves existing bests. */
  recordWin(id, { stars, time, moves }) {
    const levelId = Number(id);
    const prev = this.getLevelRecord(levelId);
    const record = {
      cleared: true,
      stars: Math.max(prev.stars || 0, stars),
      bestTime: prev.bestTime == null ? time : Math.min(prev.bestTime, time),
      bestMoves: prev.bestMoves == null ? moves : Math.min(prev.bestMoves, moves),
    };
    this.state.levels[levelId] = record;

    const isNewStarRecord = record.stars > (prev.stars || 0);
    if (levelId >= this.state.unlockedLevel && levelId < TOTAL_LEVELS) {
      this.state.unlockedLevel = levelId + 1;
    }
    this.state.stats.gamesWon += 1;
    this.save();
    return { record, isNewStarRecord };
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

  purchase(item) {
    if (item.kind !== 'powerup' && this.owns(item.id)) return { ok: false, reason: 'owned' };
    if (!this.spendCoins(item.price)) return { ok: false, reason: 'funds' };

    if (item.kind === 'powerup') {
      this.addPowerup(item.id, item.amount || 1);
    } else {
      this.state.owned.push(item.id);
      this.save();
    }
    bus.emit(EVENTS.ITEM_PURCHASED, { item });
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
