/**
 * Vocal / overdub tracks — buffers that play together on the loop frame.
 */

export class VocalTrack {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    /** @type {Float32Array | null} */
    this.samples = null;
    this.sampleRate = 44100;
    /** @type {AudioBuffer | null} */
    this.buffer = null;
    this.mute = false;
    this.volume = 0.9;
    this.armed = false;
    this.revision = 0;
  }

  get hasAudio() {
    return !!(this.samples && this.samples.length > 0);
  }

  get durationSec() {
    if (!this.samples) return 0;
    return this.samples.length / this.sampleRate;
  }

  /**
   * @param {AudioContext | OfflineAudioContext} ctx
   * @param {Float32Array} samples
   * @param {number} sampleRate
   */
  setSamples(ctx, samples, sampleRate) {
    this.samples = samples;
    this.sampleRate = sampleRate;
    this.revision += 1;
    if (!samples || samples.length === 0) {
      this.buffer = null;
      return;
    }
    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    this.buffer = buf;
  }

  clear() {
    this.samples = null;
    this.buffer = null;
    this.sampleRate = 44100;
    this.revision += 1;
  }

  /**
   * Snapshot for IndexedDB (no AudioBuffer).
   */
  toJSON() {
    return {
      name: this.name,
      mute: this.mute,
      volume: this.volume,
      sampleRate: this.sampleRate,
      samples: this.samples,
    };
  }
}

/**
 * Start a buffer on the mix, optionally looping.
 * @param {AudioContext} ctx
 * @param {VocalTrack} track
 * @param {GainNode} dest
 * @param {number} when
 * @param {boolean} loop
 * @returns {AudioBufferSourceNode | null}
 */
export function startTrackSource(ctx, track, dest, when, loop) {
  if (!track.buffer || track.mute) return null;
  dest.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.01);
  const src = ctx.createBufferSource();
  src.buffer = track.buffer;
  src.loop = loop;
  src.connect(dest);
  src.start(when);
  return src;
}
