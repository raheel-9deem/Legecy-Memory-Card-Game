/**
 * store-items.js — Everything purchasable, plus card backs and power-up metadata.
 *
 * Symbol sets live in themes.js; this module only decides which of them are
 * for sale and at what price.
 */

import { THEMES, THEME_IDS, getTheme } from './themes.mjs';

export { THEMES, THEME_IDS, getTheme };

/** The default theme option: a different set is drawn every level. */
export const AUTO_THEME = 'auto';

/** Card back visual styles. `css` is applied inline to the face-down side. */
export const CARD_BACKS = {
  'back-nebula': {
    id: 'back-nebula', name: 'Nebula', icon: '✦',
    css: 'linear-gradient(135deg, #8b3dff 0%, #00e5ff 100%)',
  },
  'back-magma': {
    id: 'back-magma', name: 'Magma', icon: '🔥',
    css: 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
  },
  'back-aurora': {
    id: 'back-aurora', name: 'Aurora', icon: '❄',
    css: 'linear-gradient(135deg, #00f5a0 0%, #00d9f5 100%)',
  },
  'back-midnight': {
    id: 'back-midnight', name: 'Midnight', icon: '🌙',
    css: 'linear-gradient(135deg, #232b5d 0%, #6a3093 100%)',
  },
  'back-gold': {
    id: 'back-gold', name: 'Royal Gold', icon: '👑',
    css: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
  },
};

/**
 * Store catalogue.
 * kind: 'cardBack' | 'theme' | 'powerup'
 * Theme ids match the keys in themes.js so equipping needs no translation.
 */
export const STORE_ITEMS = [
  // ---- Card backs ----
  { id: 'back-nebula',   kind: 'cardBack', name: 'Nebula',     desc: 'The classic purple-cyan shimmer.',     price: 0,   icon: '✦',  badge: null },
  { id: 'back-magma',    kind: 'cardBack', name: 'Magma',      desc: 'Molten reds for a hot streak.',        price: 250, icon: '🔥', badge: null },
  { id: 'back-aurora',   kind: 'cardBack', name: 'Aurora',     desc: 'Cool mint glow from the north.',       price: 350, icon: '❄',  badge: null },
  { id: 'back-midnight', kind: 'cardBack', name: 'Midnight',   desc: 'Deep indigo, easy on the eyes.',       price: 450, icon: '🌙', badge: null },
  { id: 'back-gold',     kind: 'cardBack', name: 'Royal Gold', desc: 'For players who finished everything.', price: 900, icon: '👑', badge: 'rare' },

  // ---- Themes ----
  { id: 'auto',      kind: 'theme', name: 'Surprise Me',   desc: 'A random emoji set every single level.',    price: 0,   icon: '🎲', badge: 'default' },
  { id: 'fruits',    kind: 'theme', name: 'Fruit Basket',  desc: 'Bright, friendly, easy to tell apart.',     price: 0,   icon: '🍓', badge: null },
  { id: 'animals',   kind: 'theme', name: 'Wild Kingdom',  desc: 'A zoo of unmistakable faces.',              price: 200, icon: '🦊', badge: null },
  { id: 'space',     kind: 'theme', name: 'Deep Space',    desc: 'Rockets, planets and stray asteroids.',     price: 250, icon: '🚀', badge: null },
  { id: 'food',      kind: 'theme', name: 'Snack Bar',     desc: 'Everything you shouldn’t eat at 2am.',      price: 250, icon: '🍕', badge: null },
  { id: 'sports',    kind: 'theme', name: 'Sports Day',    desc: 'Balls, bats and one very smug medal.',      price: 300, icon: '⚽', badge: null },
  { id: 'tech',      kind: 'theme', name: 'Cyber Deck',    desc: 'Gadgets and gizmos for the wired.',         price: 350, icon: '🤖', badge: null },
  { id: 'transport', kind: 'theme', name: 'On the Move',   desc: 'Wheels, wings and one cable car.',          price: 350, icon: '🚗', badge: null },
  { id: 'nature',    kind: 'theme', name: 'Garden',        desc: 'Leaves and petals — greener than most.',    price: 400, icon: '🌻', badge: null },
  { id: 'weather',   kind: 'theme', name: 'Forecast',      desc: 'Sun, storms and a stubborn rainbow.',       price: 400, icon: '🌈', badge: null },
  { id: 'music',     kind: 'theme', name: 'Sound Stage',   desc: 'Instruments and notes for the tuneful.',    price: 450, icon: '🎵', badge: null },
  { id: 'shapes',    kind: 'theme', name: 'Neon Shapes',   desc: 'Abstract colour blocks — a real test.',     price: 600, icon: '🔷', badge: 'hard' },
  { id: 'flags',     kind: 'theme', name: 'World Flags',   desc: 'Stripes on stripes. Brutally hard.',        price: 750, icon: '🏳️', badge: 'hard' },

  // ---- Power-ups (consumable) ----
  { id: 'hint',    kind: 'powerup', name: 'Reveal ×3',  desc: 'Peek at every face for 1.5 seconds.', price: 120, icon: '👁️', amount: 3, badge: null },
  { id: 'freeze',  kind: 'powerup', name: 'Freeze ×2',  desc: 'Stop the clock for 10 seconds.',      price: 150, icon: '🧊',  amount: 2, badge: null },
  { id: 'shuffle', kind: 'powerup', name: 'Shuffle ×2', desc: 'Rearrange the unmatched cards.',      price: 100, icon: '🔀',  amount: 2, badge: null },
];

export const STORE_TABS = [
  { key: 'cardBack', label: 'Card Backs' },
  { key: 'theme',    label: 'Themes' },
  { key: 'powerup',  label: 'Power-ups' },
];

export const POWERUP_META = {
  hint:    { name: 'Reveal',  icon: '👁️', duration: 1500 },
  freeze:  { name: 'Freeze',  icon: '🧊',  duration: 10000 },
  shuffle: { name: 'Shuffle', icon: '🔀',  duration: 0 },
};

export function getCardBack(id) {
  return CARD_BACKS[id] || CARD_BACKS['back-nebula'];
}

export function getStoreItem(id) {
  return STORE_ITEMS.find((i) => i.id === id) || null;
}

/** Display name for an equipped theme id, including the Auto option. */
export function themeLabel(id) {
  if (id === AUTO_THEME) return 'Surprise Me';
  return getTheme(id).name;
}
