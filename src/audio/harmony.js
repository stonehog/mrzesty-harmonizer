/**
 * Post-recording formant-preserving vocal harmony & studio ADT doubler engine.
 *
 * Pre-renders each enabled harmony voice and the vocal doubler from the selected
 * dry vocal track's Float32Array samples (with exact STFT latency compensation)
 * and schedules them as sample-aligned AudioBufferSourceNodes locked to the loop
 * transport. Each voice and the doubler has its own GainNode so volume tweaks and
 * mute/enable toggles are instantaneous during playback.
 */

import {
  DOUBLER_PRESETS,
  renderOfflineVoice,
  renderOfflineDoubler,
} from './pitchShiftDsp.js';

export { DOUBLER_PRESETS };

/** Interval presets (semitones relative to root), including micro-shift doubling */
export const INTERVALS = [
  { id: 'dblDown', label: 'Double −12¢', semitones: -0.12 },
  { id: 'dblUp', label: 'Double +12¢', semitones: 0.12 },
  { id: 'm3', label: 'Minor 3rd', semitones: 3 },
  { id: 'M3', label: 'Major 3rd', semitones: 4 },
  { id: 'P4', label: 'Perfect 4th', semitones: 5 },
  { id: 'P5', label: 'Perfect 5th', semitones: 7 },
  { id: 'm6', label: 'Minor 6th', semitones: 8 },
  { id: 'M6', label: 'Major 6th', semitones: 9 },
  { id: 'P8', label: 'Octave ↑', semitones: 12 },
  { id: 'P8d', label: 'Octave ↓', semitones: -12 },
];

/**
 * @typedef {Object} VoiceConfig
 * @property {boolean} enabled
 * @property {number} volume  0–1
 * @property {number} semitones
 */

/**
 * @typedef {Object} DoublerConfig
 * @property {boolean} enabled
 * @property {number} widthCents  8 | 15 | 25
 * @property {number} volume      0–1
 */

export class HarmonyEngine {
  /**
   * @param {AudioContext} ctx
   * @param {number} voiceCount
   */
  constructor(ctx, voiceCount = 3) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.6;

    /** @type {Array<{ gain: GainNode, config: VoiceConfig, buffer: AudioBuffer | null, cacheKey: string, source: AudioBufferSourceNode | null }>} */
    this.voices = [];

    const defaults = [
      { enabled: true, volume: 0.45, semitones: 4 },
      { enabled: true, volume: 0.4, semitones: 7 },
      { enabled: false, volume: 0.35, semitones: 12 },
    ];

    for (let i = 0; i < voiceCount; i++) {
      const cfg = { ...(defaults[i] || { enabled: false, volume: 0.35, semitones: 7 }) };
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.masterGain);
      this.voices.push({
        gain,
        config: cfg,
        buffer: null,
        cacheKey: '',
        source: null,
      });
    }

    const doublerGain = ctx.createGain();
    doublerGain.gain.value = 0;
    doublerGain.connect(this.masterGain);

    /** @type {{ gain: GainNode, config: DoublerConfig, buffer: AudioBuffer | null, cacheKey: string, source: AudioBufferSourceNode | null }} */
    this.doubler = {
      gain: doublerGain,
      config: {
        enabled: false,
        widthCents: 15,
        volume: 0.55,
      },
      buffer: null,
      cacheKey: '',
      source: null,
    };

    /** @type {Float32Array | null} */
    this._sourceSamples = null;
    this._sourceRate = ctx.sampleRate;
    this._sourceKey = '';

    /** @type {Map<string, AudioBuffer>} */
    this._renderCache = new Map();

    this._moduleEnabled = false;
    this._driveEnabled = true;
    this._playing = false;
    this._playStart = 0;
    this._loopSeconds = 0;
    this._autoLoop = true;
  }

  async init() {
    // Post-recording pre-rendered architecture needs no async worklet setup
  }

  /**
   * @param {AudioNode} dest
   */
  connect(dest) {
    this.masterGain.connect(dest);
  }

  disconnect() {
    try {
      this.masterGain.disconnect();
    } catch {
      /* */
    }
  }

  setMasterVolume(v) {
    this.masterGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)),
      this.ctx.currentTime,
      0.02
    );
  }

  /**
   * Update dry vocal source samples to harmonize/double.
   * @param {Float32Array | null} samples
   * @param {number} sampleRate
   * @param {string} sourceKey
   */
  setSourceAudio(samples, sampleRate, sourceKey) {
    const changed = this._sourceKey !== sourceKey || this._sourceSamples !== samples;
    this._sourceSamples = samples && samples.length > 0 ? samples : null;
    this._sourceRate = sampleRate || this.ctx.sampleRate;
    this._sourceKey = sourceKey || '';

    if (!this._sourceSamples) {
      this.stopPlayback();
      this._applyGains();
      return;
    }

    if (changed && this._moduleEnabled && this._driveEnabled) {
      this._ensureRenderedBuffers();
      if (this._playing) {
        this._restartActiveSources();
      }
    }
    this._applyGains();
  }

  /**
   * @param {boolean} enabled
   * @param {boolean} [driveEnabled=true]
   */
  setEnabledState(enabled, driveEnabled = true) {
    const wasActive = this._moduleEnabled && this._driveEnabled;
    this._moduleEnabled = !!enabled;
    this._driveEnabled = !!driveEnabled;
    const nowActive = this._moduleEnabled && this._driveEnabled;

    if (nowActive && this._sourceSamples) {
      this._ensureRenderedBuffers();
      if (this._playing && !wasActive) {
        this._restartActiveSources();
      }
    }
    this._applyGains();
  }

  /**
   * @param {number} index
   * @param {Partial<VoiceConfig>} patch
   */
  updateVoice(index, patch) {
    const voice = this.voices[index];
    if (!voice) return;
    const prevSemi = voice.config.semitones;
    const prevEnabled = voice.config.enabled;
    Object.assign(voice.config, patch);

    if (this._moduleEnabled && this._driveEnabled && voice.config.enabled && this._sourceSamples) {
      const changedBuffer = this._ensureVoiceBuffer(voice, index);
      if (this._playing && (changedBuffer || !prevEnabled || !voice.source || prevSemi !== voice.config.semitones)) {
        this._startLayerSource(voice);
      }
    }
    this._applyGains();
  }

  /**
   * @param {Partial<DoublerConfig>} patch
   */
  updateDoubler(patch) {
    const prevWidth = this.doubler.config.widthCents;
    const prevEnabled = this.doubler.config.enabled;
    if (typeof patch.enabled === 'boolean') this.doubler.config.enabled = patch.enabled;
    if (typeof patch.widthCents === 'number') this.doubler.config.widthCents = patch.widthCents;
    if (typeof patch.volume === 'number') {
      this.doubler.config.volume = Math.max(0, Math.min(1, patch.volume));
    }

    if (this._moduleEnabled && this._driveEnabled && this.doubler.config.enabled && this._sourceSamples) {
      const changedBuffer = this._ensureDoublerBuffer();
      if (
        this._playing &&
        (changedBuffer || !prevEnabled || !this.doubler.source || prevWidth !== this.doubler.config.widthCents)
      ) {
        this._startLayerSource(this.doubler);
      }
    }
    this._applyGains();
  }

  getVoiceConfigs() {
    return this.voices.map((v) => ({ ...v.config }));
  }

  getDoublerConfig() {
    return { ...this.doubler.config };
  }

  _applyGains() {
    const now = this.ctx.currentTime;
    const active = this._moduleEnabled && this._driveEnabled && !!this._sourceSamples;

    for (const v of this.voices) {
      const target = active && v.config.enabled ? v.config.volume : 0;
      v.gain.gain.setTargetAtTime(target, now, 0.015);
    }

    const dblTarget = active && this.doubler.config.enabled ? this.doubler.config.volume : 0;
    this.doubler.gain.gain.setTargetAtTime(dblTarget, now, 0.015);
  }

  _cachePut(key, audioBuffer) {
    if (this._renderCache.size >= 24) {
      const oldestKey = this._renderCache.keys().next().value;
      if (oldestKey) this._renderCache.delete(oldestKey);
    }
    this._renderCache.set(key, audioBuffer);
  }

  _ensureVoiceBuffer(voice, index) {
    if (!this._sourceSamples || !voice.config.enabled) return false;
    const semi = Number(voice.config.semitones) || 0;
    const key = `${this._sourceKey}:v:${semi.toFixed(3)}`;
    if (voice.cacheKey === key && voice.buffer) return false;

    let buf = this._renderCache.get(key) || null;
    if (!buf) {
      const rendered = renderOfflineVoice({
        sourceSamples: this._sourceSamples,
        sampleRate: this._sourceRate,
        semitones: semi,
        volume: 1.0,
      });
      if (rendered && rendered.length > 0) {
        buf = this.ctx.createBuffer(1, rendered.length, this._sourceRate);
        buf.getChannelData(0).set(rendered);
        this._cachePut(key, buf);
      }
    }
    voice.buffer = buf;
    voice.cacheKey = key;
    void index;
    return true;
  }

  _ensureDoublerBuffer() {
    if (!this._sourceSamples || !this.doubler.config.enabled) return false;
    const width = Number(this.doubler.config.widthCents) || 15;
    const key = `${this._sourceKey}:dbl:${width}`;
    if (this.doubler.cacheKey === key && this.doubler.buffer) return false;

    let buf = this._renderCache.get(key) || null;
    if (!buf) {
      const rendered = renderOfflineDoubler({
        sourceSamples: this._sourceSamples,
        sampleRate: this._sourceRate,
        widthCents: width,
        volume: 1.0,
      });
      if (rendered && rendered.length > 0) {
        buf = this.ctx.createBuffer(1, rendered.length, this._sourceRate);
        buf.getChannelData(0).set(rendered);
        this._cachePut(key, buf);
      }
    }
    this.doubler.buffer = buf;
    this.doubler.cacheKey = key;
    return true;
  }

  _ensureRenderedBuffers() {
    if (!this._sourceSamples) return;
    this.voices.forEach((v, i) => {
      if (v.config.enabled) this._ensureVoiceBuffer(v, i);
    });
    if (this.doubler.config.enabled) {
      this._ensureDoublerBuffer();
    }
  }

  /**
   * Start pre-rendered harmony + doubler buffers at exact transport start time.
   * @param {number} when
   * @param {number} loopSeconds
   * @param {boolean} autoLoop
   */
  startPlayback(when, loopSeconds, autoLoop) {
    this._stopAllSources();
    this._playing = true;
    this._playStart = when;
    this._loopSeconds = loopSeconds;
    this._autoLoop = !!autoLoop;

    if (this._moduleEnabled && this._driveEnabled && this._sourceSamples) {
      this._ensureRenderedBuffers();
      for (const v of this.voices) {
        if (v.config.enabled && v.buffer) {
          this._startLayerSourceAt(v, when, 0);
        }
      }
      if (this.doubler.config.enabled && this.doubler.buffer) {
        this._startLayerSourceAt(this.doubler, when, 0);
      }
    }
    this._applyGains();
  }

  _restartActiveSources() {
    if (!this._playing) return;
    for (const v of this.voices) {
      if (v.config.enabled && v.buffer) {
        this._startLayerSource(v);
      } else {
        this._stopLayerSource(v);
      }
    }
    if (this.doubler.config.enabled && this.doubler.buffer) {
      this._startLayerSource(this.doubler);
    } else {
      this._stopLayerSource(this.doubler);
    }
  }

  _startLayerSource(layer) {
    this._stopLayerSource(layer);
    if (!this._playing || !layer.buffer) return;

    const now = this.ctx.currentTime;
    if (now < this._playStart) {
      this._startLayerSourceAt(layer, this._playStart, 0);
      return;
    }

    const dur = layer.buffer.duration;
    if (dur <= 0) return;
    const elapsed = now - this._playStart;
    const loopSpan = this._loopSeconds > 0 ? Math.min(this._loopSeconds, dur) : dur;
    const offset = this._autoLoop && loopSpan > 0 ? elapsed % loopSpan : elapsed;
    if (!this._autoLoop && offset >= dur) return;

    this._startLayerSourceAt(layer, now, Math.max(0, Math.min(offset, dur - 0.005)));
  }

  _startLayerSourceAt(layer, when, offset) {
    this._stopLayerSource(layer);
    if (!layer.buffer) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = layer.buffer;
      src.loop = this._autoLoop;
      src.connect(layer.gain);
      src.start(when, offset);
      layer.source = src;
    } catch {
      /* */
    }
  }

  _stopLayerSource(layer) {
    if (!layer.source) return;
    try {
      layer.source.stop();
      layer.source.disconnect();
    } catch {
      /* */
    }
    layer.source = null;
  }

  _stopAllSources() {
    for (const v of this.voices) this._stopLayerSource(v);
    this._stopLayerSource(this.doubler);
  }

  stopPlayback() {
    this._playing = false;
    this._stopAllSources();
  }

  dispose() {
    this.stopPlayback();
    for (const v of this.voices) {
      try {
        v.gain.disconnect();
      } catch {
        /* */
      }
    }
    try {
      this.doubler.gain.disconnect();
    } catch {
      /* */
    }
    this._renderCache.clear();
    this.disconnect();
    this.voices = [];
  }
}
