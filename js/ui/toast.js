/**
 * toast.js — Transient bottom-of-screen messages.
 */

import { bus, EVENTS } from '../core/events.js';

const ICONS = { success: '✅', error: '⚠️', info: 'ℹ️', coin: '🪙' };

let el = null;
let hideTimer = null;
/**
 * The second stage of the hide: `.show` comes off, then `.hidden` goes on once
 * the 260ms fade has run. It has to be tracked separately — a follow-up toast
 * arriving inside that window would otherwise be hidden by the *previous*
 * toast's timer a fraction of a second after appearing.
 */
let fadeTimer = null;

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
  clearTimeout(fadeTimer);
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${ICONS[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  el.classList.remove('hidden');

  // Force a reflow so the transition runs even on back-to-back toasts.
  void el.offsetWidth;
  el.classList.add('show');

  hideTimer = setTimeout(() => {
    el.classList.remove('show');
    fadeTimer = setTimeout(() => el.classList.add('hidden'), 260);
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
