/**
 * HTML template builder for the MrZesty Studio Console UI.
 * Features the 8 Intelligent Musical Styles (Trip-Hop, Noir Rap, Techno, Alt-Rock,
 * Acid Jazz, Brown Sound, Art-Funk, Ska) with unified style pads,
 * independent Drum/Bass mix-and-match pads, variation density ('sparse' | 'core' | 'busy'),
 * and inline natural-language Style Interpreter.
 */

import { DOUBLER_PRESETS } from '../modules/harmonizer.js';
import {
  DRUM_PATTERNS,
  BASS_PATTERNS,
  getChopPattern,
  BASS_ROOTS,
  BASS_OCTAVES,
  BASS_VOICES,
  SWING_PRESETS,
  STYLE_PROFILES,
  VARIATION_MODES,
} from '../audio/kits.js';
import { STYLE_GROOVE_PRESETS } from './groovePrompt.js';

export const COMPACT_INTERVAL_PILLS = [
  { semitones: -12, short: '-Oct', title: 'Octave Down (-12 st)' },
  { semitones: -0.12, short: '-12¢', title: 'Micro Double Down (-12¢)' },
  { semitones: 0.12, short: '+12¢', title: 'Micro Double Up (+12¢)' },
  { semitones: 3, short: 'm3', title: 'Minor 3rd (+3 st)' },
  { semitones: 4, short: 'M3', title: 'Major 3rd (+4 st)' },
  { semitones: 5, short: '4th', title: 'Perfect 4th (+5 st)' },
  { semitones: 7, short: '5th', title: 'Perfect 5th (+7 st)' },
  { semitones: 8, short: 'm6', title: 'Minor 6th (+8 st)' },
  { semitones: 9, short: 'M6', title: 'Major 6th (+9 st)' },
  { semitones: 12, short: '+Oct', title: 'Octave Up (+12 st)' },
];

export const SCALE_TYPES = [
  { id: 'chromatic', label: 'Chromatic Lock', v1: 4, v2: 7, v3: 12 },
  { id: 'major', label: 'Major Triad (M3 + P5)', v1: 4, v2: 7, v3: 12 },
  { id: 'minor', label: 'Minor Triad (m3 + P5)', v1: 3, v2: 7, v3: 12 },
  { id: 'power', label: 'Fourth & Fifth (P4 + P5)', v1: 5, v2: 7, v3: -12 },
  { id: 'sixth', label: 'Soul 6ths (M3 + M6)', v1: 4, v2: 9, v3: 12 },
];

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parsePatternLabel(fullName) {
  const parts = String(fullName || '').split('·');
  const num = (parts[0] || '').trim();
  const rest = (parts[1] || fullName || '').trim();
  const match = rest.match(/^([^(]+?)(?:\s*\((.+)\))?$/);
  return {
    num,
    title: match ? match[1].trim() : rest,
    sub: match && match[2] ? match[2].trim() : 'Studio Style',
  };
}

export function buildConsoleHtml(engine, currentFinish, scaleTypeId) {
  const currentVar = engine.variation || 'core';
  const currentStyleId = engine.styleId || engine.drumPatternId || 'triphop';
  const chopPat = getChopPattern(engine.drumPatternId || currentStyleId);
  const chopLabel = chopPat ? chopPat.label : '—';

  return `
    <div class="console-frame finish-${currentFinish}" id="console-frame" data-finish="${currentFinish}">
      <div class="wood-cheek wood-left" aria-hidden="true"></div>
      <div class="console-chassis">

        <header class="topbar" role="banner">
          <div class="brand-cluster">
            <div class="screw" aria-hidden="true"></div>
            <div class="brand-badge">
              <div class="brand-title-row">
                <h1 class="brand-name">MRZESTY</h1>
                <span class="model-tag">STUDIO VOCAL &amp; STYLE CONSOLE</span>
              </div>
              <p id="status" class="status-line" role="status">Tap Enable Audio to power up the console.</p>
            </div>
          </div>

          <div class="transport-cluster" role="group" aria-label="Master Transport">
            <button type="button" id="btn-audio" class="hw-btn hw-btn-power" title="Initialize Web Audio Engine">
              <span class="led" id="led-audio"></span>
              <span class="btn-label" id="label-audio">ENABLE AUDIO</span>
            </button>

            <button type="button" id="btn-play" class="hw-btn hw-btn-play" disabled title="Play / Stop Loop">
              <span class="led"></span>
              <span class="btn-label" id="label-play">PLAY</span>
            </button>

            <button type="button" id="btn-stop" class="hw-btn hw-btn-stop" disabled title="Stop Transport">
              <span class="btn-label">STOP</span>
            </button>

            <button type="button" id="btn-rec" class="hw-btn hw-btn-rec" disabled aria-pressed="false" title="Record Dry Vocal Take on Armed Track">
              <span class="led led-red"></span>
              <span class="btn-label" id="label-rec">RECORD TAKE</span>
            </button>

            <label class="hw-btn hw-toggle-pill" title="Auto-loop ON records 1 frame and loops; OFF records a single phrase">
              <input type="checkbox" id="auto-loop" checked />
              <span class="led led-amber"></span>
              <span class="btn-label">LOOP</span>
            </label>

            <label class="hw-btn hw-toggle-pill" title="Metronome Click">
              <input type="checkbox" id="metro" />
              <span class="led led-green"></span>
              <span class="btn-label">CLICK</span>
            </label>
          </div>

          <div class="lcd-master" aria-label="Master Clock and Groove Readout">
            <div class="lcd-cell lcd-bpm">
              <div class="lcd-bpm-head">
                <span class="lcd-caption">BPM</span>
                <label class="lcd-lock-bpm" title="Lock BPM when switching musical styles">
                  <input type="checkbox" id="lock-bpm" ${engine.lockTempo ? 'checked' : ''} />
                  <span>LOCK</span>
                </label>
              </div>
              <input type="number" id="bpm" min="40" max="200" step="1" value="${engine.bpm}" aria-label="BPM" />
            </div>

            <div class="lcd-cell lcd-bars">
              <span class="lcd-caption">BARS (4/4)</span>
              <div class="bars-pills" role="group" aria-label="Loop Bars">
                ${[1, 2, 4, 8]
                  .map(
                    (b) =>
                      `<button type="button" class="lcd-pill ${b === engine.bars ? 'active' : ''}" data-bars-pill="${b}">${b}</button>`
                  )
                  .join('')}
              </div>
              <select id="bars" class="sr-only" aria-label="Loop frame (bars, 4/4)">
                <option value="1">1 bar</option>
                <option value="2">2 bars</option>
                <option value="4" selected>4 bars</option>
                <option value="8">8 bars</option>
              </select>
            </div>

            <div class="lcd-cell lcd-swing">
              <div class="lcd-swing-top">
                <span class="lcd-caption">GROOVE SWING</span>
                <strong id="swing-val" class="lcd-readout-val">42% · Pocket Swing</strong>
              </div>
              <input type="range" id="groove-swing" min="0" max="0.65" step="0.01" value="${engine.swing}" aria-label="Groove swing" />
              <div class="swing-pills">
                ${SWING_PRESETS.map(
                  (sp) =>
                    `<button type="button" class="lcd-mini-pill" data-swing="${sp.swing}" title="${sp.label}">${sp.label.split(' ')[0]}</button>`
                ).join('')}
              </div>
            </div>

            <div class="lcd-cell lcd-clock">
              <div class="pos" id="pos">Bar 1 · Beat 1</div>
              <div class="beats" id="beats" aria-hidden="true">
                <span class="dot" data-beat="1">1</span>
                <span class="dot" data-beat="2">2</span>
                <span class="dot" data-beat="3">3</span>
                <span class="dot" data-beat="4">4</span>
              </div>
              <div class="frame-hint" id="frame-hint"></div>
            </div>
          </div>

          <div class="utility-cluster">
            <div class="master-fader-mini" title="Master Output Level">
              <span class="silk-label">MASTER</span>
              <input type="range" id="master-vol" min="0" max="1" step="0.01" value="${engine.masterVolume}" aria-label="Master volume" />
            </div>

            <button type="button" id="btn-save-top" class="hw-btn hw-btn-util" disabled title="Save Idea to Browser IndexedDB">
              <span>SAVE IDEA</span>
            </button>
            <button type="button" id="btn-export-top" class="hw-btn hw-btn-util" disabled title="Bounce Mixdown to WAV">
              <span>EXPORT WAV</span>
            </button>
            <a id="dl-link" class="hw-btn hw-btn-amber hidden" download="mrzesty-idea.wav">DOWNLOAD WAV</a>
            <button type="button" id="btn-reset" class="hw-btn hw-btn-util" title="Reset Session">
              <span>RESET</span>
            </button>

            <button type="button" id="lite-toggle" class="hw-btn hw-btn-util lite-toggle" aria-pressed="false"
              title="Lite mode: fewer visual updates, no live reverb / delay, steadier audio buffers (takes effect fully after reload)">
              <span class="led led-green"></span>
              <span>LITE</span>
            </button>

            <div class="finish-switch" role="group" aria-label="UI Finish Mode">
              <button type="button" class="finish-opt ${currentFinish === 'console' ? 'active' : ''}" data-finish-mode="console" title="Warm Boutique Hardware Console (#3)">
                Console
              </button>
              <button type="button" class="finish-opt ${currentFinish === 'minimal' ? 'active' : ''}" data-finish-mode="minimal" title="Sleek Minimal Dark DAW (#2)">
                Minimal Dark
              </button>
            </div>
          </div>
        </header>

        <main class="console-deck">
          <!-- ZONE 1 (LEFT RACK): INTELLIGENT MUSICAL STYLE & RHYTHM ENGINE -->
          <section class="rack-unit rhythm-rack" id="kits-panel" aria-label="Intelligent Style and Rhythm Section">
            <div class="rack-header">
              <div class="rack-title-group">
                <span class="rack-unit-num">UNIT 01</span>
                <h2>STYLE &amp; RHYTHM ENGINE</h2>
              </div>
              <div class="variation-pills" id="variation-pills" role="radiogroup" aria-label="Groove Density Variation">
                ${VARIATION_MODES.map(
                  (vm) => `
                    <button type="button"
                      class="var-pill ${vm.id === currentVar ? 'active' : ''}"
                      data-variation="${vm.id}"
                      role="radio"
                      aria-checked="${vm.id === currentVar ? 'true' : 'false'}"
                      title="${vm.label}">
                      ${vm.short}
                    </button>
                  `
                ).join('')}
              </div>
            </div>

            <!-- MASTER INTELLIGENT MUSICAL STYLE MODULE (HARDWARE STYLE PADS) -->
            <div class="hw-module style-master-module">
              <div class="mini-lcd style-lcd" id="style-lcd">
                <div class="mini-lcd-top">
                  <span class="mini-lcd-tag" id="style-lcd-tag">INTELLIGENT BAND STYLE</span>
                  <span class="mini-lcd-swing" id="style-lcd-meta">84 BPM · 30% SWING</span>
                </div>
                <div class="mini-lcd-main" id="style-lcd-name">Trip-Hop · Bristol Downtempo Break</div>
                <div class="mini-lcd-sub" id="style-lcd-desc">Heavy swung Bristol breakbeat, crunchy vinyl snare &amp; dark cinematic sub-bass</div>
              </div>

              <!-- Illuminated Musical Style Hardware Pads -->
              <div class="style-pad-bank" id="style-pads" role="radiogroup" aria-label="8 Musical Styles">
                ${STYLE_PROFILES.map((sp) => {
                  const active = sp.id === currentStyleId && engine.drumPatternId === sp.id && engine.bassPatternId === sp.id;
                  return `
                    <button type="button"
                      class="style-pad ${active ? 'active' : ''}"
                      data-style-pad="${sp.id}"
                      role="radio"
                      aria-checked="${active ? 'true' : 'false'}"
                      title="${escapeHtml(sp.shortName + ' — ' + sp.title + ' (' + sp.defaultBpm + ' BPM)')}">
                      <span class="pad-led"></span>
                      <span class="style-pad-name">${escapeHtml(sp.shortName)}</span>
                      <span class="style-pad-badge">${escapeHtml(sp.badge)}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <!-- Inline Quick Style Interpreter Bar -->
              <div class="inline-style-bar">
                <input
                  type="text"
                  id="inline-groove-input"
                  placeholder='Style or hybrid: "noir rap", "ska", "2 tone", "trip-hop", "art-funk + acid jazz bass"…'
                  aria-label="Quick musical style prompt"
                />
                <button type="button" id="btn-inline-groove" class="hw-btn hw-btn-amber hw-btn-compact">
                  APPLY STYLE
                </button>
              </div>
            </div>

            <!-- 16-STEP LIVE LED CHASER -->
            <div class="step-chaser-strip" aria-label="16-Step Groove Chaser">
              <div class="chaser-head">
                <span class="silk-label">16-STEP POCKET CHASER</span>
                <span class="chaser-step-readout" id="chaser-readout">STEP 01 / 16</span>
              </div>
              <div class="step-leds" id="step-leds" aria-hidden="true">
                ${Array.from(
                  { length: 16 },
                  (_, s) =>
                    `<span class="step-led ${s % 4 === 0 ? 'downbeat' : ''}" data-step="${s}" title="Step ${s + 1}"></span>`
                ).join('')}
              </div>
            </div>

            <!-- DRUM KIT MODULE (Supports Independent Style Mix-and-Match) -->
            <div class="hw-module drum-module">
              <div class="module-top-bar">
                <label class="hw-power-switch">
                  <input type="checkbox" id="drums-on" />
                  <span class="led led-amber"></span>
                  <span class="switch-title">DRUM KIT</span>
                </label>

                <span class="channel-lcd-pill" id="drum-lcd-name">1 · Trip-Hop</span>

                <div class="module-fader-group">
                  <label class="hw-mute-pill">
                    <input type="checkbox" id="drums-mute" />
                    <span>MUTE</span>
                  </label>
                  <div class="fader-inline">
                    <span class="silk-label">LVL</span>
                    <input type="range" id="drum-vol" min="0" max="1" step="0.01" value="${engine.drumVolume}" aria-label="Drum volume" />
                  </div>
                </div>
              </div>
              <span class="sr-only" id="drum-lcd-sub">Bristol Downtempo Break</span>
              <span class="sr-only" id="drum-lcd-swing">SWING 24%</span>

              <div class="pad-bank" id="drum-pads" role="radiogroup" aria-label="Drum Style 1 to 8">
                ${DRUM_PATTERNS.map((p) => {
                  const info = parsePatternLabel(p.name);
                  const active = p.id === engine.drumPatternId;
                  return `
                    <button type="button"
                      class="step-pad ${active ? 'active' : ''}"
                      data-drum-pad="${p.id}"
                      role="radio"
                      aria-checked="${active ? 'true' : 'false'}"
                      title="Drums: ${escapeHtml(p.name)}">
                      <span class="pad-led"></span>
                      <span class="pad-num">${p.level}</span>
                      <span class="pad-caption">${escapeHtml(info.title.split(' ')[0])}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <select id="drum-pat" class="sr-only" aria-label="Drum style pattern">
                ${DRUM_PATTERNS.map(
                  (p) =>
                    `<option value="${p.id}"${p.id === engine.drumPatternId ? ' selected' : ''}>${p.name}</option>`
                ).join('')}
              </select>
            </div>


            <!-- CHOPS / KEYS MODULE (melodic bed: guitar skank, piano stabs, vibes) -->
            <div class="hw-module chop-module">
              <div class="module-top-bar">
                <label class="hw-power-switch">
                  <input type="checkbox" id="chops-on" />
                  <span class="led led-amber"></span>
                  <span class="switch-title">CHOPS / KEYS</span>
                </label>

                <span class="channel-lcd-pill" id="chop-lcd-name">${escapeHtml(chopLabel)}</span>

                <div class="module-fader-group">
                  <label class="hw-mute-pill">
                    <input type="checkbox" id="chops-mute" />
                    <span>MUTE</span>
                  </label>
                  <div class="fader-inline">
                    <span class="silk-label">LVL</span>
                    <input type="range" id="chop-vol" min="0" max="1" step="0.01" value="${engine.chopVolume ?? 0.85}" aria-label="Chops and keys volume" />
                  </div>
                </div>
              </div>
            </div>

            <!-- ANALOG BASS MODULE (Supports Independent Style Mix-and-Match + 12-Note Root Key) -->
            <div class="hw-module bass-module">
              <div class="module-top-bar">
                <label class="hw-power-switch">
                  <input type="checkbox" id="bass-on" />
                  <span class="led led-amber"></span>
                  <span class="switch-title">BASS</span>
                </label>

                <span class="channel-lcd-pill" id="bass-lcd-name">1 · Trip-Hop</span>

                <div class="module-fader-group">
                  <label class="hw-mute-pill">
                    <input type="checkbox" id="bass-mute" />
                    <span>MUTE</span>
                  </label>
                  <div class="fader-inline">
                    <span class="silk-label">LVL</span>
                    <input type="range" id="bass-vol" min="0" max="1" step="0.01" value="${engine.bassVolume}" aria-label="Bass volume" />
                  </div>
                </div>
              </div>
              <span class="sr-only" id="bass-lcd-sub">Dark Bristol Sub Creep</span>
              <span class="sr-only" id="bass-lcd-root">KEY: A</span>

              <div class="pad-bank" id="bass-pads" role="radiogroup" aria-label="Bass Style 1 to 8">
                ${BASS_PATTERNS.map((p) => {
                  const info = parsePatternLabel(p.name);
                  const active = p.id === engine.bassPatternId;
                  return `
                    <button type="button"
                      class="step-pad ${active ? 'active' : ''}"
                      data-bass-pad="${p.id}"
                      role="radio"
                      aria-checked="${active ? 'true' : 'false'}"
                      title="Bass: ${escapeHtml(p.name)}">
                      <span class="pad-led"></span>
                      <span class="pad-num">${p.level}</span>
                      <span class="pad-caption">${escapeHtml(info.title.split(' ')[0])}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <select id="bass-pat" class="sr-only" aria-label="Bass style pattern">
                ${BASS_PATTERNS.map(
                  (p) =>
                    `<option value="${p.id}"${p.id === engine.bassPatternId ? ' selected' : ''}>${p.name}</option>`
                ).join('')}
              </select>

              <div class="root-key-section">
                <div class="root-key-header">
                  <span class="silk-label">BASS KEY (C–B) · SHARED WITH HARMONIZER</span>
                  <span class="silk-value" id="bass-root-label">A · OCT 0</span>
                </div>
                <div class="note-key-bar" id="bass-root-keys" role="radiogroup" aria-label="Bass Root Note">
                  ${BASS_ROOTS.map((r) => {
                    const active = r.semitones === engine.bassRootSemis;
                    const isSharpFlat = r.id.includes('#') || r.id.includes('b');
                    const displayId = r.id.replace('b', '♭').replace('#', '♯');
                    return `
                      <button type="button"
                        class="note-key-btn ${isSharpFlat ? 'accidental' : 'natural'} ${active ? 'active' : ''}"
                        data-root-semi="${r.semitones}"
                        role="radio"
                        aria-checked="${active ? 'true' : 'false'}"
                        title="${escapeHtml(r.label)}">
                        ${displayId}
                      </button>
                    `;
                  }).join('')}
                </div>
                <div class="bass-tone-row">
                  <div class="bass-oct-group" role="radiogroup" aria-label="Bass octave">
                    <span class="silk-label">OCTAVE</span>
                    ${BASS_OCTAVES.map(
                      (o) => `
                      <button type="button"
                        class="var-pill bass-oct-btn ${o.id === (engine.bassOctave || 0) ? 'active' : ''}"
                        data-bass-octave="${o.id}"
                        role="radio"
                        aria-checked="${o.id === (engine.bassOctave || 0) ? 'true' : 'false'}"
                        title="Bass octave ${o.label}">${o.label}</button>`
                    ).join('')}
                  </div>
                  <div class="bass-voice-group" role="radiogroup" aria-label="Bass voice">
                    <span class="silk-label">VOICE</span>
                    ${BASS_VOICES.map(
                      (v) => `
                      <button type="button"
                        class="var-pill bass-voice-btn ${v.id === (engine.bassVoice || 'auto') ? 'active' : ''}"
                        data-bass-voice="${v.id}"
                        role="radio"
                        aria-checked="${v.id === (engine.bassVoice || 'auto') ? 'true' : 'false'}"
                        title="${escapeHtml(v.title)}">${escapeHtml(v.label)}</button>`
                    ).join('')}
                  </div>
                </div>
                <select id="bass-root" class="sr-only" aria-label="Bass root key">
                  ${BASS_ROOTS.map(
                    (r) =>
                      `<option value="${r.semitones}"${r.semitones === engine.bassRootSemis ? ' selected' : ''}>${r.label}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
          </section>

          <!-- ZONE 2 (CENTER CONSOLE): 3-TRACK VOCAL TAPE DECK -->
          <section class="rack-unit tape-console" aria-label="3-Track Vocal Tape Deck">
            <div class="rack-header">
              <div class="rack-title-group">
                <span class="rack-unit-num">UNIT 02</span>
                <h2>3-TRACK VOCAL TAPE DECK</h2>
              </div>
              <span class="silk-sub">DRY MIC CAPTURE · GAIN · AUTO-LEVEL</span>
            </div>

            <div class="tape-instructions">
              <span><strong>1. ARM</strong> a vocal lane</span>
              <span class="sep">·</span>
              <span><strong>2. RECORD TAKE</strong> (dry mic only)</span>
              <span class="sep">·</span>
              <span><strong>3. HARMONIZE</strong> routes track to Unit 03</span>
            </div>

            <div class="mic-input-strip" aria-label="Microphone input">
              <div class="mic-gain-wrap">
                <span class="silk-label">MIC GAIN</span>
                <input type="range" id="mic-gain" min="0" max="24" step="0.5" value="${engine.micGainDb ?? 9}" aria-label="Microphone gain in decibels" />
                <strong id="mic-gain-val" class="lcd-readout-val">+${engine.micGainDb ?? 9} dB</strong>
              </div>
              <div class="mic-meter-wrap" title="Input level after mic gain">
                <span class="silk-label">INPUT</span>
                <div class="mic-meter" id="mic-meter" aria-hidden="true">
                  <div class="mic-meter-fill" id="mic-meter-fill"></div>
                </div>
                <span class="mic-clip-flag" id="mic-clip-flag">CLIP</span>
              </div>
              <label class="hw-btn hw-toggle-pill" title="Peak-normalize each finished take to -3 dBFS before the harmonizer and doubler">
                <input type="checkbox" id="mic-auto-level" ${engine.micAutoLevel === false ? '' : 'checked'} />
                <span class="led led-green"></span>
                <span class="btn-label">AUTO-LEVEL</span>
              </label>
              <button type="button" id="mic-check" class="hw-btn hw-toggle-pill mic-check-btn" aria-pressed="false"
                title="Open the mic to watch the INPUT meter and set MIC GAIN. Leave it off otherwise: an open Bluetooth headset mic forces low-quality call audio.">
                <span class="led led-green"></span>
                <span class="btn-label">MIC CHECK</span>
              </button>
            </div>

            <div id="tracks" class="tape-lanes"></div>

            <div class="tuner-bridge" aria-live="polite">
              <div class="tuner-left">
                <span class="silk-label">VOCAL PITCH DETECTOR</span>
                <div class="pitch-readout-row">
                  <span class="pitch-note" id="pitch-note">—</span>
                  <div class="pitch-meta">
                    <span id="pitch-hz">— Hz</span>
                    <span id="pitch-cents" class="cents">±0¢</span>
                  </div>
                </div>
              </div>
              <div class="tuner-meter-wrap">
                <div class="cents-scale">
                  <span>-50¢</span>
                  <span>0¢ IN TUNE</span>
                  <span>+50¢</span>
                </div>
                <div class="cents-bar" aria-hidden="true">
                  <div class="cents-needle" id="cents-needle"></div>
                </div>
              </div>
            </div>
          </section>

          <!-- ZONE 3 (RIGHT RACK): VOCAL DOUBLER & FORMANT HARMONIZER -->
          <section class="rack-unit harmonizer-rack" aria-label="Vocal Doubler and Formant Harmonizer">
            <div class="rack-header">
              <div class="rack-title-group">
                <span class="rack-unit-num">UNIT 03</span>
                <h2>VOCAL DOUBLER &amp; FORMANT HARMONIZER</h2>
              </div>
              <label class="hw-engage-switch" title="Engage Post-Recording Vocal Processor">
                <input type="checkbox" id="harm-on" />
                <span class="led led-emerald"></span>
                <span class="engage-text">ENGAGE FX</span>
              </label>
            </div>

            <div class="fx-top-strip">
              <div class="fx-source-block">
                <span class="silk-label">SOURCE FEED</span>
                <div class="source-pills" id="harm-source-pills" role="radiogroup" aria-label="Target vocal track">
                  <button type="button" class="src-pill active" data-harm-src="track0">VOX 1</button>
                  <button type="button" class="src-pill" data-harm-src="track1">VOX 2</button>
                  <button type="button" class="src-pill" data-harm-src="track2">VOX 3</button>
                  <button type="button" class="src-pill" data-harm-src="all">ALL VOX</button>
                </div>
                <select id="harm-source" class="sr-only" aria-label="Target vocal track">
                  <option value="track0" selected>Vox 1</option>
                  <option value="track1">Vox 2</option>
                  <option value="track2">Vox 3</option>
                  <option value="all">All Vox (mixed)</option>
                </select>
              </div>

              <div class="fx-presets-block">
                <span class="silk-label">ONE-TAP MODE PRESETS</span>
                <div class="fx-preset-pills">
                  <button type="button" id="preset-double-only" class="hw-preset-btn" title="Thicken vocal with studio ADT doubler only — no harmony intervals">
                    Double Only
                  </button>
                  <button type="button" id="preset-double-triad" class="hw-preset-btn" title="ADT Doubler + Major 3rd &amp; Perfect 5th Triad">
                    Double + Triad
                  </button>
                  <button type="button" id="preset-harmony-only" class="hw-preset-btn" title="3-Voice Formant Harmony Only (Doubler Off)">
                    Harmony Only
                  </button>
                </div>
              </div>
            </div>

            <div class="hw-module doubler-module">
              <div class="doubler-top-row">
                <label class="hw-power-switch">
                  <input type="checkbox" id="doubler-on" />
                  <span class="led led-amber"></span>
                  <span class="switch-title">STUDIO ADT DOUBLER (NO HARMONY)</span>
                </label>
                <div class="fader-inline">
                  <span class="silk-label">MIX</span>
                  <input type="range" id="doubler-vol" min="0" max="1" step="0.01" value="0.55" aria-label="Doubler level" />
                </div>
              </div>

              <div class="doubler-width-pills" id="doubler-width-pills" role="radiogroup" aria-label="Doubler width">
                ${DOUBLER_PRESETS.map((p) => {
                  const active = p.widthCents === 15;
                  return `
                    <button type="button"
                      class="width-pill ${active ? 'active' : ''}"
                      data-dbl-width="${p.widthCents}"
                      role="radio"
                      aria-checked="${active ? 'true' : 'false'}">
                      <span class="led"></span>
                      <span>${escapeHtml(p.label)}</span>
                    </button>
                  `;
                }).join('')}
              </div>

              <select id="doubler-width" class="sr-only" aria-label="Doubler width">
                ${DOUBLER_PRESETS.map(
                  (p) =>
                    `<option value="${p.widthCents}"${p.widthCents === 15 ? ' selected' : ''}>${p.label}</option>`
                ).join('')}
              </select>
            </div>

            <div class="hw-module harmony-module">
              <div class="harmony-lcd-row">
                <div class="harm-lcd-box">
                  <div class="harm-lcd-field">
                    <span class="lcd-caption">SCALE KEY</span>
                    <select id="harm-key-select" aria-label="Scale Key">
                      ${BASS_ROOTS.map(
                        (r) =>
                          `<option value="${r.semitones}"${r.semitones === engine.bassRootSemis ? ' selected' : ''}>${r.id.replace('b', '♭').replace('#', '♯')} Root</option>`
                      ).join('')}
                    </select>
                  </div>
                  <div class="harm-lcd-field">
                    <span class="lcd-caption">VOICING TYPE</span>
                    <select id="harm-scale-type" aria-label="Scale Type">
                      ${SCALE_TYPES.map(
                        (st) =>
                          `<option value="${st.id}"${st.id === scaleTypeId ? ' selected' : ''}>${st.label}</option>`
                      ).join('')}
                    </select>
                  </div>
                </div>

                <div class="dry-wet-faders">
                  <label class="mini-fader-col" title="Target Dry Lead Vocal Level">
                    <span class="silk-label">DRY LEAD</span>
                    <input type="range" id="harm-dry-vol" min="0" max="1" step="0.01" value="0.9" aria-label="Dry vocal level" />
                  </label>
                  <label class="mini-fader-col" title="Wet Harmony &amp; Doubler Master Level">
                    <span class="silk-label">WET FX</span>
                    <input type="range" id="harm-vol" min="0" max="1" step="0.01" value="0.6" aria-label="FX master volume" />
                  </label>
                </div>
              </div>

              <div class="voices" id="voices"></div>
            </div>
          </section>
        </main>

        <footer class="drawer-shell" id="bottom-drawer">
          <div class="drawer-bar">
            <button type="button" id="btn-drawer-toggle" class="drawer-toggle-btn" aria-expanded="false" aria-controls="drawer-content">
              <span class="led led-amber" id="drawer-led"></span>
              <span class="drawer-toggle-title">SAVED IDEAS &amp; STYLE LAB</span>
              <span class="drawer-badge" id="drawer-summary-badge">1-Click Studio Drawer ▾</span>
            </button>

            <div class="drawer-quick-status">
              <span id="save-status" class="save-status-inline">Local IndexedDB Ready · 7 Sampled Musical Styles</span>
            </div>
          </div>

          <div id="drawer-content" class="drawer-content hidden" role="region" aria-label="Saved Ideas and Style Lab">
            <div class="drawer-grid">
              <div class="drawer-card">
                <div class="drawer-card-head">
                  <h3>INTELLIGENT STYLE INTERPRETER &amp; HYBRID LAB</h3>
                  <span class="silk-sub">SETS DRUM TIMBRE, BASS SYNTH, SWING &amp; TEMPO</span>
                </div>
                <div class="groove-prompt-row">
                  <input
                    type="text"
                    id="groove-prompt-input"
                    placeholder='Try "noir rap", "ska", "2 tone", "trip-hop", "noir rap drums with trip-hop bass"…'
                    aria-label="Style groove prompt"
                  />
                  <button type="button" id="btn-apply-groove" class="hw-btn hw-btn-amber">
                    DIAL STYLE
                  </button>
                </div>
                <div class="groove-quick-tags" id="groove-quick-tags">
                  ${STYLE_GROOVE_PRESETS.map(
                    (p) =>
                      `<button type="button" class="groove-tag-pill" data-groove-preset="${p.id}">${escapeHtml(p.shortLabel)}</button>`
                  ).join('')}
                </div>
                <p class="groove-feedback" id="groove-feedback">
                  Tap any style pad or type a hybrid combination (e.g. "noir rap with trip-hop bass" or "sparse art-funk").
                </p>
              </div>

              <div class="drawer-card">
                <div class="drawer-card-head">
                  <h3>SAVED IDEAS LIBRARY (INDEXEDDB)</h3>
                  <span class="silk-sub">LOCAL BROWSER STORAGE · WAV BOUNCE</span>
                </div>
                <div class="ideas-controls-grid">
                  <label class="drawer-field">
                    <span class="silk-label">IDEA TITLE</span>
                    <input type="text" id="idea-name" maxlength="80" value="${escapeHtml(engine.ideaName)}" />
                  </label>
                  <label class="drawer-field">
                    <span class="silk-label">SAVED TAKES</span>
                    <select id="idea-list">
                      <option value="">— none yet —</option>
                    </select>
                  </label>
                </div>
                <div class="drawer-actions-row">
                  <button type="button" id="btn-save" class="hw-btn hw-btn-amber" disabled>Save Idea</button>
                  <button type="button" id="btn-load" class="hw-btn" disabled>Load Selected</button>
                  <button type="button" id="btn-delete" class="hw-btn hw-btn-danger" disabled>Delete</button>
                  <button type="button" id="btn-export" class="hw-btn" disabled>Export Mix WAV</button>
                </div>
              </div>
            </div>
          </div>
        </footer>

      </div>
      <div class="wood-cheek wood-right" aria-hidden="true"></div>
    </div>
  `;
}
