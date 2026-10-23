# Loopify

A browser-local harmonic loop instrument. English-only, monochrome UI. Five continuous XY controls shape harmony, voicing, rhythm, motif and articulation while the loop plays. No model, inference service or account is required by the application.

## Run

Node 22+ recommended.

```sh
npm install
npm run dev
npm test
npm run build
```

## Controls

- Space: play / pause. R: new seed. Shift-R: explore unlocked maps.
- Drag a map to change the current loop immediately. Its lock prevents map edits and exploration. Keyboard users can tab to each axis and use arrow keys.
- Click a chord/bar label to freeze the exact notes in that bar during regeneration.
- Drag notes to move them by semitones and quarter-beat steps. Keyboard arrows work on focused notes. Regenerating replaces unfrozen manual edits.
- Vary explores within each unlocked map's radius. Sound settings contain the variation radii, tone and reverb.
- Bookmark menu saves locally. Project JSON preserves notes, seed, settings, sound and frozen bars. Export the JSON to back up or transfer work.
- MIDI exports note events with tempo and 4/4 metadata. WAV renders the chosen instrument and effects to 44.1 kHz, 24-bit stereo. ZIP includes both, the project and sample credits.
- Exact-loop WAV warms up two cycles and captures one full cycle; Include tail exports one pass followed by a three-second tail.

## Architecture

`engine.ts` is deterministic music generation. Each layer uses an independent seeded random stream; map edits retain the seed. `audio.ts` shares native Web Audio voice creation between real-time scheduling and offline rendering. `export.ts` writes MIDI, 24-bit PCM WAV and ZIP. State is stored locally; no application data is uploaded.

## Samples

Four self-hosted instrument packs: Salamander Grand Piano (CC BY 3.0), VCSL TX81Z FM piano, marimba and vibraphone (CC0). See `public/SAMPLE-CREDITS.txt` and `public/samples/SOURCES.json` for licenses, pinned revisions, checksums and processing. Eight additional synth presets are generated with native oscillators. Samples use one velocity layer with velocity-dependent gain and nearest-root repitching; this is a lightweight browser instrument, not a full SFZ implementation.

All generation is 4/4 and 2, 4 or 8 bars. Audio is started by a user gesture. Sample loading failures are reported instead of substituting another sound. Browser storage can be cleared by the user or browser; export projects for durable backups.
