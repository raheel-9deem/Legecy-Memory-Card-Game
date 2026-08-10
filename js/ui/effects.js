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

/** How many sprites to throw for a payout — enough to feel rich, not a swarm. */
function spriteCount(amount) {
  if (amount <= 0) return 0;
  return Math.max(5, Math.min(18, Math.round(Math.sqrt(amount) * 1.6)));
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Throw coins from the board to the header's coin counter.
 *
 * Each sprite is position-fixed and travels along its own arc via the
 * `--fly-x` / `--fly-y` / `--fly-arc` custom properties, so the whole flight
 * is one GPU-composited transform per coin.
 *
 * @param {{from?:Element|DOMRect, to?:Element, amount?:number, count?:number,
 *          duration?:number, onDone?:Function}} opts
 * @returns {number} milliseconds until the last coin lands (0 if skipped)
 */
export function flyCoins({
  from,
  to = document.querySelector('.coins-pill'),
  amount = 0,
  count,
  duration = 780,
  onDone,
} = {}) {
  const n = count ?? spriteCount(amount);
  const target = to;

  // Nothing to animate, no target, or the player asked for stillness:
  // fire the callback immediately so the caller's flow never stalls.
  if (!n || !target || !from || reducedMotion()) {
    onDone?.();
    return 0;
  }

  const src = from instanceof Element ? from.getBoundingClientRect() : from;
  const dst = target.getBoundingClientRect();
  const dstX = dst.left + dst.width / 2;
  const dstY = dst.top + dst.height / 2;

  const stagger = Math.min(45, 420 / n);
  const frag = document.createDocumentFragment();
  const sprites = [];

  for (let i = 0; i < n; i++) {
    const coin = document.createElement('div');
    coin.className = 'coin-fly';
    coin.textContent = '🪙';
    coin.setAttribute('aria-hidden', 'true');

    // Scatter the launch point across the board so they do not stack.
    const startX = src.left + src.width * (0.15 + Math.random() * 0.7);
    const startY = src.top + src.height * (0.2 + Math.random() * 0.6);

    coin.style.left = `${startX}px`;
    coin.style.top = `${startY}px`;
    coin.style.setProperty('--fly-x', `${dstX - startX}px`);
    coin.style.setProperty('--fly-y', `${dstY - startY}px`);
    coin.style.setProperty('--fly-arc', `${-60 - Math.random() * 90}px`);
    coin.style.animationDuration = `${duration}ms`;
    coin.style.animationDelay = `${i * stagger}ms`;
    coin.style.fontSize = `${15 + Math.random() * 9}px`;

    frag.appendChild(coin);
    sprites.push(coin);
  }

  document.body.appendChild(frag);

  const total = duration + (n - 1) * stagger;

  // Bump the counter as the first coins actually arrive, not when they launch.
  setTimeout(() => target.classList.add('catch'), duration * 0.72);
  setTimeout(() => target.classList.remove('catch'), duration * 0.72 + 500);

  setTimeout(() => {
    sprites.forEach((c) => c.remove());
    onDone?.();
  }, total + 60);

  return total;
}
