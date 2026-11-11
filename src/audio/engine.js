/**
 * MrZesty sketchpad engine — loop frame, multi-track vocals,
 * sampled style kits (8 styles, groove swing, bass key / octave / voice, chops/keys lane),
 * post-recording formant harmonizer + vocal doubler, mixdown.
 *
 * Vocal track buffers are always dry mic captures. Harmony and doubling operate
 * strictly post-recording on the recorded vocal tracks (Vox 1–3 or All Vox).
 */

import {
  MicCapture,
  encodeWav,
  DEFAULT_MIC_GAIN_DB,
  applyMicGainAndLimit,
  peakNormalize,
  peakOf,
  peakDb,
  softLimitSample,
  dbToGain,
  AUTO_LEVEL_TARGET_DBFS,
  prepareCaptureWorklet,
} from './recorder.js';
import { VocalTrack, startTrackSource } from './tracks.js';
import {
  getDrumPattern,
  getBassPattern,
  getChopPattern,
  getStyleProfile,
  scheduleStepHits,
  triggerClick,
  STEPS_PER_BAR,
  BEATS_PER_BAR,
} from './kits.js';
import {
  countInPlan,
  countInNumberAt,
  takeAlignOffsetSamples,
} from './countIn.js';
import { loadSampleBank, samplesReady, setFxReturn, setFxEnabled, setFxLaneLevel } from './sampler.js';
import { bounceMix } from './mixdown.js';
import { HarmonizerModule } from '../modules/harmonizer.js';

const TRACK_COUNT = 3;
/** Scheduler tick (ms) and how far ahead each tick books hits (s). The tick only books
 * the handful of 16th-notes that fall inside the window, so it stays well under 1 ms. */
export const LOOKAHEAD_MS = 25;
export const SCHEDULE_AHEAD = 0.12;
/** Lite mode books further ahead so a busy main thread can't starve the scheduler. */
export const SCHEDULE_AHEAD_LITE = 0.2;
/** Wait this long after the last vox fader move before re-rendering All Vox harmony. */
const HARMONY_RERENDER_DEBOUNCE_MS = 400;
/** Never compensate more than this much output latency on a take (s). */
const MAX_LATENCY_COMP = 0.3;
const PHRASE_MAX_SEC = 60;

export class SketchpadEngine {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    this.ready = false;

    this.bpm = 84;
    this.bars = 4;
    this.autoLoop = true;
    this.metronome = false;
    /** Groove swing: 0.0 (straight) to 0.65 (deep shuffle). 0.50 = 2:1 triplet swing. */
    this.swing = 0.30;

    this.playing = false;
    this.recording = false;
    this.armedIndex = 0;
    /** 1 = one bar of clicks before a take; 0 = start right away. Default on. */
    this.countInBars = 1;
    this.countingIn = false;
    this.countInNumber = 0;
    /** Audio-clock time the take should line up with (record downbeat). */
    this._recAlignTime = 0;
    this._countInBeats = null;
    this._countInNodes = [];
    this._wasPlayingBeforeRecord = false;

    this.tracks = Array.from({ length: TRACK_COUNT }, (_, i) => new VocalTrack('Vox ' + (i + 1)));
    this.tracks[0].armed = true;

    this.drumsOn = false;
    this.bassOn = false;
    this.drumsMute = false;
    this.bassMute = false;
    this.drumVolume = 0.85;
    this.bassVolume = 0.85;
    this.chopsOn = false;
    this.chopsMute = false;
    this.chopVolume = 0.85;
    this.styleId = 'triphop';
    this.drumPatternId = 'triphop';
    this.bassPatternId = 'triphop';
    /** Groove density variation: 'sparse' | 'core' | 'busy' */
    this.variation = 'core';
    /** When true, switching styles keeps current BPM even if no vocals are recorded */
    this.lockTempo = false;
    /** Semitone offset from A for bass root key (shared with harmonizer Scale Key) */
    this.bassRootSemis = 0;
    /** Bass octave shift: -1 | 0 | +1 */
    this.bassOctave = 0;
    /** Bass voice override: 'auto' | 'upright' | 'electric' | '808' | '808slide' | 'synth' */
    this.bassVoice = 'auto';
    /** Sample bank status: 'idle' | 'loading' | 'ready' | 'fallback' */
    this.sampleStatus = 'idle';
    this.masterVolume = 0.7;
    /** Lite mode: no live reverb/delay, longer lookahead, 'playback' latency at audio start. */
    this.liteMode = false;
    /** Capture path actually used for the last take: 'worklet' | 'scriptprocessor'. */
    this.captureMode = 'none';
    this._useWorklet = false;

    /** Mic pre-amp in dB, applied before the take is written (0..+24). */
    this.micGainDb = DEFAULT_MIC_GAIN_DB;
    /** Peak-normalize each finished take to -3 dBFS before harmony / doubler. */
    this.micAutoLevel = true;
    /** Keep the mic open for the input meter after the first permission grant. */
    this.micMonitor = false;
    this._micClipUntil = 0;
    /** @type {AnalyserNode | null} */
    this.micAnalyser = null;
    /** @type {Float32Array | null} */
    this._micMeterBuf = null;
    /** @type {GainNode | null} */
    this._micSilent = null;

    /** @type {GainNode | null} */
    this.masterGain = null;
    /** @type {GainNode | null} */
    this.mixBus = null;
    /** @type {GainNode | null} */
    this.drumGain = null;
    /** @type {GainNode | null} */
    this.bassGain = null;
    /** @type {GainNode | null} */
    this.chopGain = null;
    /** @type {GainNode | null} */
    this.metroGain = null;
    /** @type {GainNode[]} */
    this.trackGains = [];

    /** @type {MediaStream | null} */
    this.stream = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    this.micSource = null;
    /** @type {MicCapture | null} */
    this.capture = null;

    /** @type {HarmonizerModule | null} */
    this.harmonizer = null;

    this._timer = 0;
    this._nextNoteTime = 0;
    this._currentStep = 0;
    this._playStart = 0;
    this._recStartTime = 0;
    /** @type {AudioBufferSourceNode[]} */
    this._sources = [];
    this._phraseStopAt = 0;
    this.ideaId = null;
    this.ideaName = 'Untitled idea';

    /** @type {((info: object) => void) | null} */
    this.onPitch = null;
    /** @type {((step: number, bar: number, beat: number) => void) | null} */
    this.onBeat = null;
    /** @type {((n: number) => void) | null} */
    this.onCountIn = null;
    /** @type {(() => void) | null} */
    this.onState = null;
    /** @type {((msg: string) => void) | null} */
    this.onStatus = null;
  }

  /** Loop / frame length in seconds: bars × 4 beats × (60 / BPM). */
  loopSeconds() {
    return (60 / this.bpm) * BEATS_PER_BAR * this.bars;
  }

  stepSeconds() {
    return 60 / this.bpm / 4;
  }

  get isRecording() {
    return this.recording;
  }

  _emitState() {
    this.onState?.();
  }

  _status(msg) {
    this.onStatus?.(msg);
  }

  async init() {
    if (this.ready && this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    // 'interactive' (small buffers) by default; Lite asks for 'playback' (bigger, steadier
    // buffers). Takes are latency-compensated either way, so vocal sync is unaffected.
    try {
      this.ctx = new AC({ latencyHint: this.liteMode ? 'playback' : 'interactive' });
    } catch {
      this.ctx = new AC();
    }
    this.latencyHint = this.liteMode ? 'playback' : 'interactive';
    // iOS / iPadOS Safari 16.4+: play Web Audio even with the silent switch on.
    setAudioSession('playback');
    unlockAudio(this.ctx); // must run synchronously inside the first tap on iOS
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this.mixBus = this.ctx.createGain();
    // Gentle bus limiter so stacked samples (808 + bass + vocals) never clip the output
    this.busLimiter = createBusLimiter(this.ctx);
    this.mixBus.connect(this.busLimiter);
    this.busLimiter.connect(this.masterGain);
    // One shared reverb + delay for every lane, returning into the mix bus.
    setFxReturn(this.ctx, this.mixBus);
    setFxEnabled(this.ctx, !this.liteMode);

    this.drumGain = this.ctx.createGain();
    this.drumGain.gain.value = this.drumsMute ? 0 : this.drumVolume;
    this.drumGain.connect(this.mixBus);

    this.bassGain = this.ctx.createGain();
    this.bassGain.gain.value = this.bassMute ? 0 : this.bassVolume;
    this.bassGain.connect(this.mixBus);

    this.chopGain = this.ctx.createGain();
    this.chopGain.gain.value = this.chopsMute ? 0 : this.chopVolume;
    this.chopGain.connect(this.mixBus);

    this.metroGain = this.ctx.createGain();
    this.metroGain.gain.value = 0.55;
    this.metroGain.connect(this.masterGain);

    this.trackGains = this.tracks.map((t) => {
      const g = this.ctx.createGain();
      g.gain.value = t.volume;
      g.connect(this.mixBus);
      return g;
    });

    this.harmonizer = new HarmonizerModule(this.ctx, this.mixBus);
    this.harmonizer.onPitch = (info) => this.onPitch?.(info);
    await this.harmonizer.init();

    this._applyKitGains();
    // Recording runs on the audio thread (AudioWorklet) when the browser supports it.
    this._useWorklet = await prepareCaptureWorklet(this.ctx);

    this.ready = true;
    this._emitState();
    await this.loadSamples();
  }

  /** Fetch + decode the bundled CC0 one-shots (drums, basses, keys). */
  async loadSamples() {
    if (!this.ctx || samplesReady()) {
      this.sampleStatus = samplesReady() ? 'ready' : this.sampleStatus;
      this._status('Audio ready · sampled kits loaded');
      return;
    }
    this.sampleStatus = 'loading';
    this._status('Loading studio samples…');
    try {
      const res = await loadSampleBank(this.ctx, (done, total) => {
        if (done % 10 === 0 || done === total) this._status(`Loading studio samples… ${done}/${total}`);
      });
      if (res.loaded > 0) {
        this.sampleStatus = 'ready';
        this._status(
          'Audio ready · ' + res.loaded + ' sampled sounds loaded' +
            (res.failed.length ? ' (' + res.failed.length + ' missing, synth fallback)' : '')
        );
      } else {
        this.sampleStatus = 'fallback';
        this._status('Audio ready · samples unavailable, using synth fallback');
      }
    } catch {
      this.sampleStatus = 'fallback';
      this._status('Audio ready · samples unavailable, using synth fallback');
    }
    this._emitState();
  }

  async ensureMic() {
    await this.init();
    if (this.stream && this.micSource) return;
    setAudioSession('play-and-record');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.micSource = this.ctx.createMediaStreamSource(this.stream);
    this._connectMicMeter();
  }

  /**
   * Open the mic for the input meter without starting a take.
   * Safe to call from Enable Audio; failures are non-fatal for playback.
   */
  async startMicMonitor() {
    await this.ensureMic();
    this.micMonitor = true;
    this._emitState();
  }

  /**
   * Close the mic meter (and the mic itself unless a take is recording). Closing the mic
   * matters on Bluetooth headsets: while their mic is open, macOS holds them in low-quality
   * "call" mode, which makes playback sound thin and choppy.
   */
  stopMicMonitor() {
    this.micMonitor = false;
    this.releaseMicIfIdle();
    this._emitState();
  }

  /** True while the input meter has something to show. */
  get micMeterActive() {
    return !!(this.micAnalyser && (this.micMonitor || this.recording || this.countingIn));
  }

  /**
   * Lite mode: no live reverb / delay sends and a longer scheduler lookahead. The
   * 'playback' latency hint applies the next time audio starts (page reload).
   * @param {boolean} on
   */
  setLiteMode(on) {
    this.liteMode = !!on;
    if (this.ctx) setFxEnabled(this.ctx, !this.liteMode);
    this._emitState();
  }

  _connectMicMeter() {
    if (!this.ctx || !this.micSource) return;
    this._disconnectMicMeter();
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    this.micAnalyser.smoothingTimeConstant = 0.25;
    this._micMeterBuf = new Float32Array(this.micAnalyser.fftSize);
    this._micSilent = this.ctx.createGain();
    this._micSilent.gain.value = 0;
    this.micSource.connect(this.micAnalyser);
    this.micAnalyser.connect(this._micSilent);
    this._micSilent.connect(this.ctx.destination);
  }

  _disconnectMicMeter() {
    try {
      this.micAnalyser?.disconnect();
    } catch {
      /* */
    }
    try {
      this._micSilent?.disconnect();
    } catch {
      /* */
    }
    this.micAnalyser = null;
    this._micSilent = null;
    this._micMeterBuf = null;
  }

  /**
   * Live post-gain meter for the MIC GAIN strip.
   * @returns {{ peak: number, peakDb: number, rawPeak: number, clipping: boolean, clipHold: boolean }}
   */
  getMicMeter() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    let rawPeak = 0;
    if (this.micAnalyser && this._micMeterBuf) {
      this.micAnalyser.getFloatTimeDomainData(this._micMeterBuf);
      rawPeak = peakOf(this._micMeterBuf);
    }
    const postGain = rawPeak * dbToGain(this.micGainDb);
    const peak = Math.abs(softLimitSample(postGain));
    const clipping = postGain >= 0.99;
    if (clipping) this._micClipUntil = now + 0.8;
    return {
      rawPeak,
      peak,
      peakDb: peakDb(peak),
      clipping,
      clipHold: now < (this._micClipUntil || 0) || clipping,
    };
  }

  setMicGainDb(db) {
    const n = Number(db);
    this.micGainDb = Math.max(0, Math.min(24, Number.isFinite(n) ? n : DEFAULT_MIC_GAIN_DB));
  }

  setMicAutoLevel(on) {
    this.micAutoLevel = !!on;
  }

  releaseMicIfIdle() {
    if (this.recording || this.micMonitor || this.countingIn) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this._disconnectMicMeter();
    try {
      this.micSource?.disconnect();
    } catch {
      /* */
    }
    this.micSource = null;
    setAudioSession('playback');
  }

  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.03);
    }
  }

  setBpm(bpm) {
    this.bpm = Math.max(40, Math.min(200, Number(bpm) || 90));
    this._emitState();
  }

  setBars(bars) {
    this.bars = [1, 2, 4, 8].includes(Number(bars)) ? Number(bars) : 4;
    this._emitState();
  }

  setAutoLoop(on) {
    this.autoLoop = !!on;
    this._emitState();
  }

  setMetronome(on) {
    this.metronome = !!on;
  }

  setSwing(swing) {
    this.swing = Math.max(0, Math.min(0.65, Number(swing) || 0));
    this._emitState();
  }

  setBassRoot(semitones) {
    this.bassRootSemis = Math.max(-12, Math.min(12, Number(semitones) || 0));
    this._emitState();
  }

  setBassOctave(oct) {
    const n = Math.round(Number(oct) || 0);
    this.bassOctave = Math.max(-1, Math.min(1, n));
    this._emitState();
  }

  setBassVoice(voice) {
    const ok = ['auto', 'upright', 'electric', '808', '808slide', 'synth'];
    this.bassVoice = ok.includes(voice) ? voice : 'auto';
    this._emitState();
  }

  setDrumsOn(on) {
    this.drumsOn = !!on;
    this._emitState();
  }

  setBassOn(on) {
    this.bassOn = !!on;
    this._emitState();
  }

  setDrumsMute(mute) {
    this.drumsMute = !!mute;
    this._applyKitGains();
    this._emitState();
  }

  setBassMute(mute) {
    this.bassMute = !!mute;
    this._applyKitGains();
    this._emitState();
  }

  setDrumVolume(v) {
    this.drumVolume = Math.max(0, Math.min(1, v));
    this._applyKitGains();
  }

  setBassVolume(v) {
    this.bassVolume = Math.max(0, Math.min(1, v));
    this._applyKitGains();
  }

  setChopsOn(on) {
    this.chopsOn = !!on;
    this._emitState();
  }

  setChopsMute(mute) {
    this.chopsMute = !!mute;
    this._applyKitGains();
    this._emitState();
  }

  setChopVolume(v) {
    this.chopVolume = Math.max(0, Math.min(1, v));
    this._applyKitGains();
  }

  _applyKitGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.drumGain) {
      this.drumGain.gain.setTargetAtTime(this.drumsMute ? 0 : this.drumVolume, now, 0.02);
    }
    if (this.bassGain) {
      this.bassGain.gain.setTargetAtTime(this.bassMute ? 0 : this.bassVolume, now, 0.02);
    }
    if (this.chopGain) {
      this.chopGain.gain.setTargetAtTime(this.chopsMute ? 0 : this.chopVolume, now, 0.02);
    }
    // Shared reverb / delay sends follow each lane's fader and mute.
    if (this.drumGain) setFxLaneLevel(this.ctx, this.drumGain, this.drumsMute ? 0 : this.drumVolume);
    if (this.bassGain) setFxLaneLevel(this.ctx, this.bassGain, this.bassMute ? 0 : this.bassVolume);
    if (this.chopGain) setFxLaneLevel(this.ctx, this.chopGain, this.chopsMute ? 0 : this.chopVolume);
  }

  setDrumPattern(id, applyDefaultSwing = true) {
    const pat = getDrumPattern(id);
    this.drumPatternId = pat.id;
    if (applyDefaultSwing && typeof pat.defaultSwing === 'number') {
      this.swing = pat.defaultSwing;
    }
    if (this.bassPatternId === this.drumPatternId) {
      this.styleId = this.drumPatternId;
    }
    this._emitState();
  }

  setBassPattern(id) {
    const pat = getBassPattern(id);
    this.bassPatternId = pat.id;
    if (this.bassPatternId === this.drumPatternId) {
      this.styleId = this.bassPatternId;
    }
    this._emitState();
  }

  setVariation(mode) {
    if (['sparse', 'core', 'busy'].includes(mode)) {
      this.variation = mode;
      this._emitState();
    }
  }

  setLockTempo(on) {
    this.lockTempo = !!on;
    this._emitState();
  }

  hasRecordedVocals() {
    return this.tracks.some((t) => t.hasAudio);
  }

  /**
   * Intelligently apply a musical style across Drums, Bass, Swing, Timbre, and (when safe) BPM.
   * Preserves recorded vocal sync by keeping current BPM if vocal tracks already exist
   * unless forceBpm is true.
   */
  applyStyle(styleId, opts = {}) {
    const profile = getStyleProfile(styleId);
    this.styleId = profile.id;
    this.drumPatternId = opts.drumPatternId ? getDrumPattern(opts.drumPatternId).id : profile.id;
    this.bassPatternId = opts.bassPatternId ? getBassPattern(opts.bassPatternId).id : profile.id;
    this.swing = typeof opts.swing === 'number' ? opts.swing : profile.defaultSwing;

    if (opts.variation && ['sparse', 'core', 'busy'].includes(opts.variation)) {
      this.variation = opts.variation;
    }

    const canChangeTempo = opts.forceBpm || (!this.lockTempo && !this.hasRecordedVocals());
    if (canChangeTempo) {
      const targetBpm = typeof opts.bpm === 'number' ? opts.bpm : profile.defaultBpm;
      this.bpm = Math.max(40, Math.min(200, targetBpm));
    }

    if (typeof opts.bassRootSemis === 'number') {
      this.bassRootSemis = Math.max(-12, Math.min(12, opts.bassRootSemis));
    }

    if (opts.enableKits !== false) {
      this.drumsOn = true;
      this.bassOn = true;
      this.chopsOn = true;
    }

    const tempoNote = canChangeTempo
      ? this.bpm + ' BPM'
      : this.bpm + ' BPM (locked to vocal take)';
    this._status('Style: ' + profile.shortName + ' · ' + profile.title + ' (' + tempoNote + ')');
    this._emitState();
    return profile;
  }

  armTrack(index) {
    this.tracks.forEach((t, i) => {
      t.armed = i === index;
    });
    this.armedIndex = index;
    this._emitState();
  }

  setTrackMute(index, mute) {
    const t = this.tracks[index];
    if (!t) return;
    t.mute = mute;
    const g = this.trackGains[index];
    if (g && this.ctx) {
      g.gain.setTargetAtTime(mute ? 0 : t.volume, this.ctx.currentTime, 0.02);
    }
    if (this.harmonizer?.source === 'all') {
      this._routeHarmonyInput();
    }
    this._emitState();
  }

  setTrackVolume(index, volume) {
    const t = this.tracks[index];
    if (!t) return;
    t.volume = Math.max(0, Math.min(1, volume));
    const g = this.trackGains[index];
    if (g && this.ctx && !t.mute) {
      g.gain.setTargetAtTime(t.volume, this.ctx.currentTime, 0.02);
    }
    if (this.harmonizer?.source === 'all') {
      // All Vox harmony is pre-rendered from the level-weighted mix (~1 s of DSP for a
      // 3 x 11 s stack). Re-render once the fader stops moving, not on every drag tick.
      clearTimeout(this._harmRerouteTimer);
      this._harmRerouteTimer = setTimeout(() => this._routeHarmonyInput(), HARMONY_RERENDER_DEBOUNCE_MS);
    }
  }

  clearTrack(index) {
    this.tracks[index]?.clear();
    this._routeHarmonyInput();
    this._emitState();
  }

  async setHarmonyEnabled(on) {
    await this.init();
    this.harmonizer.setDriveEnabled(!this.recording);
    this._routeHarmonyInput();
    this.harmonizer.setEnabled(on);
    if (on) {
      const label =
        this.harmonizer.source === 'all'
          ? 'All Vox'
          : this.tracks[this.harmonizer.trackIndex]?.name || 'Vox 1';
      const hasAudio =
        this.harmonizer.source === 'all'
          ? this.tracks.some((t) => t.hasAudio && !t.mute)
          : !!this.tracks[this.harmonizer.trackIndex]?.hasAudio;
      this._status(
        hasAudio
          ? 'Harmonizer on (' + label + ')'
          : 'Harmonizer on — record ' + label + ' first, then Play'
      );
    } else {
      this._status('Harmonizer off');
    }
    this._emitState();
  }

  async setHarmonySource(source, trackIndex = 0) {
    await this.init();
    this.harmonizer.setSource(source, trackIndex);
    this._routeHarmonyInput();
    this._emitState();
  }

  updateHarmonyVoice(index, patch) {
    this.harmonizer?.updateVoice(index, patch);
    this._emitState();
  }

  updateHarmonyDoubler(patch) {
    this.harmonizer?.updateDoubler(patch);
    this._emitState();
  }

  async applyHarmonyPreset(presetId) {
    await this.init();
    if (!this.harmonizer) return;
    this.harmonizer.applyPreset(presetId);
    this._routeHarmonyInput();
    if (!this.harmonizer.enabled) {
      this.harmonizer.setDriveEnabled(!this.recording);
      this.harmonizer.setEnabled(true);
    }
    const presetNames = {
      'double-only': 'Double Only (No Harmony)',
      'double-triad': 'Double + Triad (M3 + P5)',
      'harmony-only': 'Harmony Only (M3 + P5)',
    };
    this._status('Vocal preset: ' + (presetNames[presetId] || presetId));
    this._emitState();
  }

  setHarmonyVolume(v) {
    this.harmonizer?.setMasterVolume(v);
  }

  _routeHarmonyInput() {
    if (!this.harmonizer || !this.ctx) return;
    if (this.harmonizer.source === 'all') {
      const mixed = mixTrackSamples(this.tracks, this.ctx.sampleRate);
      const revKey =
        'all:' +
        this.tracks
          .map((t, i) => `${i}:${t.revision}:${t.mute ? 0 : t.volume.toFixed(2)}`)
          .join('|');
      this.harmonizer.setSourceAudio(mixed, this.ctx.sampleRate, revKey);
      this.harmonizer.setInput(this.harmonizer.enabled ? this.trackGains : null);
    } else {
      const idx = this.harmonizer.trackIndex;
      const t = this.tracks[idx];
      const samples = t && t.hasAudio ? t.samples : null;
      const rate = (t && t.sampleRate) || this.ctx.sampleRate;
      const revKey = `track:${idx}:r${t ? t.revision : 0}`;
      this.harmonizer.setSourceAudio(samples, rate, revKey);
      const g = this.trackGains[idx];
      this.harmonizer.setInput(this.harmonizer.enabled && g ? g : null);
    }
  }

  async play(opts = {}) {
    await this.init();
    if (this.playing) return;
    this.playing = true;
    this._currentStep = 0;
    const startAt =
      typeof opts.at === 'number' && Number.isFinite(opts.at)
        ? opts.at
        : this.ctx.currentTime + 0.05;
    this._nextNoteTime = startAt;
    this._playStart = startAt;
    this._startTrackPlayback(this._playStart);

    if (!this.autoLoop && !this.recording) {
      this._phraseStopAt = this._playStart + this._phraseDuration();
    } else {
      this._phraseStopAt = 0;
    }

    this._timer = window.setInterval(() => this._scheduler(), LOOKAHEAD_MS);
    this._status(this.autoLoop ? 'Looping' : 'Playing phrase');
    this._emitState();
  }

  stop() {
    if (this.countingIn || this.recording) this._abortOrFinish(false);
    this._haltTransport();
    this._status('Stopped');
    this._emitState();
    this.onBeat?.(0, 1, 1);
  }

  _haltTransport() {
    this.playing = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
    this._stopTrackPlayback();
    this._currentStep = 0;
    this._phraseStopAt = 0;
  }

  async togglePlay() {
    if (this.playing) this.stop();
    else await this.play();
  }

  setCountIn(on) {
    this.countInBars = on ? 1 : 0;
    this._emitState();
  }

  /**
   * Current 4-3-2-1 count-in number at the audio clock, or 0 if none.
   * The UI should poll this from rAF (not a wall-clock timer).
   */
  countInDisplay(now) {
    if (!this.countingIn || !this._countInBeats) return 0;
    const t = Number.isFinite(now) ? now : this.ctx ? this.ctx.currentTime : 0;
    return countInNumberAt(this._countInBeats, this._recAlignTime, t);
  }

  async record() {
    await this.init();
    if (this.countingIn) {
      const keepPlaying = this._wasPlayingBeforeRecord && this.playing;
      this._abortRecord();
      if (!keepPlaying) this._haltTransport();
      this._status('Recording canceled');
      this._emitState();
      this.onCountIn?.(0);
      return;
    }
    if (this.recording) {
      this._finishRecord(false);
      return;
    }

    try {
      await this.ensureMic();
    } catch (err) {
      this._status(micError(err));
      throw err;
    }

    this._wasPlayingBeforeRecord = !!this.playing;

    if (this.countInBars > 0) {
      await this._startRecordWithCountIn();
      return;
    }

    if (this.playing) this.stop();
    this._wasPlayingBeforeRecord = false;
    this._beginDryCapture(this.ctx.currentTime);
    await this.play();
    this._recAlignTime = this._playStart;
    this.captureMode = this.capture?.mode || 'none';
    this._status(this._recordingStatus());
    this._emitState();
  }

  _recordingStatus() {
    const name = this.tracks[this.armedIndex].name;
    return this.autoLoop
      ? 'Recording dry ' + name + ' · one loop frame'
      : 'Recording dry ' + name + ' · phrase (tap Rec to stop)';
  }

  async _startRecordWithCountIn() {
    const now = this.ctx.currentTime;
    const plan = countInPlan({
      now,
      bpm: this.bpm,
      bars: this.bars,
      playing: this.playing,
      playStart: this._playStart,
      autoLoop: this.autoLoop,
    });
    this.countingIn = true;
    this.countInNumber = 4;
    this._countInBeats = plan.beats;
    this._recAlignTime = plan.recordStart;
    this._scheduleCountInClicks(plan.beats);
    // Capture starts immediately; the count-in and output latency are trimmed later
    // so the take stays beat-aligned. Clicks are not in the capture graph, only
    // the speakers, and they are short and quiet to limit bleed.
    this._beginDryCapture(plan.recordStart);
    if (!this.playing) {
      await this.play({ at: plan.recordStart });
    }
    this.captureMode = this.capture?.mode || 'none';
    this._status(
      'Count-in · 4-3-2-1 · start singing on the next downbeat · headphones keep the clicks out of the take'
    );
    this.onCountIn?.(this.countInDisplay());
    this._emitState();
  }

  /**
   * Open the dry mic tap. `alignTime` is the musical downbeat the take should
   * line up with; the capture buffer is long enough to include any pre-roll.
   */
  _beginDryCapture(alignTime) {
    const maxSec = this.autoLoop ? this.loopSeconds() : PHRASE_MAX_SEC;
    const now = this.ctx.currentTime;
    const preRoll = Math.max(0, alignTime - now);
    // Dry mic tap only — never the mix bus / harmony / kits.
    // Gain + soft limiter run on each chunk so the live waveform matches the take.
    this.capture = new MicCapture(this.ctx, this.micSource, { useWorklet: this._useWorklet });
    this.capture.process = (input) => applyMicGainAndLimit(input, this.micGainDb);
    this.recording = true;
    this._recStartTime = alignTime;
    this.harmonizer?.setDriveEnabled(false);
    this._captureStartCtx = now;
    const latTail = Math.min(
      MAX_LATENCY_COMP,
      Number(this.ctx.outputLatency) || Number(this.ctx.baseLatency) || 0,
    );
    this.capture.start(preRoll + maxSec + 0.15 + 0.06 + latTail, () => {
      if (this.recording) this._finishRecord(true);
    });
  }

  _scheduleCountInClicks(beats) {
    this._cancelCountInClicks();
    if (!this.ctx || !this.metroGain) return;
    for (const b of beats) {
      if (b.time < this.ctx.currentTime - 0.01) continue;
      const accent = b.number === 4;
      // Short and quiet so speaker bleed into the mic is less likely.
      const node = triggerClick(this.ctx, this.metroGain, b.time, accent, {
        gain: accent ? 0.1 : 0.055,
        duration: 0.02,
      });
      if (node) this._countInNodes.push(node);
    }
  }

  _cancelCountInClicks() {
    for (const n of this._countInNodes) {
      try {
        n.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        n.gain.gain.setValueAtTime(0, this.ctx.currentTime);
        n.osc.stop(this.ctx.currentTime);
      } catch {
        /* already finished */
      }
    }
    this._countInNodes = [];
  }

  _clearCountIn() {
    this._cancelCountInClicks();
    this.countingIn = false;
    this.countInNumber = 0;
    this._countInBeats = null;
    this.onCountIn?.(0);
  }

  /** Stop a take or a count-in without keeping the audio. */
  _abortRecord() {
    this._clearCountIn();
    if (this.capture) {
      try {
        this.capture.stop(0, 0);
      } catch {
        /* */
      }
    }
    this.recording = false;
    this.capture = null;
    this._recAlignTime = 0;
    this.harmonizer?.setDriveEnabled(true);
    this.releaseMicIfIdle();
  }

  _abortOrFinish(autoStopped) {
    if (this.countingIn && !autoStopped) {
      this._abortRecord();
      return;
    }
    this._finishRecord(autoStopped);
  }

  _updateCountInClock() {
    if (!this.countingIn || !this.ctx) return;
    const n = this.countInDisplay();
    if (n !== this.countInNumber) {
      this.countInNumber = n;
      this.onCountIn?.(n);
    }
    if (this.ctx.currentTime >= this._recAlignTime) {
      this._clearCountIn();
      this._status(this._recordingStatus());
      this._emitState();
    }
  }


  _finishRecord(autoStopped) {
    if (!this.recording || !this.capture) return;
    this._clearCountIn();
    const trim = this.autoLoop ? Math.floor(this.loopSeconds() * this.ctx.sampleRate) : 0;
    const result = this.capture.stop(trim, this._takeOffsetSamples(this.capture));
    this.recording = false;
    this.capture = null;
    this._recAlignTime = 0;

    this.harmonizer?.setDriveEnabled(true);

    let msg = 'Nothing captured';
    if (result && result.samples.length > 0) {
      const samples = result.samples;
      // Auto-level the finished take so harmonizer / doubler analysis see a loud, even signal.
      if (this.micAutoLevel) peakNormalize(samples, AUTO_LEVEL_TARGET_DBFS);
      const track = this.tracks[this.armedIndex];
      track.setSamples(this.ctx, samples, result.sampleRate);
      this._routeHarmonyInput();
      msg =
        'Captured dry ' +
        track.name +
        ' · ' +
        result.durationSec.toFixed(1) +
        's' +
        (autoStopped ? (this.autoLoop ? ' (frame filled)' : ' (max length)') : '') +
        (this.micAutoLevel ? ' · auto-leveled to -3 dBFS' : '');
      if (this.playing && this.autoLoop) {
        this._restartOneTrack(this.armedIndex);
        this.harmonizer?.startPlayback(this._playStart, this.loopSeconds(), this.autoLoop);
      }
    }

    this.releaseMicIfIdle();

    if (!this.autoLoop) {
      this._haltTransport();
      this.onBeat?.(0, 1, 1);
    }

    this._status(msg);
    this._emitState();
  }

  /**
   * Samples to drop from the head of a take so it lines up with the loop:
   * the scheduled pre-roll before beat 1 plus the output latency the singer hears.
   * @param {MicCapture} capture
   */
  _takeOffsetSamples(capture) {
    const sr = this.ctx.sampleRate;
    const align = this._recAlignTime || this._playStart;
    const startSec =
      capture.startFrame >= 0 ? capture.startFrame / sr : this._captureStartCtx || align;
    return takeAlignOffsetSamples({
      sampleRate: sr,
      captureStartSec: startSec,
      recordStartSec: align,
      outputLatencySec: Number(this.ctx.outputLatency) || Number(this.ctx.baseLatency) || 0,
      maxLatencySec: MAX_LATENCY_COMP,
    });
  }

  _startTrackPlayback(when) {
    this._stopTrackPlayback();
    this.tracks.forEach((track, i) => {
      const g = this.trackGains[i];
      if (g) g.gain.setValueAtTime(track.mute ? 0 : track.volume, this.ctx.currentTime);
      const src = startTrackSource(this.ctx, track, g, when, this.autoLoop);
      if (src) this._sources.push(src);
    });
    this._routeHarmonyInput();
    this.harmonizer?.startPlayback(when, this.loopSeconds(), this.autoLoop);
  }

  _restartOneTrack(index) {
    const track = this.tracks[index];
    const g = this.trackGains[index];
    if (!track?.buffer || !g) return;
    const elapsed = this.ctx.currentTime - this._playStart;
    const loop = this.loopSeconds();
    const offset =
      this.autoLoop && loop > 0 ? elapsed % Math.min(loop, track.durationSec || loop) : elapsed;
    if (!this.autoLoop && elapsed >= track.durationSec) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = track.buffer;
      src.loop = this.autoLoop;
      src.connect(g);
      const startOffset = Math.max(0, Math.min(offset, track.durationSec - 0.01));
      src.start(this.ctx.currentTime, startOffset);
      this._sources.push(src);
    } catch {
      /* */
    }
  }

  _stopTrackPlayback() {
    for (const s of this._sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* */
      }
    }
    this._sources = [];
    this.harmonizer?.stopPlayback();
  }

  _phraseDuration() {
    let max = 0;
    for (const t of this.tracks) {
      if (t.hasAudio) max = Math.max(max, t.durationSec);
    }
    if (max <= 0) max = this.loopSeconds();
    return max;
  }

  mixDuration() {
    if (this.autoLoop) return this.loopSeconds();
    return this._phraseDuration();
  }

  _scheduler() {
    if (!this.playing || !this.ctx) return;
    this._updateCountInClock();

    if (
      !this.autoLoop &&
      !this.recording &&
      this._phraseStopAt &&
      this.ctx.currentTime >= this._phraseStopAt
    ) {
      this.stop();
      return;
    }

    const drum = getDrumPattern(this.drumPatternId);
    const bass = getBassPattern(this.bassPatternId);
    const chops = getChopPattern(this.drumPatternId);
    const stepSec = this.stepSeconds();
    const stepsInLoop = this.bars * STEPS_PER_BAR;

    const ahead = this.liteMode ? SCHEDULE_AHEAD_LITE : SCHEDULE_AHEAD;
    while (this._nextNoteTime < this.ctx.currentTime + ahead) {
      const stepInBar = this._currentStep % STEPS_PER_BAR;
      scheduleStepHits({
        ctx: this.ctx,
        drumDest: this.drumGain,
        bassDest: this.bassGain,
        chopDest: this.chopGain,
        metroDest: this.metroGain,
        time: this._nextNoteTime,
        stepInBar,
        stepIndex: this._currentStep,
        drumsOn: this.drumsOn && !this.drumsMute,
        bassOn: this.bassOn && !this.bassMute,
        chopsOn: this.chopsOn && !this.chopsMute,
        metronome: this.metronome,
        drumPattern: drum,
        bassPattern: bass,
        chopPattern: chops,
        stepSec,
        swing: this.swing,
        bassRootSemis: this.bassRootSemis,
        bassOctave: this.bassOctave,
        bassVoice: this.bassVoice,
        variation: this.variation,
      });

      const bar = Math.floor(this._currentStep / STEPS_PER_BAR) + 1;
      const beat = Math.floor(stepInBar / 4) + 1;
      this.onBeat?.(this._currentStep, bar, beat);

      this._nextNoteTime += stepSec;
      this._currentStep += 1;
      if (this.autoLoop && this._currentStep >= stepsInLoop) {
        this._currentStep = 0;
      }
    }
  }

  snapshot() {
    return {
      id: this.ideaId,
      name: this.ideaName,
      bpm: this.bpm,
      bars: this.bars,
      autoLoop: this.autoLoop,
      metronome: this.metronome,
      swing: this.swing,
      drumsOn: this.drumsOn,
      bassOn: this.bassOn,
      chopsOn: this.chopsOn,
      drumsMute: this.drumsMute,
      bassMute: this.bassMute,
      chopsMute: this.chopsMute,
      drumVolume: this.drumVolume,
      bassVolume: this.bassVolume,
      chopVolume: this.chopVolume,
      styleId: this.styleId,
      drumPatternId: this.drumPatternId,
      bassPatternId: this.bassPatternId,
      variation: this.variation,
      bassRootSemis: this.bassRootSemis,
      bassOctave: this.bassOctave,
      bassVoice: this.bassVoice,
      masterVolume: this.masterVolume,
      micGainDb: this.micGainDb,
      micAutoLevel: this.micAutoLevel,
      harmony: {
        enabled: !!this.harmonizer?.enabled,
        source: this.harmonizer?.source || 'track',
        trackIndex: this.harmonizer?.trackIndex || 0,
        masterVolume: this.harmonizer?.harmony.masterGain.gain.value ?? 0.6,
        doubler: this.harmonizer?.getDoublerConfig() || {
          enabled: false,
          widthCents: 15,
          volume: 0.55,
        },
        voices: this.harmonizer?.getVoiceConfigs() || [],
      },
      tracks: this.tracks.map((t) => t.toJSON()),
    };
  }

  /**
   * @param {object} idea
   */
  async applyIdea(idea) {
    await this.init();
    this.stop();
    this.ideaId = idea.id || null;
    this.ideaName = idea.name || 'Untitled idea';
    this.bpm = idea.bpm ?? 90;
    this.bars = idea.bars ?? 4;
    this.autoLoop = idea.autoLoop !== false;
    this.metronome = !!idea.metronome;
    this.swing = typeof idea.swing === 'number' ? idea.swing : 0;
    this.drumsOn = !!idea.drumsOn;
    this.bassOn = !!idea.bassOn;
    this.chopsOn = idea.chopsOn == null ? !!idea.drumsOn : !!idea.chopsOn;
    this.drumsMute = !!idea.drumsMute;
    this.bassMute = !!idea.bassMute;
    this.chopsMute = !!idea.chopsMute;
    this.drumVolume = typeof idea.drumVolume === 'number' ? idea.drumVolume : 0.85;
    this.bassVolume = typeof idea.bassVolume === 'number' ? idea.bassVolume : 0.85;
    this.chopVolume = typeof idea.chopVolume === 'number' ? idea.chopVolume : 0.85;
    this.drumPatternId = getDrumPattern(idea.drumPatternId || 'triphop').id;
    this.bassPatternId = getBassPattern(idea.bassPatternId || 'triphop').id;
    this.styleId = idea.styleId || this.drumPatternId;
    this.variation = ['sparse', 'core', 'busy'].includes(idea.variation) ? idea.variation : 'core';
    this.bassRootSemis = typeof idea.bassRootSemis === 'number' ? idea.bassRootSemis : 0;
    this.bassOctave = [-1, 0, 1].includes(idea.bassOctave) ? idea.bassOctave : 0;
    this.bassVoice = typeof idea.bassVoice === 'string' ? idea.bassVoice : 'auto';
    this._applyKitGains();
    if (typeof idea.masterVolume === 'number') this.setMasterVolume(idea.masterVolume);
    this.micGainDb =
      typeof idea.micGainDb === 'number' ? Math.max(0, Math.min(24, idea.micGainDb)) : DEFAULT_MIC_GAIN_DB;
    this.micAutoLevel = idea.micAutoLevel !== false;

    this.tracks.forEach((track, i) => {
      const t = (idea.tracks || [])[i];
      if (!t) {
        track.clear();
        return;
      }
      track.name = t.name || track.name;
      track.mute = !!t.mute;
      track.volume = typeof t.volume === 'number' ? t.volume : 0.9;
      if (t.samples && t.samples.length) {
        track.setSamples(this.ctx, t.samples, t.sampleRate || this.ctx.sampleRate);
      } else {
        track.clear();
      }
      const g = this.trackGains[i];
      if (g) g.gain.value = track.mute ? 0 : track.volume;
    });

    if (idea.harmony && this.harmonizer) {
      this.harmonizer.applyVoiceConfigs(idea.harmony.voices);
      if (idea.harmony.doubler) {
        this.harmonizer.applyDoublerConfig(idea.harmony.doubler);
      }
      const savedSrc = idea.harmony.source === 'all' ? 'all' : 'track';
      this.harmonizer.setSource(savedSrc, idea.harmony.trackIndex || 0);
      if (typeof idea.harmony.masterVolume === 'number') {
        this.harmonizer.setMasterVolume(idea.harmony.masterVolume);
      }
      this._routeHarmonyInput();
      this.harmonizer.setEnabled(!!idea.harmony.enabled);
    }

    this._status('Loaded “' + this.ideaName + '”');
    this._emitState();
  }

  /**
   * Bounce current idea to a WAV blob (tracks + kits + post-recording harmony/doubler if on).
   */
  async exportWav() {
    await this.init();
    const duration = this.mixDuration();
    let sourceSamples = null;
    let sourceRate = this.ctx.sampleRate;
    if (this.harmonizer?.enabled) {
      if (this.harmonizer.source === 'track') {
        const t = this.tracks[this.harmonizer.trackIndex];
        sourceSamples = t?.samples || null;
        sourceRate = t?.sampleRate || sourceRate;
      } else {
        sourceSamples = mixTrackSamples(this.tracks, this.ctx.sampleRate);
        sourceRate = this.ctx.sampleRate;
      }
    }

    return bounceMix({
      sampleRate: this.ctx.sampleRate,
      durationSec: duration,
      tracks: this.tracks.map((t) => ({
        buffer: t.buffer,
        mute: t.mute,
        volume: t.volume,
      })),
      drumsOn: this.drumsOn,
      bassOn: this.bassOn,
      chopsOn: this.chopsOn,
      drumsMute: this.drumsMute,
      bassMute: this.bassMute,
      chopsMute: this.chopsMute,
      drumVolume: this.drumVolume,
      bassVolume: this.bassVolume,
      chopVolume: this.chopVolume,
      drumPatternId: this.drumPatternId,
      bassPatternId: this.bassPatternId,
      variation: this.variation,
      swing: this.swing,
      bassRootSemis: this.bassRootSemis,
      bassOctave: this.bassOctave,
      bassVoice: this.bassVoice,
      bpm: this.bpm,
      bars: this.bars,
      autoLoop: this.autoLoop,
      harmony: this.harmonizer?.enabled
        ? {
            enabled: true,
            voices: this.harmonizer.getVoiceConfigs(),
            doubler: this.harmonizer.getDoublerConfig(),
            masterVolume: this.harmonizer.harmony.masterGain.gain.value,
            sourceSamples,
            sampleRate: sourceRate,
          }
        : null,
    });
  }
}

/**
 * Soft bus limiter (DynamicsCompressor) shared by live playback and the offline bounce.
 * @param {BaseAudioContext} ctx
 */
export function createBusLimiter(ctx) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -8;
  c.knee.value = 6;
  c.ratio.value = 8;
  c.attack.value = 0.004;
  c.release.value = 0.18;
  return c;
}

/** Safari Audio Session API (no-op elsewhere). */
function setAudioSession(type) {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    /* not supported */
  }
}

/**
 * iOS Safari unlock: play a 1-sample silent buffer inside the user gesture.
 * @param {AudioContext} ctx
 */
function unlockAudio(ctx) {
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch {
    /* */
  }
}

function micError(err) {
  if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
    return 'Microphone permission denied. Allow mic access and try again.';
  }
  return 'Could not start mic: ' + (err && err.message ? err.message : err);
}

/**
 * Mix unmuted vocal track samples for All Vox harmony/doubling.
 * @param {VocalTrack[]} tracks
 * @param {number} sr
 */
function mixTrackSamples(tracks, sr) {
  let max = 0;
  const usable = [];
  for (const t of tracks) {
    if (!t.hasAudio || t.mute) continue;
    usable.push(t);
    max = Math.max(max, t.samples.length);
  }
  if (max === 0) return null;
  const out = new Float32Array(max);
  for (const t of usable) {
    const src = t.samples;
    const vol = t.volume;
    for (let i = 0; i < src.length; i++) out[i] += src[i] * vol;
  }
  void sr;
  return out;
}

export { encodeWav };
