/**
 * Plain-language walkthrough used by the in-app Help overlay and HOW-TO-USE.md.
 * Written so a non-technical person can follow it, one step at a time.
 */

export const HELP_TITLE = 'How to use MrZesty';

export const HELP_INTRO =
  'MrZesty is a small music sketchpad that runs in your web browser. You can play a backing beat, sing a short part, add extra voices, and save a sound file. You do not need to install anything.';

export const HELP_STEPS = [
  {
    title: '1. Open the page and turn the sound on',
    body: 'Open MrZesty in Chrome, Brave, Edge, or Safari. Tap the Enable Audio button at the top. This turns the sound on. You should hear a short confirmation in the status line under the MrZesty name.',
  },
  {
    title: '2. Allow the microphone',
    body: 'The first time you record, or when you tap Mic Check, your browser will ask if MrZesty can use the microphone (the mic on your computer or headset). Choose Allow. If you chose Block by accident, look for a small microphone icon in the address bar and switch it to Allow, then try again.',
  },
  {
    title: '3. Pick a style and press Play',
    body: 'On the left, Unit 01 has eight style pads. Each pad is a ready-made groove: drums (the beat) and bass (the low notes). Tap a pad you like, then tap Play. You can stop with Stop, or tap Play again. Turn the Master knob if you want it quieter or louder.',
  },
  {
    title: '4. Set the key and the tempo',
    body: 'The key is the musical home note for the bass, shown as C, D, E, and so on in the Bass strip. Tap the one that is comfortable for your voice. The tempo is how fast the beat is. It is shown as BPM, which means beats per minute. A higher number is faster. Type a new number in the BPM box, or turn Lock on if you want the speed to stay put when you try another style.',
  },
  {
    title: '5. Check the mic and set the gain',
    body: 'Gain is how much the microphone is turned up. Tap Mic Check, then sing at a normal level and watch the Input meter. Raise Mic Gain until the meter moves well, but stop if the red Clip light comes on. Tap Mic Check again to turn it off when you are done. Leaving it off keeps some wireless headphones from switching to a lower-quality "call" sound.',
  },
  {
    title: '6. Record a take with the count-in',
    body: 'A take is one recorded vocal pass. Arm a lane (Vox 1, 2, or 3) so the red Arm light is on. Count-in is on by default. It plays four quiet clicks (4-3-2-1) so you can come in on the first beat. Tap Record Take, get ready on the clicks, and start singing when the big 1 ends and the beat comes back around. The recording starts right on that downbeat. If the loop was already playing, the count-in is the last bar before the loop starts over. Turn Count-in off if you want recording to start right away. Tap Record Take again if you need to cancel.',
  },
  {
    title: '7. Listen back and redo a take',
    body: 'When the take finishes, it plays with the beat. Listen. If you do not like it, arm the same lane and record again. The new take replaces the old one on that lane. You can record up to three lanes and layer them. Use the level slider on a lane to make it quieter, or Mute if you want to hide it for a moment.',
  },
  {
    title: '8. Add doubling and harmonies',
    body: 'On the right, Unit 03 can dress up a finished take. These effects are added after you record, so they do not change the original recording. Doubling makes a second copy of your voice, slightly off, so it sounds thicker. Harmonies are extra notes that sing along with you. Tap Engage FX, then try Double and the harmony voices. Move the Dry slider to hear more or less of your original voice. You can also pick a chord type such as a triad (three notes that fit together).',
  },
  {
    title: '9. Save an idea and export a WAV',
    body: 'An idea is a saved sketch, kept in this browser on this device. Tap Save Idea and give it a name. You can load it later from the drawer at the bottom. Export WAV makes a sound file of the whole mix (the beat, your voice, and any doubling or harmonies). A WAV is a standard audio file you can open in other apps or send to a friend. Tap Export WAV, then Download WAV.',
  },
  {
    title: '10. If the sound starts to stutter, try Lite',
    body: 'If playback sounds choppy or the page feels busy, tap the Lite button in the top bar. Lite turns down some of the on-screen motion and live echo so the computer can keep the beat steady. Your saved ideas and exported files still have the full sound.',
  },
];

export const HELP_TIPS_TITLE = 'Tips for a better recording';

export const HELP_TIPS = [
  'Use wired headphones, and the microphone on your computer or a small audio interface. Wireless earbuds and AirPods often drop to a lower-quality sound when their microphone is on.',
  'Record in a quiet room, and sit close enough to the mic that you do not have to shout.',
  'The count-in clicks are short and quiet so they are less likely to leak into the take if you are listening on speakers. Headphones are still the better choice.',
  'You can use this page on an iPad in Safari. Tap Enable Audio first, and use a page address that starts with https so the microphone is allowed.',
];

/** Build the in-app help body as HTML (plain paragraphs, no extra libraries). */
export function helpBodyHtml() {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const steps = HELP_STEPS.map(
    (s) => `<section class="help-step"><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></section>`,
  ).join('');
  const tips = HELP_TIPS.map((t) => `<li>${esc(t)}</li>`).join('');
  return `<p class="help-intro">${esc(HELP_INTRO)}</p>${steps}<section class="help-step"><h3>${esc(
    HELP_TIPS_TITLE,
  )}</h3><ul class="help-tips">${tips}</ul></section>`;
}

/** Markdown source for HOW-TO-USE.md, kept in sync with the in-app Help. */
export function helpMarkdown() {
  const steps = HELP_STEPS.map((s) => `## ${s.title}\n\n${s.body}`).join('\n\n');
  const tips = HELP_TIPS.map((t) => `- ${t}`).join('\n');
  return `# ${HELP_TITLE}\n\n${HELP_INTRO}\n\n${steps}\n\n## ${HELP_TIPS_TITLE}\n\n${tips}\n`;
}
