/**
 * MrZesty Studio Console UI — Direction 3 (Warm Boutique Console: UA Apollo / TC-Helicon /
 * classic hardware studio rack) blended with the uncluttered single-screen layout of Direction 2
 * (Ableton Note / Logic Dark), plus an instant Console / Minimal Dark finish switch.
 */

import { INTERVALS } from '../modules/harmonizer.js';
import {
  DRUM_PATTERNS,
  BASS_PATTERNS,
  BASS_ROOTS,
  BASS_VOICES,
  STYLE_PROFILES,
  getStyleProfile,
  getChopPattern,
} from '../audio/kits.js';
import { saveIdea, listIdeas, loadIdea, deleteIdea, getLastIdeaId } from '../modules/storage.js';
import { matchStyleGroove } from './groovePrompt.js';
import { drawTrackWaveform } from './waveform.js';
import {
  buildConsoleHtml,
  COMPACT_INTERVAL_PILLS,
  SCALE_TYPES,
  escapeHtml,
  parsePatternLabel,
} from './consoleTemplate.js';
import { helpBodyHtml } from './helpContent.js';

const FINISH_STORAGE_KEY = 'mrzesty.uiFinish';
const LITE_STORAGE_KEY = 'mrzesty.lite';
const COUNT_IN_STORAGE_KEY = 'mrzesty.countIn';
/** Visual refresh caps (fps). Audio never depends on these. */
const UI_FPS = 30;
const UI_FPS_LITE = 15;

/**
 * @param {HTMLElement} root
 * @param {import('../audio/engine.js').SketchpadEngine} engine
 */
export function mountApp(root, engine) {
  let currentFinish = 'console';
  try {
    const savedFinish = localStorage.getItem(FINISH_STORAGE_KEY);
    if (savedFinish === 'minimal' || savedFinish === 'console') {
      currentFinish = savedFinish;
    }
  } catch {
    /* ignore */
  }

  let liteMode = false;
  try {
    liteMode = localStorage.getItem(LITE_STORAGE_KEY) === '1';
  } catch {
    /* ignore */
  }
  engine.liteMode = liteMode;
  const frameInterval = () => 1000 / (liteMode ? UI_FPS_LITE : UI_FPS);

  try {
    const savedCountIn = localStorage.getItem(COUNT_IN_STORAGE_KEY);
    engine.countInBars = savedCountIn === '0' ? 0 : 1;
  } catch {
    engine.countInBars = 1;
  }

  let scaleTypeId = 'major';
  let voicePans = [-25, 25, 0];
  let liveRecTrace = [];
  let waveformRaf = 0;

  root.innerHTML = buildConsoleHtml(engine, currentFinish, scaleTypeId);

  const voicesEl = root.querySelector('#voices');
  const voiceDefaults = [
    { label: 'VOICE 1', enabled: true, volume: 0.45, intervalId: 'M3', semitones: 4, pan: -25 },
    { label: 'VOICE 2', enabled: true, volume: 0.4, intervalId: 'P5', semitones: 7, pan: 25 },
    { label: 'VOICE 3', enabled: false, volume: 0.35, intervalId: 'P8', semitones: 12, pan: 0 },
  ];

  voiceDefaults.forEach((v, i) => {
    const slot = document.createElement('div');
    slot.className = `voice-slot ${v.enabled ? 'voice-active' : ''}`;
    slot.dataset.voiceSlot = String(i);
    slot.innerHTML = `
      <div class="voice-slot-top">
        <label class="hw-power-switch voice-toggle">
          <input type="checkbox" data-voice="${i}" data-field="enabled" ${v.enabled ? 'checked' : ''} />
          <span class="led led-amber"></span>
          <span class="switch-title">${v.label}</span>
        </label>

        <div class="voice-interval-pills" role="group" aria-label="${v.label} Interval">
          ${COMPACT_INTERVAL_PILLS.map(
            (p) => `
              <button type="button"
                class="int-pill ${Math.abs(p.semitones - v.semitones) < 0.01 ? 'active' : ''}"
                data-voice-pill="${i}"
                data-semitones="${p.semitones}"
                title="${p.title}">
                ${p.short}
              </button>
            `
          ).join('')}
        </div>

        <select data-voice="${i}" data-field="interval" class="sr-only" aria-label="${v.label} interval">
          ${INTERVALS.map(
            (int) =>
              `<option value="${int.semitones}"${int.id === v.intervalId ? ' selected' : ''}>${int.label}</option>`
          ).join('')}
        </select>
      </div>

      <div class="voice-slot-controls">
        <div class="voice-slider-wrap">
          <span class="silk-label">LEVEL</span>
          <input type="range" min="0" max="1" step="0.01" value="${v.volume}"
            data-voice="${i}" data-field="volume" aria-label="${v.label} volume" />
        </div>
        <div class="voice-pan-wrap">
          <span class="silk-label">PAN <em data-pan-label="${i}">${v.pan < 0 ? 'L' + Math.abs(v.pan) : v.pan > 0 ? 'R' + v.pan : 'C'}</em></span>
          <input type="range" min="-50" max="50" step="5" value="${v.pan}"
            data-voice="${i}" data-field="pan" aria-label="${v.label} pan" />
        </div>
      </div>
    `;
    voicesEl.appendChild(slot);
  });

  const $ = (sel) => root.querySelector(sel);
  const consoleFrame = $('#console-frame');
  const btnAudio = $('#btn-audio');
  const labelAudio = $('#label-audio');
  const btnPlay = $('#btn-play');
  const labelPlay = $('#label-play');
  const btnStop = $('#btn-stop');
  const btnRec = $('#btn-rec');
  const labelRec = $('#label-rec');
  const statusEl = $('#status');
  const posEl = $('#pos');
  const frameHint = $('#frame-hint');
  const tracksEl = $('#tracks');
  const bpmEl = $('#bpm');
  const barsEl = $('#bars');
  const autoLoopEl = $('#auto-loop');
  const metroEl = $('#metro');
  const swingEl = $('#groove-swing');
  const swingValEl = $('#swing-val');
  const drumsOnEl = $('#drums-on');
  const bassOnEl = $('#bass-on');
  const chopsOnEl = $('#chops-on');
  const drumsMuteEl = $('#drums-mute');
  const bassMuteEl = $('#bass-mute');
  const chopsMuteEl = $('#chops-mute');
  const drumPatEl = $('#drum-pat');
  const bassPatEl = $('#bass-pat');
  const bassRootEl = $('#bass-root');
  const drumVolEl = $('#drum-vol');
  const bassVolEl = $('#bass-vol');
  const chopVolEl = $('#chop-vol');
  const lockBpmEl = $('#lock-bpm');
  const styleLcdTag = $('#style-lcd-tag');
  const styleLcdMeta = $('#style-lcd-meta');
  const styleLcdName = $('#style-lcd-name');
  const styleLcdDesc = $('#style-lcd-desc');
  const inlineGrooveInput = $('#inline-groove-input');
  const btnInlineGroove = $('#btn-inline-groove');
  const drumLcdName = $('#drum-lcd-name');
  const drumLcdSub = $('#drum-lcd-sub');
  const drumLcdSwing = $('#drum-lcd-swing');
  const bassLcdName = $('#bass-lcd-name');
  const bassLcdSub = $('#bass-lcd-sub');
  const bassLcdRoot = $('#bass-lcd-root');
  const chopLcdName = $('#chop-lcd-name');
  const bassRootLabel = $('#bass-root-label');
  const chaserReadout = $('#chaser-readout');
  const stepLeds = [...root.querySelectorAll('.step-led')];
  const harmOnEl = $('#harm-on');
  const harmSourceEl = $('#harm-source');
  const harmVolEl = $('#harm-vol');
  const harmDryVolEl = $('#harm-dry-vol');
  const harmKeySelect = $('#harm-key-select');
  const harmScaleType = $('#harm-scale-type');
  const doublerOnEl = $('#doubler-on');
  const doublerWidthEl = $('#doubler-width');
  const doublerVolEl = $('#doubler-vol');
  const presetDoubleOnlyBtn = $('#preset-double-only');
  const presetDoubleTriadBtn = $('#preset-double-triad');
  const presetHarmonyOnlyBtn = $('#preset-harmony-only');
  const pitchNote = $('#pitch-note');
  const pitchHz = $('#pitch-hz');
  const pitchCents = $('#pitch-cents');
  const centsNeedle = $('#cents-needle');
  const ideaNameEl = $('#idea-name');
  const ideaListEl = $('#idea-list');
  const btnSave = $('#btn-save');
  const btnSaveTop = $('#btn-save-top');
  const btnLoad = $('#btn-load');
  const btnDelete = $('#btn-delete');
  const btnExport = $('#btn-export');
  const btnExportTop = $('#btn-export-top');
  const btnReset = $('#btn-reset');
  const dlLink = $('#dl-link');
  const saveStatus = $('#save-status');
  const masterVol = $('#master-vol');
  const beatDots = [...root.querySelectorAll('.dot')];
  const btnDrawerToggle = $('#btn-drawer-toggle');
  const drawerContent = $('#drawer-content');
  const drawerBadge = $('#drawer-summary-badge');
  const groovePromptInput = $('#groove-prompt-input');
  const btnApplyGroove = $('#btn-apply-groove');
  const grooveFeedback = $('#groove-feedback');
  const micGainEl = $('#mic-gain');
  const micGainValEl = $('#mic-gain-val');
  const micAutoLevelEl = $('#mic-auto-level');
  const micMeterEl = $('#mic-meter');
  const micMeterFillEl = $('#mic-meter-fill');
  const micClipFlagEl = $('#mic-clip-flag');
  const micCheckBtn = $('#mic-check');
  const liteBtn = $('#lite-toggle');
  const countInEl = $('#count-in');
  const countInLabel = $('#label-count-in');
  const countInOverlay = $('#count-in-overlay');
  const countInNumEl = $('#count-in-num');
  const helpBtn = $('#btn-help');
  const helpOverlay = $('#help-overlay');
  const helpClose = $('#help-close');
  const helpBody = $('#help-body');

  let lastDlUrl = null;
  let uiReady = false;
  let micMeterRaf = 0;
  let micMeterLast = 0;
  let micMeterShown = { pct: -1, hot: null, clip: null };
  let waveformLast = 0;
  let liveRecChunks = 0;
  let lastStepLed = -1;
  let lastPos = '';
  let lastBeat = -1;
  let lastPitch = { note: '', hz: '', cents: '', left: '' };

  function applyLite() {
    consoleFrame.classList.toggle('lite', liteMode);
    if (liteBtn) {
      liteBtn.classList.toggle('active', liteMode);
      liteBtn.setAttribute('aria-pressed', liteMode ? 'true' : 'false');
    }
    if (engine.harmonizer) engine.harmonizer.lite = liteMode;
  }

  function setLite(on) {
    liteMode = !!on;
    try {
      localStorage.setItem(LITE_STORAGE_KEY, liteMode ? '1' : '0');
    } catch {
      /* ignore */
    }
    engine.setLiteMode(liteMode);
    applyLite();
    statusEl.textContent = liteMode
      ? 'Lite mode on · fewer visuals, no live reverb/delay (reload for the steadier audio buffer)'
      : 'Lite mode off · full visuals and live reverb/delay';
  }

  function syncMicCheck() {
    const on = !!engine.micMonitor;
    if (micCheckBtn) {
      micCheckBtn.classList.toggle('active', on);
      micCheckBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (engine.micMeterActive) startMicMeterLoop();
  }

  function syncCountInToggle() {
    const on = engine.countInBars > 0;
    if (countInEl) countInEl.checked = on;
    if (countInLabel) countInLabel.textContent = on ? 'COUNT-IN' : 'COUNT-IN OFF';
  }

  function setCountIn(on) {
    engine.setCountIn(on);
    try {
      localStorage.setItem(COUNT_IN_STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    syncCountInToggle();
    statusEl.textContent = on
      ? 'Count-in on · one bar of clicks (4-3-2-1) before each take'
      : 'Count-in off · recording starts right away';
  }

  function updateCountInOverlay() {
    if (!countInOverlay || !countInNumEl) return;
    const n = engine.countInDisplay();
    if (!n) {
      countInOverlay.classList.add('hidden');
      countInOverlay.setAttribute('aria-hidden', 'true');
      return;
    }
    countInNumEl.textContent = String(n);
    countInOverlay.classList.remove('hidden');
    countInOverlay.setAttribute('aria-hidden', 'false');
  }

  function openHelp() {
    if (!helpOverlay) return;
    if (helpBody && !helpBody.dataset.ready) {
      helpBody.innerHTML = helpBodyHtml();
      helpBody.dataset.ready = '1';
    }
    helpOverlay.classList.remove('hidden');
    document.body.classList.add('help-open');
    helpClose?.focus();
  }

  function closeHelp() {
    if (!helpOverlay) return;
    helpOverlay.classList.add('hidden');
    document.body.classList.remove('help-open');
    helpBtn?.focus();
  }

  function setFinish(mode) {
    currentFinish = mode === 'minimal' ? 'minimal' : 'console';
    consoleFrame.dataset.finish = currentFinish;
    consoleFrame.classList.toggle('finish-console', currentFinish === 'console');
    consoleFrame.classList.toggle('finish-minimal', currentFinish === 'minimal');
    root.querySelectorAll('[data-finish-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.finishMode === currentFinish);
    });
    try {
      localStorage.setItem(FINISH_STORAGE_KEY, currentFinish);
    } catch {
      /* ignore */
    }
    redrawAllWaveforms();
  }

  function formatSwingLabel(s) {
    const pct = Math.round((Number(s) || 0) * 100);
    if (pct <= 4) return pct + '% · Straight';
    if (pct <= 22) return pct + '% · Light Groove';
    if (pct <= 42) return pct + '% · Pocket Swing';
    if (pct <= 53) return pct + '% · Triplet Swing';
    return pct + '% · Deep Shuffle';
  }

  function frameLabel() {
    const sec = engine.loopSeconds();
    return `${engine.bars}B · ${sec.toFixed(1)}s`;
  }

  function updateRhythmDisplays() {
    const drumPat = DRUM_PATTERNS.find((p) => p.id === engine.drumPatternId) || DRUM_PATTERNS[0];
    const dInfo = parsePatternLabel(drumPat.name);
    drumLcdName.textContent = `${drumPat.level} · ${dInfo.title}`;
    if (drumLcdSub) drumLcdSub.textContent = dInfo.sub;
    if (drumLcdSwing) drumLcdSwing.textContent = `SWING ${Math.round((engine.swing || 0) * 100)}%`;

    root.querySelectorAll('[data-drum-pad]').forEach((btn) => {
      const on = btn.dataset.drumPad === engine.drumPatternId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    const bassPat = BASS_PATTERNS.find((p) => p.id === engine.bassPatternId) || BASS_PATTERNS[0];
    const bInfo = parsePatternLabel(bassPat.name);
    const rootObj =
      BASS_ROOTS.find((r) => r.semitones === engine.bassRootSemis) ||
      BASS_ROOTS.find((r) => r.semitones === 0);
    bassLcdName.textContent = `${bassPat.level} · ${bInfo.title}`;
    if (bassLcdSub) bassLcdSub.textContent = bInfo.sub;
    if (bassLcdRoot) bassLcdRoot.textContent = `KEY: ${rootObj.id.replace('b', '♭').replace('#', '♯')}`;
    const oct = engine.bassOctave || 0;
    const voiceObj = BASS_VOICES.find((v) => v.id === (engine.bassVoice || 'auto')) || BASS_VOICES[0];
    bassRootLabel.textContent = `${rootObj.label} · OCT ${oct > 0 ? '+' + oct : oct} · ${voiceObj.label}`;
    root.querySelectorAll('[data-bass-octave]').forEach((btn) => {
      const on = Number(btn.dataset.bassOctave) === oct;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    root.querySelectorAll('[data-bass-voice]').forEach((btn) => {
      const on = btn.dataset.bassVoice === (engine.bassVoice || 'auto');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    root.querySelectorAll('[data-bass-pad]').forEach((btn) => {
      const on = btn.dataset.bassPad === engine.bassPatternId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    if (chopLcdName) {
      const chopPat = getChopPattern(engine.drumPatternId);
      chopLcdName.textContent = chopPat ? chopPat.label : '—';
    }

    // Update Master Intelligent Style LCD & 8 Style Pads
    const isUnified = engine.drumPatternId === engine.bassPatternId;
    const drumStyle = getStyleProfile(engine.drumPatternId);
    const bassStyle = getStyleProfile(engine.bassPatternId);
    const varUpper = (engine.variation || 'core').toUpperCase();
    const swingPct = Math.round((engine.swing || 0) * 100);

    if (styleLcdMeta) {
      styleLcdMeta.textContent = `${engine.bpm} BPM · ${swingPct}% SWING · ${varUpper}`;
    }
    if (isUnified) {
      if (styleLcdTag) styleLcdTag.textContent = `STYLE 0${drumStyle.level} · ${drumStyle.badge}`;
      if (styleLcdName) styleLcdName.textContent = `${drumStyle.shortName} · ${drumStyle.title}`;
      if (styleLcdDesc) styleLcdDesc.textContent = drumStyle.timbreDesc;
    } else {
      if (styleLcdTag) styleLcdTag.textContent = 'HYBRID STYLE MIX-AND-MATCH';
      if (styleLcdName) styleLcdName.textContent = `${drumStyle.shortName} Drums × ${bassStyle.shortName} Bass`;
      if (styleLcdDesc) {
        styleLcdDesc.textContent = `Drums: ${drumStyle.title} + Bass: ${bassStyle.title}`;
      }
    }

    root.querySelectorAll('[data-style-pad]').forEach((btn) => {
      const on = isUnified && btn.dataset.stylePad === drumStyle.id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    root.querySelectorAll('[data-variation]').forEach((btn) => {
      const on = btn.dataset.variation === (engine.variation || 'core');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    root.querySelectorAll('[data-swing]').forEach((btn) => {
      const target = Number(btn.dataset.swing);
      const on = Math.abs((Number(engine.swing) || 0) - target) <= 0.04;
      btn.classList.toggle('active', on);
    });

    if (lockBpmEl) {
      lockBpmEl.checked = !!engine.lockTempo;
    }

    root.querySelectorAll('[data-root-semi]').forEach((btn) => {
      const on = Number(btn.dataset.rootSemi) === engine.bassRootSemis;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    if (harmKeySelect) {
      harmKeySelect.value = String(engine.bassRootSemis);
    }
  }

  function isTrackFeedingHarmonizer(index) {
    if (!engine.harmonizer) return index === 0;
    return (
      engine.harmonizer.source === 'all' ||
      (engine.harmonizer.source === 'track' && engine.harmonizer.trackIndex === index)
    );
  }

  function renderTracks() {
    const harmEnabled = !!engine.harmonizer?.enabled;
    tracksEl.innerHTML = engine.tracks
      .map((t, i) => {
        const dur = t.hasAudio ? t.durationSec.toFixed(1) + 's' : 'EMPTY';
        const feedsHarm = isTrackFeedingHarmonizer(i);
        return `
        <div class="track-row ${t.armed ? 'armed' : ''} ${t.hasAudio ? 'has-audio' : ''} ${t.mute ? 'is-muted' : ''}" data-track-lane="${i}">
          <div class="track-left-controls">
            <span class="track-badge">VOX ${i + 1}</span>
            <label class="hw-arm-btn ${t.armed ? 'active' : ''}" title="Arm ${t.name} for recording">
              <input type="radio" name="arm" data-arm="${i}" ${t.armed ? 'checked' : ''} />
              <span class="led led-red"></span>
              <span>ARM</span>
            </label>
          </div>

          <div class="track-waveform-box">
            <canvas class="track-canvas" data-waveform="${i}" width="360" height="54" aria-label="${t.name} waveform"></canvas>
            <span class="track-dur-badge">${dur}</span>
          </div>

          <div class="track-right-controls">
            <div class="track-fader-wrap" title="${t.name} Level">
              <span class="silk-label">LVL</span>
              <input type="range" min="0" max="1" step="0.01" value="${t.volume}" data-tvol="${i}" aria-label="${t.name} volume" />
            </div>

            <button type="button"
              class="hw-harm-target-btn ${feedsHarm ? 'feeding' : ''} ${feedsHarm && harmEnabled ? 'engaged' : ''}"
              data-harm-target="${i}"
              title="Route ${t.name} into Vocal Doubler &amp; Harmonizer Unit">
              <span class="led"></span>
              <span>HARMONIZE</span>
            </button>

            <label class="hw-mute-pill ${t.mute ? 'active' : ''}" title="Mute ${t.name}">
              <input type="checkbox" data-mute="${i}" ${t.mute ? 'checked' : ''} />
              <span>MUTE</span>
            </label>

            <button type="button" class="hw-clear-btn" data-clear="${i}" ${t.hasAudio ? '' : 'disabled'} title="Clear ${t.name}">
              CLEAR
            </button>
          </div>
        </div>`;
      })
      .join('');

    redrawAllWaveforms();
  }

  function redrawAllWaveforms(playheadRatio = -1) {
    const canvases = tracksEl.querySelectorAll('canvas[data-waveform]');
    canvases.forEach((canvas) => {
      const idx = Number(canvas.dataset.waveform);
      const track = engine.tracks[idx];
      if (!track) return;
      drawTrackWaveform(canvas, {
        samples: track.samples,
        armed: track.armed,
        mute: track.mute,
        isRecording: engine.recording && track.armed,
        liveTrace: liveRecTrace,
        playheadRatio: track.hasAudio ? playheadRatio : -1,
        finish: currentFinish,
      });
    });
  }

  function formatMicGain(db) {
    const n = Number(db) || 0;
    if (n === 0) return '0 dB';
    const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
    return '+' + s + ' dB';
  }

  function micMeterPercent(peak) {
    if (!peak || peak <= 0) return 0;
    const db = 20 * Math.log10(peak);
    const min = -48;
    return Math.max(0, Math.min(100, ((db - min) / -min) * 100));
  }

  function updateMicMeter() {
    if (!micMeterFillEl) return;
    const active = engine.micMeterActive;
    const level = active && engine.getMicMeter ? engine.getMicMeter() : { peak: 0, clipHold: false };
    // Quantize so the DOM is only touched when the bar visibly moves.
    const pct = Math.round(micMeterPercent(level.peak || 0) * 2) / 2;
    const hot = pct >= 82; // about -6 dBFS on the -48..0 scale
    const clip = !!level.clipHold;
    if (pct !== micMeterShown.pct) {
      micMeterFillEl.style.transform = 'scaleX(' + (pct / 100).toFixed(3) + ')';
      micMeterShown.pct = pct;
    }
    if (micMeterEl && (hot !== micMeterShown.hot || clip !== micMeterShown.clip)) {
      micMeterEl.classList.toggle('hot', hot && !clip);
      micMeterEl.classList.toggle('clipping', clip);
    }
    if (micClipFlagEl && clip !== micMeterShown.clip) {
      micClipFlagEl.classList.toggle('on', clip);
    }
    micMeterShown.hot = hot;
    micMeterShown.clip = clip;
  }

  /** Mic meter runs only while MIC CHECK is on or a take is recording, capped at 30 fps. */
  function startMicMeterLoop() {
    if (micMeterRaf) return;
    const tick = (now) => {
      micMeterRaf = 0;
      if (!engine.micMeterActive) {
        updateMicMeter(); // drop the bar to zero once
        return;
      }
      micMeterRaf = requestAnimationFrame(tick);
      if (document.hidden || now - micMeterLast < frameInterval()) return;
      micMeterLast = now;
      updateMicMeter();
    };
    micMeterRaf = requestAnimationFrame(tick);
  }

  function updateWaveformLoop(now = performance.now()) {
    waveformRaf = 0;
    updateCountInOverlay();
    if (!engine.playing && !engine.recording && !engine.countingIn) {
      redrawAllWaveforms(-1);
      return;
    }
    // Throttle to 30 fps (15 in Lite) and skip work entirely while the tab is hidden.
    if (document.hidden || now - waveformLast < frameInterval()) {
      waveformRaf = requestAnimationFrame(updateWaveformLoop);
      return;
    }
    waveformLast = now;

    if (engine.recording) {
      const chunks = engine.capture?._chunks;
      if (chunks && chunks.length > 0 && chunks.length !== liveRecChunks) {
        liveRecChunks = chunks.length;
        const last = chunks[chunks.length - 1];
        let peak = 0;
        for (let i = 0; i < last.length; i += 8) {
          const a = Math.abs(last[i]);
          if (a > peak) peak = a;
        }
        liveRecTrace.push(Math.min(1, Math.max(0.05, peak * 2.2)));
        if (liveRecTrace.length > 96) liveRecTrace.shift();
        redrawAllWaveforms(-1); // only when a new chunk arrived
      }
    } else if (engine.playing && engine.ctx) {
      const dur = engine.mixDuration() || engine.loopSeconds() || 1;
      const elapsed = Math.max(0, engine.ctx.currentTime - engine._playStart);
      const ratio = engine.autoLoop ? (elapsed % dur) / dur : Math.min(1, elapsed / dur);
      redrawAllWaveforms(ratio);
    }

    if (engine.playing || engine.recording) {
      waveformRaf = requestAnimationFrame(updateWaveformLoop);
    }
  }

  function syncHarmonizerControls() {
    if (!engine.harmonizer) return;
    harmOnEl.checked = !!engine.harmonizer.enabled;
    const srcVal =
      engine.harmonizer.source === 'all' ? 'all' : 'track' + engine.harmonizer.trackIndex;
    harmSourceEl.value = srcVal;

    root.querySelectorAll('[data-harm-src]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.harmSrc === srcVal);
    });

    harmVolEl.value = String(engine.harmonizer.harmony.masterGain.gain.value ?? 0.6);

    const targetIdx = engine.harmonizer.source === 'all' ? 0 : engine.harmonizer.trackIndex;
    if (engine.tracks[targetIdx] && harmDryVolEl) {
      harmDryVolEl.value = String(engine.tracks[targetIdx].volume);
    }

    const dbl = engine.harmonizer.getDoublerConfig();
    doublerOnEl.checked = !!dbl.enabled;
    doublerWidthEl.value = String(dbl.widthCents ?? 15);
    doublerVolEl.value = String(dbl.volume ?? 0.55);

    root.querySelectorAll('[data-dbl-width]').forEach((btn) => {
      const on = Number(btn.dataset.dblWidth) === Number(dbl.widthCents ?? 15);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    const voiceCfgs = engine.harmonizer.getVoiceConfigs();
    voiceCfgs.forEach((cfg, idx) => {
      const slot = voicesEl.querySelector(`[data-voice-slot="${idx}"]`);
      const enEl = voicesEl.querySelector(`input[data-voice="${idx}"][data-field="enabled"]`);
      const intEl = voicesEl.querySelector(`select[data-voice="${idx}"][data-field="interval"]`);
      const volEl = voicesEl.querySelector(`input[data-voice="${idx}"][data-field="volume"]`);
      if (slot) slot.classList.toggle('voice-active', !!cfg.enabled);
      if (enEl) enEl.checked = !!cfg.enabled;
      if (intEl) intEl.value = String(cfg.semitones);
      if (volEl) volEl.value = String(cfg.volume);

      voicesEl.querySelectorAll(`[data-voice-pill="${idx}"]`).forEach((pill) => {
        const semi = Number(pill.dataset.semitones);
        pill.classList.toggle('active', Math.abs(semi - Number(cfg.semitones)) < 0.01);
      });
    });
  }

  async function refreshIdeas(selectId) {
    let ideas = [];
    try {
      ideas = await listIdeas();
    } catch (err) {
      saveStatus.textContent = 'Storage error: ' + (err.message || err);
      return;
    }
    const current = selectId || ideaListEl.value || engine.ideaId || '';
    ideaListEl.innerHTML =
      ideas.length === 0
        ? '<option value="">— none yet —</option>'
        : ideas
            .map((it) => {
              const when = new Date(it.updatedAt).toLocaleString();
              return `<option value="${it.id}">${escapeHtml(it.name)} · ${when}</option>`;
            })
            .join('');
    if (current && ideas.some((i) => i.id === current)) ideaListEl.value = current;
    btnLoad.disabled = !ideaListEl.value;
    btnDelete.disabled = !ideaListEl.value;
    drawerBadge.textContent =
      ideas.length > 0 ? `${ideas.length} Saved · Groove Prompt ▾` : '1-Click Studio Drawer ▾';
  }

  function setTransportEnabled(on) {
    btnPlay.disabled = !on;
    btnStop.disabled = !on;
    btnRec.disabled = !on;
    btnSave.disabled = !on;
    btnSaveTop.disabled = !on;
    btnExport.disabled = !on;
    btnExportTop.disabled = !on;
  }

  function syncTransportButtons() {
    const isPlaying = engine.playing && !engine.recording;
    labelPlay.textContent = isPlaying ? 'PLAYING' : 'PLAY';
    btnPlay.classList.toggle('active', isPlaying);
    if (engine.countingIn) {
      labelRec.textContent = 'CANCEL';
    } else {
      labelRec.textContent = engine.recording ? 'STOP REC' : 'RECORD TAKE';
    }
    btnRec.classList.toggle('recording', engine.recording || engine.countingIn);
    btnRec.setAttribute('aria-pressed', engine.recording || engine.countingIn ? 'true' : 'false');
    updateCountInOverlay();

    if ((engine.playing || engine.recording || engine.countingIn) && !waveformRaf) {
      waveformLast = 0;
      waveformRaf = requestAnimationFrame(updateWaveformLoop);
    }
    if (!engine.playing && lastStepLed >= 0) {
      stepLeds[lastStepLed]?.classList.remove('active');
      lastStepLed = -1;
    }
    syncMicCheck();
  }

  function updateFrameHint() {
    frameHint.textContent = frameLabel();
    root.querySelectorAll('[data-bars-pill]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.barsPill) === engine.bars);
    });
  }

  engine.onStatus = (msg) => {
    statusEl.textContent = msg;
  };

  engine.onState = () => {
    renderTracks();
    syncTransportButtons();
    bpmEl.value = String(engine.bpm);
    barsEl.value = String(engine.bars);
    autoLoopEl.checked = engine.autoLoop;
    metroEl.checked = engine.metronome;
    swingEl.value = String(engine.swing);
    swingValEl.textContent = formatSwingLabel(engine.swing);
    drumsOnEl.checked = engine.drumsOn;
    bassOnEl.checked = engine.bassOn;
    if (chopsOnEl) chopsOnEl.checked = engine.chopsOn;
    drumsMuteEl.checked = engine.drumsMute;
    bassMuteEl.checked = engine.bassMute;
    if (chopsMuteEl) chopsMuteEl.checked = engine.chopsMute;
    drumPatEl.value = engine.drumPatternId;
    bassPatEl.value = engine.bassPatternId;
    bassRootEl.value = String(engine.bassRootSemis);
    drumVolEl.value = String(engine.drumVolume);
    bassVolEl.value = String(engine.bassVolume);
    if (chopVolEl) chopVolEl.value = String(engine.chopVolume ?? 0.85);
    updateRhythmDisplays();
    syncHarmonizerControls();
    ideaNameEl.value = engine.ideaName;
    if (micGainEl) {
      micGainEl.value = String(engine.micGainDb ?? 9);
      if (micGainValEl) micGainValEl.textContent = formatMicGain(engine.micGainDb ?? 9);
    }
    if (micAutoLevelEl) micAutoLevelEl.checked = engine.micAutoLevel !== false;
    updateFrameHint();
  };

  engine.onBeat = (step, bar, beat) => {
    // Touch only what changed: one LED off, one on, and the readouts when they differ.
    const pos = 'Bar ' + bar + ' · Beat ' + beat;
    if (pos !== lastPos) {
      posEl.textContent = pos;
      lastPos = pos;
    }
    if (beat !== lastBeat) {
      beatDots.forEach((d) => d.classList.toggle('on', Number(d.dataset.beat) === beat));
      lastBeat = beat;
    }

    const stepInBar = ((Number(step) || 0) % 16 + 16) % 16;
    const ledIdx = engine.playing ? stepInBar : -1;
    if (ledIdx !== lastStepLed) {
      chaserReadout.textContent = `STEP ${String(stepInBar + 1).padStart(2, '0')} / 16`;
      if (lastStepLed >= 0 && stepLeds[lastStepLed]) stepLeds[lastStepLed].classList.remove('active');
      if (ledIdx >= 0 && stepLeds[ledIdx]) stepLeds[ledIdx].classList.add('active');
      lastStepLed = ledIdx;
    }
  };

  function setText(el, key, value) {
    if (lastPitch[key] === value) return;
    lastPitch[key] = value;
    el.textContent = value;
  }

  engine.onPitch = (info) => {
    setText(pitchNote, 'note', info.note);
    let left = '50%';
    if (info.frequency != null) {
      setText(pitchHz, 'hz', info.frequency.toFixed(1) + ' Hz');
      const sign = info.cents > 0 ? '+' : '';
      setText(pitchCents, 'cents', sign + info.cents + '¢');
      left = 50 + Math.max(-50, Math.min(50, info.cents)) + '%';
    } else {
      setText(pitchHz, 'hz', '— Hz');
      setText(pitchCents, 'cents', '±0¢');
    }
    if (lastPitch.left !== left) {
      lastPitch.left = left;
      centsNeedle.style.left = left;
    }
  };

  if (liteBtn) liteBtn.addEventListener('click', () => setLite(!liteMode));
  applyLite();
  syncCountInToggle();
  if (countInEl) {
    countInEl.addEventListener('change', () => setCountIn(countInEl.checked));
  }
  if (helpBody) {
    helpBody.innerHTML = helpBodyHtml();
    helpBody.dataset.ready = '1';
  }
  if (helpBtn) helpBtn.addEventListener('click', () => {
    if (helpOverlay && !helpOverlay.classList.contains('hidden')) closeHelp();
    else openHelp();
  });
  if (helpClose) helpClose.addEventListener('click', () => closeHelp());
  if (helpOverlay) {
    helpOverlay.addEventListener('click', (e) => {
      if (e.target === helpOverlay) closeHelp();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpOverlay && !helpOverlay.classList.contains('hidden')) {
      closeHelp();
    }
  });
  engine.onCountIn = () => {
    updateCountInOverlay();
    syncTransportButtons();
    if ((engine.playing || engine.recording || engine.countingIn) && !waveformRaf) {
      waveformRaf = requestAnimationFrame(updateWaveformLoop);
    }
  };

  if (micCheckBtn) {
    micCheckBtn.addEventListener('click', async () => {
      try {
        if (engine.micMonitor) {
          engine.stopMicMonitor();
          statusEl.textContent = 'Mic check off · mic closed until you record';
        } else {
          await engine.startMicMonitor();
          statusEl.textContent = 'Mic check on · sing and set MIC GAIN (turn off when done)';
        }
      } catch (err) {
        statusEl.textContent = 'Could not open mic: ' + (err.message || err);
      }
      syncMicCheck();
    });
  }

  root.querySelectorAll('[data-finish-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setFinish(btn.dataset.finishMode));
  });

  btnAudio.addEventListener('click', async () => {
    btnAudio.disabled = true;
    try {
      await engine.init();
      uiReady = true;
      labelAudio.textContent = 'AUDIO ON';
      btnAudio.classList.add('on');
      setTransportEnabled(true);
      updateFrameHint();
      updateRhythmDisplays();
      renderTracks();
      applyLite();
      // The mic stays closed until MIC CHECK or RECORD: an always-open Bluetooth headset
      // mic forces macOS into low-quality "call" audio, which makes playback choppy.
      await refreshIdeas();
      const last = getLastIdeaId();
      if (last) {
        ideaListEl.value = last;
        btnLoad.disabled = false;
        btnDelete.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = 'Could not start audio: ' + (err.message || err);
      btnAudio.disabled = false;
    }
  });

  btnPlay.addEventListener('click', async () => {
    try {
      if (engine.playing && !engine.recording) engine.stop();
      else await engine.play();
    } catch (err) {
      statusEl.textContent = err.message || String(err);
    }
  });

  btnStop.addEventListener('click', () => engine.stop());

  btnRec.addEventListener('click', async () => {
    try {
      if (!engine.recording) {
        liveRecTrace = [];
        liveRecChunks = 0;
      }
      await engine.record();
    } catch (err) {
      statusEl.textContent = err.message || String(err);
    }
  });

  bpmEl.addEventListener('change', () => engine.setBpm(Number(bpmEl.value)));

  barsEl.addEventListener('change', () => {
    engine.setBars(Number(barsEl.value));
    updateFrameHint();
  });
  root.querySelectorAll('[data-bars-pill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = Number(btn.dataset.barsPill);
      barsEl.value = String(b);
      engine.setBars(b);
      updateFrameHint();
    });
  });

  autoLoopEl.addEventListener('change', () => engine.setAutoLoop(autoLoopEl.checked));
  metroEl.addEventListener('change', () => engine.setMetronome(metroEl.checked));

  swingEl.addEventListener('input', () => {
    const val = Number(swingEl.value);
    swingValEl.textContent = formatSwingLabel(val);
    engine.setSwing(val);
  });
  root.querySelectorAll('[data-swing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      engine.setSwing(Number(btn.dataset.swing));
    });
  });

  drumsOnEl.addEventListener('change', async () => {
    engine.setDrumsOn(drumsOnEl.checked);
    if (drumsOnEl.checked && !engine.playing) {
      try {
        await engine.play();
      } catch {
        /* */
      }
    }
  });
  bassOnEl.addEventListener('change', async () => {
    engine.setBassOn(bassOnEl.checked);
    if (bassOnEl.checked && !engine.playing) {
      try {
        await engine.play();
      } catch {
        /* */
      }
    }
  });
  chopsOnEl?.addEventListener('change', async () => {
    engine.setChopsOn(chopsOnEl.checked);
    if (chopsOnEl.checked && !engine.playing) {
      try {
        await engine.play();
      } catch {
        /* */
      }
    }
  });

  drumPatEl.addEventListener('change', () => engine.setDrumPattern(drumPatEl.value, true));
  bassPatEl.addEventListener('change', () => engine.setBassPattern(bassPatEl.value));
  bassRootEl.addEventListener('change', () => engine.setBassRoot(Number(bassRootEl.value)));

  if (lockBpmEl) {
    lockBpmEl.addEventListener('change', () => {
      engine.setLockTempo(lockBpmEl.checked);
    });
  }

  root.querySelector('#variation-pills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-variation]');
    if (!btn) return;
    engine.setVariation(btn.dataset.variation);
  });

  root.querySelector('#style-pads')?.addEventListener('click', async (e) => {
    const pad = e.target.closest('[data-style-pad]');
    if (!pad) return;
    const styleId = pad.dataset.stylePad;
    const profile = engine.applyStyle(styleId);
    drumPatEl.value = engine.drumPatternId;
    bassPatEl.value = engine.bassPatternId;
    if (grooveFeedback) {
      grooveFeedback.textContent = `Style: ${profile.shortName} (${profile.title}) — ${profile.timbreDesc}`;
    }
    if (uiReady && !engine.playing) {
      try {
        await engine.play();
      } catch {
        /* ignore */
      }
    }
  });

  root.querySelector('#drum-pads').addEventListener('click', (e) => {
    const pad = e.target.closest('[data-drum-pad]');
    if (!pad) return;
    const id = pad.dataset.drumPad;
    drumPatEl.value = id;
    engine.setDrumPattern(id, true);
  });

  root.querySelector('#bass-pads').addEventListener('click', (e) => {
    const pad = e.target.closest('[data-bass-pad]');
    if (!pad) return;
    const id = pad.dataset.bassPad;
    bassPatEl.value = id;
    engine.setBassPattern(id);
  });

  root.querySelector('#bass-root-keys').addEventListener('click', (e) => {
    const keyBtn = e.target.closest('[data-root-semi]');
    if (!keyBtn) return;
    const semi = Number(keyBtn.dataset.rootSemi);
    bassRootEl.value = String(semi);
    engine.setBassRoot(semi);
  });

  root.querySelectorAll('[data-bass-octave]').forEach((btn) => {
    btn.addEventListener('click', () => engine.setBassOctave(Number(btn.dataset.bassOctave)));
  });
  root.querySelectorAll('[data-bass-voice]').forEach((btn) => {
    btn.addEventListener('click', () => engine.setBassVoice(btn.dataset.bassVoice));
  });

  drumsMuteEl.addEventListener('change', () => engine.setDrumsMute(drumsMuteEl.checked));
  bassMuteEl.addEventListener('change', () => engine.setBassMute(bassMuteEl.checked));
  chopsMuteEl?.addEventListener('change', () => engine.setChopsMute(chopsMuteEl.checked));
  drumVolEl.addEventListener('input', () => engine.setDrumVolume(Number(drumVolEl.value)));
  bassVolEl.addEventListener('input', () => engine.setBassVolume(Number(bassVolEl.value)));
  chopVolEl?.addEventListener('input', () => engine.setChopVolume(Number(chopVolEl.value)));

  micGainEl?.addEventListener('input', () => {
    const db = Number(micGainEl.value);
    engine.setMicGainDb(db);
    if (micGainValEl) micGainValEl.textContent = formatMicGain(engine.micGainDb);
    updateMicMeter();
  });
  micAutoLevelEl?.addEventListener('change', () => {
    engine.setMicAutoLevel(micAutoLevelEl.checked);
  });

  tracksEl.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.arm != null) engine.armTrack(Number(t.dataset.arm));
    if (t.dataset.mute != null) engine.setTrackMute(Number(t.dataset.mute), t.checked);
  });
  tracksEl.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.tvol != null) {
      const idx = Number(t.dataset.tvol);
      const val = Number(t.value);
      engine.setTrackVolume(idx, val);
      if (harmDryVolEl && isTrackFeedingHarmonizer(idx)) {
        harmDryVolEl.value = String(val);
      }
    }
  });
  tracksEl.addEventListener('click', async (e) => {
    const clearBtn = e.target.closest('[data-clear]');
    if (clearBtn) {
      engine.clearTrack(Number(clearBtn.dataset.clear));
      return;
    }
    const harmTargetBtn = e.target.closest('[data-harm-target]');
    if (harmTargetBtn) {
      const idx = Number(harmTargetBtn.dataset.harmTarget);
      await engine.setHarmonySource('track', idx);
      if (!engine.harmonizer?.enabled) {
        await engine.setHarmonyEnabled(true);
      }
    }
  });

  harmOnEl.addEventListener('change', async () => {
    try {
      await engine.setHarmonyEnabled(harmOnEl.checked);
    } catch {
      harmOnEl.checked = false;
    }
  });

  harmSourceEl.addEventListener('change', async () => {
    const v = harmSourceEl.value;
    if (v === 'all') await engine.setHarmonySource('all');
    else await engine.setHarmonySource('track', Number(v.replace('track', '')));
  });

  root.querySelector('#harm-source-pills').addEventListener('click', async (e) => {
    const pill = e.target.closest('[data-harm-src]');
    if (!pill) return;
    const v = pill.dataset.harmSrc;
    harmSourceEl.value = v;
    if (v === 'all') await engine.setHarmonySource('all');
    else await engine.setHarmonySource('track', Number(v.replace('track', '')));
  });

  harmVolEl.addEventListener('input', () => engine.setHarmonyVolume(Number(harmVolEl.value)));

  harmDryVolEl.addEventListener('input', () => {
    const v = Number(harmDryVolEl.value);
    if (!engine.harmonizer || engine.harmonizer.source === 'all') {
      engine.tracks.forEach((_, idx) => engine.setTrackVolume(idx, v));
    } else {
      engine.setTrackVolume(engine.harmonizer.trackIndex, v);
    }
    renderTracks();
  });

  harmKeySelect.addEventListener('change', () => {
    const semi = Number(harmKeySelect.value);
    bassRootEl.value = String(semi);
    engine.setBassRoot(semi);
  });

  harmScaleType.addEventListener('change', () => {
    scaleTypeId = harmScaleType.value;
    const st = SCALE_TYPES.find((s) => s.id === scaleTypeId);
    if (st && engine.harmonizer) {
      engine.updateHarmonyVoice(0, { semitones: st.v1 });
      engine.updateHarmonyVoice(1, { semitones: st.v2 });
      engine.updateHarmonyVoice(2, { semitones: st.v3 });
    }
  });

  doublerOnEl.addEventListener('change', () => {
    engine.updateHarmonyDoubler({ enabled: doublerOnEl.checked });
  });
  doublerWidthEl.addEventListener('change', () => {
    engine.updateHarmonyDoubler({ widthCents: Number(doublerWidthEl.value) });
  });
  root.querySelector('#doubler-width-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-dbl-width]');
    if (!pill) return;
    const w = Number(pill.dataset.dblWidth);
    doublerWidthEl.value = String(w);
    engine.updateHarmonyDoubler({ enabled: true, widthCents: w });
  });
  doublerVolEl.addEventListener('input', () => {
    engine.updateHarmonyDoubler({ volume: Number(doublerVolEl.value) });
  });

  presetDoubleOnlyBtn.addEventListener('click', () => engine.applyHarmonyPreset('double-only'));
  presetDoubleTriadBtn.addEventListener('click', () => engine.applyHarmonyPreset('double-triad'));
  presetHarmonyOnlyBtn.addEventListener('click', () => engine.applyHarmonyPreset('harmony-only'));

  voicesEl.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-voice-pill]');
    if (!pill) return;
    const idx = Number(pill.dataset.voicePill);
    const semi = Number(pill.dataset.semitones);
    engine.updateHarmonyVoice(idx, { enabled: true, semitones: semi });
  });

  voicesEl.addEventListener('change', (e) => {
    const t = e.target;
    const idx = Number(t.dataset.voice);
    if (Number.isNaN(idx)) return;
    if (t.dataset.field === 'enabled') engine.updateHarmonyVoice(idx, { enabled: t.checked });
    if (t.dataset.field === 'interval') {
      engine.updateHarmonyVoice(idx, { semitones: Number(t.value) });
    }
  });

  voicesEl.addEventListener('input', (e) => {
    const t = e.target;
    const idx = Number(t.dataset.voice);
    if (Number.isNaN(idx)) return;
    if (t.dataset.field === 'volume') {
      engine.updateHarmonyVoice(idx, { volume: Number(t.value) });
    } else if (t.dataset.field === 'pan') {
      const p = Number(t.value);
      voicePans[idx] = p;
      const lbl = voicesEl.querySelector(`[data-pan-label="${idx}"]`);
      if (lbl) lbl.textContent = p < 0 ? 'L' + Math.abs(p) : p > 0 ? 'R' + p : 'C';
    }
  });

  masterVol.addEventListener('input', () => engine.setMasterVolume(Number(masterVol.value)));
  ideaNameEl.addEventListener('input', () => {
    engine.ideaName = ideaNameEl.value || 'Untitled idea';
  });

  function toggleDrawer(forceOpen) {
    const isHidden = drawerContent.classList.contains('hidden');
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
    drawerContent.classList.toggle('hidden', !nextOpen);
    btnDrawerToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    btnDrawerToggle.classList.toggle('open', nextOpen);
  }

  btnDrawerToggle.addEventListener('click', () => toggleDrawer());

  function applyGrooveFromPrompt(promptStr) {
    const matched = matchStyleGroove(promptStr);
    engine.applyStyle(matched.id, {
      drumPatternId: matched.drumPatternId,
      bassPatternId: matched.bassPatternId,
      swing: matched.swing,
      bpm: matched.bpm,
      variation: matched.variation || 'core',
      enableKits: true,
    });
    drumPatEl.value = engine.drumPatternId;
    bassPatEl.value = engine.bassPatternId;
    if (inlineGrooveInput && promptStr) inlineGrooveInput.value = promptStr;
    if (groovePromptInput && promptStr) groovePromptInput.value = promptStr;
    grooveFeedback.textContent = `Dialed "${matched.label}": ${matched.description}`;
    statusEl.textContent = `Style set: ${matched.label} (${engine.bpm} BPM)`;
  }

  btnApplyGroove.addEventListener('click', () => {
    applyGrooveFromPrompt(groovePromptInput.value);
  });
  groovePromptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyGrooveFromPrompt(groovePromptInput.value);
    }
  });
  btnInlineGroove?.addEventListener('click', () => {
    applyGrooveFromPrompt(inlineGrooveInput.value);
  });
  inlineGrooveInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyGrooveFromPrompt(inlineGrooveInput.value);
    }
  });
  root.querySelector('#groove-quick-tags').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-groove-preset]');
    if (!tag) return;
    groovePromptInput.value = tag.textContent.trim();
    applyGrooveFromPrompt(tag.dataset.groovePreset);
  });

  async function handleSaveIdea() {
    if (!uiReady) return;
    saveStatus.textContent = 'Saving…';
    try {
      const id = await saveIdea(engine.snapshot());
      engine.ideaId = id;
      saveStatus.textContent = `Saved "${engine.ideaName}" locally.`;
      statusEl.textContent = `Saved "${engine.ideaName}"`;
      await refreshIdeas(id);
    } catch (err) {
      saveStatus.textContent = 'Save failed: ' + (err.message || err);
    }
  }

  async function handleExportWav() {
    saveStatus.textContent = 'Bouncing mix…';
    statusEl.textContent = 'Bouncing mixdown WAV…';
    if (lastDlUrl) {
      URL.revokeObjectURL(lastDlUrl);
      lastDlUrl = null;
    }
    dlLink.classList.add('hidden');
    try {
      const result = await engine.exportWav();
      lastDlUrl = URL.createObjectURL(result.blob);
      const safe = (engine.ideaName || 'mrzesty-idea').replace(/[^\w\-]+/g, '_');
      dlLink.href = lastDlUrl;
      dlLink.download = safe + '.wav';
      dlLink.classList.remove('hidden');
      const msg = 'Mixdown ' + result.durationSec.toFixed(1) + 's — tap Download WAV.';
      saveStatus.textContent = msg;
      statusEl.textContent = msg;
    } catch (err) {
      saveStatus.textContent = 'Export failed: ' + (err.message || err);
    }
  }

  btnSave.addEventListener('click', handleSaveIdea);
  btnSaveTop.addEventListener('click', handleSaveIdea);
  btnExport.addEventListener('click', handleExportWav);
  btnExportTop.addEventListener('click', handleExportWav);

  btnReset.addEventListener('click', () => {
    engine.stop();
    engine.tracks.forEach((_, idx) => engine.clearTrack(idx));
    engine.armTrack(0);
    engine.setDrumsOn(false);
    engine.setBassOn(false);
    engine.setChopsOn(false);
    engine.setBpm(90);
    engine.setBars(4);
    engine.setSwing(0);
    engine.setBassRoot(0);
    engine.setBassOctave(0);
    engine.setBassVoice('auto');
    engine.setMicGainDb(9);
    engine.setMicAutoLevel(true);
    if (engine.harmonizer) {
      engine.harmonizer.setEnabled(false);
    }
    dlLink.classList.add('hidden');
    statusEl.textContent = 'Console reset to default 4-bar / 90 BPM studio state.';
    engine._emitState();
  });

  btnLoad.addEventListener('click', async () => {
    const id = ideaListEl.value;
    if (!id) return;
    saveStatus.textContent = 'Loading…';
    try {
      const idea = await loadIdea(id);
      if (!idea) {
        saveStatus.textContent = 'Idea not found.';
        return;
      }
      await engine.applyIdea(idea);
      saveStatus.textContent = 'Loaded.';
    } catch (err) {
      saveStatus.textContent = 'Load failed: ' + (err.message || err);
    }
  });

  btnDelete.addEventListener('click', async () => {
    const id = ideaListEl.value;
    if (!id) return;
    if (!confirm('Delete this saved idea?')) return;
    try {
      await deleteIdea(id);
      if (engine.ideaId === id) engine.ideaId = null;
      saveStatus.textContent = 'Deleted.';
      await refreshIdeas();
    } catch (err) {
      saveStatus.textContent = 'Delete failed: ' + (err.message || err);
    }
  });

  ideaListEl.addEventListener('change', () => {
    btnLoad.disabled = !ideaListEl.value;
    btnDelete.disabled = !ideaListEl.value;
  });

  updateRhythmDisplays();
  renderTracks();
  updateFrameHint();
}
