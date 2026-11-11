import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRUM_PATTERNS,
  BASS_PATTERNS,
  BASS_ROOTS,
  BASS_OCTAVES,
  BASS_VOICES,
  SWING_PRESETS,
  STYLE_PROFILES,
  VARIATION_MODES,
  getDrumPattern,
  getBassPattern,
  getStyleProfile,
  stepSwingOffset,
  getStyleKit,
  getChopPattern,
  CHOP_PATTERNS,
  resolveBassVoice,
  bassMidiFor,
  chopMidiFor,
} from '../src/audio/kits.js';
import { INSTRUMENTS, zoneRateFor } from '../src/audio/sampler.js';
import { SAMPLE_URLS } from '../src/audio/sampleManifest.js';
import {
  DOUBLER_PRESETS,
  FormantPitchShifter,
  renderOfflineVoice,
  renderOfflineDoubler,
} from '../src/audio/pitchShiftDsp.js';
import { INTERVALS } from '../src/audio/harmony.js';
import { STYLE_GROOVE_PRESETS, matchStyleGroove } from '../src/ui/groovePrompt.js';
import { computeWaveformPeaks } from '../src/ui/waveform.js';
import {
  buildConsoleHtml,
  COMPACT_INTERVAL_PILLS,
  SCALE_TYPES,
  parsePatternLabel,
} from '../src/ui/consoleTemplate.js';

test('8 Core Musical Styles (Ska added, Cumbia & Shroom Lounge still gone) are defined', () => {
  const expectedIds = ['triphop', 'noirrap', 'techno', 'altrock', 'acidjazz', 'ween', 'byrne', 'ska'];

  assert.deepEqual(
    STYLE_PROFILES.map((s) => s.id),
    expectedIds
  );
  assert.deepEqual(
    DRUM_PATTERNS.map((p) => p.id),
    expectedIds
  );
  assert.deepEqual(
    BASS_PATTERNS.map((p) => p.id),
    expectedIds
  );
  assert.equal(BASS_ROOTS.length, 12);
  assert.deepEqual(
    BASS_ROOTS.map((r) => r.id),
    ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
  );
  assert.equal(new Set(BASS_ROOTS.map((r) => r.semitones)).size, 12);
  assert.deepEqual(BASS_OCTAVES.map((o) => o.id), [-1, 0, 1]);
  assert.ok(BASS_VOICES.some((v) => v.id === '808slide'));
  assert.equal(SWING_PRESETS.length, 4);
  assert.equal(VARIATION_MODES.length, 3);

  DRUM_PATTERNS.forEach((p, idx) => {
    assert.equal(p.level, idx + 1);
    assert.equal(p.kick.length, 32);
    assert.equal(p.snare.length, 32);
    assert.equal(p.hat.length, 32);
    assert.equal(p.perc.length, 32);
    const parsed = parsePatternLabel(p.name);
    assert.equal(parsed.num, String(idx + 1));
    assert.ok(parsed.title.length > 0);
  });

  BASS_PATTERNS.forEach((p, idx) => {
    assert.equal(p.level, idx + 1);
    assert.equal(p.notes.length, 32);
    assert.equal(p.gates.length, 32);
    assert.equal(p.vels.length, 32);
  });

  // Noir Rap: slow half-time (snare on beat 3 = step 8 / 24)
  const rap = getStyleProfile('noirrap');
  assert.ok(rap.defaultBpm >= 70 && rap.defaultBpm <= 90);
  assert.ok(getDrumPattern('noirrap').snare[8] >= 1.0);
  assert.ok(getDrumPattern('noirrap').snare[24] >= 1.0);

  // Ska: uptempo 2-tone (snare on 2 & 4, skank on the '&'s)
  const ska = getStyleProfile('ska');
  assert.ok(ska.defaultBpm >= 150 && ska.defaultBpm <= 170);
  assert.equal(ska.shortName, 'Ska');
  assert.ok(/2-tone/i.test(ska.title) || /2-tone/i.test(ska.badge));
  const skaDrums = getDrumPattern('ska');
  assert.ok(skaDrums.snare[4] >= 1.0 && skaDrums.snare[12] >= 1.0);
  const skaChop = getChopPattern('ska');
  assert.ok(skaChop);
  assert.equal(skaChop.instrument, 'eguitar');
  assert.equal(skaChop.steps[2], 1); // '&' of beat 1, bar 1 = I
  assert.equal(skaChop.steps[18], 2); // '&' of beat 1, bar 2 = IV
  assert.ok(skaChop.steps[26] >= 2); // later bar-2 '&' moves to V
  assert.equal(getBassPattern('ska').notes[16], 7); // bar 2 starts on the 5th, not a 1-bar loop

  // Backward-compatible legacy pattern lookup (old saved ideas)
  assert.equal(getDrumPattern('rock').id, 'altrock');
  assert.equal(getDrumPattern('cumbia').id, 'altrock');
  assert.equal(getBassPattern('mushroom').id, 'triphop');
  assert.equal(getStyleProfile('funk').id, 'acidjazz');

  assert.equal(stepSwingOffset(0, 0.125, 0.5), 0);
  assert.ok(stepSwingOffset(1, 0.125, 0.5) > 0.04);
});

test('Per-style sampled kits: natural bass everywhere except Techno synth and Noir Rap 808', () => {
  const pitchedDrumBan = /^(vibes|piano|agogo|cowbell|claves|woodblock|eguit)/;
  for (const sp of STYLE_PROFILES) {
    const kit = getStyleKit(sp.id);
    assert.ok(kit.kick && kit.snare && kit.hat && kit.open && kit.bass, sp.id);
    const lanes = [kit.kick, kit.snare, kit.ghost, kit.hat, kit.open, kit.perc1, kit.perc2];
    for (const lane of lanes) {
      assert.ok(!lane.chord, 'drum lane must not carry a pitched chord in ' + sp.id);
      const names = Array.isArray(lane.s) ? lane.s : [lane.s];
      names.forEach((n) => {
        assert.ok(SAMPLE_URLS[n], 'missing sample ' + n + ' in ' + sp.id);
        assert.ok(!pitchedDrumBan.test(n), 'pitched/melodic sample ' + n + ' still in drum kit for ' + sp.id);
      });
    }
  }
  // Melodic beds belong on the chop/keys lane
  assert.equal(getChopPattern('triphop').instrument, 'vibes');
  assert.equal(getChopPattern('noirrap').instrument, 'piano');
  assert.equal(getChopPattern('ska').instrument, 'eguitar');
  assert.equal(getChopPattern('techno'), null);
  assert.equal(resolveBassVoice('techno').instrument, 'synth');
  assert.equal(resolveBassVoice('noirrap').instrument, 'sub808');
  assert.equal(resolveBassVoice('noirrap', 'upright').instrument, 'upright');
  assert.equal(resolveBassVoice('noirrap', '808slide').slide, true);
  for (const id of ['triphop', 'altrock', 'acidjazz', 'ween', 'byrne', 'ska']) {
    assert.ok(['upright', 'electric'].includes(resolveBassVoice(id).instrument), id);
  }
  assert.equal(resolveBassVoice('ska').instrument, 'electric');
  for (const inst of Object.values(INSTRUMENTS)) {
    for (const [name] of inst.zones) assert.ok(SAMPLE_URLS[name], name);
  }
});

test('Bass key + octave transpose the line and stay in a playable range', () => {
  const a0 = bassMidiFor(0, 0, 0, -1);
  assert.equal(a0, 33); // A1
  assert.equal(bassMidiFor(0, 0, 1, -1), 45);
  assert.equal(bassMidiFor(0, 3, 0, -1), 36); // C
  assert.equal(bassMidiFor(0, -7, 0, -1), 38); // D2
  assert.equal(bassMidiFor(0, -5, 0, -1), 28); // E1
  for (const r of BASS_ROOTS) {
    for (const o of [-1, 0, 1]) {
      for (const semi of [-7, 0, 12]) {
        const m = bassMidiFor(semi, r.semitones, o, -1);
        assert.ok(m >= 16 && m <= 64, `${r.id} oct ${o} semi ${semi} -> ${m}`);
      }
    }
  }
  // Octave −1 / +1 really move the line for every key
  for (const r of BASS_ROOTS) {
    assert.equal(bassMidiFor(0, r.semitones, -1, -1), bassMidiFor(0, r.semitones, 0, -1) - 12);
    assert.equal(bassMidiFor(0, r.semitones, 1, -1), bassMidiFor(0, r.semitones, 0, -1) + 12);
  }
  const z = zoneRateFor('upright', 33);
  assert.ok(z.rate > 0.8 && z.rate < 1.25);
  const zg = zoneRateFor('eguitar', 48);
  assert.ok(zg && zg.rate > 0.8 && zg.rate < 1.25);
  // C major triad in the guitar register
  assert.equal(chopMidiFor(0, 3, 48), 48);
  assert.equal(chopMidiFor(4, 3, 48), 52);
  assert.equal(chopMidiFor(7, 3, 48), 55);
});

test('Intelligent Style Interpreter resolves the 8 styles and hybrids', () => {
  assert.ok(STYLE_GROOVE_PRESETS.length >= 8);
  assert.ok(!STYLE_GROOVE_PRESETS.some((p) => p.id === 'cumbia' || p.id === 'mushroom'));

  const triphop = matchStyleGroove('trip-hop bristol break');
  assert.equal(triphop.id, 'triphop');
  assert.equal(triphop.drumPatternId, 'triphop');
  assert.equal(triphop.bassPatternId, 'triphop');

  const rap = matchStyleGroove('lorde style rap');
  assert.equal(rap.id, 'noirrap');
  assert.equal(matchStyleGroove('noir rap').id, 'noirrap');
  assert.equal(matchStyleGroove('kanye 808').id, 'noirrap');

  const techno = matchStyleGroove('berlin 909 techno');
  assert.equal(techno.id, 'techno');
  assert.equal(techno.swing, 0);

  assert.equal(matchStyleGroove('90s pixies alt-rock').id, 'altrock');
  assert.equal(matchStyleGroove('jamiroquai acid jazz').id, 'acidjazz');
  assert.equal(matchStyleGroove('ween the mollusk brown mode').id, 'ween');
  assert.equal(matchStyleGroove('david byrne talking heads remain in light').id, 'byrne');
  assert.equal(matchStyleGroove('ska').id, 'ska');
  assert.equal(matchStyleGroove('2 tone skank').id, 'ska');
  const slowSka = matchStyleGroove('slow ska');
  assert.equal(slowSka.id, 'ska');
  assert.equal(slowSka.bpm, 80);

  const hybrid = matchStyleGroove('noir rap drums with trip-hop bass');
  assert.equal(hybrid.drumPatternId, 'noirrap');
  assert.equal(hybrid.bassPatternId, 'triphop');

  const sparseByrne = matchStyleGroove('sparse david byrne');
  assert.equal(sparseByrne.id, 'byrne');
  assert.equal(sparseByrne.variation, 'sparse');
});

test('Waveform peak computer calculates accurate min/max envelopes for canvas lanes', () => {
  const empty = computeWaveformPeaks(null, 64);
  assert.equal(empty.peak, 0);
  assert.equal(empty.mins.length, 64);

  const sine = new Float32Array(4800);
  for (let i = 0; i < sine.length; i++) {
    sine[i] = Math.sin((2 * Math.PI * 220 * i) / 48000) * 0.75;
  }
  const res = computeWaveformPeaks(sine, 48);
  assert.ok(res.peak > 0.7 && res.peak <= 0.76);
  assert.equal(res.mins.length, 48);
  assert.equal(res.maxs.length, 48);
});

test('FormantPitchShifter & ADT Doubler DSP preserve length and audio energy', () => {
  assert.equal(DOUBLER_PRESETS.length, 3);
  const sr = 24000;
  const dry = new Float32Array(sr / 2);
  for (let i = 0; i < dry.length; i++) {
    dry[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5;
  }

  const shifted = renderOfflineVoice({
    sourceSamples: dry,
    sampleRate: sr,
    semitones: 4,
    volume: 0.8,
  });
  assert.equal(shifted.length, dry.length);

  const doubled = renderOfflineDoubler({
    sourceSamples: dry,
    sampleRate: sr,
    widthCents: 15,
    volume: 0.8,
  });
  assert.equal(doubled.length, dry.length);
  assert.ok(FormantPitchShifter);
});

test('Studio Console template renders 8 Musical Style Pads, Chops lane, Variation selector, Lock BPM, and Harmonizer controls', () => {
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
  };

  const html = buildConsoleHtml(mockEngine, 'console', 'major');

  assert.ok(html.includes('data-finish-mode="console"'));
  assert.ok(html.includes('data-finish-mode="minimal"'));
  assert.ok(html.includes('id="lock-bpm"'));

  for (const sp of STYLE_PROFILES) {
    assert.ok(html.includes(`data-style-pad="${sp.id}"`));
    assert.ok(html.includes(`data-drum-pad="${sp.id}"`));
    assert.ok(html.includes(`data-bass-pad="${sp.id}"`));
  }

  for (const vm of VARIATION_MODES) {
    assert.ok(html.includes(`data-variation="${vm.id}"`));
  }

  assert.ok(html.includes('id="inline-groove-input"'));
  assert.ok(html.includes('id="step-leds"'));

  for (const r of BASS_ROOTS) {
    assert.ok(html.includes(`data-root-semi="${r.semitones}"`));
  }
  for (const o of BASS_OCTAVES) {
    assert.ok(html.includes(`data-bass-octave="${o.id}"`));
  }
  for (const v of BASS_VOICES) {
    assert.ok(html.includes(`data-bass-voice="${v.id}"`));
  }
  assert.ok(html.includes('id="chops-on"'));
  assert.ok(html.includes('id="chop-vol"'));
  assert.ok(html.includes('CHOPS / KEYS'));
  assert.ok(html.includes('data-style-pad="ska"'));
  assert.ok(!/cumbia|shroom/i.test(html));
  assert.ok(!/english beat|the clash/i.test(html)); // no artist names on the pads

  assert.equal(COMPACT_INTERVAL_PILLS.length, 10);
  assert.equal(SCALE_TYPES.length, 5);
  assert.ok(Array.isArray(INTERVALS));
});
