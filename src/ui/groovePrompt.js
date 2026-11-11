/**
 * Intelligent Musical Style & Groove Interpreter
 *
 * Understands:
 *   1. The 8 Core Studio Styles:
 *      - Trip-Hop (Bristol Downtempo Break)
 *      - Noir Rap (half-time dark-pop rap bed: 808, hard snare, snaps, piano stabs)
 *      - Techno (Berlin 909 / Warehouse Hypnotic)
 *      - Alt-Rock (90s Pixies / Indie Quiet-Loud Drive)
 *      - Acid Jazz (funk break drums × Bristol dub bass)
 *      - Ween Mode (The Pod / Mollusk Brown-Sound Eclectic)
 *      - David Byrne Mode (Remain in Light / Talking Heads Afro-Funk Poly-Groove)
 *      - Ska (2-Tone offbeat skank)
 *   2. Extra genre aliases (Country/Folk, Motown/Soul, Boom-Bap, Disco/House, Dubstep/Half-time)
 *   3. Hybrid Mix-and-Match prompts (e.g. "noir rap drums with trip-hop bass", "byrne + acid jazz bass")
 *   4. Tempo & Variation modifiers (e.g. "slow", "rebajada", "fast", "sparse", "stripped", "busy", "115 bpm")
 */

export const STYLE_GROOVE_PRESETS = [
  {
    id: 'triphop',
    label: 'Trip-Hop · Bristol Break',
    shortLabel: 'Trip-Hop',
    keywords: ['trip-hop', 'trip hop', 'triphop', 'bristol', 'portishead', 'massive attack', 'tricky', 'morcheeba', 'sneaker pimps', 'mezzo', 'mezzanine', 'dummy', 'dark breakbeat', 'cinematic break'],
    drumPatternId: 'triphop',
    bassPatternId: 'triphop',
    swing: 0.30,
    bpm: 84,
    variation: 'core',
    harmonyPreset: 'double-triad',
    description: 'Heavy Swung Bristol Trip-Hop Breakbeat, Crunchy Vinyl Snare & Dark Sub-Bass Creep · 84 BPM · 30% Swing',
  },
  {
    id: 'noirrap',
    label: 'Noir Rap · Half-Time 808',
    shortLabel: 'Noir Rap',
    keywords: ['noir rap', 'noir', 'rap', 'hip-hop', 'hip hop', 'hiphop', 'trap', '808', 'half-time', 'halftime', 'boom bap', 'boombap', 'lana del rey', 'lana', 'lorde', 'kanye', 'ye', 'dark pop', 'sad girl', 'moody rap', 'soul chop', 'piano stab', 'billie'],
    drumPatternId: 'noirrap',
    bassPatternId: 'noirrap',
    swing: 0.12,
    bpm: 76,
    variation: 'core',
    harmonyPreset: 'double-only',
    description: 'Half-Time 808 Boom + Hard Snare/Clap on 3 + Finger Snaps + Piano Stabs & Deep 808 Sub · 76 BPM · 12% Swing',
  },
  {
    id: 'techno',
    label: 'Techno · Berlin 909',
    shortLabel: 'Techno',
    keywords: ['techno', '909', 'berlin', 'warehouse', 'berghain', 'electronic', 'rave', 'minimal techno', 'hypnotic', 'four on the floor', '4x4'],
    drumPatternId: 'techno',
    bassPatternId: 'techno',
    swing: 0.0,
    bpm: 126,
    variation: 'core',
    harmonyPreset: 'double-only',
    description: 'Berlin 909 4x4 Kick & Offbeat Open Hat + Rolling 16th Sequencer Sub · 126 BPM · 0% Machine Lock',
  },
  {
    id: 'altrock',
    label: 'Alt-Rock · 90s Indie',
    shortLabel: 'Alt-Rock',
    keywords: ['alt-rock', 'alt rock', 'alternative', 'pixies', 'kim deal', 'indie', '90s rock', 'grunge', 'pavement', 'breeders', 'sonic youth', 'nirvana', 'garage', 'rock'],
    drumPatternId: 'altrock',
    bassPatternId: 'altrock',
    swing: 0.04,
    bpm: 120,
    variation: 'core',
    harmonyPreset: 'double-only',
    description: 'Punchy Live-Room Rock Kit + Gritty Picked 8th-Note Indie Bass · 120 BPM · 4% Tight Rock Feel',
  },
  {
    id: 'acidjazz',
    label: 'Acid Jazz · Dub Bass',
    shortLabel: 'Acid Jazz',
    keywords: ['acid jazz', 'acid-jazz', 'jamiroquai', 'brand new heavies', 'incognito', 'funk', 'funky', 'syncopated', 'groove', 'dub bass', 'dub'],
    drumPatternId: 'acidjazz',
    bassPatternId: 'acidjazz',
    swing: 0.22,
    bpm: 110,
    variation: 'core',
    harmonyPreset: 'double-triad',
    description: 'Hyper-Syncopated 16th Ghost-Snare Breakbeat + Deep Slow Bristol Dub Bass · 110 BPM · 22% Swing',
  },
  {
    id: 'ween',
    label: 'Brown Sound · Lo-Fi Eclectic',
    shortLabel: 'Brown Sound',
    keywords: ['brown sound', 'brown mode', 'ween', 'brown', 'mollusk', 'the pod', 'pure guava', 'chocolate and cheese', 'quebec', 'deaner', 'gener', 'weird', 'quirky', 'off-kilter', 'eclectic', 'boognish'],
    drumPatternId: 'ween',
    bassPatternId: 'ween',
    swing: 0.28,
    bpm: 102,
    variation: 'core',
    harmonyPreset: 'double-triad',
    description: 'Crooked Lo-Fi Drum Machine + Pitch-Bent Snare + Elastic Wobble Bass · 102 BPM · 28% Swing',
  },
  {
    id: 'byrne',
    label: 'Art-Funk · 80s Poly-Groove',
    shortLabel: 'Art-Funk',
    keywords: ['art-funk', 'art funk', 'poly-funk', 'david byrne', 'byrne', 'talking heads', 'remain in light', 'speaking in tongues', 'eno', 'brian eno', 'tina weymouth', 'afrobeat', 'afro-funk', 'poly', 'polyrhythm', 'once in a lifetime', 'born under punches', 'fela'],
    drumPatternId: 'byrne',
    bassPatternId: 'byrne',
    swing: 0.14,
    bpm: 115,
    variation: 'core',
    harmonyPreset: 'double-triad',
    description: '80s Afro-Funk Polyrhythm + Dual Agogo Clave + Staccato Space-Funk Bass · 115 BPM · 14% Pocket',
  },
  {
    id: 'ska',
    label: 'Ska · 2-Tone Skank',
    shortLabel: 'Ska',
    keywords: ['ska', '2 tone', '2-tone', '2tone', 'two tone', 'twotone', 'skank', 'offbeat', 'upstroke', 'rocksteady', 'rude boy', 'rudie', 'english beat', 'the clash', 'clash', 'the specials', 'specials', 'madness', 'selector'],
    drumPatternId: 'ska',
    bassPatternId: 'ska',
    swing: 0.06,
    bpm: 160,
    variation: 'core',
    harmonyPreset: 'double-triad',
    description: '2-Tone Offbeat Guitar Skank + Crisp Snare / Open Hats + Walking Electric Bass · 160 BPM · 6% Lift',
  },
  // Extra hybrid presets for classic requests
  {
    id: 'country',
    label: 'Country / Cosmic Americana',
    shortLabel: 'Country',
    keywords: ['country', 'folk', 'americana', 'bluegrass', 'western', '12 golden country greats', 'cash', 'train'],
    drumPatternId: 'altrock',
    bassPatternId: 'altrock',
    swing: 0.16,
    bpm: 108,
    variation: 'sparse',
    harmonyPreset: 'double-triad',
    description: 'Tight Backbeat Kit + Root-Third-Fifth Alternating Bass · 108 BPM · 16% Swing',
  },
  {
    id: 'motown',
    label: 'Motown / 60s Soul Pocket',
    shortLabel: 'Motown Soul',
    keywords: ['motown', 'soul', 'jamerson', '60s', 'r&b', 'rnb', 'gospel'],
    drumPatternId: 'acidjazz',
    bassPatternId: 'byrne',
    swing: 0.26,
    bpm: 100,
    variation: 'core',
    harmonyPreset: 'harmony-only',
    description: 'Warm Soul Pocket Drums + Syncopated Motown/Funk Bassline · 100 BPM · 26% Swing',
  },
];

function scorePreset(query, preset) {
  let score = 0;
  if (query === preset.id || query === preset.shortLabel.toLowerCase()) score += 25;
  for (const kw of preset.keywords) {
    if (query === kw) score += 18;
    else if (query.includes(kw)) score += 6 + kw.length * 0.35;
    else if (kw.includes(query) && query.length >= 3) score += 3;
  }
  return score;
}

function findBestStyle(fragment) {
  const q = String(fragment || '').trim().toLowerCase();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const preset of STYLE_GROOVE_PRESETS) {
    const s = scorePreset(q, preset);
    if (s > bestScore) {
      bestScore = s;
      best = preset;
    }
  }
  return best;
}

/**
 * Parse a free-text musical style prompt into a complete intelligent groove configuration.
 * Supports:
 *   - Direct style names ("trip-hop", "noir rap", "techno", "alt-rock", "acid jazz", "ween", "david byrne", "ska", "2 tone")
 *   - Hybrid drum/bass combinations ("noir rap drums with trip-hop bass", "byrne + acid jazz bass")
 *   - Tempo & density modifiers ("rebajada", "slow", "fast", "sparse", "busy", "118 bpm")
 *
 * @param {string} rawPrompt
 * @returns {{
 *   id: string,
 *   label: string,
 *   shortLabel: string,
 *   drumPatternId: string,
 *   bassPatternId: string,
 *   swing: number,
 *   bpm: number,
 *   variation: 'sparse' | 'core' | 'busy',
 *   harmonyPreset: string,
 *   description: string
 * }}
 */
export function matchStyleGroove(rawPrompt) {
  const q = String(rawPrompt || '').trim().toLowerCase();
  if (!q) return { ...STYLE_GROOVE_PRESETS[0] };

  // Check for explicit hybrid prompt (e.g., "noir rap drums with trip-hop bass" or "byrne / acid jazz")
  const splitMatch = q.match(/^(.+?)\s+(?:with|and|plus|\+|\/|over|meets)\s+(.+)$/);
  let primary = findBestStyle(q) || STYLE_GROOVE_PRESETS[0];
  let result = { ...primary };

  if (splitMatch) {
    const leftStyle = findBestStyle(splitMatch[1]);
    const rightStyle = findBestStyle(splitMatch[2]);
    if (leftStyle && rightStyle && leftStyle.id !== rightStyle.id) {
      const leftMentionsBass = /bass/.test(splitMatch[1]);
      const drm = leftMentionsBass ? rightStyle : leftStyle;
      const bss = leftMentionsBass ? leftStyle : rightStyle;
      result = {
        ...drm,
        id: drm.id,
        label: `${drm.shortLabel} Drums × ${bss.shortLabel} Bass`,
        shortLabel: `${drm.shortLabel} × ${bss.shortLabel}`,
        drumPatternId: drm.drumPatternId,
        bassPatternId: bss.bassPatternId,
        swing: Number(((drm.swing + bss.swing) / 2).toFixed(2)),
        bpm: Math.round((drm.bpm + bss.bpm) / 2),
        description: `Hybrid Groove: ${drm.shortLabel} Drums + ${bss.shortLabel} Bass · ${Math.round((drm.bpm + bss.bpm) / 2)} BPM`,
      };
    }
  }

  // Variation / density modifiers
  if (/\b(sparse|stripped|simple|minimal|quiet|space|chill)\b/.test(q)) {
    result.variation = 'sparse';
  } else if (/\b(busy|hype|complex|heavy|wild|fills|intense)\b/.test(q)) {
    result.variation = 'busy';
  }

  // Tempo modifiers (e.g. "rebajada"/"chopped" slowed-down, "slow", "fast", or explicit "112 bpm")
  const bpmMatch = q.match(/\b(\d{2,3})\s*bpm\b/);
  if (bpmMatch) {
    result.bpm = Math.max(40, Math.min(200, Number(bpmMatch[1])));
  } else if (/\b(rebajada|chopped|screwed)\b/.test(q)) {
    result.bpm = Math.max(60, Math.round(result.bpm * 0.84));
    result.swing = Math.min(0.45, Number((result.swing + 0.06).toFixed(2)));
  } else if (/\b(slow|slower|downtempo|laid back|half-time|halftime)\b/.test(q) && result.id === 'ska') {
    result.bpm = 80;
  } else if (/\b(slow|slower|downtempo|laid back)\b/.test(q) && result.id !== 'noirrap') {
    result.bpm = Math.max(55, result.bpm - 10);
  } else if (/\b(fast|faster|upbeat|uptempo|hyper)\b/.test(q)) {
    result.bpm = Math.min(185, result.bpm + 12);
  }

  return result;
}
