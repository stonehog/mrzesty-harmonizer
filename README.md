# MrZesty · Studio Vocal & Style Console

Offline-first Music Memos–style vocal sketchpad and hardware-inspired studio console. Record a loop or a phrase, stack up to 3 dry vocal lanes (`Vox 1–3`) with live waveforms, dial in **8 sampled musical styles** with **Sparse / Core / Busy** density, mix and match any drum style with any bass style, set the **bass key (C–B), octave (−1 / 0 / +1) and bass voice**, then thicken or harmonize your takes with the post-recording **ADT Vocal Doubler** and **3-Voice Formant Harmonizer**. Bounce everything to a WAV.

**Stack:** native browser ES modules + Web Audio. Zero runtime dependencies, no accounts, no backend, no cloud AI. All drum, bass, guitar and keys sounds are **real CC0 sampled one-shots bundled in the app** (see [SAMPLES-LICENSES.md](SAMPLES-LICENSES.md)), so it works fully offline.

Repo: https://github.com/stonehog/mrzesty-harmonizer

## Run it on a Mac (or Windows / Linux)

You need [Node.js](https://nodejs.org) 18+ and git.

```bash
git clone https://github.com/stonehog/mrzesty-harmonizer.git
cd mrzesty-harmonizer
npm install
npm start          # = npm run build && npm run preview → http://localhost:4173
```

Open **http://localhost:4173** in Chrome, Brave, Edge or Safari, tap **ENABLE AUDIO** (this also loads the samples), then allow the microphone when you record a take.

**Use the production build (`npm start`) for playing and recording.** It serves the optimized `dist/` bundle with no file watcher or hot-reload socket, which matters if the folder lives in iCloud Drive (the dev server watches every file there). `npm run dev` (http://localhost:5173) is for editing the code.

To update later: `git pull` (or copy the new files in), then `npm start` again. Stop the server with **Ctrl+C**.

### Build only / serve it anywhere

```bash
npm run build      # → dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is a plain static site with relative paths, so you can also serve it with any static server (`cd dist && python3 -m http.server 8080`) from the site root or a sub-folder. Browsers only allow the microphone on **https://** or **http://localhost**, so if you host it, use HTTPS. (Opening `dist/index.html` straight from Finder via `file://` will not work because browsers block module and sample loading there.)

### No Node at all?

```bash
python3 -m http.server 5173
```

from the repo folder also works (the source runs unbundled), then open http://localhost:5173.

### Tests

```bash
npm test
```

### iPad / iPhone (Safari)

Works in Safari on iPadOS / iOS 16.4+: the first tap on **ENABLE AUDIO** unlocks Web Audio and sound plays even with the silent switch on. Recording runs in an AudioWorklet on the audio thread, with an automatic ScriptProcessor fallback for browsers without one. Use HTTPS for the microphone.

## Recording vocals

Conference-headset and laptop mics often come in very quiet (browser auto-gain is turned off so the tone stays natural). Unit 02 now has:

- **MIC GAIN** (0 to +24 dB, default **+9 dB**) applied before the take is written, with a live **INPUT** meter and a **CLIP** warning. A soft limiter sits after the gain so a hot take does not hard-clip.
- **MIC CHECK** opens the mic so you can watch the INPUT meter while you set MIC GAIN. Turn it off when you are done. Otherwise the mic is open only while a take is recording: a Bluetooth headset (AirPods included) drops into low-quality "call" audio whenever its mic is open, which makes playback thin and choppy. Wired headphones plus the Mac mic or an audio interface sound best.
- Takes are lined up with the loop automatically: the recorder drops the scheduled pre-roll and the output latency the browser reports, so vocals land on the beat instead of slightly late.
- **AUTO-LEVEL** (on by default) peak-normalizes each finished take to about **−3 dBFS** before the harmonizer and doubler analyze it, so doubles and harmonies get the same louder signal.
- Each vox lane already has a **LVL** playback trim (saved with the idea and used by the WAV bounce). MIC GAIN and AUTO-LEVEL are also saved with ideas; they only affect new takes, not audio already on the lanes.

## The 8 Musical Styles (`Unit 01 · Style & Rhythm Engine`)

| Pad | Style | Drums (sampled kit) | Bass (sampled, default voice) | Default feel |
|---|---|---|---|---|
| **1** | **Trip-Hop** (`Bristol Downtempo Break`) | Dusty kick, crunchy layered snare in a dark room, soft hats, raw rim/shaker. **Vibes pings live on the Chops / Keys lane** | Dark, deep **upright bass** (pizz) with space | `84 BPM` · `30%` swing |
| **2** | **Noir Rap** (`Half-Time Dark-Pop Boom`) | Slow half-time 808 kick, **hard snare + clap** on beat 3, finger snaps on 2 & 4, sparse hats, big reverb. **Minor piano stabs live on the Chops / Keys lane** | **808 sub** (switch to `808 SLIDE` for a heavier sliding 808, or `UPRIGHT` / `ELECTRIC` for a natural bass) | `76 BPM` · `12%` swing |
| **3** | **Techno** (`Berlin 909 / Warehouse`) | Punchy electronic kick, clap + snare, tight hats, bright open hats, rim/claves with delay | **Synth bass** (electronic, resonant, driven) | `126 BPM` · straight |
| **4** | **Alt-Rock** (`90s Quiet-Loud Drive`) | Acoustic kick, live snare layered with a hard snare, real hi-hats, shaker / rim | Picked-feel **electric bass**, brighter with light drive | `120 BPM` · `4%` |
| **5** | **Acid Jazz** (`Funk Break × Bristol Dub Bass`) | Syncopated 16th break with ghost snares | **New:** deep, slow, dubby **electric sub bass** — long notes, dark tone, dub-delay space and weight | `110 BPM` · `22%` |
| **6** | **Brown Sound** (`Lo-Fi Eclectic`) | Fat kick, detuned dub snare, rim & snap | Rubbery electric bass with a little pitch scoop | `102 BPM` · `28%` |
| **7** | **Art-Funk** (`80s Poly-Groove`) | Tight kick & snare, hats + shaker, rim-clave (unpitched) | Staccato electric funk bass | `115 BPM` · `14%` |
| **8** | **Ska** (`2-Tone Offbeat Skank`) — new | Acoustic kick on 1 & 3, crisp snare on 2 & 4, open hats on the '&'s, rim / cross-stick. **Offbeat guitar skank lives on the Chops / Keys lane** (I in bar 1, IV→V in bar 2; Sparse keeps only the '&' of 2 and 4, Busy adds upstroke 16ths) | Bouncy walking **electric bass**, two distinct bars | `160 BPM` · `6%` (type `slow ska` for an 80 BPM half-time feel) |

Cumbia and Shroom Lounge were removed in v0.4.0 (old saved ideas that used them load as Alt-Rock / Trip-Hop).

- **Mix and match**: tap a Style pad to switch the whole band, or tap the `1–8` pads in the **Drum Kit** and **Bass** strips separately (e.g. Noir Rap drums × Trip-Hop bass).
- **Chops / Keys lane**: melodic beds (Trip-Hop vibes, Noir Rap piano stabs, Ska guitar skank) have their own on/off, mute and level, separate from the raw drum kit. The chop follows the **Drum Kit** style when you mix and match.
- **Density (`SPARSE` / `CORE` / `BUSY`)**: strip it back for sketching, play the core 2-bar groove, or add ghost notes, pickups and extra skank 16ths.
- **Bass key / octave / voice**: the 12-key bar (C … B) sets the bass key and is shared with the harmonizer's Scale Key. `OCTAVE −1 / 0 / +1` moves the whole bass line (−1 is deep-sub territory: best on headphones or a subwoofer). `VOICE` = `AUTO` (style default), `UPRIGHT`, `ELECTRIC`, `808`, `808 SLIDE`, `SYNTH`. All of these apply live, are saved with ideas, and are used by the WAV bounce.
- **Style interpreter**: type `"noir rap"`, `"ska"`, `"2 tone"`, `"slow ska"`, `"sparse trip-hop"`, `"noir rap drums with trip-hop bass"`, `"85 bpm techno"` and hit **APPLY STYLE**.
- **BPM lock**: once vocals are recorded (or `LOCK` is on), switching styles keeps your tempo.

## Performance

v0.4.3 was a performance pass after playback got choppy on an Intel iMac. Measured with a Chrome DevTools trace (3 vox lanes of 11.4 s, Trip-Hop on **Busy**, Double + Triad harmony on All Vox), share of time the browser's main thread was busy:

| | v0.4.2 | v0.4.3 | v0.4.3 Lite |
|---|---|---|---|
| Playback | 42–44% | 8–9.5% | 3.9% |
| Recording a take | 32–35% | 8–9.6% | 3.9% |
| Idle (audio on, stopped) | 10–11% | 1% | 1% |
| Playback, 8-bar takes (22.9 s) | 61% | 7.6% | |
| 10 ticks of the harmony DRY fader (All Vox) | 24 s frozen | 0.2 s | |

What changed:

- **Waveforms**: the app rescanned every recorded sample of every lane 60 times a second just to draw the playhead (the biggest cost, which grew with take length). Peaks are now computed once per take, the waveform is cached as an image, and only the playhead line is redrawn, at most 30 fps (15 in Lite) and never while the tab is hidden.
- **Harmony re-render**: in All Vox mode, every tick of a vox LVL or DRY fader re-rendered the whole harmony stack (about 1 s of DSP each time). It now re-renders once, 0.4 s after you let go.
- **Mic**: the meter and the mic stay off unless MIC CHECK is on or a take is recording (see above). Recording moved from a ScriptProcessor to an **AudioWorklet**.
- **Pitch readout**: 20 updates a second, and only while playing (it used to run at 60 fps forever once the harmonizer was on).
- **Reverb**: one shared reverb and dub delay per session (it was one per lane, so three convolution reverbs), with a shorter 1.8 s plate. Finished drum and bass voices are disconnected right away.
- **DOM**: the step chaser, beat dots, meter and tuner only touch the page when something visibly changes.

**LITE** (top bar) is a safety valve: half-rate visuals, no live reverb or delay (the WAV export keeps them), no LED glows, and a longer scheduler lookahead. After a reload it also asks the browser for larger, steadier audio buffers. The setting is remembered.

The scheduler checks every 25 ms and books hits 120 ms ahead (200 ms in Lite). Each check takes about 0.05 ms.

## Sound engine

`src/audio/sampler.js` decodes the bundled one-shots into `AudioBuffer`s once and shares them between live playback and the offline WAV mixdown. Drums get a velocity curve and a short anti-click fade; pitched instruments (upright, electric, 808, synth bass, piano, vibes) use multi-zone root maps with playback-rate pitch shifting (and glides for the 808 slide). Each style maps its lanes to a fitting kit in `STYLE_KITS` (`src/audio/kits.js`), with per-lane filters plus one shared dark reverb and dub delay per session (each lane's send follows its fader and mute), and a soft bus limiter keeps stacked parts from clipping. If samples ever fail to load, every voice falls back to the older Web Audio synthesis.

## License

The **code** is released under the [MIT License](LICENSE) (© 2026 Brian Hanson).
The **bundled audio samples** in `src/assets/samples/` keep their own licenses (all CC0 / public domain); see [SAMPLES-LICENSES.md](SAMPLES-LICENSES.md) for each file's source and license.

## Live demo

https://stonehog.github.io/mrzesty-harmonizer/

Hosted on GitHub Pages over HTTPS (required for the microphone).

## Deploying to GitHub Pages

The production site is published from the `gh-pages` branch (the built `dist/`, with Vite `base` set to `/mrzesty-harmonizer/`). From a clone:

```bash
npm install
npm run deploy
```

This rebuilds with `GITHUB_PAGES=true` and force-pushes `gh-pages`. GitHub Pages is set to serve that branch from `/`. Local `npm start` and `npm run dev` still use a relative base at the site root.

An unused GitHub Actions workflow is saved at `deploy/github-pages-workflow.yml` if you ever want Actions-based deploys instead (that needs a login with the `workflow` scope, and the file should not be committed under `.github/workflows` until then).
