/**
 * WAV encode + dry microphone capture for vocal tracks.
 * MicCapture taps only the given AudioNode (mic source) — never the mix bus —
 * so harmony / kits are not written into the vocal buffer.
 */


/** Default pre-amp for quiet mics (conference headsets, etc.). */
export const DEFAULT_MIC_GAIN_DB = 9;
export const MAX_MIC_GAIN_DB = 24;
/** Peak-normalize finished takes to this level before harmony / doubler analysis. */
export const AUTO_LEVEL_TARGET_DBFS = -3;
/** Soft-knee starts here (~ -1 dBFS) so a hot take never quite reaches 0 dBFS. */
export const LIMIT_THRESHOLD = 0.89;
export const CLIP_THRESHOLD = 0.99;
/** Cap auto-level boost so a near-silent take does not roar up the noise floor. */
export const AUTO_LEVEL_MAX_BOOST_DB = 36;

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

/**
 * @param {ArrayLike<number>} samples
 * @returns {number}
 */
export function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * @param {number} peak  linear amplitude 0..1+
 * @returns {number} dBFS, or -Infinity for digital silence
 */
export function peakDb(peak) {
  if (peak <= 1e-12) return -Infinity;
  return 20 * Math.log10(peak);
}

/**
 * Soft-knee limiter: linear below threshold, tanh into just under 0 dBFS.
 * @param {number} x
 * @param {number} [threshold]
 */
export function softLimitSample(x, threshold = LIMIT_THRESHOLD) {
  const a = Math.abs(x);
  if (a <= threshold) return x;
  const headroom = Math.max(1e-6, 1 - threshold);
  const shaped = threshold + headroom * Math.tanh((a - threshold) / headroom);
  return (x < 0 ? -1 : 1) * Math.min(shaped, 0.999);
}

/**
 * Apply mic pre-amp (0..+24 dB) then a soft limiter. Does not mutate `samples`.
 * @param {ArrayLike<number>} samples
 * @param {number} gainDb
 * @returns {Float32Array}
 */
export function applyMicGainAndLimit(samples, gainDb) {
  const db = Math.max(0, Math.min(MAX_MIC_GAIN_DB, Number(gainDb) || 0));
  const g = dbToGain(db);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = softLimitSample(samples[i] * g);
  }
  return out;
}

/**
 * Peak-normalize in place to `targetDb` dBFS (default -3). Returns the same buffer.
 * @param {Float32Array} samples
 * @param {number} [targetDb]
 * @param {number} [maxBoostDb]
 * @returns {Float32Array}
 */
export function peakNormalize(samples, targetDb = AUTO_LEVEL_TARGET_DBFS, maxBoostDb = AUTO_LEVEL_MAX_BOOST_DB) {
  const peak = peakOf(samples);
  if (peak < 1e-7) return samples;
  const target = dbToGain(targetDb);
  let scale = target / peak;
  const maxScale = dbToGain(maxBoostDb);
  if (scale > maxScale) scale = maxScale;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return samples;
}

/**
 * Full capture chain used by the recorder and by headless tests:
 * gain + soft limit, then optional peak-normalize to -3 dBFS.
 * @param {ArrayLike<number>} samples
 * @param {{ gainDb?: number, autoLevel?: boolean, targetDb?: number }} [opts]
 * @returns {Float32Array}
 */
export function prepareVocalTake(samples, opts = {}) {
  const gainDb = opts.gainDb ?? DEFAULT_MIC_GAIN_DB;
  const autoLevel = opts.autoLevel !== false;
  const targetDb = opts.targetDb ?? AUTO_LEVEL_TARGET_DBFS;
  const processed = applyMicGainAndLimit(samples, gainDb);
  if (autoLevel) peakNormalize(processed, targetDb);
  return processed;
}


/**
 * Encode Float32 mono samples as 16-bit PCM WAV.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWav(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/**
 * AudioWorklet capture processor (inlined as a Blob URL so it works in Vite dev, the
 * production build, and the plain `python3 -m http.server` no-build path).
 * Batches 128-frame render quanta into 2048-sample chunks so the main thread gets ~23
 * small messages per second instead of running a ScriptProcessor callback on its own thread.
 */
const CAPTURE_WORKLET_SRC = `
class MrZestyCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.on = true;
    this.first = -1;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        if (this.n > 0) this.port.postMessage({ chunk: this.buf.slice(0, this.n), frame: this.first });
        this.port.postMessage({ done: true });
        this.on = false;
      }
    };
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.first < 0) this.first = currentFrame;
      let i = 0;
      while (i < ch.length) {
        const take = Math.min(ch.length - i, this.size - this.n);
        this.buf.set(ch.subarray(i, i + take), this.n);
        this.n += take;
        i += take;
        if (this.n === this.size) {
          this.port.postMessage({ chunk: this.buf, frame: this.first }, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('mrzesty-capture', MrZestyCapture);
`;

/** @type {WeakMap<BaseAudioContext, Promise<boolean>>} */
const WORKLET_READY = new WeakMap();

/**
 * Load the capture worklet once per context. Resolves false when AudioWorklet is
 * unavailable (very old Safari) so MicCapture falls back to ScriptProcessor.
 * @param {BaseAudioContext} ctx
 * @returns {Promise<boolean>}
 */
export function prepareCaptureWorklet(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof AudioWorkletNode === 'undefined' || typeof Blob === 'undefined') {
    return Promise.resolve(false);
  }
  let p = WORKLET_READY.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SRC], { type: 'application/javascript' }));
    p = ctx.audioWorklet
      .addModule(url)
      .then(() => true)
      .catch(() => false)
      .finally(() => URL.revokeObjectURL(url));
    WORKLET_READY.set(ctx, p);
  }
  return p;
}

/**
 * Capture a mono tap from an AudioNode into a Float32Array (dry).
 * Uses an AudioWorklet (audio thread) when available, ScriptProcessor otherwise.
 */
export class MicCapture {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} sourceNode  must be the mic MediaStreamSource, not the mix
   * @param {{ useWorklet?: boolean }} [opts] useWorklet: true once prepareCaptureWorklet() resolved true
   */
  constructor(ctx, sourceNode, opts = {}) {
    this.ctx = ctx;
    this.sourceNode = sourceNode;
    this.useWorklet = !!opts.useWorklet;
    this.mode = 'none';
    this.recording = false;
    this._chunks = [];
    this._processor = null;
    this._silent = null;
    this._total = 0;
    this._maxSamples = 0;
    this._onFull = null;
    /** Context frame (sample index) of the first captured sample, when known. */
    this.startFrame = -1;
    /** @type {((input: Float32Array) => Float32Array) | null} */
    this.process = null;
  }

  _push(input, copy) {
    const processed = this.process ? this.process(input) : copy ? Float32Array.from(input) : input;
    const chunk = processed === input && copy ? Float32Array.from(input) : processed;
    this._chunks.push(chunk);
    this._total += chunk.length;
    if (this._total >= this._maxSamples) {
      const cb = this._onFull;
      this._onFull = null;
      if (cb) setTimeout(cb, 0);
    }
  }

  /**
   * @param {number} maxSeconds
   * @param {(() => void) | null} [onFull] called when max length is reached
   */
  start(maxSeconds, onFull = null) {
    if (this.recording) return;
    this.recording = true;
    this._chunks = [];
    this._total = 0;
    this._maxSamples = Math.floor(this.ctx.sampleRate * maxSeconds);
    this._onFull = onFull;
    this.startFrame = -1;

    // Keep the tap in the graph so it is pulled, but output silence so we never
    // monitor the mic to speakers (feedback).
    this._silent = this.ctx.createGain();
    this._silent.gain.value = 0;

    if (this.useWorklet) {
      try {
        const node = new AudioWorkletNode(this.ctx, 'mrzesty-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        node.port.onmessage = (e) => {
          const d = e.data;
          if (!d || !d.chunk || !this.recording) return;
          if (this.startFrame < 0 && typeof d.frame === 'number') this.startFrame = d.frame;
          this._push(d.chunk, false); // transferred buffer: already ours, no copy needed
        };
        this._processor = node;
        this.mode = 'worklet';
      } catch {
        this._processor = null;
      }
    }

    if (!this._processor) {
      const bufferSize = 4096;
      const sp = this.ctx.createScriptProcessor(bufferSize, 1, 1);
      sp.onaudioprocess = (e) => {
        if (!this.recording) return;
        // Copy — ScriptProcessor reuses the underlying buffer.
        this._push(e.inputBuffer.getChannelData(0), true);
      };
      this._processor = sp;
      this.mode = 'scriptprocessor';
    }

    this.sourceNode.connect(this._processor);
    this._processor.connect(this._silent);
    this._silent.connect(this.ctx.destination);
  }

  /**
   * @param {number} [trimSamples] if set, slice/pad to this many samples
   * @param {number} [skipSamples] drop this many samples from the start first (latency / pre-roll compensation)
   * @returns {{ samples: Float32Array, sampleRate: number, durationSec: number } | null}
   */
  stop(trimSamples = 0, skipSamples = 0) {
    if (!this.recording) return null;
    this.recording = false;

    const proc = this._processor;
    try {
      if (proc && proc.port) proc.port.postMessage('stop');
    } catch {
      /* */
    }
    try {
      proc?.disconnect();
      this._silent?.disconnect();
      this.sourceNode.disconnect(proc);
    } catch {
      /* already disconnected */
    }
    if (proc && 'onaudioprocess' in proc) proc.onaudioprocess = null;
    if (proc && proc.port) proc.port.onmessage = null;
    this._processor = null;
    this._silent = null;
    this._onFull = null;

    if (this._chunks.length === 0) return null;

    let length = 0;
    for (const c of this._chunks) length += c.length;
    const raw = new Float32Array(length);
    let offset = 0;
    for (const c of this._chunks) {
      raw.set(c, offset);
      offset += c.length;
    }
    this._chunks = [];

    const skip = Math.max(0, Math.min(raw.length, Math.floor(skipSamples) || 0));
    const body = skip > 0 ? raw.subarray(skip) : raw;
    let samples = skip > 0 ? Float32Array.from(body) : raw;
    if (trimSamples > 0) {
      samples = new Float32Array(trimSamples);
      samples.set(body.subarray(0, Math.min(body.length, trimSamples)));
    }

    return {
      samples,
      sampleRate: this.ctx.sampleRate,
      durationSec: samples.length / this.ctx.sampleRate,
    };
  }
}
