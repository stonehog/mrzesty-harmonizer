/**
 * MrZesty one-shot Sampler.
 *
 * - Loads the bundled CC0 one-shots (see SAMPLES-LICENSES.md) once, decodes them into
 *   AudioBuffers, and shares them between the live AudioContext and the OfflineAudioContext
 *   used for WAV mixdown (AudioBuffers are context-independent).
 * - Plays drum hits with velocity curve, optional playback-rate tuning and a short anti-click fade.
 * - Plays pitched instruments (upright / electric / 808 / synth bass, piano, vibes, electric guitar) from
 *   multi-zone root maps with playback-rate pitch shifting, optional glide (808 slide),
 *   per-voice filter and soft saturation.
 * - Provides ONE lazily created shared FX bus per context (dark plate-style reverb + dub delay) so
 *   trip-hop / rap kits get "space" both live and in the offline bounce.
 *
 * If samples fail to load (or in Node tests), kits.js falls back to its synthesis voices.
 */

import { SAMPLE_URLS } from './sampleManifest.js';

/** @type {Map<string, AudioBuffer>} */
const BANK = new Map();
let loadPromise = null;

/** Pitched instrument zone maps: sample name → MIDI root (measured). */
export const INSTRUMENTS = {
  upright: {
    label: 'Upright Bass (pizz)',
    zones: [
      ['upright_E1', 28],
      ['upright_G1', 31],
      ['upright_As1', 34],
      ['upright_C2', 36],
      ['upright_E2', 40],
      ['upright_A2', 45],
      ['upright_E3', 52],
    ],
  },
  electric: {
    label: 'Electric Finger Bass',
    zones: [
      ['ebass_E1', 28],
      ['ebass_G1', 31],
      ['ebass_As1', 34],
      ['ebass_Cs2', 37],
      ['ebass_Ds2', 39],
    ],
  },
  sub808: {
    label: '808 Sub',
    zones: [['sub_808_boom', 34.47]],
  },
  synth: {
    label: 'Synth Bass (electronic)',
    zones: [['synth_bass_hard_C2', 36]],
  },
  synthThick: {
    label: 'Thick Synth Bass',
    zones: [['synth_bass_thick_C2', 36]],
  },
  piano: {
    label: 'Upright Piano',
    zones: [
      ['piano_A3', 57],
      ['piano_Cs4', 61],
    ],
  },
  vibes: {
    label: 'Vibraphone',
    zones: [['vibes_A4', 69]],
  },
  eguitar: {
    label: 'Clean Electric Guitar (skank)',
    zones: [
      ['eguit_C3', 48],
      ['eguit_E3', 52],
      ['eguit_G3', 55],
      ['eguit_B3', 59],
      ['eguit_E4', 64],
      ['eguit_G4', 67],
    ],
  },
};

export function sampleNames() {
  return Object.keys(SAMPLE_URLS);
}

export function hasSample(name) {
  return BANK.has(name);
}

export function samplesReady() {
  return BANK.size > 0;
}

/** Test / advanced hook: inject decoded buffers directly. */
export function setSample(name, buffer) {
  if (buffer) BANK.set(name, buffer);
}

export function clearSamples() {
  BANK.clear();
  loadPromise = null;
}

function decode(ctx, arrayBuffer) {
  // Older Safari only supports the callback form of decodeAudioData.
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fetch + decode every bundled sample (once). Resolves with { loaded, failed }.
 * @param {BaseAudioContext} ctx
 * @param {(done: number, total: number) => void} [onProgress]
 */
export function loadSampleBank(ctx, onProgress) {
  if (loadPromise) return loadPromise;
  const entries = Object.entries(SAMPLE_URLS);
  let done = 0;
  const failed = [];
  loadPromise = Promise.all(
    entries.map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await decode(ctx, await res.arrayBuffer());
        BANK.set(name, buf);
      } catch (err) {
        failed.push(name);
      } finally {
        done += 1;
        onProgress?.(done, entries.length);
      }
    })
  ).then(() => {
    if (BANK.size === 0) loadPromise = null; // allow retry
    return { loaded: BANK.size, failed };
  });
  return loadPromise;
}

/* ------------------------------------------------------------------ */
/* FX bus: ONE shared reverb + dub delay per context                   */
/* ------------------------------------------------------------------ */

/** @type {WeakMap<BaseAudioContext, { reverbIn: GainNode, delayIn: GainNode, delayNode: DelayNode, ret: GainNode }>} */
const FX = new WeakMap();
/** Per-lane send nodes (lane dest → its own send level into the shared bus). */
const LANE_SENDS = new WeakMap();
/** Where the shared FX return goes, per context (live: the mix bus). */
const FX_RETURN = new WeakMap();
/** Live FX on/off per context (Lite mode turns sends off; WAV export keeps them). */
const FX_OFF = new WeakSet();
let saturationCurve = null;

/** Reverb impulse length (s). Short dark plate: was 2.4 s, now 1.8 s (less convolution work). */
export const REVERB_SECONDS = 1.8;

function makeImpulse(ctx, seconds = REVERB_SECONDS, decay = 3.2, dark = true) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = Math.random() * 2 - 1;
      // One-pole low-pass on the noise for a darker, plate-like tail
      lp = dark ? lp + 0.22 * (n - lp) : n;
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
  }
  return ir;
}

/**
 * Route the shared FX return of `ctx` into `node` (call before the first hit).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} node
 */
export function setFxReturn(ctx, node) {
  FX_RETURN.set(ctx, node);
  const fx = FX.get(ctx);
  if (fx) {
    try {
      fx.ret.disconnect();
    } catch {
      /* */
    }
    fx.ret.connect(node);
  }
}

/** Live reverb / delay sends on (default) or off (Lite mode). */
export function setFxEnabled(ctx, on) {
  if (!ctx) return;
  if (on) FX_OFF.delete(ctx);
  else FX_OFF.add(ctx);
}

export function fxEnabled(ctx) {
  return !FX_OFF.has(ctx);
}

function getSharedFx(ctx, fallbackDest) {
  let fx = FX.get(ctx);
  if (fx) return fx;

  const ret = ctx.createGain();
  ret.connect(FX_RETURN.get(ctx) || fallbackDest || ctx.destination);

  const reverbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx);
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 180; // keep the low end dry and tight
  const revOut = ctx.createGain();
  revOut.gain.value = 0.9;
  reverbIn.connect(revHp);
  revHp.connect(conv);
  conv.connect(revOut);
  revOut.connect(ret);

  const delayIn = ctx.createGain();
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = 0.36;
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const dly = ctx.createBiquadFilter();
  dly.type = 'bandpass';
  dly.frequency.value = 1100;
  dly.Q.value = 0.6;
  delayIn.connect(delayNode);
  delayNode.connect(dly);
  dly.connect(fb);
  fb.connect(delayNode);
  dly.connect(ret);

  fx = { reverbIn, delayIn, delayNode, ret };
  FX.set(ctx, fx);
  return fx;
}

/**
 * FX sends for a lane destination. All lanes share one reverb and one delay per context;
 * each lane gets two tiny GainNodes whose level follows the lane fader / mute
 * (see setFxLaneLevel), so the reverb tail still follows the lane like before.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @returns {{ reverb: GainNode, delay: GainNode, delayNode: DelayNode }}
 */
export function getFxBus(ctx, dest) {
  let lane = LANE_SENDS.get(dest);
  if (lane) return lane;
  const fx = getSharedFx(ctx, dest);
  const reverb = ctx.createGain();
  const delay = ctx.createGain();
  reverb.connect(fx.reverbIn);
  delay.connect(fx.delayIn);
  lane = { reverb, delay, delayNode: fx.delayNode };
  LANE_SENDS.set(dest, lane);
  return lane;
}

/**
 * Keep a lane's FX send level in step with its fader (0 when muted).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {number} level
 */
export function setFxLaneLevel(ctx, dest, level) {
  if (!ctx || !dest) return;
  const lane = getFxBus(ctx, dest);
  const v = Math.max(0, level);
  if ('currentTime' in ctx && ctx.currentTime > 0 && lane.reverb.gain.setTargetAtTime) {
    lane.reverb.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    lane.delay.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  } else {
    lane.reverb.gain.value = v;
    lane.delay.gain.value = v;
  }
}

/** Test hook: how many shared FX buses exist for this context (0 or 1). */
export function fxBusCount(ctx) {
  return FX.has(ctx) ? 1 : 0;
}

function getSaturationCurve() {
  if (saturationCurve) return saturationCurve;
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  saturationCurve = curve;
  return curve;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Play a one-shot.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {string} name
 * @param {number} time
 * @param {object} [o]
 * @param {number} [o.vel=1]        0..1.25 velocity (perceptual curve applied)
 * @param {number} [o.gain=1]       extra linear gain
 * @param {number} [o.rate=1]       playback rate (tuning)
 * @param {number} [o.dur]          max length in seconds (short fade applied)
 * @param {number} [o.reverb=0]     reverb send 0..1
 * @param {number} [o.delay=0]      dub-delay send 0..1
 * @param {number} [o.lowpass]      optional low-pass cutoff (Hz)
 * @param {number} [o.highpass]     optional high-pass cutoff (Hz)
 * @param {number} [o.rateTo]       glide target playback rate
 * @param {number} [o.glide=0.06]   glide time (s)
 * @param {boolean} [o.drive]       soft saturation
 * @returns {boolean} true if a sample was played
 */
export function playSample(ctx, dest, name, time, o = {}) {
  const buffer = BANK.get(name);
  if (!buffer || !dest) return false;
  const vel = Math.max(0.05, Math.min(1.25, o.vel ?? 1));
  const amp = Math.pow(vel, 1.6) * (o.gain ?? 1);
  const rate = Math.max(0.05, o.rate ?? 1);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.setValueAtTime(rate, time);
  if (o.rateTo && o.rateTo > 0) {
    // 808 slide: start on the previous note's pitch and glide into this one
    src.playbackRate.setValueAtTime(o.rateFrom || rate, time);
    src.playbackRate.exponentialRampToValueAtTime(o.rateTo, time + (o.glide ?? 0.06));
  }

  /** every node in this hit's chain, disconnected when the voice ends */
  const chain = [src];
  let node = src;
  if (o.highpass) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.highpass;
    node.connect(hp);
    node = hp;
    chain.push(hp);
  }
  if (o.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass;
    lp.Q.value = o.q ?? 0.7;
    node.connect(lp);
    node = lp;
    chain.push(lp);
  }
  if (o.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = getSaturationCurve();
    ws.oversample = '2x';
    node.connect(ws);
    node = ws;
    chain.push(ws);
  }

  const g = ctx.createGain();
  const naturalLen = buffer.duration / (o.rateTo || rate);
  const dur = Math.min(naturalLen, o.dur ?? naturalLen);
  const fade = Math.min(0.06, Math.max(0.008, dur * 0.25));
  g.gain.setValueAtTime(amp, time);
  g.gain.setValueAtTime(amp, time + Math.max(0.001, dur - fade));
  g.gain.linearRampToValueAtTime(0.0001, time + dur);
  node.connect(g);
  g.connect(dest);
  chain.push(g);

  if ((o.reverb || o.delay) && ctx.createConvolver && !FX_OFF.has(ctx)) {
    const fx = getFxBus(ctx, dest);
    if (o.reverb) {
      const s = ctx.createGain();
      s.gain.value = o.reverb;
      g.connect(s);
      s.connect(fx.reverb);
      chain.push(s);
    }
    if (o.delay) {
      if (o.delayTime) fx.delayNode.delayTime.setValueAtTime(o.delayTime, time);
      const s = ctx.createGain();
      s.gain.value = o.delay;
      g.connect(s);
      s.connect(fx.delay);
      chain.push(s);
    }
  }

  src.start(time);
  src.stop(time + dur + 0.02);
  // Free the per-hit chain as soon as the voice ends (helps Safari / long sessions).
  src.onended = () => {
    for (const n of chain) {
      try {
        n.disconnect();
      } catch {
        /* */
      }
    }
  };
  return true;
}

/**
 * Choose the zone whose root is nearest the requested MIDI note.
 * @param {string} instrument
 * @param {number} midi
 * @returns {{ name: string, rate: number } | null}
 */
export function pickZone(instrument, midi) {
  const inst = INSTRUMENTS[instrument];
  if (!inst) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [name, root] of inst.zones) {
    if (!BANK.has(name)) continue;
    // Prefer pitching down slightly over pitching up (sounds more natural)
    const d = midi - root;
    const dist = d >= 0 ? d * 1.15 : -d;
    if (dist < bestDist) {
      bestDist = dist;
      best = { name, rate: Math.pow(2, d / 12) };
    }
  }
  return best;
}

/**
 * Rate math only (no audio) – exported for tests.
 */
export function zoneRateFor(instrument, midi) {
  const inst = INSTRUMENTS[instrument];
  if (!inst) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [name, root] of inst.zones) {
    const d = midi - root;
    const dist = d >= 0 ? d * 1.15 : -d;
    if (dist < bestDist) {
      bestDist = dist;
      best = { name, rate: Math.pow(2, d / 12) };
    }
  }
  return best;
}

/**
 * Play a pitched note on a sampled instrument.
 * @returns {boolean} true if played
 */
export function playPitched(ctx, dest, instrument, midi, time, o = {}) {
  const zone = pickZone(instrument, midi);
  if (!zone) return false;
  const extra = { ...o, rate: zone.rate };
  if (typeof o.slideFromMidi === 'number') {
    extra.rateFrom = zone.rate * Math.pow(2, (o.slideFromMidi - midi) / 12);
    extra.rateTo = zone.rate;
  }
  return playSample(ctx, dest, zone.name, time, extra);
}
