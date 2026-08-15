/**
 * particles.js — Animated floating-particle background.
 *
 * Soft neon orbs drift upward with a gentle sway, plus a light
 * parallax response to the pointer. Pauses when the tab is hidden,
 * and switches off entirely for reduced-motion or via settings.
 */

import { bus, EVENTS } from '../core/events.js';
import { store } from '../core/storage.js';

const COLORS = [
  'rgba(139, 61, 255,',   // purple
  'rgba(0, 229, 255,',    // cyan
  'rgba(241, 60, 224,',   // pink
  'rgba(176, 124, 255,',  // light purple
];

/**
 * Orbs are drawn from pre-rendered sprites rather than a fresh
 * createRadialGradient() per particle per frame. At 70 particles and 60fps that
 * was ~4200 gradient objects a second, all of them identical bar their radius —
 * easily the most expensive thing on an otherwise idle page. Each sprite is one
 * colour at one quantised radius, tinted white-hot at the core, and the per-frame
 * twinkle is applied with globalAlpha instead of rebuilding the gradient.
 */
const SPRITE_STEPS = 8;      // radius buckets between MIN and MAX
const SPRITE_MIN_R = 1.2;
const SPRITE_MAX_R = 4.6;

function buildSprite(color, radius) {
  const glow = radius * 5;
  const size = Math.ceil(glow * 2) + 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  const mid = size / 2;

  const grad = c.createRadialGradient(mid, mid, 0, mid, mid, glow);
  grad.addColorStop(0, `${color} 1)`);
  grad.addColorStop(0.45, `${color} 0.28)`);
  grad.addColorStop(1, `${color} 0)`);
  c.fillStyle = grad;
  c.beginPath();
  c.arc(mid, mid, glow, 0, Math.PI * 2);
  c.fill();

  // The bright core, baked in so the draw loop is a single drawImage.
  c.fillStyle = 'rgba(255, 255, 255, 0.75)';
  c.beginPath();
  c.arc(mid, mid, radius * 0.42, 0, Math.PI * 2);
  c.fill();

  return { canvas, size, half: mid };
}

class ParticleField {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.raf = null;
    this.enabled = true;
    this.pointer = { x: 0.5, y: 0.5 };
    this.dpr = 1;
    /** `${colorIndex}:${radiusBucket}` -> pre-rendered orb. Built on demand. */
    this.sprites = new Map();
    this._resizeRaf = null;
    this._unsubs = [];
  }

  init(canvasId = 'particle-canvas') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return this;
    this.ctx = this.canvas.getContext('2d');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.enabled = store.getSetting('particles') !== false && !reduced;

    this.resize();

    // Coalesce resize storms to one canvas rebuild per frame: each one reallocates
    // the backing store, and doing it per event stalls a window drag.
    this._onResize = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this.resize();
      });
    };
    window.addEventListener('resize', this._onResize);

    window.addEventListener('pointermove', this._onPointer = (e) => {
      this.pointer.x = e.clientX / window.innerWidth;
      this.pointer.y = e.clientY / window.innerHeight;
    }, { passive: true });

    this._onVisibility = () => {
      document.hidden ? this.stop() : this.start();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._unsubs.push(bus.on(EVENTS.SETTING_CHANGED, (e) => {
      if (e.detail.key !== 'particles') return;
      this.enabled = !!e.detail.value;
      this.enabled ? this.start() : this.clearAndStop();
    }));

    this.start();
    return this;
  }

  /** Nearest pre-rendered orb for a colour/radius, built once and reused. */
  sprite(colorIndex, radius) {
    const t = (radius - SPRITE_MIN_R) / (SPRITE_MAX_R - SPRITE_MIN_R);
    const bucket = Math.max(0, Math.min(SPRITE_STEPS - 1, Math.round(t * (SPRITE_STEPS - 1))));
    const key = `${colorIndex}:${bucket}`;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const r = SPRITE_MIN_R + (bucket / (SPRITE_STEPS - 1)) * (SPRITE_MAX_R - SPRITE_MIN_R);
      sprite = buildSprite(COLORS[colorIndex], r);
      this.sprites.set(key, sprite);
    }
    return sprite;
  }

  /** Particle count scales with viewport so phones stay smooth. */
  get targetCount() {
    const area = window.innerWidth * window.innerHeight;
    return Math.max(18, Math.min(70, Math.round(area / 26000)));
  }

  resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    // Deliberately no spawn() here. Re-seeding the field re-scattered every orb
    // on each resize event, so dragging a window edge looked like the background
    // teleporting. update() already tops the count up or trims it to whatever the
    // new viewport asks for, one particle at a time.
    if (!this.particles.length) this.spawn();
  }

  spawn() {
    const count = this.targetCount;
    this.particles = Array.from({ length: count }, () => this.makeParticle(true));
  }

  makeParticle(scatter = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const colorIndex = Math.floor(Math.random() * COLORS.length);
    const r = SPRITE_MIN_R + Math.random() * (SPRITE_MAX_R - SPRITE_MIN_R);
    return {
      x: Math.random() * w,
      y: scatter ? Math.random() * h : h + 20,
      r,
      speed: 0.12 + Math.random() * 0.55,
      drift: (Math.random() - 0.5) * 0.35,
      phase: Math.random() * Math.PI * 2,
      swayAmp: 6 + Math.random() * 22,
      alpha: 0.18 + Math.random() * 0.5,
      twinkle: 0.4 + Math.random() * 1.6,
      color: COLORS[colorIndex],
      // Resolved once at birth so the draw loop is a property read, not a lookup.
      img: this.sprite(colorIndex, r),
      depth: 0.3 + Math.random() * 0.7,       // parallax weight
    };
  }

  start() {
    if (!this.enabled || !this.ctx || this.raf) return;
    this.lastTime = performance.now();
    const loop = (now) => {
      const dt = Math.min(48, now - this.lastTime);
      this.lastTime = now;
      this.update(dt, now);
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  clearAndStop() {
    this.stop();
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  update(dt, now) {
    const w = window.innerWidth;
    const step = dt / 16.67;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y -= p.speed * step;
      p.x += p.drift * step;
      p.phase += 0.012 * step;

      if (p.y < -30 || p.x < -40 || p.x > w + 40) {
        this.particles[i] = this.makeParticle(false);
      }
    }

    // Keep the count in step with viewport changes.
    const target = this.targetCount;
    while (this.particles.length < target) this.particles.push(this.makeParticle(false));
    if (this.particles.length > target) this.particles.length = target;
  }

  draw(now) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const px = (this.pointer.x - 0.5) * 26;
    const py = (this.pointer.y - 0.5) * 26;

    for (const p of this.particles) {
      const sway = Math.sin(p.phase) * p.swayAmp;
      const x = p.x + sway + px * p.depth;
      const y = p.y + py * p.depth;
      const pulse = 0.72 + 0.28 * Math.sin(now / 700 * p.twinkle + p.phase);

      // One drawImage of a cached sprite, with the twinkle expressed as opacity.
      const s = p.img;
      ctx.globalAlpha = Math.min(1, p.alpha * pulse);
      ctx.drawImage(s.canvas, x - s.half, y - s.half);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  destroy() {
    this.stop();
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = null;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointer);
    // Registered anonymously once, which meant a re-init stacked a second handler
    // that outlived the field and kept restarting it.
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];
    this.sprites.clear();
    this.particles = [];
  }
}

/** Singleton background field. */
export const particles = new ParticleField();
