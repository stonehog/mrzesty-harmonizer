import test from 'node:test';
import assert from 'node:assert/strict';

import { getWaveformPeaks, computeWaveformPeaks } from '../src/ui/waveform.js';
import { detectPitch } from '../src/audio/pitch.js';
import { getFxBus, setFxReturn, setFxLaneLevel, fxBusCount, setFxEnabled, fxEnabled, REVERB_SECONDS } from '../src/audio/sampler.js';
import { MicCapture } from '../src/audio/recorder.js';
import { buildConsoleHtml } from '../src/ui/consoleTemplate.js';
import { LOOKAHEAD_MS, SCHEDULE_AHEAD, SCHEDULE_AHEAD_LITE } from '../src/audio/engine.js';

/** Minimal fake BaseAudioContext that counts the nodes it creates. */
function fakeCtx() {
  const counts = { gain: 0, convolver: 0, delay: 0, biquad: 0 };
  const node = (kind) => {
    counts[kind] = (counts[kind] || 0) + 1;
    const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {} });
    return { kind, gain: param(), frequency: param(), Q: param(), delayTime: param(), connect() {}, disconnect() {} };
  };
  return {
    counts,
    sampleRate: 48000,
    currentTime: 0,
    destination: node('dest'),
    createGain: () => node('gain'),
    createConvolver: () => node('convolver'),
    createDelay: () => node('delay'),
    createBiquadFilter: () => node('biquad'),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), length: len, numberOfChannels: ch }),
  };
}

test('waveform peaks are computed once per take, not every frame', () => {
  const s = new Float32Array(48000 * 10).map((_, i) => Math.sin(i / 20));
  const a = getWaveformPeaks(s, 144);
  const b = getWaveformPeaks(s, 144);
  assert.equal(a, b, 'second call must hit the cache');
  assert.deepEqual(Array.from(a.maxs), Array.from(computeWaveformPeaks(s, 144).maxs));
});

test('detectPitch with a reusable scratch buffer matches the allocating path', () => {
  const sr = 48000;
  const buf = new Float32Array(2048).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const scratch = new Float32Array(Math.ceil(sr / 60) + 2);
  const a = detectPitch(buf, sr);
  const b = detectPitch(buf, sr, undefined, scratch);
  const c = detectPitch(buf, sr, undefined, scratch);
  assert.ok(a && Math.abs(a.frequency - 220) < 2);
  assert.equal(a.frequency, b.frequency);
  assert.equal(b.frequency, c.frequency);
});

test('one shared reverb + delay per context, not one per lane', () => {
  const ctx = fakeCtx();
  const mix = ctx.createGain();
  setFxReturn(ctx, mix);
  const drum = ctx.createGain();
  const bass = ctx.createGain();
  const chop = ctx.createGain();
  const d = getFxBus(ctx, drum);
  getFxBus(ctx, bass);
  getFxBus(ctx, chop);
  assert.equal(getFxBus(ctx, drum), d, 'lane sends are cached');
  assert.equal(ctx.counts.convolver, 1);
  assert.equal(ctx.counts.delay, 1);
  assert.equal(fxBusCount(ctx), 1);
  setFxLaneLevel(ctx, bass, 0);
  assert.equal(getFxBus(ctx, bass).reverb.gain.value, 0, 'muted lane sends nothing to the shared reverb');
  assert.ok(REVERB_SECONDS <= 2);
  assert.equal(fxEnabled(ctx), true);
  setFxEnabled(ctx, false);
  assert.equal(fxEnabled(ctx), false);
});

test('MicCapture drops pre-roll / latency samples and keeps the loop length', () => {
  const cap = new MicCapture({ sampleRate: 1000 }, {});
  cap.recording = true;
  cap._chunks = [Float32Array.from({ length: 600 }, (_, i) => i), Float32Array.from({ length: 600 }, (_, i) => 600 + i)];
  const r = cap.stop(1000, 80);
  assert.equal(r.samples.length, 1000);
  assert.equal(r.samples[0], 80);
  assert.equal(r.samples[999], 1079);
});

test('scheduler window: 25 ms tick, 120 ms ahead (200 ms in Lite)', () => {
  assert.equal(LOOKAHEAD_MS, 25);
  assert.ok(SCHEDULE_AHEAD >= 0.1 && SCHEDULE_AHEAD <= 0.15);
  assert.ok(SCHEDULE_AHEAD_LITE > SCHEDULE_AHEAD);
});

test('console renders the LITE toggle and MIC CHECK button', () => {
  const html = buildConsoleHtml({ micGainDb: 9, micAutoLevel: true, tracks: [], bpm: 84, bars: 4 }, 'console', 'major');
  assert.match(html, /id="lite-toggle"/);
  assert.match(html, /id="mic-check"/);
});
