/**
 * store.js — Shop screen: card backs, themes, power-ups and a Coming Soon teaser.
 */

import { store } from '../core/storage.js';
import {
  STORE_ITEMS, STORE_TABS, COMING_SOON, getCardBack, getTheme, AUTO_THEME,
  POWERUP_META,
} from '../data/store-items.js';
import { bus, EVENTS } from '../core/events.js';
import { header } from '../ui/header.js';
import { audio } from '../ui/audio.js';
import { toast, escapeHtml } from '../ui/toast.js';

const SLOT_FOR_KIND = { cardBack: 'cardBack', theme: 'theme' };
/** The teaser tab has no stock, so it renders its own body. */
const SOON_TAB = 'soon';

let activeTab = 'cardBack';
let unsubs = [];
let rootEl = null;
/**
 * One body repaint per frame. A single purchase emits COINS_CHANGED *and*
 * POWERUPS_CHANGED and then calls refresh() directly, so the grid was being
 * rebuilt three times — and each rebuild restarts every card's entrance
 * animation, which read as a flicker.
 */
let refreshRaf = null;

export default {
  title: 'Store',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },

  render() {
    const tabs = STORE_TABS.map(
      (t) => `<button class="store-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');

    return `
      <div class="screen-head">
        <h2 class="text-grad">${activeTab === SOON_TAB ? 'Store — Coming Soon' : 'Store'}</h2>
        <p id="store-blurb">${storeBlurb()}</p>
      </div>
      <div class="store-tabs">${tabs}</div>
      <div class="scroll-y" style="flex:1;min-height:0">
        <div id="store-body">${renderBody()}</div>
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
        syncHead();
        refresh();
        return;
      }

      // Teaser cards look like stock but are not for sale — say so out loud
      // rather than letting a click land on nothing.
      const soonCard = e.target.closest('[data-soon]');
      if (soonCard) {
        audio.play('error');
        const item = COMING_SOON.find((i) => i.id === soonCard.dataset.soon);
        toast(`${item ? item.name : 'That'} isn’t available yet — ${item?.eta || 'soon'}`, 'info', 2000);
        return;
      }

      const buyBtn = e.target.closest('[data-buy]');
      if (buyBtn) return handleBuy(buyBtn.dataset.buy);

      const equipBtn = e.target.closest('[data-equip]');
      if (equipBtn) return handleEquip(equipBtn.dataset.equip);
    };

    const onSubmit = (e) => {
      const form = e.target.closest('#notify-form');
      if (!form) return;
      e.preventDefault();               // no backend — nothing leaves the device
      handleSubscribe(form);
    };

    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    unsubs.push(
      () => el.removeEventListener('click', onClick),
      () => el.removeEventListener('submit', onSubmit),
      bus.on(EVENTS.COINS_CHANGED, refreshStock),
      bus.on(EVENTS.POWERUPS_CHANGED, refreshStock)
    );
  },

  unmount() {
    unsubs.forEach((fn) => fn());
    unsubs = [];
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = null;
    rootEl = null;
  },
};

/* ---------- rendering ---------- */

function storeBlurb() {
  return activeTab === SOON_TAB
    ? 'A look at what’s being built next'
    : 'Spend coins on new looks and power-ups';
}

/** The head text changes with the tab, so re-render it in place. */
function syncHead() {
  const h2 = rootEl?.querySelector('.screen-head h2');
  const blurb = rootEl?.querySelector('#store-blurb');
  if (h2) h2.textContent = activeTab === SOON_TAB ? 'Store — Coming Soon' : 'Store';
  if (blurb) blurb.textContent = storeBlurb();
}

function renderBody() {
  return activeTab === SOON_TAB
    ? renderComingSoon()
    : `<div class="store-grid" id="store-grid">${renderItems()}</div>`;
}

function renderComingSoon() {
  const cards = COMING_SOON.map((item, index) => `
    <article class="store-item soon-item" data-soon="${item.id}"
             style="animation-delay:${Math.min(index * 60, 400)}ms"
             aria-disabled="true">
      <span class="badge-tag soon-tag">Coming Soon</span>
      <div class="store-preview soon-preview">
        <span class="soon-icon">${item.icon}</span>
      </div>
      <h3 class="store-name">${escapeHtml(item.name)}</h3>
      <p class="store-desc">${escapeHtml(item.desc)}</p>
      <div class="store-foot">
        <span class="store-price soon-price">🪙 ${item.price}</span>
        <span class="soon-eta">${escapeHtml(item.eta)}</span>
      </div>
    </article>
  `).join('');

  const subscribed = store.getSetting('notifyUpdates') === true;

  return `
    <div class="construction-banner" role="status">
      <div class="construction-stripes" aria-hidden="true"></div>
      <div class="construction-text">
        <span class="cone" aria-hidden="true">🚧</span>
        <span>Under Construction</span>
        <span class="cone right" aria-hidden="true">🚧</span>
      </div>
    </div>

    <div class="store-grid soon-grid">${cards}</div>

    ${renderNotify(subscribed)}
  `;
}

function renderNotify(subscribed) {
  if (subscribed) {
    return `
      <div class="notify-teaser subscribed" id="notify-teaser">
        <span class="notify-icon">✅</span>
        <div class="notify-copy">
          <h4>You’re on the list</h4>
          <p>We’ll flag new drops right here on this screen.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="notify-teaser" id="notify-teaser">
      <span class="notify-icon">✉️</span>
      <div class="notify-copy">
        <h4>Notify me when these drop</h4>
        <p>Saved on this device only — there is no server to send it to.</p>
        <form id="notify-form" class="notify-form" novalidate>
          <input id="notify-input" class="notify-input" type="email" inputmode="email"
                 placeholder="you@example.com" aria-label="Email address" autocomplete="email">
          <button class="store-btn notify-btn" type="submit">Subscribe</button>
        </form>
      </div>
    </div>
  `;
}

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
    const useCost = POWERUP_META[item.id]?.useCost || 0;
    return `
      <div class="store-price-col">
        <span class="store-price">🪙 ${item.price}</span>
        ${useCost ? `<span class="store-usecost">🪙 ${useCost} per use</span>` : ''}
      </div>
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
  if (refreshRaf) return;
  refreshRaf = requestAnimationFrame(() => {
    refreshRaf = null;
    const body = rootEl?.querySelector('#store-body');
    if (body) body.innerHTML = renderBody();
  });
}

/**
 * The balance-driven repaint. It skips the teaser tab on purpose: nothing there
 * is priced against the wallet, but it does hold the notify form, and blowing
 * `#store-body` away mid-sentence would take a half-typed address with it.
 */
function refreshStock() {
  if (activeTab === SOON_TAB) return;
  refresh();
}

/* ---------- actions ---------- */

/**
 * There is no backend: the address is validated for shape, the *preference* is
 * saved, and the address itself is deliberately never stored or transmitted.
 */
function handleSubscribe(form) {
  const input = form.querySelector('#notify-input');
  const value = (input?.value || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    audio.play('error');
    toast('That doesn’t look like an email address', 'error');
    input?.focus();
    return;
  }

  store.setSetting('notifyUpdates', true);
  audio.play('coin');
  toast('You’re on the list — thanks!', 'success');
  refresh();
}

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
