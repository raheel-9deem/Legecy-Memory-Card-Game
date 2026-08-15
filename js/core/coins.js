/**
 * coins.js — The coin economy: what a round pays, and where it is banked.
 *
 * One earning rule, in one place, so the engine and the win screen can never
 * disagree about a payout:
 *
 *   base           10 coins for clearing the level
 *   time bonus     +5 coins for every second still on the clock
 *   combo bonus    +2 coins for every combo match (a match that extended a
 *                  streak — the 2nd, 3rd, … consecutive match without a miss)
 *   hard mode      +25% on the sum of the three above
 *
 * Persistence deliberately reuses the single save file owned by storage.js
 * rather than opening a second localStorage key. Two keys would let the header
 * and the bank drift apart after a failed write.
 */

import { store } from './storage.js';
import { bus, EVENTS } from './events.js';

/** The payout rates. Tweak here and every screen follows. */
export const COIN_RULES = Object.freeze({
  base: 10,
  perSecondLeft: 5,
  perComboMatch: 2,
  /** Hard mode multiplies the whole payout by this. */
  hardModeMultiplier: 1.25,
});

/**
 * What a finished round is worth.
 *
 * The hard-mode bonus is applied here rather than by the caller so the itemised
 * rows on the win screen still add up to the headline figure. When the gameplay
 * screen multiplied the total afterwards, `coinBreakdown()` listed the
 * unboosted lines under a boosted total and the sum visibly disagreed.
 *
 * @param {{timeLeft?:number, comboMatches?:number, won?:boolean, hardMode?:boolean}} round
 * @returns {{base:number, time:number, combo:number, bonus:number, total:number,
 *            seconds:number, combos:number, hardMode:boolean}}
 */
export function calculateCoins({ timeLeft = 0, comboMatches = 0, won = true, hardMode = false } = {}) {
  // A loss pays nothing — the clock ran out, there is no bonus to bank.
  if (!won) {
    return { base: 0, time: 0, combo: 0, bonus: 0, total: 0, seconds: 0, combos: 0, hardMode: !!hardMode };
  }

  const seconds = Math.max(0, Math.floor(timeLeft));
  const combos  = Math.max(0, Math.floor(comboMatches));

  const base  = COIN_RULES.base;
  const time  = seconds * COIN_RULES.perSecondLeft;
  const combo = combos * COIN_RULES.perComboMatch;

  const earned = base + time + combo;
  const bonus = hardMode
    ? Math.round(earned * COIN_RULES.hardModeMultiplier) - earned
    : 0;

  return {
    base, time, combo, bonus,
    total: earned + bonus,
    seconds, combos,
    hardMode: !!hardMode,
  };
}

/**
 * Itemised rows for the win screen, skipping any line worth nothing.
 * @param {ReturnType<typeof calculateCoins>} purse
 */
export function coinBreakdown(purse) {
  const rows = [{ label: 'Level cleared', detail: 'base', value: purse.base }];

  if (purse.time) {
    rows.push({
      label: 'Time bonus',
      detail: `${purse.seconds}s left × ${COIN_RULES.perSecondLeft}`,
      value: purse.time,
    });
  }
  if (purse.combo) {
    rows.push({
      label: 'Combo bonus',
      detail: `${purse.combos} combo match${purse.combos === 1 ? '' : 'es'} × ${COIN_RULES.perComboMatch}`,
      value: purse.combo,
    });
  }
  if (purse.bonus) {
    rows.push({
      label: 'Hard mode',
      detail: `+${Math.round((COIN_RULES.hardModeMultiplier - 1) * 100)}% on a tighter clock`,
      value: purse.bonus,
    });
  }
  return rows;
}

/**
 * The player's purse. A thin, event-emitting face over the save file so
 * screens never poke at `store.state.coins` directly.
 */
class CoinBank {
  /** Current balance, restored from localStorage on boot. */
  get total() { return store.coins; }

  /** Every coin ever earned, across all sessions. */
  get lifetimeEarned() { return store.state.player.totalCoinsEarned || 0; }

  canAfford(amount) { return store.canAfford(amount); }

  /**
   * Bank a payout and persist it. Emits `coins:earned` so the UI can fly the
   * coins across to the counter; `coins:changed` follows from the store.
   * @param {number} amount
   * @param {{levelId?:number, purse?:object, origin?:string}} meta
   * @returns {number} the new balance
   */
  award(amount, meta = {}) {
    const delta = Math.max(0, Math.round(amount));
    if (!delta) return this.total;

    store.state.player.totalCoinsEarned = this.lifetimeEarned + delta;
    const total = store.addCoins(delta);          // saves + emits COINS_CHANGED
    bus.emit(EVENTS.COINS_EARNED, { amount: delta, total, ...meta });
    return total;
  }

  /** @returns {boolean} false when the balance is too low. */
  spend(amount) { return store.spendCoins(amount); }
}

/** Shared purse. */
export const coinBank = new CoinBank();
