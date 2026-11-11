import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIC_GAIN_DB,
  MAX_MIC_GAIN_DB,
  AUTO_LEVEL_TARGET_DBFS,
  applyMicGainAndLimit,
  peakNormalize,
  peakOf,
  peakDb,
  dbToGain,
  softLimitSample,
  prepareVocalTake,
} from '../src/audio/recorder.js';
import { buildConsoleHtml } from '../src/ui/consoleTemplate.js';

function sine(seconds, sr, hz, amp) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sr) * amp;
  return out;
}

test('mic gain + soft limiter + auto-level raise a quiet (headset-like) take to about -3 dBFS', () => {
  assert.equal(DEFAULT_MIC_GAIN_DB, 9);
  assert.equal(MAX_MIC_GAIN_DB, 24);
  assert.equal(AUTO_LEVEL_TARGET_DBFS, -3);

  // ~ -26 dBFS, typical of a quiet Bluetooth conference headset
  const quiet = sine(0.4, 48000, 220, 0.05);
  assert.ok(Math.abs(peakDb(peakOf(quiet)) - peakDb(0.05)) < 0.2);

  const gainedOnly = applyMicGainAndLimit(quiet, DEFAULT_MIC_GAIN_DB);
  const expectedGain = 0.05 * dbToGain(9);
  assert.ok(Math.abs(peakOf(gainedOnly) - expectedGain) < 0.002);
  assert.ok(peakOf(gainedOnly) < 0.2, 'gain alone should not already be loud');

  const take = prepareVocalTake(quiet, { gainDb: DEFAULT_MIC_GAIN_DB, autoLevel: true });
  const peak = peakOf(take);
  const target = dbToGain(AUTO_LEVEL_TARGET_DBFS);
  assert.ok(Math.abs(peak - target) < 0.02, 'auto-leveled peak ' + peak + ' vs target ' + target);
  assert.ok(peakDb(peak) > -3.3 && peakDb(peak) < -2.7);
  assert.ok(peak < 1, 'auto-leveled take must not clip');
});

test('soft limiter keeps a hot take from clipping after +24 dB of mic gain', () => {
  const hot = sine(0.25, 48000, 330, 0.8);
  const limited = applyMicGainAndLimit(hot, 24);
  const peak = peakOf(limited);
  assert.ok(peak < 1, 'limiter must stay below 0 dBFS, got ' + peak);
  assert.ok(peak > 0.9, 'limiter should still be loud, got ' + peak);
  assert.ok(softLimitSample(12) < 1);
  assert.equal(softLimitSample(0.2), 0.2);
});

test('auto-level can be turned off; silence stays silent', () => {
  const quiet = sine(0.2, 44100, 220, 0.05);
  const raw = prepareVocalTake(quiet, { gainDb: 9, autoLevel: false });
  assert.ok(Math.abs(peakOf(raw) - 0.05 * dbToGain(9)) < 0.002);

  const silent = new Float32Array(2048);
  const out = prepareVocalTake(silent, { gainDb: 24, autoLevel: true });
  assert.equal(peakOf(out), 0);
});

test('Studio Console template renders MIC GAIN, input meter, and AUTO-LEVEL', () => {
  const mockEngine = {
    bpm: 78,
    bars: 4,
    swing: 0.24,
    styleId: 'triphop',
    variation: 'core',
    lockTempo: false,
    masterVolume: 0.7,
    drumVolume: 0.85,
    bassVolume: 0.85,
    drumPatternId: 'triphop',
    bassPatternId: 'triphop',
    bassRootSemis: 0,
    bassOctave: 0,
    bassVoice: 'auto',
    ideaName: 'Test Session',
    micGainDb: 9,
    micAutoLevel: true,
  };
  const html = buildConsoleHtml(mockEngine, 'console', 'major');
  assert.ok(html.includes('id="mic-gain"'));
  assert.ok(html.includes('id="mic-auto-level"'));
  assert.ok(html.includes('id="mic-meter"'));
  assert.ok(html.includes('id="mic-clip-flag"'));
  assert.ok(html.includes('MIC GAIN'));
  assert.ok(html.includes('AUTO-LEVEL'));
  assert.ok(html.includes('checked'));
});
