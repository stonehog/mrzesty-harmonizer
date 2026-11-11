/**
 * Formant-preserving vocal pitch shifter & studio ADT vocal doubler DSP
 * (STFT Phase Vocoder + Spectral Envelope Preservation).
 *
 * Operates post-recording on dry vocal track buffers:
 * - Pre-analyzes a vocal track's STFT frames, instantaneous frequencies, and vocal-tract
 *   formant envelopes once per take (`analyzeVocalTrack`).
 * - Synthesizes formant-preserved interval harmony voices (`ratio = 2^(semitones/12)`)
 *   and micro-pitch shifted / Haas-delayed vocal doubler layers (`renderOfflineDoubler`)
 *   with exact sample-0 latency compensation so pre-rendered buffers lock to dry tracks
 *   with zero lag during loop playback and WAV mixdown export.
 */

export const DOUBLER_PRESETS = [
  { id: 'subtle', label: 'Subtle (±8¢)', widthCents: 8, delayAMs: 6, delayBMs: 11, lfoCents: 2.0 },
  { id: 'classic', label: 'Classic ADT (±15¢)', widthCents: 15, delayAMs: 9, delayBMs: 16, lfoCents: 3.0 },
  { id: 'wide', label: 'Wide Chorus (±25¢)', widthCents: 25, delayAMs: 12, delayBMs: 20, lfoCents: 4.0 },
];

export class FormantPitchShifter {
  /**
   * @param {number} [sampleRate=48000]
   * @param {number} [fftSize=1024]
   * @param {number} [hopSize=256]
   */
  constructor(sampleRate = 48000, fftSize = 1024, hopSize = 256) {
    this.sampleRate = sampleRate || 48000;
    this.fftSize = fftSize;
    this.hopSize = hopSize;
    this.halfSize = fftSize >> 1;
    this.osamp = fftSize / hopSize;
    this.latency = fftSize - hopSize;

    // Periodic Hann window for 4x overlap-add (WOLA)
    this.window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
    }

    // Radix-2 bit-reversal permutation table
    const bits = Math.round(Math.log2(fftSize));
    this.bitRev = new Uint32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      let rev = 0;
      let x = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      this.bitRev[i] = rev;
    }

    // Precomputed twiddle factors per butterfly stage
    this.twiddleRe = new Float32Array(fftSize);
    this.twiddleIm = new Float32Array(fftSize);
    for (let len = 2; len <= fftSize; len <<= 1) {
      const half = len >> 1;
      const base = half;
      const ang = (-2 * Math.PI) / len;
      for (let j = 0; j < half; j++) {
        this.twiddleRe[base + j] = Math.cos(ang * j);
        this.twiddleIm[base + j] = Math.sin(ang * j);
      }
    }

    // Time-domain overlap-add FIFOs
    this.inFIFO = new Float32Array(fftSize);
    this.outFIFO = new Float32Array(fftSize);
    this.outAccum = new Float32Array(fftSize * 2);
    this.rover = this.latency;

    // Spectral workspace
    this.fftRe = new Float32Array(fftSize);
    this.fftIm = new Float32Array(fftSize);
    this.synRe = new Float32Array(fftSize);
    this.synIm = new Float32Array(fftSize);

    this.anaMag = new Float32Array(this.halfSize + 1);
    this.anaPhase = new Float32Array(this.halfSize + 1);
    this.lastPhase = new Float32Array(this.halfSize + 1);
    this.trueBin = new Float32Array(this.halfSize + 1);
    this.lobeAmp = new Float32Array(this.halfSize + 1);
    this.env = new Float32Array(this.halfSize + 1);
    this.envPeaks = new Int32Array(this.halfSize + 1);
    this.peaks = new Int32Array(this.halfSize + 1);

    this.maxVoices = 4;
    this.synPhase = [];
    for (let v = 0; v < this.maxVoices; v++) {
      this.synPhase.push(new Float32Array(this.halfSize + 1));
    }

    this.voices = [
      { enabled: true, semitones: 4, volume: 0.45 },
      { enabled: true, semitones: 7, volume: 0.4 },
      { enabled: false, semitones: 12, volume: 0.35 },
    ];

    this.active = true;
    this.gateGain = 0;
    this.rmsGateFloor = 0.0025;
    this._frameCount = 0;
  }

  /**
   * @param {Array<{ enabled: boolean, semitones: number, volume: number, lfoCents?: number, lfoHz?: number, lfoPhase?: number }>} voices
   */
  setVoices(voices) {
    if (!Array.isArray(voices)) return;
    this.voices = voices.map((v) => ({
      enabled: !!v.enabled,
      semitones: Number(v.semitones) || 0,
      volume: Math.max(0, Math.min(1.5, Number(v.volume) || 0)),
      lfoCents: Number(v.lfoCents) || 0,
      lfoHz: Number(v.lfoHz) || 0,
      lfoPhase: Number(v.lfoPhase) || 0,
    }));
  }

  /**
   * @param {boolean} active
   */
  setActive(active) {
    this.active = !!active;
  }

  reset() {
    this.inFIFO.fill(0);
    this.outFIFO.fill(0);
    this.outAccum.fill(0);
    this.lastPhase.fill(0);
    for (let v = 0; v < this.maxVoices; v++) {
      this.synPhase[v].fill(0);
    }
    this.rover = this.latency;
    this.gateGain = 0;
    this._frameCount = 0;
  }

  /**
   * In-place radix-2 Cooley-Tukey FFT.
   * @param {Float32Array} re
   * @param {Float32Array} im
   * @param {boolean} inverse
   */
  _fft(re, im, inverse) {
    const n = this.fftSize;
    const bitRev = this.bitRev;
    for (let i = 0; i < n; i++) {
      const j = bitRev[i];
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    const twRe = this.twiddleRe;
    const twIm = this.twiddleIm;
    const invSign = inverse ? -1 : 1;

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const base = half;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const wRe = twRe[base + j];
          const wIm = invSign * twIm[base + j];
          const idx = i + j;
          const idxHalf = idx + half;
          const uRe = re[idx];
          const uIm = im[idx];
          const r2 = re[idxHalf];
          const m2 = im[idxHalf];
          const vRe = r2 * wRe - m2 * wIm;
          const vIm = r2 * wIm + m2 * wRe;
          re[idx] = uRe + vRe;
          im[idx] = uIm + vIm;
          re[idxHalf] = uRe - vRe;
          im[idxHalf] = uIm - vIm;
        }
      }
    }

    if (inverse) {
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= invN;
        im[i] *= invN;
      }
    }
  }

  /**
   * Extract smooth vocal-tract formant envelope from 3-bin main-lobe peak amplitudes
   * (immune to Hann fractional-bin scalloping loss) interpolated across harmonic peaks.
   */
  _extractEnvelope() {
    const half = this.halfSize;
    const mag = this.anaMag;
    const lobe = this.lobeAmp;
    const env = this.env;
    const envPeaks = this.envPeaks;

    lobe[0] = mag[0] + mag[1];
    for (let k = 1; k < half; k++) {
      lobe[k] = mag[k - 1] + mag[k] + mag[k + 1];
    }
    lobe[half] = mag[half - 1] + mag[half];

    let epCount = 0;
    envPeaks[epCount++] = 0;
    for (let k = 1; k < half; k++) {
      const mk = mag[k];
      if (mk > 1e-6 && mk >= mag[k - 1] && mk >= mag[k + 1]) {
        if ((k < 2 || mk >= mag[k - 2]) && (k + 2 > half || mk >= mag[k + 2])) {
          envPeaks[epCount++] = k;
        }
      }
    }
    envPeaks[epCount++] = half;

    for (let i = 0; i < epCount - 1; i++) {
      const k0 = envPeaks[i];
      const k1 = envPeaks[i + 1];
      const v0 = lobe[k0];
      const dv = (lobe[k1] - v0) / (k1 - k0 || 1);
      for (let k = k0; k <= k1; k++) {
        env[k] = v0 + dv * (k - k0);
      }
    }
  }

  /**
   * Evaluate spectral envelope at fractional bin index.
   * @param {number} fracBin
   */
  _envAt(fracBin) {
    if (fracBin <= 0) return this.env[0];
    if (fracBin >= this.halfSize) return this.env[this.halfSize];
    const k0 = Math.floor(fracBin);
    const frac = fracBin - k0;
    const k1 = k0 + 1 <= this.halfSize ? k0 + 1 : this.halfSize;
    return this.env[k0] * (1 - frac) + this.env[k1] * frac;
  }

  _processFrame() {
    const n = this.fftSize;
    const half = this.halfSize;
    const hop = this.hopSize;
    const osamp = this.osamp;
    const win = this.window;
    const re = this.fftRe;
    const im = this.fftIm;
    const frameIdx = this._frameCount++;

    let frameEnergy = 0;
    for (let i = 0; i < n; i++) {
      const s = this.inFIFO[i];
      frameEnergy += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }

    const rms = Math.sqrt(frameEnergy / n);
    // Symmetric soft-knee noise gate so silence stays clean without delaying syllable onsets
    let gate = 0;
    if (this.active && rms > this.rmsGateFloor) {
      gate = Math.min(1.0, (rms - this.rmsGateFloor) / (this.rmsGateFloor * 2));
    }
    this.gateGain = gate;

    if (gate <= 1e-5) {
      // Advance outFIFO cleanly on silent frames without running FFT/IFFT
      for (let i = 0; i < hop; i++) {
        this.outFIFO[i] = this.outAccum[i];
      }
      this.outAccum.copyWithin(0, hop, n + hop);
      for (let i = n; i < n + hop; i++) {
        this.outAccum[i] = 0;
      }
      return;
    }

    this._fft(re, im, false);

    const TWO_PI = 2 * Math.PI;
    const INV_TWO_PI = 1 / TWO_PI;
    const expStep = (TWO_PI * hop) / n;

    for (let k = 0; k <= half; k++) {
      const r = re[k];
      const m = im[k];
      const mag = Math.sqrt(r * r + m * m);
      const phase = Math.atan2(m, r);
      let dp = phase - this.lastPhase[k] - k * expStep;
      this.lastPhase[k] = phase;
      dp -= TWO_PI * Math.round(dp * INV_TWO_PI);
      this.anaMag[k] = mag;
      this.anaPhase[k] = phase;
      this.trueBin[k] = k + dp * osamp * INV_TWO_PI;
    }

    this._extractEnvelope();

    // Locate local spectral peaks for identity phase-locked shifting (Laroche & Dolson)
    let peakCount = 0;
    const peaks = this.peaks;
    for (let k = 1; k < half; k++) {
      const mk = this.anaMag[k];
      if (mk > 1e-6 && mk >= this.anaMag[k - 1] && mk >= this.anaMag[k + 1]) {
        peaks[peakCount++] = k;
      }
    }

    const synRe = this.synRe;
    const synIm = this.synIm;
    synRe.fill(0);
    synIm.fill(0);

    if (peakCount > 0) {
      const voiceLimit = Math.min(this.voices.length, this.maxVoices);
      const frameTimeSec = (frameIdx * hop) / this.sampleRate;

      for (let vIdx = 0; vIdx < voiceLimit; vIdx++) {
        const v = this.voices[vIdx];
        if (!v || !v.enabled || v.volume <= 0) continue;

        let effectiveSemis = v.semitones || 0;
        if (v.lfoCents && v.lfoHz) {
          effectiveSemis +=
            (v.lfoCents / 100) * Math.sin(TWO_PI * v.lfoHz * frameTimeSec + (v.lfoPhase || 0));
        }
        const ratio = Math.pow(2, effectiveSemis / 12);
        const vGain = v.volume * gate;
        const vSynPhase = this.synPhase[vIdx];

        for (let pIdx = 0; pIdx < peakCount; pIdx++) {
          const p = peaks[pIdx];
          const startBin = pIdx === 0 ? 1 : (peaks[pIdx - 1] + p) >> 1;
          const endBin = pIdx === peakCount - 1 ? half : (p + peaks[pIdx + 1]) >> 1;

          // Exact fractional target bin preserves micro-pitch shifts (e.g. ±8 to ±25 cents)
          const targetFreq = this.trueBin[p] * ratio;
          const newPeak = Math.round(targetFreq);
          if (newPeak < 1 || newPeak >= half) continue;

          const deltaBin = newPeak - p;
          vSynPhase[newPeak] += expStep * targetFreq;
          vSynPhase[newPeak] -= TWO_PI * Math.round(vSynPhase[newPeak] * INV_TWO_PI);
          const phaseRot = vSynPhase[newPeak] - this.anaPhase[p];

          // Scale entire harmonic main lobe so its shifted peak rides the original formant envelope
          const srcEnv = Math.max(this.lobeAmp[p], this.env[p] * 0.5, 1e-7);
          const dstEnv = this._envAt(targetFreq);
          const scale = (dstEnv / srcEnv) * vGain;

          const cosRot = Math.cos(phaseRot);
          const sinRot = Math.sin(phaseRot);

          for (let k = startBin; k < endBin; k++) {
            const dst = k + deltaBin;
            if (dst <= 0 || dst >= half) continue;
            const rIn = re[k] * scale;
            const iIn = im[k] * scale;
            synRe[dst] += rIn * cosRot - iIn * sinRot;
            synIm[dst] += rIn * sinRot + iIn * cosRot;
          }
        }
      }
    }

    // Enforce Hermitian symmetry for real-valued inverse FFT output
    synIm[0] = 0;
    synIm[half] = 0;
    for (let k = 1; k < half; k++) {
      synRe[n - k] = synRe[k];
      synIm[n - k] = -synIm[k];
    }

    this._fft(synRe, synIm, true);

    // Hann^2 4x overlap-add normalization (sum of w^2 at N/4 hop is 1.5)
    const olaScale = 1 / (this.osamp * 0.375);
    for (let i = 0; i < n; i++) {
      this.outAccum[i] += synRe[i] * win[i] * olaScale;
    }

    for (let i = 0; i < hop; i++) {
      this.outFIFO[i] = this.outAccum[i];
    }
    this.outAccum.copyWithin(0, hop, n + hop);
    for (let i = n; i < n + hop; i++) {
      this.outAccum[i] = 0;
    }
  }

  /**
   * Process an input Float32Array into output Float32Array of the same length.
   * @param {Float32Array} input
   * @param {Float32Array} output
   */
  process(input, output) {
    const n = this.fftSize;
    const hop = this.hopSize;
    const latency = this.latency;
    for (let i = 0; i < input.length; i++) {
      this.inFIFO[this.rover] = input[i];
      output[i] = this.outFIFO[this.rover - latency];
      this.rover++;
      if (this.rover >= n) {
        this.rover = latency;
        this._processFrame();
        this.inFIFO.copyWithin(0, hop, n);
      }
    }
  }
}

/**
 * Render a single formant-preserved pitch-shifted voice buffer with exact sample-0 alignment
 * (strips full `fftSize` STFT lookahead + synthesis latency) and optional Haas micro-delay + LFO.
 *
 * @param {object} opts
 * @param {Float32Array} opts.sourceSamples
 * @param {number} opts.sampleRate
 * @param {number} opts.semitones
 * @param {number} [opts.volume=1.0]
 * @param {number} [opts.durationSec]
 * @param {boolean} [opts.autoLoop=false]
 * @param {number} [opts.delayMs=0]
 * @param {number} [opts.lfoCents=0]
 * @param {number} [opts.lfoHz=0]
 * @param {number} [opts.lfoPhase=0]
 * @returns {Float32Array | null}
 */
export function renderOfflineVoice(opts) {
  const {
    sourceSamples,
    sampleRate,
    semitones = 0,
    volume = 1.0,
    durationSec,
    autoLoop = false,
    delayMs = 0,
    lfoCents = 0,
    lfoHz = 0,
    lfoPhase = 0,
  } = opts;

  if (!sourceSamples || sourceSamples.length === 0 || volume <= 0) return null;
  const srcLen = sourceSamples.length;
  const totalSamples = durationSec
    ? Math.max(1, Math.floor(sampleRate * durationSec))
    : srcLen;

  const shifter = new FormantPitchShifter(sampleRate, 1024, 256);
  shifter.setVoices([
    {
      enabled: true,
      semitones,
      volume: 1.0,
      lfoCents,
      lfoHz,
      lfoPhase,
    },
  ]);
  shifter.setActive(true);

  // Full STFT + WOLA pipeline delay is fftSize (1024 samples)
  const totalDelay = shifter.fftSize;
  const paddedLen = totalSamples + totalDelay;
  const inputBuf = new Float32Array(paddedLen);

  for (let i = 0; i < totalSamples; i++) {
    if (i < srcLen) {
      inputBuf[i] = sourceSamples[i];
    } else if (autoLoop && srcLen > 0) {
      inputBuf[i] = sourceSamples[i % srcLen];
    }
  }

  const rawOut = new Float32Array(paddedLen);
  shifter.process(inputBuf, rawOut);

  const delaySamples = Math.max(0, Math.round((delayMs / 1000) * sampleRate));
  const aligned = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const srcIdx = i - delaySamples;
    if (srcIdx >= 0) {
      aligned[i] = rawOut[srcIdx + totalDelay] * volume;
    } else if (autoLoop && totalSamples > 0) {
      const wrapped = ((srcIdx % totalSamples) + totalSamples) % totalSamples;
      aligned[i] = rawOut[wrapped + totalDelay] * volume;
    }
  }
  return aligned;
}

/**
 * Render studio ADT vocal doubler (thickens a vocal line using two formant-preserved
 * micro-pitch shifted copies at -widthCents and +widthCents with distinct Haas micro-delays
 * and slow LFO modulation, with no interval harmony).
 *
 * @param {object} opts
 * @param {Float32Array} opts.sourceSamples
 * @param {number} opts.sampleRate
 * @param {number} [opts.widthCents=15]
 * @param {number} [opts.volume=1.0]
 * @param {number} [opts.durationSec]
 * @param {boolean} [opts.autoLoop=false]
 * @returns {Float32Array | null}
 */
export function renderOfflineDoubler(opts) {
  const {
    sourceSamples,
    sampleRate,
    widthCents = 15,
    volume = 1.0,
    durationSec,
    autoLoop = false,
  } = opts;

  if (!sourceSamples || sourceSamples.length === 0 || volume <= 0) return null;
  const cents = Math.max(2, Math.min(50, Number(widthCents) || 15));

  let delayAMs = 9;
  let delayBMs = 16;
  let lfoCents = 3.0;
  if (cents <= 10) {
    delayAMs = 6;
    delayBMs = 11;
    lfoCents = 2.0;
  } else if (cents >= 20) {
    delayAMs = 12;
    delayBMs = 20;
    lfoCents = 4.0;
  }

  const copyA = renderOfflineVoice({
    sourceSamples,
    sampleRate,
    semitones: -cents / 100,
    volume: 0.72 * volume,
    durationSec,
    autoLoop,
    delayMs: delayAMs,
    lfoCents,
    lfoHz: 0.65,
    lfoPhase: 0,
  });

  const copyB = renderOfflineVoice({
    sourceSamples,
    sampleRate,
    semitones: +cents / 100,
    volume: 0.72 * volume,
    durationSec,
    autoLoop,
    delayMs: delayBMs,
    lfoCents,
    lfoHz: 0.88,
    lfoPhase: 1.57,
  });

  if (!copyA || !copyB) return null;
  const out = new Float32Array(copyA.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = copyA[i] + copyB[i];
  }
  return out;
}

/**
 * Render formant-preserved harmony voices (+ optional vocal doubler) offline.
 * Compensates for full `fftSize` STFT pipeline latency so sample 0 of the output
 * aligns with sample 0 of the dry vocal track.
 *
 * @param {object} opts
 * @param {Float32Array} opts.sourceSamples
 * @param {number} opts.sampleRate
 * @param {Array<{ enabled: boolean, semitones: number, volume: number }>} [opts.voices]
 * @param {object | null} [opts.doubler]  { enabled, widthCents, volume }
 * @param {number} [opts.masterVolume=0.6]
 * @param {number} [opts.durationSec]
 * @param {boolean} [opts.autoLoop=false]
 * @returns {Float32Array | null}
 */
export function renderOfflineHarmony(opts) {
  const {
    sourceSamples,
    sampleRate,
    voices = [],
    doubler = null,
    masterVolume = 0.6,
    durationSec,
    autoLoop = false,
  } = opts;

  if (!sourceSamples || sourceSamples.length === 0 || masterVolume <= 0) return null;
  const activeVoices = (voices || []).filter((v) => v && v.enabled && v.volume > 0);
  const doublerActive = !!(doubler && doubler.enabled && doubler.volume > 0);
  if (activeVoices.length === 0 && !doublerActive) return null;

  const srcLen = sourceSamples.length;
  const totalSamples = durationSec
    ? Math.max(1, Math.floor(sampleRate * durationSec))
    : srcLen;
  const aligned = new Float32Array(totalSamples);

  if (activeVoices.length > 0) {
    const shifter = new FormantPitchShifter(sampleRate, 1024, 256);
    shifter.setVoices(activeVoices);
    shifter.setActive(true);

    const totalDelay = shifter.fftSize;
    const paddedLen = totalSamples + totalDelay;
    const inputBuf = new Float32Array(paddedLen);

    for (let i = 0; i < totalSamples; i++) {
      if (i < srcLen) {
        inputBuf[i] = sourceSamples[i];
      } else if (autoLoop && srcLen > 0) {
        inputBuf[i] = sourceSamples[i % srcLen];
      }
    }

    const rawOut = new Float32Array(paddedLen);
    shifter.process(inputBuf, rawOut);

    for (let i = 0; i < totalSamples; i++) {
      aligned[i] += rawOut[i + totalDelay] * masterVolume;
    }
  }

  if (doublerActive) {
    const dblSamples = renderOfflineDoubler({
      sourceSamples,
      sampleRate,
      widthCents: doubler.widthCents ?? 15,
      volume: (doubler.volume ?? 0.55) * masterVolume,
      durationSec: totalSamples / sampleRate,
      autoLoop,
    });
    if (dblSamples) {
      for (let i = 0; i < totalSamples; i++) {
        aligned[i] += dblSamples[i];
      }
    }
  }

  return aligned;
}
