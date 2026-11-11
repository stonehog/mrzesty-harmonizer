/**
 * YIN-style pitch detection (simplified) + live pitch stabilizer.
 * Based on the YIN algorithm (de Cheveigné & Kawahara, 2002):
 * difference function → cumulative mean normalized difference →
 * absolute-threshold parabolic interpolation.
 */

const DEFAULT_THRESHOLD = 0.12;
const MIN_HZ = 70;
const MAX_HZ = 1000;
/** Clarity must clear this to count as voiced (stricter than raw YIN). */
export const CLARITY_GATE = 0.82;
const RMS_GATE = 0.012;

/**
 * @param {Float32Array} buffer - time-domain samples (mono)
 * @param {number} sampleRate
 * @param {number} [threshold]
 * @param {Float32Array} [scratch] optional reusable work buffer (avoids a per-call allocation)
 * @returns {{ frequency: number, clarity: number } | null}
 */
export function detectPitch(buffer, sampleRate, threshold = DEFAULT_THRESHOLD, scratch) {
  const size = buffer.length;
  if (size < 2) return null;

  let rms = 0;
  for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / size);
  if (rms < RMS_GATE) return null;

  const tauMax = Math.min(Math.floor(sampleRate / MIN_HZ), size - 1);
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));

  const yinBuffer =
    scratch && scratch.length >= tauMax + 1 ? scratch : new Float32Array(tauMax + 1);
  yinBuffer[0] = 1;

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < size - tau; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  let runningSum = 0;
  yinBuffer[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] = runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum;
  }

  let tauEstimate = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    let minVal = Infinity;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (yinBuffer[tau] < minVal) {
        minVal = yinBuffer[tau];
        tauEstimate = tau;
      }
    }
    if (minVal >= 0.45) return null;
  }

  let betterTau = tauEstimate;
  if (tauEstimate > 0 && tauEstimate < tauMax) {
    const s0 = yinBuffer[tauEstimate - 1];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) {
      betterTau = tauEstimate + (s2 - s0) / denom;
    }
  }

  const frequency = sampleRate / betterTau;
  if (frequency < MIN_HZ || frequency > MAX_HZ) return null;

  const clarity = 1 - yinBuffer[tauEstimate];
  return { frequency, clarity };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/**
 * Convert Hz to nearest MIDI note + cents offset.
 * @param {number} hz
 * @returns {{ note: string, midi: number, cents: number, octave: number }}
 */
export function hzToNote(hz) {
  const midiFloat = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return {
    note: `${name}${octave}`,
    midi,
    cents,
    octave,
  };
}

/**
 * True if candidate looks like an octave error vs reference.
 * @param {number} hz
 * @param {number} ref
 */
export function isOctaveJump(hz, ref) {
  if (!ref || ref <= 0 || !hz || hz <= 0) return false;
  const ratio = hz / ref;
  // Near 2× or ½× (with slack) → reject
  return (ratio > 1.78 && ratio < 2.25) || (ratio > 0.44 && ratio < 0.56);
}

/**
 * Stabilize noisy YIN frames for display + harmony drive.
 * Median window, octave-jump reject, hold-last-good on unvoiced.
 */
export class PitchSmoother {
  /**
   * @param {object} [opts]
   * @param {number} [opts.clarityGate]
   * @param {number} [opts.medianSize]
   * @param {number} [opts.holdMs]
   * @param {number} [opts.ema]
   */
  constructor(opts = {}) {
    this.clarityGate = opts.clarityGate ?? CLARITY_GATE;
    this.medianSize = opts.medianSize ?? 5;
    this.holdMs = opts.holdMs ?? 220;
    this.ema = opts.ema ?? 0.35;
    /** @type {number[]} */
    this._hist = [];
    this._heldHz = 0;
    this._heldAt = 0;
    this._smoothHz = 0;
  }

  reset() {
    this._hist = [];
    this._heldHz = 0;
    this._heldAt = 0;
    this._smoothHz = 0;
  }

  /**
   * @param {{ frequency: number, clarity: number } | null} raw
   * @param {number} [nowMs]
   * @returns {{ frequency: number | null, clarity: number, voiced: boolean, held: boolean }}
   */
  push(raw, nowMs = performance.now()) {
    let accepted = null;
    if (raw && raw.clarity >= this.clarityGate) {
      const hz = raw.frequency;
      const ref = this._smoothHz || this._heldHz;
      if (!ref || !isOctaveJump(hz, ref)) {
        // Also reject wild leaps (>5 semitones) unless we have no lock yet
        if (!ref || Math.abs(Math.log2(hz / ref)) < 5 / 12) {
          accepted = hz;
        }
      }
    }

    if (accepted != null) {
      this._hist.push(accepted);
      if (this._hist.length > this.medianSize) this._hist.shift();
      const sorted = [...this._hist].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      if (this._smoothHz > 0) {
        this._smoothHz = this._smoothHz * (1 - this.ema) + mid * this.ema;
      } else {
        this._smoothHz = mid;
      }
      this._heldHz = this._smoothHz;
      this._heldAt = nowMs;
      return {
        frequency: this._smoothHz,
        clarity: raw?.clarity ?? 1,
        voiced: true,
        held: false,
      };
    }

    // Unvoiced / rejected: briefly hold last good Hz for display
    if (this._heldHz > 0 && nowMs - this._heldAt < this.holdMs) {
      return {
        frequency: this._heldHz,
        clarity: raw?.clarity ?? 0,
        voiced: false,
        held: true,
      };
    }

    this._hist = [];
    this._smoothHz = 0;
    this._heldHz = 0;
    return {
      frequency: null,
      clarity: raw?.clarity ?? 0,
      voiced: false,
      held: false,
    };
  }
}
