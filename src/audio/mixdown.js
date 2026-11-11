/**
 * Offline mixdown of tracks + kits (+ optional post-recording vocal harmony & doubler) to WAV.
 * Vocal buffers are dry captures; harmony and doubling are rendered via FormantPitchShifter
 * from the selected vocal track source.
 */

import { encodeWav } from './recorder.js';
import { renderOfflineHarmony } from './pitchShiftDsp.js';
import {
  getDrumPattern,
  getBassPattern,
  getChopPattern,
  scheduleStepHits,
  STEPS_PER_BAR,
} from './kits.js';
import { setFxReturn, setFxLaneLevel } from './sampler.js';

/**
 * @param {object} spec
 * @param {number} spec.sampleRate
 * @param {number} spec.durationSec
 * @param {Array<{ buffer: AudioBuffer | null, mute: boolean, volume: number }>} spec.tracks
 * @param {boolean} spec.drumsOn
 * @param {boolean} spec.bassOn
 * @param {boolean} [spec.chopsOn]
 * @param {number} [spec.drumVolume]
 * @param {number} [spec.bassVolume]
 * @param {number} [spec.chopVolume]
 * @param {boolean} [spec.drumsMute]
 * @param {boolean} [spec.bassMute]
 * @param {boolean} [spec.chopsMute]
 * @param {string} spec.drumPatternId
 * @param {string} spec.bassPatternId
 * @param {number} [spec.swing=0]
 * @param {number} [spec.bassRootSemis=0]
 * @param {number} [spec.bassOctave=0]   -1 | 0 | +1
 * @param {string} [spec.bassVoice='auto']
 * @param {number} spec.bpm
 * @param {number} spec.bars
 * @param {boolean} spec.autoLoop
 * @param {object | null} spec.harmony  { enabled, voices, doubler, masterVolume, sourceSamples, sampleRate }
 * @returns {Promise<{ blob: Blob, durationSec: number }>}
 */
export async function bounceMix(spec) {
  const sr = spec.sampleRate;
  const durationSec = Math.max(0.25, spec.durationSec);
  const length = Math.max(1, Math.floor(sr * durationSec));
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const offline = new OAC(1, length, sr);

  const master = offline.createGain();
  master.gain.value = 0.9;
  master.connect(offline.destination);

  const mix = offline.createGain();
  const limiter = offline.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;
  mix.connect(limiter);
  limiter.connect(master);

  for (const track of spec.tracks) {
    if (!track.buffer || track.mute) continue;
    const g = offline.createGain();
    g.gain.value = track.volume;
    g.connect(mix);
    const src = offline.createBufferSource();
    src.buffer = track.buffer;
    src.loop = !!spec.autoLoop;
    src.connect(g);
    src.start(0);
  }

  const drumGain = offline.createGain();
  const bassGain = offline.createGain();
  const chopGain = offline.createGain();
  const drumsMuted = !!spec.drumsMute;
  const bassMuted = !!spec.bassMute;
  const chopsMuted = !!spec.chopsMute;
  drumGain.gain.value = drumsMuted ? 0 : (spec.drumVolume ?? 0.85);
  bassGain.gain.value = bassMuted ? 0 : (spec.bassVolume ?? 0.85);
  chopGain.gain.value = chopsMuted ? 0 : (spec.chopVolume ?? 0.85);
  drumGain.connect(mix);
  bassGain.connect(mix);
  chopGain.connect(mix);
  // One shared reverb / delay for the bounce, returning to the mix; lane sends follow lane levels.
  setFxReturn(offline, mix);
  setFxLaneLevel(offline, drumGain, drumGain.gain.value);
  setFxLaneLevel(offline, bassGain, bassGain.gain.value);
  setFxLaneLevel(offline, chopGain, chopGain.gain.value);

  const drumPattern = getDrumPattern(spec.drumPatternId);
  const bassPattern = getBassPattern(spec.bassPatternId);
  const chopPattern = getChopPattern(spec.drumPatternId);
  const stepSec = 60 / spec.bpm / 4;
  const totalSteps = Math.ceil(durationSec / stepSec);
  const swing = spec.swing ?? 0;
  const bassRootSemis = spec.bassRootSemis ?? 0;
  const variation = spec.variation || 'core';
  const bassOctave = spec.bassOctave ?? 0;
  const bassVoice = spec.bassVoice || 'auto';

  for (let i = 0; i < totalSteps; i++) {
    const time = i * stepSec;
    if (time >= durationSec) break;
    scheduleStepHits({
      ctx: offline,
      drumDest: drumGain,
      bassDest: bassGain,
      chopDest: chopGain,
      time,
      stepInBar: i % STEPS_PER_BAR,
      stepIndex: i,
      drumsOn: spec.drumsOn && !drumsMuted,
      bassOn: spec.bassOn && !bassMuted,
      chopsOn: (spec.chopsOn ?? spec.drumsOn) && !chopsMuted,
      metronome: false,
      drumPattern,
      bassPattern,
      chopPattern,
      stepSec,
      swing,
      bassRootSemis,
      bassOctave,
      bassVoice,
      variation,
    });
  }

  if (spec.harmony && spec.harmony.enabled && spec.harmony.sourceSamples) {
    scheduleOfflineHarmony(offline, mix, spec.harmony, durationSec, !!spec.autoLoop);
  }

  const rendered = await offline.startRendering();
  const samples = Float32Array.from(rendered.getChannelData(0));
  softNormalize(samples);
  const wav = encodeWav(samples, sr);
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    durationSec: samples.length / sr,
  };
}

/**
 * Peak soft-normalize so the bounce doesn't clip into garbage.
 * @param {Float32Array} samples
 */
function softNormalize(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0.99) return;
  const scale = 0.95 / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
}

/**
 * Render formant-preserved pitch-shifted harmony voices + vocal doubler from the dry vocal buffer
 * and schedule them onto the offline mix bus.
 * @param {OfflineAudioContext} ctx
 * @param {AudioNode} dest
 * @param {object} harmony
 * @param {number} durationSec
 * @param {boolean} autoLoop
 */
function scheduleOfflineHarmony(ctx, dest, harmony, durationSec, autoLoop) {
  const harmRate = harmony.sampleRate || ctx.sampleRate;
  const renderedSamples = renderOfflineHarmony({
    sourceSamples: harmony.sourceSamples,
    sampleRate: harmRate,
    voices: harmony.voices || [],
    doubler: harmony.doubler || null,
    masterVolume: harmony.masterVolume ?? 0.6,
    durationSec,
    autoLoop,
  });
  if (!renderedSamples || renderedSamples.length === 0) return;

  const buf = ctx.createBuffer(1, renderedSamples.length, harmRate);
  buf.getChannelData(0).set(renderedSamples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  src.start(0);
}
