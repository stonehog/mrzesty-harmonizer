import test from 'node:test';
import assert from 'node:assert/strict';

import { MicCapture } from '../src/audio/recorder.js';
import {
  barSeconds,
  beatSeconds,
  countInPlan,
  countInNumberAt,
  takeAlignOffsetSamples,
  COUNT_IN_LEAD_SEC,
} from '../src/audio/countIn.js';
import { buildConsoleHtml } from '../src/ui/consoleTemplate.js';
import { helpBodyHtml, HELP_STEPS, helpMarkdown } from '../src/ui/helpContent.js';

test('count-in from a stopped transport is one full bar after a short lead', () => {
  const bpm = 120;
  const now = 5;
  const plan = countInPlan({ now, bpm, bars: 4, playing: false, playStart: 0, autoLoop: true });
  const barSec = barSeconds(bpm);
  const beatSec = beatSeconds(bpm);
  assert.equal(plan.beats.length, 4);
  assert.deepEqual(plan.beats.map((b) => b.number), [4, 3, 2, 1]);
  assert.ok(Math.abs(plan.countStart - (now + COUNT_IN_LEAD_SEC)) < 1e-12);
  assert.ok(Math.abs(plan.recordStart - (plan.countStart + barSec)) < 1e-12);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(plan.beats[i].time - (plan.countStart + i * beatSec)) < 1e-12);
  }
  assert.equal(countInNumberAt(plan.beats, plan.recordStart, plan.countStart - 0.01), 4);
  assert.equal(countInNumberAt(plan.beats, plan.recordStart, plan.beats[0].time), 4);
  assert.equal(countInNumberAt(plan.beats, plan.recordStart, plan.beats[2].time + 0.001), 2);
  assert.equal(countInNumberAt(plan.beats, plan.recordStart, plan.recordStart), 0);
});

test('count-in while looping occupies the bar before the next loop start', () => {
  const bpm = 84;
  const bars = 4;
  const barSec = barSeconds(bpm);
  const loopSec = barSec * bars;
  const playStart = 1;
  // Middle of bar 3 of the first cycle (0-indexed bars 0..3).
  const now = playStart + barSec * 2.4;
  const plan = countInPlan({ now, bpm, bars, playing: true, playStart, autoLoop: true });
  const expectedT = playStart + loopSec;
  assert.ok(Math.abs(plan.recordStart - expectedT) < 1e-9, `recordStart ${plan.recordStart} vs ${expectedT}`);
  assert.ok(Math.abs(plan.countStart - (expectedT - barSec)) < 1e-9);
  assert.ok(plan.countStart > now);
});

test('count-in already inside the last bar waits for the next full cycle', () => {
  const bpm = 100;
  const bars = 4;
  const barSec = barSeconds(bpm);
  const loopSec = barSec * bars;
  const playStart = 0;
  const now = playStart + barSec * 3.25; // already in bar 4
  const plan = countInPlan({ now, bpm, bars, playing: true, playStart, autoLoop: true });
  const expectedT = playStart + loopSec * 2;
  assert.ok(Math.abs(plan.recordStart - expectedT) < 1e-9, `recordStart ${plan.recordStart} vs ${expectedT}`);
  assert.ok(plan.countStart > now);
  assert.ok(Math.abs(plan.recordStart - plan.countStart - barSec) < 1e-9);
});

test('count-in + latency trim lines the first beat up within 10 ms', () => {
  const sr = 48000;
  const bpm = 120;
  const now = 5;
  const latency = 0.018;
  const plan = countInPlan({ now, bpm, bars: 4, playing: false, playStart: 0, autoLoop: true });
  const skip = takeAlignOffsetSamples({
    sampleRate: sr,
    captureStartSec: now,
    recordStartSec: plan.recordStart,
    outputLatencySec: latency,
  });
  const firstSampleTime = now + skip / sr;
  const intendedVocalArrival = plan.recordStart + latency;
  const errMs = Math.abs(firstSampleTime - intendedVocalArrival) * 1000;
  assert.ok(errMs <= 10, `alignment error ${errMs.toFixed(3)} ms`);

  // Spike at the singer's beat-1 arrival must land on (or within 10 ms of) sample 0.
  const totalSec = plan.recordStart - now + barSeconds(bpm) * 4 + 0.5;
  const data = new Float32Array(Math.floor(totalSec * sr));
  const spikeAt = Math.round((intendedVocalArrival - now) * sr);
  data[spikeAt] = 1;
  const cap = new MicCapture({ sampleRate: sr }, {});
  cap.recording = true;
  cap._chunks = [data];
  const loopSamples = Math.floor(barSeconds(bpm) * 4 * sr);
  const result = cap.stop(loopSamples, skip);
  const idx = result.samples.findIndex((s) => s === 1);
  assert.ok(idx >= 0, 'expected a spike in the trimmed take');
  assert.ok((idx / sr) * 1000 <= 10, `spike was ${((idx / sr) * 1000).toFixed(3)} ms after beat 1`);
});

test('console renders the COUNT-IN toggle and Help button', () => {
  const html = buildConsoleHtml(
    { micGainDb: 9, micAutoLevel: true, tracks: [], bpm: 84, bars: 4, countInBars: 1 },
    'console',
    'major',
  );
  assert.match(html, /id="count-in"/);
  assert.match(html, /id="label-count-in"/);
  assert.match(html, /id="btn-help"/);
  assert.match(html, /id="help-overlay"/);
  assert.match(html, /id="count-in-overlay"/);
  assert.match(html, /checked/);
});

test('help walkthrough has ten plain-language steps and a tips section', () => {
  assert.equal(HELP_STEPS.length, 10);
  const html = helpBodyHtml();
  assert.match(html, /Enable Audio/);
  assert.match(html, /microphone/i);
  assert.match(html, /Count-in/);
  assert.match(html, /wired headphones/i);
  assert.match(html, /Lite/);
  assert.match(html, /WAV/);
  const md = helpMarkdown();
  assert.match(md, /^# How to use MrZesty/m);
  assert.match(md, /## Tips for a better recording/);
});
