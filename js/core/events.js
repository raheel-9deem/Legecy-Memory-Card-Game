/**
 * events.js — Global event bus.
 *
 * A thin wrapper over EventTarget so every module can speak the same
 * event-driven language without importing each other directly.
 */

export const EVENTS = {
  // Navigation
  NAVIGATE:        'nav:navigate',
  SCREEN_ENTER:    'nav:screen-enter',
  SCREEN_LEAVE:    'nav:screen-leave',

  // Economy / progress
  COINS_CHANGED:   'save:coins-changed',
  COINS_EARNED:    'save:coins-earned',
  LEVEL_UNLOCKED:  'save:level-unlocked',
  PROGRESS_SAVED:  'save:progress-saved',
  ITEM_PURCHASED:  'save:item-purchased',
  ITEM_EQUIPPED:   'save:item-equipped',
  POWERUPS_CHANGED:'save:powerups-changed',
  SETTING_CHANGED: 'save:setting-changed',
  SAVE_RESET:      'save:reset',

  // Game lifecycle
  GAME_INIT:       'game:init',
  GAME_START:      'game:start',
  GAME_PAUSE:      'game:pause',
  GAME_RESUME:     'game:resume',
  GAME_RESET:      'game:reset',
  TIMER_START:     'game:timer-start',
  GAME_TICK:       'game:tick',
  GAME_PROGRESS:   'game:progress',
  GAME_OVER:       'game:over',

  // Board interaction
  CARD_FLIP:       'card:flip',
  CARD_UNFLIP:     'card:unflip',
  PAIR_MATCH:      'pair:match',
  PAIR_MISMATCH:   'pair:mismatch',
  BOARD_SHUFFLE:   'board:shuffle',
  POWERUP_USED:    'powerup:used',
  HINT_SHOW:       'hint:show',
  HINT_HIDE:       'hint:hide',

  // UI
  TOAST:           'ui:toast',
};

export class EventBus extends EventTarget {
  /** Dispatch a CustomEvent carrying `detail`. */
  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    return this;
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(type, handler, options) {
    this.addEventListener(type, handler, options);
    return () => this.removeEventListener(type, handler, options);
  }

  /** Subscribe for a single dispatch. */
  once(type, handler) {
    return this.on(type, handler, { once: true });
  }

  off(type, handler, options) {
    this.removeEventListener(type, handler, options);
    return this;
  }
}

/** App-wide singleton bus. */
export const bus = new EventBus();
