/**
 * Canvas waveform & live recording level trace renderer for the 3-Track Vocal Tape console.
 */

/**
 * Compute downsampled min/max envelope buckets for a mono Float32Array.
 * @param {Float32Array | null} samples
 * @param {number} bucketCount
 * @returns {{ mins: Float32Array, maxs: Float32Array, peak: number }}
 */
/** @type {WeakMap<Float32Array, Map<number, { mins: Float32Array, maxs: Float32Array, peak: number }>>} */
const PEAK_CACHE = new WeakMap();

/**
 * Cached envelope: a take's samples never change in place (a new take is a new array),
 * so the peaks are computed once per take and bucket count instead of every frame.
 * @param {Float32Array | null} samples
 * @param {number} bucketCount
 */
export function getWaveformPeaks(samples, bucketCount = 160) {
  if (!samples || samples.length === 0) return computeWaveformPeaks(samples, bucketCount);
  let byCount = PEAK_CACHE.get(samples);
  if (!byCount) {
    byCount = new Map();
    PEAK_CACHE.set(samples, byCount);
  }
  const key = Math.max(16, Math.floor(bucketCount));
  let peaks = byCount.get(key);
  if (!peaks) {
    peaks = computeWaveformPeaks(samples, key);
    byCount.set(key, peaks);
  }
  return peaks;
}

/** Per-canvas cache of the static (non-playhead) layer. */
const LAYER_CACHE = new WeakMap();

export function computeWaveformPeaks(samples, bucketCount = 160) {
  const count = Math.max(16, Math.floor(bucketCount));
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  if (!samples || samples.length === 0) {
    return { mins, maxs, peak: 0 };
  }

  const len = samples.length;
  const step = len / count;
  let globalPeak = 0;

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.min(len, Math.floor((i + 1) * step)));
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j++) {
      const v = samples[j];
      if (v < min) min = v;
      if (v > max) max = v;
      const a = v < 0 ? -v : v;
      if (a > globalPeak) globalPeak = a;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    mins[i] = min;
    maxs[i] = max;
  }

  return { mins, maxs, peak: globalPeak };
}

/**
 * Draw a track's recorded waveform or live recording trace onto a <canvas>.
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {Float32Array | null} opts.samples
 * @param {boolean} [opts.armed=false]
 * @param {boolean} [opts.mute=false]
 * @param {boolean} [opts.isRecording=false]
 * @param {number[]} [opts.liveTrace]       rolling peak history 0..1 while recording
 * @param {number} [opts.playheadRatio=-1]  0..1 playhead position (-1 = hidden)
 * @param {'console' | 'minimal'} [opts.finish='console']
 */
export function drawTrackWaveform(canvas, opts) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 54;
  const targetW = Math.max(64, Math.floor(cssW * dpr));
  const targetH = Math.max(28, Math.floor(cssH * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    LAYER_CACHE.delete(canvas);
  }

  const w = canvas.width;
  const h = canvas.height;
  const isMinimal = opts.finish === 'minimal';
  const liveRec = !!(opts.isRecording && opts.armed);
  const hasPlayhead =
    typeof opts.playheadRatio === 'number' && opts.playheadRatio >= 0 && opts.playheadRatio <= 1;
  const px = hasPlayhead ? Math.round(opts.playheadRatio * w) : -1;

  if (!liveRec && typeof document !== 'undefined' && document.createElement) {
    // Static layer (grid + waveform) is rendered once per take/size/finish/mute state;
    // each frame just blits it and draws the playhead line.
    const key = [w, h, opts.finish, !!opts.mute, !!opts.armed].join('|');
    let entry = LAYER_CACHE.get(canvas);
    if (!entry || entry.key !== key || entry.samples !== (opts.samples || null)) {
      const layer = entry?.layer || document.createElement('canvas');
      layer.width = w;
      layer.height = h;
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      drawStatic(lctx, w, h, dpr, cssW, opts, isMinimal);
      entry = { key, samples: opts.samples || null, layer, px: -2 };
      LAYER_CACHE.set(canvas, entry);
    } else if (entry.px === px) {
      return; // nothing visible changed since the last frame
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(entry.layer, 0, 0);
    entry.px = px;
    if (px >= 0) drawPlayhead(ctx, px, h, dpr, isMinimal);
    return;
  }

  LAYER_CACHE.delete(canvas);
  drawStatic(ctx, w, h, dpr, cssW, opts, isMinimal);
  if (!liveRec && px >= 0) drawPlayhead(ctx, px, h, dpr, isMinimal);
}

function drawPlayhead(ctx, px, h, dpr, isMinimal) {
  ctx.strokeStyle = isMinimal ? '#38bdf8' : '#ffd166';
  ctx.lineWidth = Math.max(1.5, dpr * 1.5);
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, h);
  ctx.stroke();
}

function drawStatic(ctx, w, h, dpr, cssW, opts, isMinimal) {
  const midY = h * 0.5;

  const bgColor = isMinimal ? '#10141d' : '#120e0a';
  const gridColor = isMinimal ? 'rgba(148, 163, 184, 0.11)' : 'rgba(245, 179, 66, 0.12)';
  const centerLineColor = isMinimal ? 'rgba(148, 163, 184, 0.22)' : 'rgba(245, 179, 66, 0.24)';

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  // Subtle bar/beat vertical grid ticks (16 subdivisions)
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = Math.max(1, dpr * 0.75);
  for (let i = 1; i < 16; i++) {
    const x = Math.floor((w * i) / 16) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, i % 4 === 0 ? 0 : h * 0.2);
    ctx.lineTo(x, i % 4 === 0 ? h : h * 0.8);
    ctx.stroke();
  }

  // Zero-crossing center line
  ctx.strokeStyle = centerLineColor;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  // Live recording trace on the armed track
  if (opts.isRecording && opts.armed) {
    const trace = opts.liveTrace || [];
    const barCount = 96;
    const barW = w / barCount;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.strokeStyle = '#ff5a5f';
    ctx.lineWidth = Math.max(1.2, dpr * 1.2);

    for (let i = 0; i < trace.length && i < barCount; i++) {
      const amp = Math.max(0.03, Math.min(1, trace[i]));
      const x = i * barW;
      const halfH = amp * (h * 0.44);
      ctx.fillStyle = i === trace.length - 1 ? '#ff7b7f' : 'rgba(244, 63, 94, 0.78)';
      ctx.fillRect(x + 0.5, midY - halfH, Math.max(1.5, barW - 1.2 * dpr), halfH * 2);
    }

    // Recording head glow
    const headX = Math.min(w - 2, trace.length * barW);
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = Math.max(1.5, dpr * 1.5);
    ctx.beginPath();
    ctx.moveTo(headX, 0);
    ctx.lineTo(headX, h);
    ctx.stroke();
    return;
  }

  // Recorded audio waveform
  if (opts.samples && opts.samples.length > 0) {
    const buckets = Math.min(200, Math.max(64, Math.floor(cssW / 2.5)));
    const { mins, maxs, peak } = getWaveformPeaks(opts.samples, buckets);
    const norm = peak > 0.01 ? Math.min(2.6, 0.92 / peak) : 1;
    const barW = w / buckets;

    const mainFill = opts.mute
      ? 'rgba(138, 145, 158, 0.38)'
      : isMinimal
        ? 'rgba(56, 189, 248, 0.82)'
        : 'rgba(245, 179, 66, 0.86)';
    const coreFill = opts.mute
      ? 'rgba(138, 145, 158, 0.55)'
      : isMinimal
        ? '#bae6fd'
        : '#ffe099';

    ctx.fillStyle = mainFill;
    for (let i = 0; i < buckets; i++) {
      const minV = Math.max(-1, mins[i] * norm);
      const maxV = Math.min(1, maxs[i] * norm);
      const yTop = midY - maxV * (h * 0.44);
      const yBot = midY - minV * (h * 0.44);
      const barH = Math.max(1.5 * dpr, yBot - yTop);
      ctx.fillRect(i * barW + 0.4, yTop, Math.max(1.2, barW - 0.9 * dpr), barH);
    }

    // Inner bright RMS highlight
    ctx.fillStyle = coreFill;
    for (let i = 0; i < buckets; i++) {
      const minV = Math.max(-1, mins[i] * norm * 0.45);
      const maxV = Math.min(1, maxs[i] * norm * 0.45);
      const yTop = midY - maxV * (h * 0.44);
      const yBot = midY - minV * (h * 0.44);
      const barH = Math.max(1 * dpr, yBot - yTop);
      ctx.fillRect(i * barW + 0.5, yTop, Math.max(1, barW - 1.1 * dpr), barH);
    }
  } else {
    // Empty tape lane standby label
    ctx.fillStyle = isMinimal ? 'rgba(148, 163, 184, 0.42)' : 'rgba(235, 186, 109, 0.42)';
    ctx.font = `${Math.round(10.5 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = opts.armed ? 'ARMED · READY TO RECORD DRY MIC' : 'EMPTY TAPE LANE';
    ctx.fillText(label, w / 2, midY);
  }
}
