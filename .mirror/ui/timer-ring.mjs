/**
 * timer-ring.js — Circular countdown, pinned to the corner of the board.
 *
 * An SVG ring whose stroke drains as the clock runs down, shifting hue
 * green → amber → red. The ring is dormant until the first card flip;
 * until then it shows the full time limit at rest.
 */

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ring colour for a fraction of time remaining (1 = full, 0 = empty). */
export function timerColor(fraction) {
  if (fraction > 0.6)  return { stroke: '#37e2a0', tone: 'safe' };    // green
  if (fraction > 0.35) return { stroke: '#ffc93c', tone: 'warn' };    // amber
  if (fraction > 0.15) return { stroke: '#ff9d2f', tone: 'low' };     // orange
  return { stroke: '#ff5470', tone: 'critical' };                     // red
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class TimerRing {
  constructor() {
    this.root = null;
    this.arc = null;
    this.label = null;
    this.state = null;
    this.limit = 0;
    this.tone = '';
  }

  /** Markup for the screen to drop into place. */
  static markup() {
    return `
      <div class="timer-ring idle" id="timer-ring" role="timer" aria-live="off">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle class="timer-ring-track" cx="40" cy="40" r="${RADIUS}" />
          <circle class="timer-ring-arc" cx="40" cy="40" r="${RADIUS}"
                  stroke-dasharray="${CIRCUMFERENCE.toFixed(2)}"
                  stroke-dashoffset="0" />
        </svg>
        <div class="timer-ring-face">
          <span class="timer-ring-value" id="timer-ring-value">0:00</span>
          <span class="timer-ring-state" id="timer-ring-state">ready</span>
        </div>
      </div>
    `;
  }

  /** Bind to already-rendered markup. */
  attach(container) {
    this.root = container.querySelector('#timer-ring');
    if (!this.root) return this;
    this.arc = this.root.querySelector('.timer-ring-arc');
    this.label = this.root.querySelector('#timer-ring-value');
    this.state = this.root.querySelector('#timer-ring-state');
    return this;
  }

  /** Set the total time for the round and park the ring at full. */
  reset(limit) {
    this.limit = Math.max(1, limit);
    this.root?.classList.add('idle');
    this.root?.classList.remove('frozen');
    this.setStateText('tap a card');
    this.update(this.limit);
    return this;
  }

  /** The clock has begun — drop the resting look. */
  start() {
    this.root?.classList.remove('idle');
    this.setStateText('remaining');
    return this;
  }

  setStateText(text) {
    if (this.state) this.state.textContent = text;
  }

  setFrozen(frozen) {
    this.root?.classList.toggle('frozen', !!frozen);
    if (frozen) this.setStateText('frozen');
    else if (!this.root?.classList.contains('idle')) this.setStateText('remaining');
  }

  /** @param {number} timeLeft seconds remaining */
  update(timeLeft) {
    if (!this.arc || !this.label) return;
    const fraction = Math.max(0, Math.min(1, timeLeft / this.limit));

    // Drain clockwise from the top: the arc is rotated -90° in CSS.
    this.arc.style.strokeDashoffset = (CIRCUMFERENCE * (1 - fraction)).toFixed(2);

    const { stroke, tone } = timerColor(fraction);
    this.arc.style.stroke = stroke;

    if (tone !== this.tone) {
      this.tone = tone;
      this.root.dataset.tone = tone;
    }

    this.label.textContent = formatClock(timeLeft);
    this.root.setAttribute('aria-label', `${Math.round(timeLeft)} seconds remaining`);
    return this;
  }

  detach() {
    this.root = this.arc = this.label = this.state = null;
    this.tone = '';
  }
}

/** One ring per app — the gameplay screen owns it. */
export const timerRing = new TimerRing();
