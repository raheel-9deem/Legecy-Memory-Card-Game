/**
 * audio.js — Small WebAudio sound engine.
 *
 * All effects are synthesised, so the game ships with no audio assets and no
 * network requests. The context is created lazily on the first user gesture,
 * because browsers refuse to start one earlier.
 *
 * Signal chain:
 *
 *   voices ──► sfxGain   ──┐
 *                          ├──► master ──► limiter ──► destination
 *   melodies ─► musicGain ─┘        │
 *                    └──► reverbSend ──► convolver ──┘
 *
 * The two buses exist so a fanfare can duck the effects under it without
 * touching the player's master volume, and so the limiter sees one summed
 * signal — a three-star win fires confetti chimes, a coin run and a four-note
 * melody within the same 400ms, and without a limiter that stack clipped.
 */

import { store } from '../core/storage.js';

/**
 * One-shot voices.
 *
 * `vary` is a semitone-ish spread applied per trigger. Flip fires up to sixty
 * times a round and an identical sample at an identical pitch stops reading as
 * a card and starts reading as a beep, so the common cues are detuned slightly
 * on every play. The deliberate ones (error, coin) stay fixed.
 */
const SOUNDS = {
  flip:     { type: 'triangle', freq: 620,  to: 880,  dur: 0.09, gain: 0.16, vary: 0.06 },
  match:    { type: 'sine',     freq: 660,  to: 1180, dur: 0.22, gain: 0.20, vary: 0.03, verb: 0.25 },
  mismatch: { type: 'sawtooth', freq: 240,  to: 130,  dur: 0.20, gain: 0.12, vary: 0.02 },
  coin:     { type: 'square',   freq: 980,  to: 1560, dur: 0.14, gain: 0.10 },
  click:    { type: 'triangle', freq: 420,  to: 520,  dur: 0.06, gain: 0.12, vary: 0.04 },
  error:    { type: 'square',   freq: 180,  to: 120,  dur: 0.24, gain: 0.10 },
  powerup:  { type: 'sine',     freq: 520,  to: 1320, dur: 0.30, gain: 0.16, verb: 0.2 },
  /** Per-power-up cues, so the three read apart without looking at the screen. */
  hint:     { type: 'sine',     freq: 880,  to: 1760, dur: 0.26, gain: 0.14, verb: 0.3 },
  freeze:   { type: 'triangle', freq: 1400, to: 520,  dur: 0.42, gain: 0.13, verb: 0.35 },
  shuffle:  { type: 'sawtooth', freq: 300,  to: 720,  dur: 0.24, gain: 0.10, vary: 0.05 },
  /** Final-seconds heartbeat and the star reveals on the win screen. */
  tick:     { type: 'square',   freq: 1200, to: 1200, dur: 0.045, gain: 0.07 },
  tock:     { type: 'square',   freq: 900,  to: 900,  dur: 0.045, gain: 0.055 },
  star:     { type: 'sine',     freq: 1046, to: 1568, dur: 0.34, gain: 0.16, verb: 0.4 },
  unlock:   { type: 'triangle', freq: 440,  to: 1320, dur: 0.5,  gain: 0.16, verb: 0.4 },
};

/** C-major arpeggio up, then the octave — the "you did it" shape. */
const WIN_MELODY  = [523.25, 659.25, 783.99, 1046.5];
/** A minor fall. Deliberately not a raspberry: losing a round is not a failure. */
const LOSE_MELODY = [440, 349.23, 261.63];
/** Three-star flourish: the win melody plus a fifth above. */
const PERFECT_MELODY = [523.25, 659.25, 783.99, 1046.5, 1318.5];

/** Volume is stored 0–1; this is what the master sits at when volume is 1. */
const MASTER_CEILING = 0.7;
/** Envelope attacks shorter than this cannot be expressed — see _tone(). */
const MIN_ATTACK = 0.004;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.reverbSend = null;
    this._tickParity = false;
  }

  get enabled() { return store.getSetting('sound') !== false; }

  /**
   * Player volume, 0–1. Absent from older save files, so it defaults to full
   * rather than silent — a missing key must never read as "muted".
   */
  get volume() {
    const v = store.getSetting('volume');
    return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
  }

  setVolume(value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    store.setSetting('volume', v);
    this._applyVolume();
    return v;
  }

  _applyVolume() {
    if (!this.master || !this.ctx) return;
    const target = MASTER_CEILING * this.volume;
    // Ramp rather than jump: a step on a live gain node is an audible click.
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

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
      this._buildGraph();
      // Nothing schedules audio while the tab is hidden, so let the context
      // idle instead of holding the audio hardware open in the background.
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        document.hidden ? this.ctx.suspend() : this.ctx.resume();
      });
    } catch (err) {
      console.warn('[audio] unavailable:', err);
      this.ctx = null;
    }
  }

  _buildGraph() {
    const ctx = this.ctx;

    // A limiter, not a compressor for taste: its only job is to stop the win
    // stack from clipping. Fast attack, near-instant knee, high ratio.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_CEILING * this.volume;
    this.master.connect(limiter);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 1;
    this.musicGain.connect(this.master);

    // A short synthesised impulse response. Real reverb would mean shipping a
    // file; this is two exponentially-decaying noise channels, which is enough
    // to put the match chime in a room instead of against a wall.
    const convolver = ctx.createConvolver();
    convolver.buffer = this._impulse(1.4, 2.6);
    convolver.connect(this.master);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(convolver);
  }

  /** Decaying stereo noise burst used as the convolver's impulse response. */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const frames = Math.max(1, Math.floor(rate * seconds));
    const buffer = this.ctx.createBuffer(2, frames, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, decay);
      }
    }
    return buffer;
  }

  play(name) {
    if (!this.enabled) return;
    this.unlock();
    const cfg = SOUNDS[name];
    if (!this.ctx || !cfg) return;
    const t = this.ctx.currentTime;
    this._tone(cfg, t, this.sfxGain);
    // A card turning over is a click, not a beep — layer a noise transient.
    if (name === 'flip') this._noise({ dur: 0.05, gain: 0.09, freq: 2100 }, t);
    if (name === 'click') this._noise({ dur: 0.03, gain: 0.05, freq: 2600 }, t);
    if (name === 'shuffle') this._noise({ dur: 0.16, gain: 0.06, freq: 1500, q: 0.6 }, t);
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

    src.connect(filter).connect(env).connect(this.sfxGain);
    src.start(startAt);
    src.stop(startAt + dur + 0.01);
  }

  /**
   * One oscillator voice with an exponential AD envelope.
   *
   * `dur` is clamped against the attack: a cue shorter than the 12ms ramp used
   * to schedule its decay *before* its attack, and Web Audio resolves that by
   * holding the peak until the stop — a 45ms tick came out as a click at full
   * gain. The attack now scales with the note.
   */
  _tone({ type, freq, to, dur, gain, vary = 0, verb = 0 }, startAt, destination) {
    if (!this.ctx) return;
    const out = destination || this.sfxGain;

    // Detune per trigger so a repeated cue never phases into a machine noise.
    const detune = vary ? 1 + (Math.random() * 2 - 1) * vary : 1;
    const f0 = Math.max(20, freq * detune);
    const f1 = to ? Math.max(20, to * detune) : f0;

    const attack = Math.min(0.012, Math.max(MIN_ATTACK, dur * 0.25));
    const peak = Math.max(0.0002, gain);

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(f0, startAt);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, startAt + dur);

    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

    osc.connect(env);
    env.connect(out);

    // Wet path is a parallel send, so the dry hit keeps its attack.
    if (verb && this.reverbSend) {
      const send = this.ctx.createGain();
      send.gain.value = verb;
      env.connect(send).connect(this.reverbSend);
    }

    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  /**
   * Melodies run on the music bus and duck the effects bus underneath, so a
   * coin run landing during the fanfare does not fight it.
   */
  _melody(notes, { step = 0.13, dur = 0.24, type = 'sine', gain = 0.17, verb = 0.3 } = {}) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;

    const t0 = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      this._tone({ type, freq, to: freq, dur, gain, verb }, t0 + i * step, this.musicGain);
    });

    const span = notes.length * step + dur;
    this._duck(this.sfxGain, 0.45, t0, span);
  }

  /** Pull a bus down for `span` seconds, then bring it back. */
  _duck(bus, amount, startAt, span) {
    if (!bus || !this.ctx) return;
    bus.gain.cancelScheduledValues(startAt);
    bus.gain.setTargetAtTime(amount, startAt, 0.04);
    bus.gain.setTargetAtTime(1, startAt + span, 0.12);
  }

  win()  { this._melody(WIN_MELODY, { step: 0.14, dur: 0.3, type: 'triangle', gain: 0.18 }); }
  lose() { this._melody(LOSE_MELODY, { step: 0.2, dur: 0.34, type: 'sawtooth', gain: 0.12, verb: 0.15 }); }
  /** Three-star clear — one note longer and a touch brighter than a plain win. */
  perfect() { this._melody(PERFECT_MELODY, { step: 0.13, dur: 0.34, type: 'triangle', gain: 0.19, verb: 0.4 }); }

  /** Named aliases: the two round-end cues read better at the call site. */
  levelComplete(stars = 0) {
    if (stars >= 3) this.perfect();
    else this.win();
  }

  gameOver() { this.lose(); }

  /**
   * The last-ten-seconds heartbeat. Alternates two pitches so it reads as a
   * clock rather than a repeated alarm, and the gameplay screen calls it once
   * per tick — the alternation is state here, not there.
   */
  countdown() {
    if (!this.enabled) return;
    this._tickParity = !this._tickParity;
    this.play(this._tickParity ? 'tick' : 'tock');
  }

  /** One chime per star as it lands on the results screen. */
  starEarned(index = 0) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    const cfg = SOUNDS.star;
    // Each star a fourth above the last, so three of them form a rising figure.
    const mult = Math.pow(4 / 3, Math.max(0, index));
    this._tone(
      { ...cfg, freq: cfg.freq * mult, to: cfg.to * mult },
      this.ctx.currentTime,
      this.musicGain
    );
  }

  /** Master mute. Persisted through settings, so it survives a reload. */
  get muted() { return !this.enabled; }

  setMuted(muted) {
    store.setSetting('sound', !muted);
    if (!muted) {
      this.unlock();
      this._applyVolume();
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
    this._tone(
      { type: 'sine', freq: base, to: base * 1.7, dur: 0.24, gain: 0.2, verb: 0.25 },
      this.ctx.currentTime,
      this.sfxGain
    );
  }
}

/** Singleton audio engine. */
export const audio = new AudioEngine();
