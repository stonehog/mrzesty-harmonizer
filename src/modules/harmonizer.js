/**
 * Post-recording harmonizer & vocal doubler module.
 *
 * Operates strictly on recorded vocal tracks (Vox 1, Vox 2, Vox 3, or All Vox) —
 * never on the live mic during singing. Pre-renders formant-preserved harmony voices
 * and/or micro-pitch shifted ADT vocal doubling locked to the dry vocal buffer with
 * zero latency lag.
 */

import { detectPitch, hzToNote, PitchSmoother, CLARITY_GATE } from '../audio/pitch.js';
import { HarmonyEngine, INTERVALS, DOUBLER_PRESETS } from '../audio/harmony.js';

export { INTERVALS, DOUBLER_PRESETS };

const ANALYSER_SIZE = 2048;
/** Pitch readout refresh (Hz). The needle doesn't need 60 fps; 20 is smooth to the eye. */
export const PITCH_HZ = 20;
export const PITCH_HZ_LITE = 8;

export class HarmonizerModule {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination  mix bus
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.enabled = false;
    this.driveEnabled = true;
    /** @type {'track' | 'all'} */
    this.source = 'track';
    this.trackIndex = 0;

    this.harmony = new HarmonyEngine(ctx, 3);
    this.harmony.connect(destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = ANALYSER_SIZE;
    this.analyser.smoothingTimeConstant = 0.5;
    this._timeDomain = new Float32Array(ANALYSER_SIZE);
    this._smoother = new PitchSmoother({ clarityGate: CLARITY_GATE });

    /** @type {AudioNode[]} */
    this._analyserInputs = [];
    this._raf = 0;
    this._lastTick = 0;
    this._playing = false;
    this.lite = false;
    this._yin = new Float32Array(Math.ceil(ctx.sampleRate / 60) + 2);

    this.pitchInfo = { frequency: null, note: '—', cents: 0, clarity: 0 };
    /** @type {((info: typeof this.pitchInfo) => void) | null} */
    this.onPitch = null;
  }

  async init() {
    await this.harmony.init();
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.harmony.setEnabledState(this.enabled, this.driveEnabled);
    if (!this.enabled) {
      this._stopTick();
      this._smoother.reset();
      this.pitchInfo = { frequency: null, note: '—', cents: 0, clarity: 0 };
      this.onPitch?.(this.pitchInfo);
    } else {
      this._smoother.reset();
      this._startTick();
    }
  }

  /**
   * Mute harmony playback while recording a new take.
   * @param {boolean} on
   */
  setDriveEnabled(on) {
    this.driveEnabled = !!on;
    this.harmony.setEnabledState(this.enabled, this.driveEnabled);
  }

  /**
   * @param {'track' | 'all'} source
   * @param {number} [trackIndex]
   */
  setSource(source, trackIndex = 0) {
    if (source === 'all') {
      this.source = 'all';
    } else {
      this.source = 'track';
      this.trackIndex = Math.max(0, Math.min(2, Number(trackIndex) || 0));
    }
  }

  /**
   * Connect track gain node(s) into the pitch readout analyser.
   * @param {AudioNode | AudioNode[] | null} nodes
   */
  setInput(nodes) {
    for (const prev of this._analyserInputs) {
      try {
        prev.disconnect(this.analyser);
      } catch {
        /* */
      }
    }
    this._analyserInputs = [];
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes ? [nodes] : [];
    for (const n of list) {
      try {
        n.connect(this.analyser);
        this._analyserInputs.push(n);
      } catch {
        /* */
      }
    }
    if (this._analyserInputs.length === 0) {
      this._smoother.reset();
    }
  }

  /**
   * Provide the dry vocal samples from the target track(s) for pre-rendered harmony/doubling.
   * @param {Float32Array | null} samples
   * @param {number} sampleRate
   * @param {string} sourceKey
   */
  setSourceAudio(samples, sampleRate, sourceKey) {
    this.harmony.setSourceAudio(samples, sampleRate, sourceKey);
  }

  /**
   * Start sample-aligned harmony + doubler playback locked to transport start.
   * @param {number} when
   * @param {number} loopSeconds
   * @param {boolean} autoLoop
   */
  startPlayback(when, loopSeconds, autoLoop) {
    this.harmony.startPlayback(when, loopSeconds, autoLoop);
    this._playing = true;
    if (this.enabled) this._startTick();
  }

  stopPlayback() {
    this.harmony.stopPlayback();
    this._playing = false;
    this._stopTick();
    this._smoother.reset();
    this.pitchInfo = { frequency: null, note: '—', cents: 0, clarity: 0 };
    this.onPitch?.(this.pitchInfo);
  }

  setMasterVolume(v) {
    this.harmony.setMasterVolume(v);
  }

  updateVoice(index, patch) {
    this.harmony.updateVoice(index, patch);
  }

  updateDoubler(patch) {
    this.harmony.updateDoubler(patch);
  }

  getVoiceConfigs() {
    return this.harmony.getVoiceConfigs();
  }

  getDoublerConfig() {
    return this.harmony.getDoublerConfig();
  }

  applyVoiceConfigs(configs) {
    if (!configs) return;
    configs.forEach((c, i) => this.harmony.updateVoice(i, c));
  }

  applyDoublerConfig(cfg) {
    if (!cfg) return;
    this.harmony.updateDoubler(cfg);
  }

  /**
   * Apply a quick vocal mode preset:
   * - 'double-only': Doubler ON, all interval harmony voices OFF (thickens vocal, no harmony)
   * - 'double-triad': Doubler ON + Major 3rd (+4st) & Perfect 5th (+7st) ON
   * - 'harmony-only': Doubler OFF + Major 3rd (+4st) & Perfect 5th (+7st) ON
   * @param {'double-only' | 'double-triad' | 'harmony-only'} presetId
   */
  applyPreset(presetId) {
    if (presetId === 'double-only') {
      this.harmony.updateDoubler({ enabled: true });
      this.harmony.updateVoice(0, { enabled: false });
      this.harmony.updateVoice(1, { enabled: false });
      this.harmony.updateVoice(2, { enabled: false });
    } else if (presetId === 'double-triad') {
      this.harmony.updateDoubler({ enabled: true });
      this.harmony.updateVoice(0, { enabled: true, semitones: 4 });
      this.harmony.updateVoice(1, { enabled: true, semitones: 7 });
      this.harmony.updateVoice(2, { enabled: false });
    } else if (presetId === 'harmony-only') {
      this.harmony.updateDoubler({ enabled: false });
      this.harmony.updateVoice(0, { enabled: true, semitones: 4 });
      this.harmony.updateVoice(1, { enabled: true, semitones: 7 });
      this.harmony.updateVoice(2, { enabled: false });
    }
  }

  _startTick() {
    // Pitch readout only matters while the transport is playing back a take.
    if (this._raf || !this._playing) return;
    this._lastTick = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  _stopTick() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _tick = (now = performance.now()) => {
    this._raf = 0;
    if (!this.enabled || !this._playing) return;
    const interval = 1000 / (this.lite ? PITCH_HZ_LITE : PITCH_HZ);
    if ((typeof document !== 'undefined' && document.hidden) || now - this._lastTick < interval) {
      this._raf = requestAnimationFrame(this._tick);
      return;
    }
    this._lastTick = now;

    this.analyser.getFloatTimeDomainData(this._timeDomain);
    const raw = detectPitch(this._timeDomain, this.ctx.sampleRate, undefined, this._yin);
    const stable = this._smoother.push(raw);

    if (stable.frequency != null) {
      const { note, cents } = hzToNote(stable.frequency);
      this.pitchInfo = {
        frequency: stable.frequency,
        note,
        cents,
        clarity: stable.clarity,
      };
    } else {
      this.pitchInfo = {
        frequency: null,
        note: '—',
        cents: 0,
        clarity: stable.clarity,
      };
    }

    this.onPitch?.(this.pitchInfo);
    this._raf = requestAnimationFrame(this._tick);
  };

  dispose() {
    this._stopTick();
    this.setInput(null);
    this.harmony.dispose();
  }
}
