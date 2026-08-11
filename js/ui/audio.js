/**
 * audio.js — Tiny WebAudio sound engine.
 *
 * All effects are synthesised, so the game ships with no audio assets.
 * The context is created lazily on the first user gesture (autoplay rules).
 */

import { store } from '../core/storage.js';

const SOUNDS = {
  flip:     { type: 'triangle', freq: 620,  to: 880,  dur: 0.09, gain: 0.16 },
  match:    { type: 'sine',     freq: 660,  to: 1180, dur: 0.22, gain: 0.20 },
  mismatch: { type: 'sawtooth', freq: 240,  to: 130,  dur: 0.20, gain: 0.12 },
  coin:     { type: 'square',   freq: 980,  to: 1560, dur: 0.14, gain: 0.10 },
  click:    { type: 'triangle', freq: 420,  to: 520,  dur: 0.06, gain: 0.12 },
  error:    { type: 'square',   freq: 180,  to: 120,  dur: 0.24, gain: 0.10 },
  powerup:  { type: 'sine',     freq: 520,  to: 1320, dur: 0.30, gain: 0.16 },
};

const WIN_MELODY  = [523.25, 659.25, 783.99, 1046.5];
const LOSE_MELODY = [440, 349.23, 261.63];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  get enabled() { return store.getSetting('sound') !== false; }

  /** Called on first gesture — browsers block earlier construction. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    } catch (err) {
      console.warn('[audio] unavailable:', err);
    }
  }

  play(name) {
    if (!this.enabled) return;
    this.unlock();
    const cfg = SOUNDS[name];
    if (!this.ctx || !cfg) return;
    const t = this.ctx.currentTime;
    this._tone(cfg, t);
    // A card turning over is a click, not a beep — layer a noise transient.
    if (name === 'flip') this._noise({ dur: 0.05, gain: 0.09, freq: 2100 }, t);
    if (name === 'click') this._noise({ dur: 0.03, gain: 0.05, freq: 2600 }, t);
  }

  /** Short band-passed white-noise burst: the physical snap of card on card. */
  _noise({ dur = 0.05, gain = 0.08, freq = 2000, q = 0.9 } = {}, startAt) {
    if (!this.ctx) return;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Decay the noise so it reads as a transient rather than a hiss.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, startAt);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

    src.connect(filter).connect(env).connect(this.master);
    src.start(startAt);
    src.stop(startAt + dur + 0.01);
  }

  _tone({ type, freq, to, dur, gain }, startAt) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), startAt + dur);

    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

    osc.connect(env).connect(this.master);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  _melody(notes, { step = 0.13, dur = 0.24, type = 'sine', gain = 0.17 } = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      this._tone({ type, freq, to: freq, dur, gain }, t0 + i * step);
    });
  }

  win()  { this._melody(WIN_MELODY, { step: 0.14, dur: 0.3, type: 'triangle', gain: 0.18 }); }
  lose() { this._melody(LOSE_MELODY, { step: 0.2, dur: 0.34, type: 'sawtooth', gain: 0.12 }); }

  /** Named aliases: the two round-end cues read better at the call site. */
  levelComplete() { this.win(); }
  gameOver()      { this.lose(); }

  /** Master mute. Persisted through settings, so it survives a reload. */
  get muted() { return !this.enabled; }

  setMuted(muted) {
    store.setSetting('sound', !muted);
    if (!muted) {
      this.unlock();
      this.play('click');        // confirm audibly that sound is back
    }
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }

  /** Rising pitch as a combo builds. */
  combo(level) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    const base = 660 * Math.pow(1.12, Math.min(level, 10) - 1);
    this._tone({ type: 'sine', freq: base, to: base * 1.7, dur: 0.24, gain: 0.2 }, this.ctx.currentTime);
  }
}

/** Singleton audio engine. */
export const audio = new AudioEngine();
