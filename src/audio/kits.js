/**
 * Offline Intelligent Musical Style Kits — sampled band tones & genre grooves (no cloud).
 *
 * Sound: bundled CC0 one-shots via ./sampler.js (per-style kit mapping below). If the samples
 * are not loaded yet (or in Node tests) every voice falls back to the older Web Audio synthesis.
 *
 * 8 Core Musical Styles:
 *   1 · Trip-Hop (Bristol Downtempo Break)
 *   2 · Noir Rap (Half-Time Dark-Pop Boom) — new
 *   3 · Techno (Berlin 909 / Warehouse)
 *   4 · Alt-Rock (90s Quiet-Loud Drive)
 *   5 · Acid Jazz (Funk break × Bristol dub bass)
 *   6 · Brown Sound (Lo-Fi Eclectic)
 *   7 · Art-Funk (80s Poly-Groove)
 *   8 · Ska (2-Tone Offbeat Skank)
 *
 * Each style defines:
 *   - 2-bar (32-step) drum & percussion choreography (kick, snare/rim, closed/open hat, unpitched percussion)
 *   - optional 2-bar chop / keys pattern (guitar skank, piano stabs, vibes) on a separate lane
 *   - 2-bar (32-step) bassline (semitone offsets from selected Bass Root, gate lengths, velocities)
 *   - Per-style synthesis timbre parameters (kick pitch/punch, snare/rim/clap/brush character,
 *     güiro/conga/agogo/cowbell percussion synth, and bass oscillator/filter/resonance/wobble envelope)
 *   - Groove Variation / Density mode ('sparse' | 'core' | 'busy')
 */

import { playSample, playPitched, samplesReady } from './sampler.js';

export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
export const BASS_ROOT_HZ = 110; // A2 reference (synth fallback)
export const BASS_ROOT_MIDI = 45; // A2

/**
 * Groove swing presets (0 = straight 16ths, 0.50 = 2:1 triplet swing, 0.60 = deep shuffle).
 */
export const SWING_PRESETS = [
  { id: 'straight', label: 'Straight 0%', swing: 0 },
  { id: 'pocket', label: 'Pocket 22%', swing: 0.22 },
  { id: 'swing', label: 'Lounge 36%', swing: 0.36 },
  { id: 'shuffle', label: 'Shuffle 55%', swing: 0.55 },
];

/**
 * Groove density / variation modes so any style can be stripped back or pushed harder.
 */
export const VARIATION_MODES = [
  { id: 'sparse', label: 'Pocket (Stripped)', short: 'SPARSE' },
  { id: 'core', label: 'Core Groove', short: 'CORE' },
  { id: 'busy', label: 'Hype / Dub Fill', short: 'BUSY' },
];

/**
 * Selectable bass root keys, C through B (all 12). Values are semitone offsets relative to A
 * and keep the same numbers as earlier builds so saved ideas reload in the same key (this key is
 * shared with the harmonizer's Scale Key). See bassMidiFor() for the register and the
 * Octave control (−1 / 0 / +1).
 */
export const BASS_ROOTS = [
  { id: 'C', label: 'C', semitones: 3 },
  { id: 'C#', label: 'C♯ / D♭', semitones: 4 },
  { id: 'D', label: 'D', semitones: -7 },
  { id: 'Eb', label: 'E♭ / D♯', semitones: -6 },
  { id: 'E', label: 'E', semitones: -5 },
  { id: 'F', label: 'F', semitones: -4 },
  { id: 'F#', label: 'F♯ / G♭', semitones: -3 },
  { id: 'G', label: 'G', semitones: -2 },
  { id: 'Ab', label: 'A♭ / G♯', semitones: -1 },
  { id: 'A', label: 'A', semitones: 0 },
  { id: 'Bb', label: 'B♭ / A♯', semitones: 1 },
  { id: 'B', label: 'B', semitones: 2 },
];

/** Bass octave shift choices. */
export const BASS_OCTAVES = [
  { id: -1, label: '−1' },
  { id: 0, label: '0' },
  { id: 1, label: '+1' },
];

/**
 * Bass voice override. 'auto' uses each style's own instrument (natural upright / electric
 * bass everywhere except Techno's synth bass and Noir Rap's 808).
 */
export const BASS_VOICES = [
  { id: 'auto', label: 'AUTO', title: 'Style default' },
  { id: 'upright', label: 'UPRIGHT', title: 'Natural upright (pizz) bass' },
  { id: 'electric', label: 'ELECTRIC', title: 'Natural electric finger bass' },
  { id: '808', label: '808', title: 'Sampled 808 sub' },
  { id: '808slide', label: '808 SLIDE', title: 'Heavier 808 with glides between notes' },
  { id: 'synth', label: 'SYNTH', title: 'Electronic synth bass' },
];

/** Root-key helper: MIDI note for bass root (A = MIDI 45 at octave 0 before voice offset). */
export function bassRootLabel(semis) {
  const r = BASS_ROOTS.find((x) => x.semitones === Number(semis));
  return r ? r.label : 'A';
}

/**
 * Compute time delay (in seconds) for odd 16th-note subdivisions ("e" and "a").
 * At swing = 0.50, odd steps shift by +0.33 * stepSec (exact 2:1 triplet swing).
 *
 * @param {number} stepIndex
 * @param {number} stepSec
 * @param {number} [swing=0]  0.0 to 0.65
 * @returns {number}
 */
export function stepSwingOffset(stepIndex, stepSec, swing = 0) {
  if ((stepIndex & 1) === 0) return 0;
  const clamped = Math.max(0, Math.min(0.65, Number(swing) || 0));
  return clamped * 0.66 * stepSec;
}

/**
 * Master catalog of the 8 Intelligent Musical Styles.
 * Links unified style metadata with default BPM, swing, root key suggestion, and vocal preset.
 */
export const STYLE_PROFILES = [
  {
    id: 'triphop',
    level: 1,
    shortName: 'Trip-Hop',
    title: 'Bristol Downtempo Break',
    badge: 'BRISTOL BREAK',
    defaultBpm: 84,
    defaultSwing: 0.30,
    defaultRootSemis: 0, // A
    harmonyPreset: 'double-triad',
    timbreDesc: 'Heavy swung Bristol breakbeat, crunchy vinyl snare, raw kit, vibes on a separate keys lane & dark upright bass in a deep room',
  },
  {
    id: 'noirrap',
    level: 2,
    shortName: 'Noir Rap',
    title: 'Half-Time Dark-Pop Boom',
    badge: 'NOIR 808',
    defaultBpm: 76,
    defaultSwing: 0.12,
    defaultRootSemis: -4, // F
    harmonyPreset: 'double-only',
    timbreDesc: 'Slow half-time 808 boom, hard snare + clap, finger snaps, sparse hats, piano stabs on a separate keys lane & deep 808 sub in a big dark room',
  },
  {
    id: 'techno',
    level: 3,
    shortName: 'Techno',
    title: 'Berlin 909 / Warehouse',
    badge: '909 HYPNOTIC',
    defaultBpm: 126,
    defaultSwing: 0.0,
    defaultRootSemis: -4, // F
    harmonyPreset: 'double-only',
    timbreDesc: 'Driving 4x4 909 kick, offbeat open hats, industrial clap & rolling 16th sub-sequencer',
  },
  {
    id: 'altrock',
    level: 4,
    shortName: 'Alt-Rock',
    title: '90s Quiet-Loud Indie Drive',
    badge: 'INDIE DRIVE',
    defaultBpm: 120,
    defaultSwing: 0.04,
    defaultRootSemis: 0, // A
    harmonyPreset: 'double-only',
    timbreDesc: 'Punchy live-room snare, open-hat bark & gritty picked 8th-note indie bass',
  },
  {
    id: 'acidjazz',
    level: 5,
    shortName: 'Acid Jazz',
    title: 'Funk Break × Bristol Dub Bass',
    badge: 'ACID × DUB',
    defaultBpm: 110,
    defaultSwing: 0.22,
    defaultRootSemis: -5, // E
    harmonyPreset: 'double-triad',
    timbreDesc: 'Syncopated 16th breakbeat ghost snares over a deep, slow, dubby electric sub bass with space & weight',
  },
  {
    id: 'ween',
    level: 6,
    shortName: 'Brown Sound',
    title: 'Lo-Fi Pitch-Bent Eclectic',
    badge: 'BROWN SOUND',
    defaultBpm: 102,
    defaultSwing: 0.28,
    defaultRootSemis: -7, // D
    harmonyPreset: 'double-triad',
    timbreDesc: 'Crooked studio drum machine, pitch-warped rim/clave & rubbery wobbled brown bass',
  },
  {
    id: 'byrne',
    level: 7,
    shortName: 'Art-Funk',
    title: '80s Afro-Funk Poly-Groove',
    badge: 'POLY-FUNK',
    defaultBpm: 115,
    defaultSwing: 0.14,
    defaultRootSemis: 0, // A
    harmonyPreset: 'double-triad',
    timbreDesc: 'Interlocking studio polyrhythm, raw rim-clave & staccato space-funk bass',
  },
  {
    id: 'ska',
    level: 8,
    shortName: 'Ska',
    title: '2-Tone Offbeat Skank',
    badge: '2-TONE SKANK',
    defaultBpm: 160,
    defaultSwing: 0.06,
    defaultRootSemis: 3, // C
    harmonyPreset: 'double-triad',
    timbreDesc: 'Uptempo 2-tone kit: kick on 1 & 3, crisp snare on 2 & 4, open-hat lift, rim/cross-stick, offbeat guitar skank on a separate chops lane & bouncy walking electric bass',
  },
];

/**
 * Drum patterns for the 8 core musical styles (32 steps = 2 bars).
 * - kick: 0 = rest, 0.4..1.1 = kick velocity
 * - snare: 0 = rest, 0.3..0.48 = ghost snare/rim, 0.5..1.1 = main snare/rim/clap
 * - hat: 0 = rest, 0.1..1.0 = closed hat/shaker, 2 = open hi-hat / güiro scrape
 * - perc: 0 = rest, 1 = low unpitched perc (rim/snap/shaker), 2 = high unpitched perc (rim shot/snap)
 */
export const DRUM_PATTERNS = [
  {
    id: 'triphop',
    level: 1,
    style: 'triphop',
    name: '1 · Trip-Hop (Bristol Downtempo Break)',
    defaultSwing: 0.30,
    defaultBpm: 84,
    // Heavy swung Bristol Trip-Hop breakbeat:
    // Deep sub-kick on 1, late swung kicks into beat 3, crunchy dark snare on 2 & 4 with dusty ghost drags.
    kick: [
      1.08, 0, 0, 0, 0, 0, 0, 0.72, 0, 0, 0.96, 0, 0, 0, 0, 0,
      1.08, 0, 0, 0, 0, 0, 0.78, 0, 0, 0, 0.98, 0, 0, 0, 0.65, 0.48,
    ],
    snare: [
      0, 0, 0, 0, 1.02, 0, 0, 0, 0, 0.36, 0, 0, 1.05, 0, 0, 0.38,
      0, 0, 0, 0, 1.02, 0, 0, 0.34, 0, 0.4, 0, 0, 1.06, 0, 0.36, 0.44,
    ],
    hat: [
      0.68, 0, 0.52, 0, 0.65, 0, 0.55, 0.32, 0.68, 0, 0.54, 0, 0.65, 0, 0.58, 0,
      0.68, 0, 0.52, 0, 0.65, 0, 0.55, 0.32, 0.68, 0, 0.54, 0, 0.65, 0, 2, 0.36,
    ],
    perc: [
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0,
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0,
    ],
  },
  {
    id: 'noirrap',
    level: 2,
    style: 'noirrap',
    name: '2 · Noir Rap (Half-Time Dark-Pop Boom)',
    defaultSwing: 0.12,
    defaultBpm: 76,
    // Slow half-time: deep 808 kick on 1 with a lazy push, HARD snare+clap on beat 3 of each bar.
    kick: [
      1.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0,
      1.1, 0, 0, 0.72, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0, 0.62, 0,
    ],
    snare: [
      0, 0, 0, 0, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 0, 0.38, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 0.36, 0, 0.42,
    ],
    // Sparse 8th hats, one open hat lift at the end of each 2-bar phrase
    hat: [
      0.55, 0, 0.32, 0, 0.5, 0, 0.32, 0, 0.55, 0, 0.32, 0, 0.5, 0, 0.32, 0,
      0.55, 0, 0.32, 0, 0.5, 0, 0.32, 0, 0.55, 0, 0.32, 0, 0.5, 0.3, 2, 0,
    ],
    // 1 = finger snap (on 2 & 4). Piano stabs live on the separate chop/keys lane.
    perc: [
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    ],
  },
  {
    id: 'techno',
    level: 3,
    style: 'techno',
    name: '3 · Techno (Berlin 909 / Warehouse)',
    defaultSwing: 0.0,
    defaultBpm: 126,
    // Relentless 909 four-on-the-floor + hypnotic bar-2 ghost rumble
    kick: [
      1.05, 0, 0, 0, 1.05, 0, 0, 0, 1.05, 0, 0, 0, 1.05, 0, 0, 0.48,
      1.05, 0, 0, 0.42, 1.05, 0, 0, 0, 1.05, 0, 0, 0.52, 1.05, 0, 0.65, 0,
    ],
    // Crisp 909 clap/snare on 2 & 4
    snare: [
      0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0,
      0, 0, 0, 0, 0.95, 0, 0, 0.35, 0, 0, 0, 0, 0.95, 0, 0, 0.45,
    ],
    // Rolling 16th closed hats with barking 909 open hat (2) on every '&' offbeat
    hat: [
      0.45, 0.38, 2, 0.42, 0.45, 0.38, 2, 0.42, 0.45, 0.38, 2, 0.42, 0.45, 0.38, 2, 0.5,
      0.45, 0.38, 2, 0.42, 0.45, 0.38, 2, 0.42, 0.45, 0.38, 2, 0.42, 0.55, 0.45, 2, 0.6,
    ],
    // Syncopated warehouse metallic synth-rim / tom stabs
    perc: [
      0, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 2, 0,
      0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 2, 0, 1, 2, 0,
    ],
  },
  {
    id: 'altrock',
    level: 4,
    style: 'altrock',
    name: '4 · Alt-Rock (90s Quiet-Loud Drive)',
    defaultSwing: 0.04,
    defaultBpm: 120,
    // Driving indie/alt kick locking with 8th-note bass
    kick: [
      1.05, 0, 0.82, 0, 0, 0, 0.88, 0, 1.05, 0, 0.85, 0, 0, 0, 0.78, 0,
      1.05, 0, 0.82, 0, 0, 0, 0.9, 0, 1.05, 0, 0.88, 0.7, 0, 0.85, 0, 0,
    ],
    // Loud cracking Albini-room snare on 2 & 4 + bar-2 turnaround fill
    snare: [
      0, 0, 0, 0, 1.05, 0, 0, 0, 0, 0, 0, 0, 1.05, 0, 0, 0,
      0, 0, 0, 0, 1.05, 0, 0, 0.42, 0, 0, 0, 0, 1.05, 0.65, 0.85, 0.95,
    ],
    // Sloshy open/closed hi-hat eighth drive
    hat: [
      2, 0, 0.85, 0, 0.95, 0, 0.85, 0, 0.95, 0, 0.85, 0, 0.95, 0, 2, 0,
      2, 0, 0.85, 0, 0.95, 0, 0.85, 0, 0.95, 0, 2, 0, 0.95, 0, 2, 0,
    ],
    perc: [
      2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
      2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2,
    ],
  },
  {
    id: 'acidjazz',
    level: 5,
    style: 'acidjazz',
    name: '5 · Acid Jazz (Funk Ghost-Note Break)',
    defaultSwing: 0.22,
    defaultBpm: 110,
    // Agile syncopated funk-jazz kick
    kick: [
      1.0, 0, 0, 0.82, 0, 0, 0.88, 0, 0, 0.75, 0.95, 0, 0, 0, 0.78, 0,
      1.0, 0, 0, 0.82, 0, 0, 0.9, 0, 0, 0.78, 0, 0.85, 0, 0, 0.88, 0,
    ],
    // Tight piccolosnare with rapid ghost-note chatter
    snare: [
      0, 0.3, 0, 0, 1.0, 0, 0, 0.36, 0, 0.4, 0, 0.32, 1.0, 0, 0, 0.35,
      0, 0.32, 0, 0, 1.0, 0, 0, 0.38, 0, 0.36, 0.85, 0, 0.95, 0, 0.4, 0.72,
    ],
    // Crisp 16th hi-hats with syncopated open-hat barks
    hat: [
      0.95, 0.5, 0.8, 0.5, 0.95, 0.5, 2, 0, 0.95, 0.5, 0.8, 0.5, 0.95, 0.5, 0.85, 0.5,
      0.95, 0.5, 0.8, 0.5, 0.95, 0.5, 0.8, 0.5, 0.95, 0.5, 2, 0, 0.95, 0.55, 2, 0,
    ],
    perc: [
      0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0,
      0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 2, 0, 1, 2,
    ],
  },
  {
    id: 'ween',
    level: 6,
    style: 'ween',
    name: '6 · Brown Sound (Lo-Fi Eclectic)',
    defaultSwing: 0.28,
    defaultBpm: 102,
    // Crooked, bouncy Pod/Pure Guava/Mollusk drum-machine pocket
    kick: [
      1.0, 0, 0.72, 0, 0, 0.85, 0, 0, 0.95, 0, 0, 0.78, 0, 0, 0, 0.68,
      1.0, 0, 0, 0.8, 0, 0, 0.9, 0, 0.88, 0, 0.75, 0, 0, 0.82, 0, 0.7,
    ],
    // Warped dry studio snare + off-kilter hits
    snare: [
      0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0.45, 0, 0, 0.95, 0, 0.55, 0,
      0, 0, 0.4, 0, 0.95, 0, 0, 0.48, 0, 0, 0, 0.52, 0.95, 0, 0.65, 0.8,
    ],
    hat: [
      0.85, 0, 0.7, 0.45, 0.85, 0, 2, 0, 0.85, 0.4, 0.7, 0, 0.85, 0, 2, 0.45,
      0.85, 0, 0.7, 0.45, 0.85, 0, 0.75, 0, 2, 0, 0.75, 0.45, 0.85, 0.5, 2, 0,
    ],
    // Quirky unpitched rim / snap answers
    perc: [
      0, 2, 0, 1, 0, 0, 2, 0, 1, 0, 2, 0, 0, 1, 0, 2,
      1, 0, 2, 0, 0, 1, 0, 2, 0, 2, 1, 0, 2, 1, 2, 0,
    ],
  },
  {
    id: 'byrne',
    level: 7,
    style: 'byrne',
    name: '7 · Art-Funk (80s Poly-Groove)',
    defaultSwing: 0.14,
    defaultBpm: 115,
    // Remain in Light / Born Under Punches interlocking poly-groove
    kick: [
      1.0, 0, 0, 0.88, 0, 0, 0.92, 0, 0, 0, 0.95, 0, 0, 0.82, 0, 0,
      1.0, 0, 0, 0.88, 0, 0.78, 0, 0, 0.95, 0, 0, 0.85, 0, 0, 0.9, 0,
    ],
    // Tight, dry post-punk funk snare with displaced syncopation in bar 2
    snare: [
      0, 0, 0, 0, 0.95, 0, 0, 0.38, 0, 0.42, 0, 0, 0.95, 0, 0, 0.4,
      0, 0.35, 0, 0, 0.95, 0, 0.45, 0, 0, 0.5, 0, 0.38, 0.95, 0, 0.65, 0,
    ],
    // Relentless 16th shaker / crisp closed hat pulse
    hat: [
      0.9, 0.55, 0.8, 0.55, 0.9, 0.55, 0.8, 0.55, 0.9, 0.55, 2, 0.55, 0.9, 0.55, 0.8, 0.55,
      0.9, 0.55, 0.8, 0.55, 0.9, 0.55, 2, 0.55, 0.9, 0.55, 0.8, 0.55, 0.9, 0.55, 2, 0.55,
    ],
    // 3-2 / 2-3 Afro-funk clave, played as unpitched rim click / rim shot
    perc: [
      2, 0, 0, 2, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 2, 0,
      0, 2, 0, 1, 0, 0, 2, 0, 1, 0, 2, 0, 1, 2, 0, 1,
    ],
  },
  {
    id: 'ska',
    level: 8,
    style: 'ska',
    name: '8 · Ska (2-Tone Offbeat Skank)',
    defaultSwing: 0.06,
    defaultBpm: 160,
    // Uptempo 2-tone: kick on 1 & 3 with a bounce into 3, crisp snare on 2 & 4,
    // closed hats on the beat, open hats on the '&'s, rim/cross-stick color.
    // Bar 2 adds a little pickup and a turnaround so it is not a 1-bar loop.
    kick: [
      1.05, 0, 0, 0, 0, 0, 0.72, 0, 1.0, 0, 0, 0, 0, 0, 0, 0,
      1.05, 0, 0, 0, 0, 0, 0.78, 0, 1.0, 0, 0.62, 0, 0, 0, 0.7, 0,
    ],
    snare: [
      0, 0, 0, 0, 1.05, 0, 0, 0, 0, 0, 0, 0, 1.05, 0, 0, 0,
      0, 0, 0, 0, 1.05, 0, 0, 0.36, 0, 0, 0, 0, 1.05, 0, 0.4, 0.48,
    ],
    hat: [
      0.78, 0, 2, 0, 0.75, 0, 2, 0, 0.78, 0, 2, 0, 0.75, 0, 2, 0,
      0.78, 0, 2, 0, 0.75, 0, 2, 0, 0.78, 0, 2, 0, 0.8, 0.4, 2, 0,
    ],
    perc: [
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2,
    ],
  },
];

/**
 * Bass patterns for the 8 core musical styles (32 steps = 2 bars).
 * `notes` are semitone offsets from the selected Bass Root. `-99` = rest.
 * `gates` are note lengths in 16th-note steps.
 * `vels` are per-step velocities (0.4 = ghost pluck, 1.0 = normal, 1.25 = bright pop/accent).
 */
export const BASS_PATTERNS = [
  {
    id: 'triphop',
    level: 1,
    style: 'triphop',
    name: '1 · Trip-Hop (Dark Upright Creep)',
    // Brooding nocturnal minor/Phrygian sub-bass creep with long weighty sustain
    notes: [
      0, -99, -99, -99, -99, -99, -99, 0, -99, -99, 3, -99, 2, -99, -99, -99,
      0, -99, -99, -99, -99, -99, 7, -99, 8, -99, 7, -99, 3, -99, 1, -99,
    ],
    gates: [
      4.5, 0, 0, 0, 0, 0, 0, 2.2, 0, 0, 1.8, 0, 3.2, 0, 0, 0,
      4.5, 0, 0, 0, 0, 0, 1.8, 0, 1.8, 0, 1.8, 0, 1.8, 0, 1.8, 0,
    ],
    vels: [
      1.15, 0, 0, 0, 0, 0, 0, 0.88, 0, 0, 1.02, 0, 0.96, 0, 0, 0,
      1.15, 0, 0, 0, 0, 0, 0.94, 0, 1.05, 0, 0.96, 0, 0.98, 0, 0.92, 0,
    ],
  },
  {
    id: 'noirrap',
    level: 2,
    style: 'noirrap',
    name: '2 · Noir Rap (Deep 808 Sub Line)',
    // Long 808 sub notes locking with the kick; root → b7 below → minor 3rd lift (slides in 808 SLIDE)
    notes: [
      0, -99, -99, -99, -99, -99, -99, -99, -99, -99, 0, -99, -99, -99, -99, -99,
      0, -99, -99, -2, -99, -99, 3, -99, -99, -99, -2, -99, -99, -99, -5, -99,
    ],
    gates: [
      7.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4.5, 0, 0, 0, 0, 0,
      2.8, 0, 0, 2.6, 0, 0, 3.6, 0, 0, 0, 3.8, 0, 0, 0, 1.8, 0,
    ],
    vels: [
      1.15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0,
      1.15, 0, 0, 0.95, 0, 0, 1.02, 0, 0, 0, 1.05, 0, 0, 0, 0.9, 0,
    ],
  },
  {
    id: 'techno',
    level: 3,
    style: 'techno',
    name: '3 · Techno (Rolling 16th Offbeat Sub)',
    // Hypnotic Berlin rolling bass: ducks slightly under the 909 kick and drives the offbeat 16ths
    notes: [
      0, 0, 12, 0, 0, 0, 12, 3, 0, 0, 12, 0, -2, 0, 10, 0,
      0, 0, 12, 0, 0, 3, 12, 0, 0, 0, 10, 0, 7, 5, 3, 2,
    ],
    gates: [
      0.8, 0.85, 0.95, 0.85, 0.8, 0.85, 0.95, 0.9, 0.8, 0.85, 0.95, 0.85, 0.9, 0.85, 0.95, 0.85,
      0.8, 0.85, 0.95, 0.85, 0.8, 0.9, 0.95, 0.85, 0.8, 0.85, 0.95, 0.85, 0.9, 0.9, 0.9, 0.9,
    ],
    vels: [
      0.7, 0.9, 1.15, 0.95, 0.7, 0.9, 1.15, 1.0, 0.7, 0.9, 1.15, 0.95, 1.0, 0.9, 1.15, 0.95,
      0.7, 0.9, 1.15, 0.95, 0.7, 1.0, 1.15, 0.95, 0.7, 0.9, 1.15, 0.95, 1.05, 1.0, 1.05, 1.1,
    ],
  },
  {
    id: 'altrock',
    level: 4,
    style: 'altrock',
    name: '4 · Alt-Rock (Picked 8th Indie Drive)',
    // Kim Deal style driving 8th-note picked bassline: Root -> 5th -> b7 -> 4th
    notes: [
      0, -99, 0, -99, 0, -99, 0, 3, 7, -99, 7, -99, 5, -99, 5, -99,
      0, -99, 0, -99, 10, -99, 10, -99, 5, -99, 5, -99, 7, -99, 10, 12,
    ],
    gates: [
      1.7, 0, 1.7, 0, 1.7, 0, 1.1, 1.0, 1.7, 0, 1.7, 0, 1.7, 0, 1.7, 0,
      1.7, 0, 1.7, 0, 1.7, 0, 1.7, 0, 1.7, 0, 1.7, 0, 1.7, 0, 1.1, 1.1,
    ],
    vels: [
      1.1, 0, 0.95, 0, 1.0, 0, 0.95, 0.9, 1.1, 0, 0.95, 0, 1.05, 0, 0.95, 0,
      1.1, 0, 0.95, 0, 1.1, 0, 0.95, 0, 1.05, 0, 0.95, 0, 1.1, 0, 1.15, 1.2,
    ],
  },
  {
    id: 'acidjazz',
    level: 5,
    style: 'acidjazz',
    name: '5 · Acid Jazz (Bristol Dub Sub)',
    // Deep, slow, dubby sub line with lots of air: long roots, a lazy b7 drop and a minor lift.
    notes: [
      0, -99, -99, -99, -99, -99, -99, 0, -99, -99, -2, -99, -99, -99, -99, -99,
      0, -99, -99, -99, -99, -99, -99, 3, -99, -99, 5, -99, -99, 3, -99, -99,
    ],
    gates: [
      6.0, 0, 0, 0, 0, 0, 0, 1.6, 0, 0, 4.5, 0, 0, 0, 0, 0,
      6.0, 0, 0, 0, 0, 0, 0, 2.2, 0, 0, 2.6, 0, 0, 2.8, 0, 0,
    ],
    vels: [
      1.15, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 1.0, 0, 0, 0, 0, 0,
      1.15, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 1.0, 0, 0, 0.92, 0, 0,
    ],
  },
  {
    id: 'ween',
    level: 6,
    style: 'ween',
    name: '6 · Brown Sound (Elastic Wobble Bounce)',
    // Elastic, off-kilter Mixolydian / chromatic "brown" bass with playful leaps
    notes: [
      0, -99, 12, -99, 10, 9, 7, -99, 0, 3, 4, -99, -5, -99, -2, 0,
      0, -99, 7, 12, -99, 10, 6, 7, 4, -99, 2, 0, -5, -99, 10, 12,
    ],
    gates: [
      1.8, 0, 1.4, 0, 1.0, 1.0, 1.8, 0, 1.0, 1.0, 1.6, 0, 1.8, 0, 1.0, 1.0,
      1.8, 0, 1.0, 1.4, 0, 1.0, 1.0, 1.5, 1.6, 0, 1.0, 1.0, 1.8, 0, 1.0, 1.2,
    ],
    vels: [
      1.15, 0, 1.2, 0, 0.95, 0.95, 1.05, 0, 1.0, 0.9, 1.1, 0, 1.0, 0, 0.9, 1.05,
      1.15, 0, 1.0, 1.25, 0, 1.0, 1.1, 1.05, 1.0, 0, 0.9, 1.0, 1.05, 0, 1.15, 1.2,
    ],
  },
  {
    id: 'byrne',
    level: 7,
    style: 'byrne',
    name: '7 · Art-Funk (Space-Funk Clave)',
    // Tina Weymouth / Busta Jones Remain in Light style: staccato downbeat + syncopated space-funk answer
    notes: [
      0, 0, -99, 12, -99, -99, 10, -99, -99, 7, 5, -99, 0, -99, 10, 12,
      -99, 0, -99, 12, -99, 10, 7, -99, 5, -99, 0, 3, -99, 7, 10, -99,
    ],
    gates: [
      0.75, 0.75, 0, 1.1, 0, 0, 1.2, 0, 0, 0.9, 1.2, 0, 1.1, 0, 0.85, 0.95,
      0, 0.95, 0, 1.1, 0, 0.9, 1.2, 0, 1.1, 0, 0.85, 1.1, 0, 0.9, 1.1, 0,
    ],
    vels: [
      1.15, 1.05, 0, 1.25, 0, 0, 1.1, 0, 0, 1.0, 1.1, 0, 1.15, 0, 1.05, 1.2,
      0, 1.15, 0, 1.25, 0, 1.05, 1.1, 0, 1.1, 0, 1.0, 1.15, 0, 1.05, 1.2, 0,
    ],
  },
  {
    id: 'ska',
    level: 8,
    style: 'ska',
    name: '8 · Ska (Walking Electric Skank)',
    // Bouncy walking electric bass: bar 1 roots and a climb, bar 2 walks off the 5th and back.
    notes: [
      0, -99, -99, -99, 0, -99, 7, -99, 0, -99, 4, -99, 5, -99, 7, -99,
      7, -99, 7, -99, 5, -99, 4, -99, 0, -99, 0, 4, 5, -99, 7, 12,
    ],
    gates: [
      1.7, 0, 0, 0, 1.5, 0, 1.5, 0, 1.5, 0, 1.3, 0, 1.3, 0, 1.5, 0,
      1.6, 0, 1.5, 0, 1.4, 0, 1.3, 0, 1.5, 0, 1.0, 1.0, 1.3, 0, 1.1, 1.2,
    ],
    vels: [
      1.15, 0, 0, 0, 1.0, 0, 0.95, 0, 1.08, 0, 0.95, 0, 1.0, 0, 1.05, 0,
      1.1, 0, 0.95, 0, 1.0, 0, 0.95, 0, 1.12, 0, 1.0, 0.95, 1.0, 0, 1.1, 1.2,
    ],
  },
];

// Legacy pattern ID aliases so existing saved ideas or tests map cleanly
const LEGACY_DRUM_MAP = {
  reggae: 'triphop',
  pulse: 'triphop',
  rock: 'altrock',
  four: 'techno',
  pocket: 'triphop',
  shuffle: 'ween',
  boombap: 'noirrap',
  cumbia: 'altrock',
  mushroom: 'triphop',
  rap: 'noirrap',
  hiphop: 'noirrap',
  funk: 'acidjazz',
  linear: 'byrne',
  twotone: 'ska',
  skank: 'ska',
};

const LEGACY_BASS_MAP = {
  reggae: 'triphop',
  whole: 'triphop',
  root: 'altrock',
  fifth: 'altrock',
  cumbia: 'altrock',
  mushroom: 'triphop',
  rap: 'noirrap',
  hiphop: 'noirrap',
  pedal: 'altrock',
  boogie: 'ween',
  walk: 'triphop',
  motown: 'acidjazz',
  funk16: 'byrne',
  twotone: 'ska',
  skank: 'ska',
};

export function getStyleProfile(id) {
  const mapped = LEGACY_DRUM_MAP[id] || LEGACY_BASS_MAP[id] || id;
  return STYLE_PROFILES.find((s) => s.id === mapped) || STYLE_PROFILES[0];
}

export function getDrumPattern(id) {
  const mapped = LEGACY_DRUM_MAP[id] || id;
  return DRUM_PATTERNS.find((p) => p.id === mapped) || DRUM_PATTERNS[0];
}

export function getBassPattern(id) {
  const mapped = LEGACY_BASS_MAP[id] || id;
  return BASS_PATTERNS.find((p) => p.id === mapped) || BASS_PATTERNS[0];
}


/**
 * Melodic chop / keys patterns (32 steps = 2 bars). These are NOT part of the drum kit:
 * they play on a separate CHOPS / KEYS lane with its own level.
 * `steps` values: 0 = rest, 1..n = voicing id (see `voicings`, intervals from the bass root).
 */
export const CHOP_PATTERNS = [
  {
    id: 'triphop',
    label: 'Vibes',
    instrument: 'vibes',
    register: 69,
    voicings: { 1: [4], 2: [5] },
    steps: [
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0,
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1, 0,
    ],
    dur: 0.9,
    gain: 0.22,
    rev: 0.5,
    dly: 0.3,
  },
  {
    id: 'noirrap',
    label: 'Piano Stabs',
    instrument: 'piano',
    register: 48,
    voicings: { 1: [0, 3, 7], 2: [5, 8, 12] },
    steps: [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    dur: 0.55,
    gain: 0.34,
    lp: 3200,
    rev: 0.4,
    dly: 0.22,
  },
  {
    id: 'ska',
    label: 'Guitar Skank',
    instrument: 'eguitar',
    register: 48,
    voicings: { 1: [0, 4, 7], 2: [5, 9, 12], 3: [7, 11, 14] },
    // Offbeat upstrokes on every '&'. Bar 1 = I, bar 2 = IV then V so it is not a 1-bar loop.
    steps: [
      0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 3, 0,
    ],
    dur: 0.11,
    gain: 0.46,
    hp: 220,
    lp: 4800,
  },
];

export function getChopPattern(id) {
  const mapped = LEGACY_DRUM_MAP[id] || id;
  return CHOP_PATTERNS.find((p) => p.id === mapped) || null;
}

/** MIDI note for a chop/keys interval, parked in a mid instrument register and folded to stay musical. */
export function chopMidiFor(interval, bassRootSemis = 0, register = 48) {
  const rootPc = ((bassRootMidi(bassRootSemis) % 12) + 12) % 12;
  let midi = register + rootPc + interval;
  while (midi < 48) midi += 12;
  while (midi > 79) midi -= 12;
  return midi;
}

function noiseBuffer(ctx, seconds = 0.25) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Style-aware Kick synthesis:
 * - 'reggae': warm, round sub-heavy one-drop kick (115 -> 44 Hz, soft click)
 * - 'cumbia': warm acoustic bombo drum (125 -> 55 Hz, woody thump)
 * - 'techno': punchy 909 kick with longer sub tail & sharp attack click (165 -> 42 Hz)
 * - 'mushroom': dusty, warm MPC-style kick (125 -> 48 Hz)
 * - 'altrock': tight punchy live rock kick (155 -> 52 Hz)
 * - 'ween': quirky punchy drum-machine kick
 * - 'byrne' / 'acidjazz': tight dry funk kick
 */
export function triggerKick(ctx, dest, time, vel = 1, style = 'triphop') {
  const v = Math.max(0.1, Math.min(1.25, vel));
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const g = ctx.createGain();

  let startFreq = 140;
  let endFreq = 48;
  let decay = 0.28;
  let clickFreq = 85;
  let clickAmt = 0.16;

  if (style === 'triphop') {
    startFreq = 118;
    endFreq = 40;
    decay = 0.42;
    clickAmt = 0.14;
  } else if (style === 'cumbia') {
    startFreq = 122;
    endFreq = 54;
    decay = 0.26;
    clickFreq = 110;
    clickAmt = 0.12;
  } else if (style === 'techno') {
    startFreq = 175;
    endFreq = 41;
    decay = 0.38;
    clickFreq = 130;
    clickAmt = 0.28;
  } else if (style === 'mushroom') {
    startFreq = 124;
    endFreq = 46;
    decay = 0.25;
    clickAmt = 0.1;
  } else if (style === 'altrock') {
    startFreq = 158;
    endFreq = 50;
    decay = 0.27;
    clickFreq = 95;
    clickAmt = 0.24;
  } else if (style === 'byrne' || style === 'acidjazz') {
    startFreq = 148;
    endFreq = 49;
    decay = 0.22;
    clickAmt = 0.2;
  }

  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.09);
  g.gain.setValueAtTime(0.95 * v, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.02);

  const click = ctx.createOscillator();
  click.type = style === 'techno' || style === 'altrock' ? 'square' : 'triangle';
  const cg = ctx.createGain();
  click.frequency.value = clickFreq;
  cg.gain.setValueAtTime(clickAmt * v, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
  click.connect(cg);
  cg.connect(dest);
  click.start(time);
  click.stop(time + 0.03);
}

/**
 * Style-aware Snare / Rimshot / Clap / Brush synthesis:
 * - 'reggae': crisp wooden cross-stick rimshot + dub spring tail
 * - 'cumbia': metallic timbale cáscara / rim shot
 * - 'techno': tight 909 snare/clap burst
 * - 'mushroom': soft brushed jazz snare
 * - 'altrock': big live-room acoustic snare
 * - 'acidjazz': high-tuned snapping funk piccolo snare
 * - 'ween': pitch-warped lo-fi snare
 * - 'byrne': bone-dry, tight studio post-punk funk snare
 */
export function triggerSnare(ctx, dest, time, vel = 1, style = 'triphop') {
  const v = Math.max(0.1, Math.min(1.25, vel));
  const isGhost = v < 0.5;

  let decay = isGhost ? 0.08 : 0.16;
  let bpFreq = isGhost ? 2100 : 1800;
  let bpQ = isGhost ? 1.2 : 0.9;
  let bodyFreq = isGhost ? 235 : 210;
  let noiseAmp = 0.52;
  let bodyAmp = 0.28;

  if (style === 'triphop') {
    // Crunchy dark vinyl breakbeat snare
    decay = isGhost ? 0.085 : 0.22;
    bpFreq = 1350;
    bpQ = 0.85;
    bodyFreq = 178;
    noiseAmp = 0.62;
    bodyAmp = 0.38;
  } else if (style === 'cumbia') {
    decay = 0.11;
    bpFreq = 2400;
    bpQ = 1.8;
    bodyFreq = 310;
    noiseAmp = 0.35;
    bodyAmp = 0.35;
  } else if (style === 'techno') {
    // 909 clap/snare
    decay = isGhost ? 0.09 : 0.19;
    bpFreq = 1550;
    bpQ = 0.75;
    bodyFreq = 195;
    noiseAmp = 0.65;
    bodyAmp = 0.24;
  } else if (style === 'mushroom') {
    // Brushed lounge snare
    decay = isGhost ? 0.11 : 0.21;
    bpFreq = 2900;
    bpQ = 0.65;
    bodyFreq = 185;
    noiseAmp = 0.45;
    bodyAmp = 0.2;
  } else if (style === 'altrock') {
    // Big cracking room snare
    decay = isGhost ? 0.1 : 0.24;
    bpFreq = 1650;
    bpQ = 0.7;
    bodyFreq = 205;
    noiseAmp = 0.68;
    bodyAmp = 0.34;
  } else if (style === 'acidjazz') {
    // Tight piccolo funk snare
    decay = isGhost ? 0.075 : 0.14;
    bpFreq = 2350;
    bpQ = 1.1;
    bodyFreq = 255;
    noiseAmp = 0.56;
    bodyAmp = 0.3;
  } else if (style === 'ween') {
    decay = isGhost ? 0.08 : 0.17;
    bpFreq = 1400;
    bpQ = 1.6;
    bodyFreq = 275;
    noiseAmp = 0.48;
    bodyAmp = 0.38;
  } else if (style === 'byrne') {
    // Dry, super-tight Eno/Byrne studio snare
    decay = isGhost ? 0.065 : 0.12;
    bpFreq = 2050;
    bpQ = 1.0;
    bodyFreq = 225;
    noiseAmp = 0.54;
    bodyAmp = 0.32;
  }

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.26);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = bpFreq;
  bp.Q.value = bpQ;
  const g = ctx.createGain();
  g.gain.setValueAtTime(noiseAmp * v, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + decay + 0.03);

  const tone = ctx.createOscillator();
  tone.type = style === 'triphop' || style === 'cumbia' ? 'sine' : 'triangle';
  const tg = ctx.createGain();
  tone.frequency.setValueAtTime(bodyFreq, time);
  if (style === 'ween') {
    // Quirky brown pitch bend on snare body
    tone.frequency.exponentialRampToValueAtTime(bodyFreq * 0.72, time + 0.09);
  }
  tg.gain.setValueAtTime(bodyAmp * v, time);
  tg.gain.exponentialRampToValueAtTime(0.001, time + (isGhost ? 0.055 : 0.095));
  tone.connect(tg);
  tg.connect(dest);
  tone.start(time);
  tone.stop(time + 0.12);
}

/**
 * Closed hat / shaker synthesis.
 */
export function triggerHat(ctx, dest, time, vel = 1, style = 'triphop') {
  const v = Math.max(0.1, Math.min(1.2, vel));
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.1);
  const hp = ctx.createBiquadFilter();
  hp.type = style === 'cumbia' || style === 'mushroom' || style === 'byrne' ? 'bandpass' : 'highpass';
  hp.frequency.value = style === 'cumbia' ? 5800 : style === 'mushroom' ? 6400 : 7400;
  if (hp.type === 'bandpass') hp.Q.value = 1.4;

  const decay = style === 'cumbia' ? 0.055 : style === 'mushroom' ? 0.06 : 0.042;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22 * v, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(hp);
  hp.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + decay + 0.02);
}

/**
 * Open hi-hat / Cumbia Güiro scrape / Crash sizzle synthesis.
 * In Cumbia mode, produces the authentic notched high-frequency güiro/maraca "chucu-chucu" scrape!
 */
export function triggerOpenHat(ctx, dest, time, vel = 0.85, style = 'triphop') {
  const v = Math.max(0.1, Math.min(1.2, vel));
  const dur = style === 'cumbia' ? 0.14 : style === 'techno' ? 0.2 : 0.25;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.04);

  const filter = ctx.createBiquadFilter();
  if (style === 'cumbia') {
    // Güiro / caballito scrape: resonant high-mid bandpass with double-grain envelope
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(4200, time);
    filter.frequency.exponentialRampToValueAtTime(6800, time + dur);
    filter.Q.value = 2.4;
  } else {
    filter.type = 'highpass';
    filter.frequency.value = style === 'altrock' ? 5400 : 6400;
  }

  const g = ctx.createGain();
  if (style === 'cumbia') {
    g.gain.setValueAtTime(0.02, time);
    g.gain.linearRampToValueAtTime(0.28 * v, time + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  } else {
    g.gain.setValueAtTime(0.24 * v, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  }

  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + dur + 0.03);
}

/**
 * Unpitched auxiliary percussion (`perc` lane: 1 = low rim/click, 2 = high rim/snap).
 * Melodic instruments (vibes, piano, guitar skank, agogo, cowbell) do not belong here.
 */
export function triggerPerc(ctx, dest, time, type = 1, style = 'triphop') {
  const v = type === 2 ? 0.16 : 0.14;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = type === 2 ? 3200 : 1800;
  bp.Q.value = type === 2 ? 1.6 : 1.1;
  const g = ctx.createGain();
  const dur = type === 2 ? 0.07 : 0.09;
  g.gain.setValueAtTime(v, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + dur + 0.03);

  // Short unpitched body click (no sustained pitch)
  const click = ctx.createOscillator();
  click.type = 'triangle';
  const cg = ctx.createGain();
  click.frequency.setValueAtTime(type === 2 ? 420 : 240, time);
  click.frequency.exponentialRampToValueAtTime(80, time + 0.03);
  cg.gain.setValueAtTime(0.08, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
  click.connect(cg);
  cg.connect(dest);
  click.start(time);
  click.stop(time + 0.04);
}

/**
 * Synth fallback for the chop / keys lane (short guitar-like pluck, piano thud, or vibe ping).
 */
export function triggerChop(ctx, dest, time, freq, dur = 0.12, vel = 0.9, kind = 'eguitar') {
  const v = Math.max(0.15, Math.min(1.2, vel));
  const safeFreq = Math.max(80, freq);
  const safeDur = Math.max(0.05, dur);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  if (kind === 'vibes' || kind === 'piano') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(safeFreq, time);
    g.gain.setValueAtTime(0.12 * v, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.min(0.6, safeDur));
    osc.connect(g);
    g.connect(dest);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(safeFreq, time);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(2800, safeFreq * 3.2);
    bp.Q.value = 1.8;
    g.gain.setValueAtTime(0.16 * v, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + Math.min(0.18, safeDur));
    osc.connect(bp);
    bp.connect(g);
    g.connect(dest);
  }
  osc.start(time);
  osc.stop(time + safeDur + 0.02);
}

export function triggerBass(ctx, dest, time, freq, dur, vel = 1, style = 'triphop') {
  const v = Math.max(0.2, Math.min(1.35, vel));
  const safeDur = Math.max(0.05, dur);
  const safeFreq = Math.max(30, freq);

  const osc = ctx.createOscillator();
  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();

  let mainWave = 'sawtooth';
  let subAmount = 0.25;
  let peakCutoff = v > 1.1 ? 880 : v < 0.6 ? 340 : 540;
  let endCutoff = 175;
  let qVal = v > 1.1 ? 2.0 : 1.25;
  let attack = 0.01;
  let ampScale = 0.32;

  if (style === 'triphop') {
    mainWave = 'triangle';
    subAmount = 0.62;
    peakCutoff = 285;
    endCutoff = 115;
    qVal = 1.35;
    attack = 0.018;
    ampScale = 0.40;
  } else if (style === 'cumbia') {
    mainWave = 'triangle';
    subAmount = 0.42;
    peakCutoff = 420;
    endCutoff = 155;
    qVal = 1.15;
    attack = 0.01;
    ampScale = 0.36;
  } else if (style === 'techno') {
    mainWave = 'sawtooth';
    subAmount = 0.35;
    peakCutoff = v > 1.05 ? 780 : 520;
    endCutoff = 140;
    qVal = 2.6;
    attack = 0.006;
    ampScale = 0.32;
  } else if (style === 'mushroom') {
    mainWave = 'triangle';
    subAmount = 0.45;
    peakCutoff = 350;
    endCutoff = 145;
    qVal = 1.05;
    attack = 0.014;
    ampScale = 0.35;
  } else if (style === 'altrock') {
    mainWave = 'sawtooth';
    subAmount = 0.18;
    peakCutoff = 860;
    endCutoff = 240;
    qVal = 1.65;
    attack = 0.005;
    ampScale = 0.31;
  } else if (style === 'acidjazz') {
    mainWave = 'sawtooth';
    subAmount = 0.22;
    peakCutoff = v > 1.1 ? 1250 : 880;
    endCutoff = 180;
    qVal = 4.2;
    attack = 0.007;
    ampScale = 0.3;
  } else if (style === 'ween') {
    mainWave = 'sawtooth';
    subAmount = 0.3;
    peakCutoff = 720;
    endCutoff = 195;
    qVal = 3.1;
    attack = 0.009;
    ampScale = 0.32;
  } else if (style === 'byrne') {
    mainWave = 'sawtooth';
    subAmount = 0.28;
    peakCutoff = 680;
    endCutoff = 170;
    qVal = 1.9;
    attack = 0.006;
    ampScale = 0.33;
  }

  osc.type = mainWave;
  osc.frequency.setValueAtTime(safeFreq, time);

  if (style === 'ween') {
    // Subtle rubbery brown pitch-glide/wobble
    osc.frequency.setValueAtTime(safeFreq * 0.975, time);
    osc.frequency.exponentialRampToValueAtTime(safeFreq, time + Math.min(0.045, safeDur * 0.5));
  }

  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(safeFreq, time);
  subGain.gain.value = subAmount;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(peakCutoff, time);
  filter.frequency.exponentialRampToValueAtTime(endCutoff, time + Math.min(safeDur, 0.24));
  filter.Q.value = qVal;

  const g = ctx.createGain();
  const amp = ampScale * Math.min(1.18, v);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(amp, time + attack);
  g.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

  osc.connect(filter);
  subOsc.connect(subGain);
  subGain.connect(filter);
  filter.connect(g);
  g.connect(dest);

  osc.start(time);
  subOsc.start(time);
  osc.stop(time + safeDur + 0.02);
  subOsc.stop(time + safeDur + 0.02);
}

/* ------------------------------------------------------------------ */
/* Sampled kits — per-style mapping of lanes to bundled one-shots       */
/* ------------------------------------------------------------------ */

/**
 * Each lane: { s: sample | [layered samples], g: gain, rate?, lp?, hp?, rev?, dly?, dur? }
 * ghost = soft snare/rim used for velocities < 0.5.
 * perc1 / perc2 = style percussion (value 1 / 2 in the perc lane).
 * bass.voice = default bass instrument; bass.lp = tone filter; rev/dly = space sends.
 */
export const STYLE_KITS = {
  triphop: {
    kick: { s: 'kick_dusty', g: 1.05, lp: 4200 },
    snare: { s: ['snare_crunch', 'snare_fat'], g: 0.62, rev: 0.32 },
    ghost: { s: 'snare_soft', g: 0.38, lp: 5000 },
    hat: { s: 'hat_closed_soft', g: 0.5, lp: 9000 },
    open: { s: 'hat_open', g: 0.42, dur: 0.6, lp: 8500 },
    perc1: { s: 'rim_click', g: 0.32, rev: 0.15 },
    perc2: { s: 'shaker', g: 0.34 },
    bass: { voice: 'upright', lp: 650, octave: -1, gain: 1.15, rev: 0.12, sustain: 1.15 },
  },
  noirrap: {
    kick: { s: 'kick_808', g: 1.15 },
    snare: { s: ['snare_hard', 'clap'], g: 0.72, rev: 0.42 },
    ghost: { s: 'rim_click', g: 0.32, rev: 0.25 },
    hat: { s: 'hat_closed_tight', g: 0.36, hp: 6000 },
    open: { s: 'hat_open', g: 0.3, dur: 0.5, rev: 0.2 },
    perc1: { s: 'snap', g: 0.6, rev: 0.45 },
    perc2: { s: 'snap_2', g: 0.5, rev: 0.35 },
    bass: { voice: '808', lp: 900, octave: -1, gain: 1.25, rev: 0, sustain: 1.0 },
  },
  techno: {
    kick: { s: 'kick_tek', g: 1.15 },
    snare: { s: ['clap', 'snare_tight'], g: 0.55, rev: 0.18 },
    ghost: { s: 'clap_solo', g: 0.3 },
    hat: { s: 'hat_zild', g: 0.36, hp: 7000 },
    open: { s: 'hat_open_bright', g: 0.34, dur: 0.24 },
    perc1: { s: 'rim_click', g: 0.32, dly: 0.25 },
    perc2: { s: 'rim_shot', g: 0.3, dly: 0.25 },
    bass: { voice: 'synth', lp: 900, octave: -1, gain: 0.95, q: 4, rev: 0 },
  },
  altrock: {
    kick: { s: 'kick_acoustic', g: 1.05 },
    snare: { s: ['snare_live', 'snare_hard'], g: 0.7, rev: 0.22 },
    ghost: { s: 'snare_soft', g: 0.35 },
    hat: { s: 'hat_closed', g: 0.5 },
    open: { s: 'hat_open', g: 0.45, dur: 0.45 },
    perc1: { s: 'shaker', g: 0.35 },
    perc2: { s: 'rim_shot', g: 0.32 },
    bass: { voice: 'electric', lp: 2600, octave: -1, gain: 1.0, drive: true },
  },
  acidjazz: {
    kick: { s: 'kick_heavy', g: 1.0 },
    snare: { s: 'snare_tight', g: 0.62, rev: 0.15 },
    ghost: { s: 'snare_soft', g: 0.3 },
    hat: { s: 'hat_closed_tight', g: 0.4 },
    open: { s: 'hat_open', g: 0.36, dur: 0.3 },
    perc1: { s: 'rim_click', g: 0.3 },
    perc2: { s: 'shaker', g: 0.32 },
    // Bristol dub: deep, dark, slow electric sub with dub-delay space
    bass: { voice: 'electric', lp: 380, octave: -1, gain: 1.35, rev: 0.1, dly: 0.16, sustain: 1.2 },
  },
  ween: {
    kick: { s: 'kick_fat', g: 1.0 },
    snare: { s: 'snare_dub', g: 0.62, rate: 0.94 },
    ghost: { s: 'snare_soft', g: 0.32 },
    hat: { s: 'hat_closed_tight', g: 0.42 },
    open: { s: 'hat_open_bright', g: 0.36, dur: 0.35 },
    perc1: { s: 'rim_click', g: 0.34 },
    perc2: { s: 'snap', g: 0.32 },
    bass: { voice: 'electric', lp: 1300, octave: -1, gain: 1.05, wobble: true },
  },
  byrne: {
    kick: { s: 'kick_heavy', g: 1.0 },
    snare: { s: 'snare_tight', g: 0.6 },
    ghost: { s: 'snare_soft', g: 0.3 },
    hat: { s: ['hat_closed_tight', 'shaker'], g: 0.32 },
    open: { s: 'hat_open', g: 0.34, dur: 0.3 },
    perc1: { s: 'rim_click', g: 0.32 },
    perc2: { s: 'rim_shot', g: 0.3 },
    bass: { voice: 'electric', lp: 1700, octave: -1, gain: 1.0 },
  },
  ska: {
    kick: { s: 'kick_acoustic', g: 1.05 },
    snare: { s: ['snare_tight', 'snare_hard'], g: 0.66 },
    ghost: { s: 'rim_click', g: 0.34 },
    hat: { s: 'hat_closed_tight', g: 0.42 },
    open: { s: 'hat_open_bright', g: 0.38, dur: 0.18 },
    perc1: { s: 'rim_click', g: 0.36 },
    perc2: { s: 'rim_shot', g: 0.34 },
    bass: { voice: 'electric', lp: 2000, octave: -1, gain: 1.05, drive: true },
  },
};

export function getStyleKit(style) {
  return STYLE_KITS[style] || STYLE_KITS.triphop;
}

function playLane(ctx, dest, lane, time, vel, stepSec) {
  if (!lane) return false;
  if (lane.chord) {
    let ok = false;
    for (const n of lane.notes) {
      ok =
        playPitched(ctx, dest, lane.chord, n, time, {
          vel,
          gain: lane.g,
          dur: lane.dur,
          lowpass: lane.lp,
          reverb: lane.rev,
          delay: lane.dly,
          delayTime: stepSec ? stepSec * 3 : undefined,
        }) || ok;
    }
    return ok;
  }
  const list = Array.isArray(lane.s) ? lane.s : [lane.s];
  let ok = false;
  list.forEach((name, idx) => {
    ok =
      playSample(ctx, dest, name, time, {
        vel,
        gain: lane.g * (idx === 0 ? 1 : 0.75),
        rate: lane.rate,
        dur: lane.dur,
        lowpass: lane.lp,
        highpass: lane.hp,
        reverb: lane.rev,
        delay: lane.dly,
        delayTime: stepSec ? stepSec * 3 : undefined,
      }) || ok;
  });
  return ok;
}

/** Resolve which bass instrument to use for a style + user voice override. */
export function resolveBassVoice(style, voiceOverride = 'auto') {
  const kit = getStyleKit(style);
  const v = voiceOverride && voiceOverride !== 'auto' ? voiceOverride : kit.bass.voice;
  if (v === '808' || v === '808slide') return { instrument: 'sub808', slide: v === '808slide', heavy: v === '808slide' };
  if (v === 'synth') return { instrument: 'synth', slide: false };
  if (v === 'upright' || v === 'electric') return { instrument: v, slide: false };
  return { instrument: 'upright', slide: false };
}

/**
 * MIDI note for a bass step. The key's root sits on the bass guitar's natural low window
 * (E1…D♯2, i.e. A = A1 55 Hz, C = C2, E = E1) at octave 0 for the default voices; the
 * Octave control moves the whole line ±12 semitones (−1 is deep sub territory).
 * Notes are folded into E0…E4 so extreme settings stay audible and musical.
 */
export function bassRootMidi(bassRootSemis = 0) {
  const pc = ((((BASS_ROOT_MIDI + (Number(bassRootSemis) || 0) - 28) % 12) + 12) % 12);
  return 28 + pc;
}

export function bassMidiFor(semi, bassRootSemis = 0, bassOctave = 0, voiceOctave = -1) {
  let midi = bassRootMidi(bassRootSemis) + semi + 12 * ((Number(bassOctave) || 0) + voiceOctave + 1);
  while (midi < 16) midi += 12;
  while (midi > 64) midi -= 12;
  return midi;
}

function sampledBassNote(ctx, dest, time, midi, dur, vel, style, voice, prevMidi, stepSec) {
  const kit = getStyleKit(style);
  const b = kit.bass;
  const rv = resolveBassVoice(style, voice);
  const opts = {
    vel: Math.min(1.2, vel),
    gain: (b.gain ?? 1) * (rv.instrument === 'sub808' ? (rv.heavy ? 1.15 : 1.0) : 1),
    dur: dur * (b.sustain ?? 1),
    lowpass: rv.instrument === 'sub808' ? (rv.heavy ? 1400 : 900) : b.lp,
    q: b.q,
    drive: rv.heavy || b.drive || rv.instrument === 'synth',
    reverb: b.rev,
    delay: b.dly,
    delayTime: stepSec ? stepSec * 3 : undefined,
  };
  if (rv.slide && typeof prevMidi === 'number' && prevMidi !== midi) {
    opts.slideFromMidi = prevMidi;
    opts.glide = Math.min(0.12, dur * 0.35);
  }
  if (b.wobble && rv.instrument === 'electric') {
    opts.slideFromMidi = midi - 0.45; // rubbery scoop into the note
    opts.glide = 0.045;
  }
  return playPitched(ctx, dest, rv.instrument, midi, time, opts);
}

/**
 * Soft metronome click. Accent = downbeat (always straight on the beat).
 */
export function triggerClick(ctx, dest, time, accent) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1320 : 880;
  const g = ctx.createGain();
  g.gain.setValueAtTime(accent ? 0.22 : 0.12, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + 0.05);
}

/** Previous sounding note in a (looping) bass pattern, for 808 slides. */
function previousBassSemi(pattern, step) {
  const n = pattern.notes.length;
  for (let k = 1; k < n; k++) {
    const v = pattern.notes[(step - k + n) % n];
    if (v !== undefined && v > -90) return v;
  }
  return null;
}

/**
 * Schedule kit hits for one 16th step (works live or offline, supports 2-bar patterns,
 * style-specific timbres, and sparse/core/busy variation density).
 */
export function scheduleStepHits(opts) {
  const {
    ctx,
    kitDest,
    drumDest,
    bassDest,
    chopDest,
    metroDest,
    time,
    stepInBar,
    stepIndex,
    drumsOn,
    bassOn,
    chopsOn,
    metronome,
    drumPattern,
    bassPattern,
    chopPattern,
    stepSec,
    swing = 0,
    bassRootSemis = 0,
    bassOctave = 0,
    bassVoice = 'auto',
    variation = 'core',
  } = opts;
  const useSamples = samplesReady();

  const drums = drumDest || kitDest;
  const bass = bassDest || kitDest;
  const chops = chopDest || kitDest;
  const globalStep = typeof stepIndex === 'number' ? stepIndex : stepInBar;
  const hitTime = time + stepSwingOffset(globalStep, stepSec, swing);
  const isOdd16th = (globalStep & 1) === 1;

  if (drumsOn && drumPattern && drums) {
    const dStyle = drumPattern.style || drumPattern.id || 'triphop';
    const dLen = drumPattern.kick.length || STEPS_PER_BAR;
    const dStep = globalStep % dLen;

    let kVel = drumPattern.kick[dStep] || 0;
    let sVel = drumPattern.snare[dStep] || 0;
    let hVal = drumPattern.hat[dStep] || 0;
    let pVal = drumPattern.perc ? drumPattern.perc[dStep] || 0 : 0;

    if (variation === 'sparse') {
      // Strip busy 16th ghost notes while keeping the core style pocket intact
      if (isOdd16th && kVel < 0.78) kVel = 0;
      if (sVel < 0.45) sVel = 0;
      if (isOdd16th && hVal > 0 && hVal < 1.5 && dStyle !== 'cumbia') hVal = 0;
      if (isOdd16th && pVal === 1) pVal = 0;
    } else if (variation === 'busy') {
      // Add tasteful turnaround ghost snares and percussion answers in busy mode
      if (sVel === 0 && (dStep === 15 || dStep === 27 || dStep === 31)) sVel = 0.38;
      if (pVal === 0 && dStep === 30) pVal = 2;
    }

    const kit = useSamples ? getStyleKit(dStyle) : null;

    if (kVel > 0) {
      if (!(kit && playLane(ctx, drums, kit.kick, hitTime, kVel, stepSec))) {
        triggerKick(ctx, drums, hitTime, kVel, dStyle);
      }
    }
    if (sVel > 0) {
      const lane = kit ? (sVel < 0.5 ? kit.ghost : kit.snare) : null;
      if (!(lane && playLane(ctx, drums, lane, hitTime, sVel < 0.5 ? sVel * 1.6 : sVel, stepSec))) {
        triggerSnare(ctx, drums, hitTime, sVel, dStyle);
      }
    }

    if (hVal >= 1.5) {
      if (!(kit && playLane(ctx, drums, kit.open, hitTime, 0.85, stepSec))) {
        triggerOpenHat(ctx, drums, hitTime, 0.85, dStyle);
      }
    } else if (hVal > 0) {
      if (!(kit && playLane(ctx, drums, kit.hat, hitTime, hVal * 0.95, stepSec))) {
        triggerHat(ctx, drums, hitTime, hVal * 0.85, dStyle);
      }
    }

    if (pVal > 0) {
      const lane = kit ? (pVal === 2 ? kit.perc2 : kit.perc1) : null;
      if (!(lane && playLane(ctx, drums, lane, hitTime, 0.9, stepSec))) {
        triggerPerc(ctx, drums, hitTime, pVal, dStyle);
      }
    }
  }

  const chopPat = chopPattern || (drumPattern ? getChopPattern(drumPattern.style || drumPattern.id) : null);
  const chopsEnabled = chopsOn == null ? !!drumsOn : !!chopsOn;
  if (chopsEnabled && chopPat && chops) {
    const cLen = chopPat.steps.length || STEPS_PER_BAR;
    const cStep = globalStep % cLen;
    let cVal = chopPat.steps[cStep] || 0;
    const dStyle = (drumPattern && (drumPattern.style || drumPattern.id)) || chopPat.id;

    if (variation === 'sparse') {
      if (dStyle === 'ska') {
        if (cStep !== 6 && cStep !== 14 && cStep !== 22 && cStep !== 30) cVal = 0;
      } else if ((cStep & 1) === 1) {
        cVal = 0;
      }
    } else if (variation === 'busy') {
      if (cVal === 0 && dStyle === 'ska' && (cStep === 3 || cStep === 11 || cStep === 15 || cStep === 19 || cStep === 31)) {
        cVal = cStep >= 24 ? 3 : cStep >= 16 ? 2 : 1;
      } else if (cVal === 0 && dStyle !== 'ska' && (cStep === 15 || cStep === 30)) {
        cVal = 1;
      }
    }

    if (cVal > 0) {
      const ivs = chopPat.voicings[cVal] || chopPat.voicings[1];
      let played = false;
      if (useSamples && ivs) {
        for (const iv of ivs) {
          const midi = chopMidiFor(iv, bassRootSemis, chopPat.register ?? 48);
          const ok = playPitched(ctx, chops, chopPat.instrument, midi, hitTime, {
            vel: 0.9,
            gain: (chopPat.gain ?? 0.4) / Math.max(1, ivs.length * 0.72),
            dur: chopPat.dur,
            lowpass: chopPat.lp,
            highpass: chopPat.hp,
            reverb: chopPat.rev,
            delay: chopPat.dly,
            delayTime: stepSec ? stepSec * 3 : undefined,
          });
          if (ok) played = true;
        }
      }
      if (!played && ivs) {
        for (const iv of ivs) {
          const midi = chopMidiFor(iv, bassRootSemis, chopPat.register ?? 48);
          const freq = 440 * Math.pow(2, (midi - 69) / 12);
          triggerChop(ctx, chops, hitTime, freq, chopPat.dur ?? 0.12, 0.9, chopPat.instrument);
        }
      }
    }
  }

  if (bassOn && bassPattern && bass) {
    const bStyle = bassPattern.style || bassPattern.id || 'triphop';
    const bLen = bassPattern.notes.length || STEPS_PER_BAR;
    const bStep = globalStep % bLen;
    let semi = bassPattern.notes[bStep];

    if (variation === 'sparse' && isOdd16th && bStep % 4 !== 3 && bStyle !== 'techno') {
      // Leave extra air on odd 16ths in sparse mode
      const velCheck = bassPattern.vels ? bassPattern.vels[bStep] || 1.0 : 1.0;
      if (velCheck < 0.92) semi = -99;
    } else if (variation === 'busy' && (semi === undefined || semi <= -90) && bStep === 31) {
      // Turnaround octave/fifth pickup on step 31 in busy mode
      semi = 7;
    }

    if (semi !== undefined && semi > -90) {
      const gateSteps = bassPattern.gates ? bassPattern.gates[bStep] || 1.6 : 1.6;
      const vel = bassPattern.vels ? bassPattern.vels[bStep] || 1.0 : 1.0;
      const kitBass = getStyleKit(bStyle).bass;
      const midi = bassMidiFor(semi, bassRootSemis, bassOctave, kitBass.octave ?? -1);
      let played = false;
      if (useSamples) {
        const prevSemi = previousBassSemi(bassPattern, bStep);
        const prevMidi =
          prevSemi === null ? undefined : bassMidiFor(prevSemi, bassRootSemis, bassOctave, kitBass.octave ?? -1);
        played = sampledBassNote(ctx, bass, hitTime, midi, stepSec * gateSteps, vel, bStyle, bassVoice, prevMidi, stepSec);
      }
      if (!played) {
        // Synthesis fallback (same pitch as the sampled path)
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        triggerBass(ctx, bass, hitTime, freq, stepSec * gateSteps, vel, bStyle);
      }
    }
  }

  if (metronome && metroDest && stepInBar % 4 === 0) {
    triggerClick(ctx, metroDest, time, stepInBar === 0);
  }
}
