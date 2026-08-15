/**
 * particles.js — Animated floating-particle background.
 *
 * Soft neon orbs drift upward with a gentle sway, plus a light
 * parallax response to the pointer. Pauses when the tab is hidden,
 * and switches off entirely for reduced-motion or via settings.
 */

import { bus, EVENTS } from '../core/events.mjs';
import { store } from '../core/storage.mjs';

const COLORS = [
  'rgba(139, 61, 255,',   // purple
  'rgba(0, 229, 255,',    // cyan
  'rgba(241, 60, 224,',   // pink
  'rgba(176, 124, 255,',  // light purple
];

class ParticleField {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.raf = null;
    this.enabled = true;
    this.pointer = { x: 0.5, y: 0.5 };
    this.dpr = 1;
  }

  init(canvasId = 'particle-canvas') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return this;
    this.ctx = this.canvas.getContext('2d');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.enabled = store.getSetting('particles') !== false && !reduced;

    this.resize();
    window.addEventListener('resize', this._onResize = () => this.resize());
    window.addEventListener('pointermove', this._onPointer = (e) => {
      this.pointer.x = e.clientX / window.innerWidth;
      this.pointer.y = e.clientY / window.innerHeight;
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      document.hidden ? this.stop() : this.start();
    });

    bus.on(EVENTS.SETTING_CHANGED, (e) => {
      if (e.detail.key !== 'particles') return;
      this.enabled = !!e.detail.value;
      this.enabled ? this.start() : this.clearAndStop();
    });

    this.start();
    return this;
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
    this.spawn();
  }

  spawn() {
    const count = this.targetCount;
    this.particles = Array.from({ length: count }, () => this.makeParticle(true));
  }

  makeParticle(scatter = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      x: Math.random() * w,
      y: scatter ? Math.random() * h : h + 20,
      r: 1.2 + Math.random() * 3.4,
      speed: 0.12 + Math.random() * 0.55,
      drift: (Math.random() - 0.5) * 0.35,
      phase: Math.random() * Math.PI * 2,
      swayAmp: 6 + Math.random() * 22,
      alpha: 0.18 + Math.random() * 0.5,
      twinkle: 0.4 + Math.random() * 1.6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
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
      const alpha = p.alpha * pulse;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, p.r * 5);
      grad.addColorStop(0, `${p.color} ${alpha})`);
      grad.addColorStop(0.45, `${p.color} ${alpha * 0.28})`);
      grad.addColorStop(1, `${p.color} 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, p.r * 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.75})`;
      ctx.beginPath();
      ctx.arc(x, y, p.r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointer);
  }
}

/** Singleton background field. */
export const particles = new ParticleField();
