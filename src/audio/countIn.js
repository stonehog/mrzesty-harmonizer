/**
 * 1-bar record count-in timing (audio-clock based, no setTimeout).
 *
 * A 4/4 bar of clicks (4-3-2-1, accented downbeat) is scheduled before
 * `recordStart`. Capture can begin earlier; `takeAlignOffsetSamples` drops
 * that pre-roll plus the output latency the singer hears, so the first kept
 * sample is the vocal that belongs on beat 1.
 */

export const BEATS_PER_BAR = 4;
/** How soon a count-in may begin when the transport is stopped. */
export const COUNT_IN_LEAD_SEC = 0.08;
/** Start capturing this far before the record downbeat when possible. */
export const CAPTURE_PREROLL_SEC = 0.15;
/** Same cap as the engine: never compensate more than this much output latency. */
export const MAX_LATENCY_COMP = 0.3;

export function beatSeconds(bpm) {
  return 60 / Math.max(1, Number(bpm) || 120);
}

export function barSeconds(bpm) {
  return beatSeconds(bpm) * BEATS_PER_BAR;
}

/**
 * Plan a 1-bar count-in and the audio-clock time of the record downbeat.
 *
 * If the loop is already playing, the count-in occupies the bar before the
 * next loop start. If that window has already begun, wait for the following
 * cycle so the singer still gets a full bar of clicks.
 *
 * @param {{
 *   now: number,
 *   bpm: number,
 *   bars?: number,
 *   playing?: boolean,
 *   playStart?: number,
 *   autoLoop?: boolean,
 * }} opts
 * @returns {{ countStart: number, recordStart: number, beats: { time: number, number: number }[] }}
 */
export function countInPlan(opts) {
  const now = Number(opts.now) || 0;
  const bpm = Number(opts.bpm) || 120;
  const bars = Math.max(1, Number(opts.bars) || 4);
  const beatSec = beatSeconds(bpm);
  const barSec = beatSec * BEATS_PER_BAR;
  const loopSec = barSec * bars;

  let recordStart;
  if (opts.playing && opts.autoLoop !== false && Number.isFinite(opts.playStart)) {
    const playStart = opts.playStart;
    const elapsed = Math.max(0, now - playStart);
    const loopsDone = Math.ceil((elapsed + 1e-9) / loopSec);
    recordStart = playStart + loopsDone * loopSec;
    // Need a full bar of clicks still in the future (tiny grace so a press
    // right on the last-bar downbeat still uses this cycle).
    if (recordStart - barSec < now - 0.05) {
      recordStart += loopSec;
    }
  } else {
    recordStart = now + COUNT_IN_LEAD_SEC + barSec;
  }

  const countStart = recordStart - barSec;
  const beats = [4, 3, 2, 1].map((number, i) => ({
    time: countStart + i * beatSec,
    number,
  }));
  return { countStart, recordStart, beats };
}

/**
 * Current 4-3-2-1 number at audio time `now`, or 0 when the count-in is over.
 * @param {{ time: number, number: number }[]} beats
 * @param {number} recordStart
 * @param {number} now
 */
export function countInNumberAt(beats, recordStart, now) {
  if (!beats || !beats.length || now >= recordStart) return 0;
  let n = beats[0].number;
  for (const b of beats) {
    if (now >= b.time) n = b.number;
  }
  return n;
}

/**
 * Samples to drop from the head of a take so sample 0 is the singer's beat 1:
 * everything before `recordStart`, plus the output latency they heard.
 *
 * @param {{
 *   sampleRate: number,
 *   captureStartSec: number,
 *   recordStartSec: number,
 *   outputLatencySec?: number,
 *   maxLatencySec?: number,
 * }} opts
 */
export function takeAlignOffsetSamples(opts) {
  const sr = Number(opts.sampleRate) || 0;
  if (sr <= 0) return 0;
  const preRoll = Math.max(0, (Number(opts.recordStartSec) || 0) - (Number(opts.captureStartSec) || 0));
  let lat = Number(opts.outputLatencySec) || 0;
  if (!Number.isFinite(lat) || lat < 0) lat = 0;
  const cap = Number(opts.maxLatencySec);
  lat = Math.min(Number.isFinite(cap) ? cap : MAX_LATENCY_COMP, lat);
  return Math.round((preRoll + lat) * sr);
}
