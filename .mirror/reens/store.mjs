/**
 * store.js — Shop screen: card backs, themes and power-ups.
 */

import { store } from '../core/storage.mjs';
import { STORE_ITEMS, STORE_TABS, getCardBack, getTheme, AUTO_THEME } from '../data/store-items.mjs';
import { bus, EVENTS } from '../core/events.mjs';
import { header } from '../ui/header.mjs';
import { audio } from '../ui/audio.mjs';
import { toast, escapeHtml } from '../ui/toast.mjs';

const SLOT_FOR_KIND = { cardBack: 'cardBack', theme: 'theme' };

let activeTab = 'cardBack';
let unsubs = [];
let rootEl = null;

export default {
  title: 'Store',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render() {
    const tabs = STORE_TABS.map(
      (t) => `<button class="store-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');

    return `
      <div class="screen-head">
        <h2 class="text-grad">Store</h2>
        <p>Spend coins on new looks and power-ups</p>
      </div>
      <div class="store-tabs">${tabs}</div>
      <div class="scroll-y" style="flex:1;min-height:0">
        <div class="store-grid" id="store-grid">${renderItems()}</div>
      </div>
    `;
  },

  mount(el, params, router) {
    rootEl = el;
    header.setLevel(store.state.unlockedLevel);

    const onClick = (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        activeTab = tab.dataset.tab;
        audio.play('click');
        el.querySelectorAll('[data-tab]').forEach((t) =>
          t.classList.toggle('active', t.dataset.tab === activeTab)
        );
        refresh();
        return;
      }

      const buyBtn = e.target.closest('[data-buy]');
      if (buyBtn) return handleBuy(buyBtn.dataset.buy);

      const equipBtn = e.target.closest('[data-equip]');
      if (equipBtn) return handleEquip(equipBtn.dataset.equip);
    };

    el.addEventListener('click', onClick);
    unsubs.push(
      () => el.removeEventListener('click', onClick),
      bus.on(EVENTS.COINS_CHANGED, refresh),
      bus.on(EVENTS.POWERUPS_CHANGED, refresh)
    );
  },

  unmount() {
    unsubs.forEach((fn) => fn());
    unsubs = [];
    rootEl = null;
  },
};

/* ---------- rendering ---------- */

function renderItems() {
  return STORE_ITEMS.filter((i) => i.kind === activeTab)
    .map((item, index) => {
      const owned = item.kind === 'powerup' ? false : store.owns(item.id);
      const slot = SLOT_FOR_KIND[item.kind];
      const equipped = slot ? store.isEquipped(slot, item.id) : false;
      const affordable = store.canAfford(item.price);

      const classes = ['store-item'];
      if (owned) classes.push('owned');
      if (equipped) classes.push('equipped');

      return `
        <article class="${classes.join(' ')}" style="animation-delay:${Math.min(index * 45, 400)}ms">
          ${item.badge ? `<span class="badge-tag">${item.badge}</span>` : ''}
          <div class="store-preview" style="${previewStyle(item)}">${previewContent(item)}</div>
          <h3 class="store-name">${escapeHtml(item.name)}</h3>
          <p class="store-desc">${escapeHtml(item.desc)}</p>
          <div class="store-foot">
            ${footer(item, { owned, equipped, affordable })}
          </div>
        </article>
      `;
    })
    .join('');
}

function previewStyle(item) {
  if (item.kind === 'cardBack') return `background:${getCardBack(item.id).css}`;
  return '';
}

function previewContent(item) {
  if (item.kind === 'cardBack') {
    return `<span style="font-size:2rem;filter:drop-shadow(0 0 10px rgba(255,255,255,.7))">${getCardBack(item.id).icon}</span>`;
  }
  if (item.kind === 'theme') {
    // The Auto option has no symbol set of its own — show a mixed sample.
    const sample = item.id === AUTO_THEME
      ? ['🎲', '🍓', '🚀', '🦊']
      : getTheme(item.id).symbols.slice(0, 4);
    return `<span style="font-size:1.6rem;letter-spacing:2px">${sample.join(' ')}</span>`;
  }
  const count = store.powerupCount(item.id);
  return `<span style="font-size:2rem">${item.icon}</span>
          <span style="position:absolute;bottom:6px;font-size:.62rem;letter-spacing:.1em;color:var(--text-muted)">OWNED: ${count}</span>`;
}

function footer(item, { owned, equipped, affordable }) {
  if (item.kind === 'powerup') {
    return `
      <span class="store-price">🪙 ${item.price}</span>
      <button class="store-btn" data-buy="${item.id}" ${affordable ? '' : 'disabled'}>Buy</button>
    `;
  }
  if (equipped) {
    return `<span class="store-price" style="color:var(--green)">Equipped</span>
            <button class="store-btn equipped-btn" disabled>✓ Active</button>`;
  }
  if (owned) {
    return `<span class="store-price" style="color:var(--text-muted)">Owned</span>
            <button class="store-btn" data-equip="${item.id}">Equip</button>`;
  }
  return `
    <span class="store-price">🪙 ${item.price}</span>
    <button class="store-btn" data-buy="${item.id}" ${affordable ? '' : 'disabled'}>Buy</button>
  `;
}

function refresh() {
  const grid = rootEl?.querySelector('#store-grid');
  if (grid) grid.innerHTML = renderItems();
}

/* ---------- actions ---------- */

function handleBuy(itemId) {
  const item = STORE_ITEMS.find((i) => i.id === itemId);
  if (!item) return;

  const result = store.purchase(item);
  if (!result.ok) {
    audio.play('error');
    toast(result.reason === 'funds' ? 'Not enough coins' : 'Already owned', 'error');
    return;
  }

  audio.play('coin');
  if (item.kind === 'powerup') {
    toast(`${item.name} added to your kit`, 'success');
  } else {
    const slot = SLOT_FOR_KIND[item.kind];
    store.equip(slot, item.id);
    toast(`${item.name} purchased and equipped`, 'success');
  }
  refresh();
}

function handleEquip(itemId) {
  const item = STORE_ITEMS.find((i) => i.id === itemId);
  if (!item) return;
  const slot = SLOT_FOR_KIND[item.kind];
  if (store.equip(slot, item.id)) {
    audio.play('click');
    toast(`${item.name} equipped`, 'success', 1600);
    refresh();
  }
}
