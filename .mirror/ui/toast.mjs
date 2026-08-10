/**
 * toast.js — Transient bottom-of-screen messages.
 */

import { bus, EVENTS } from '../core/events.mjs';

const ICONS = { success: '✅', error: '⚠️', info: 'ℹ️', coin: '🪙' };

let el = null;
let hideTimer = null;

export function initToast() {
  el = document.getElementById('toast');
  bus.on(EVENTS.TOAST, (e) => toast(e.detail.message, e.detail.type, e.detail.duration));
  return el;
}

/**
 * @param {string} message
 * @param {'success'|'error'|'info'|'coin'} type
 * @param {number} duration ms
 */
export function toast(message, type = 'info', duration = 2400) {
  if (!el) el = document.getElementById('toast');
  if (!el) return;

  clearTimeout(hideTimer);
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${ICONS[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  el.classList.remove('hidden');

  // Force a reflow so the transition runs even on back-to-back toasts.
  void el.offsetWidth;
  el.classList.add('show');

  hideTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 260);
  }, duration);
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
