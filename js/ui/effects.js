/**
 * effects.js — One-off visual flourishes (confetti, combo text).
 */

const CONFETTI_COLORS = ['#8b3dff', '#00e5ff', '#f13ce0', '#ffc93c', '#37e2a0', '#ffffff'];

/** Rain confetti from the top of the viewport. */
export function confetti({ count = 90, duration = 2600 } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const frag = document.createDocumentFragment();
  const pieces = [];

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 8;
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (1 + Math.random())}px`;
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.borderRadius = Math.random() > 0.6 ? '50%' : '2px';
    piece.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.opacity = String(0.7 + Math.random() * 0.3);
    frag.appendChild(piece);
    pieces.push(piece);
  }

  document.body.appendChild(frag);
  setTimeout(() => pieces.forEach((p) => p.remove()), duration + 800);
}

/** Flash a big gradient word (e.g. "COMBO ×4") over the board. */
export function comboFlash(text) {
  const el = document.createElement('div');
  el.className = 'combo-flash';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}
