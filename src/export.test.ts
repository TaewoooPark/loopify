import test from 'node:test';
import assert from 'node:assert/strict';
import * as MidiPackage from '@tonejs/midi';
const Midi: typeof MidiPackage.Midi = Reflect.get(MidiPackage, 'Midi') ?? Reflect.get(MidiPackage, 'default').Midi;
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT, generate, type Snapshot } from './engine.ts';
import { midiBytes, wavBytes, bundleBytes } from './export.ts';
const snapshot: Snapshot = { settings: DEFAULT, loop: generate(DEFAULT), instrument: 'grand-piano', effects: { tone: .7, space: .16, volume: .72 }, frozen: [], version: 1 };

test('MIDI round trip preserves notes, timing, velocity, tempo and full loop length', () => {
  const bytes = midiBytes(snapshot), parsed = new Midi(bytes), notes = parsed.tracks[0].notes;
  assert.equal(notes.length, snapshot.loop.notes.length);
  assert.equal(parsed.header.tempos[0].bpm, DEFAULT.bpm);
  assert.deepEqual(parsed.header.timeSignatures[0].timeSignature, [4, 4]);
  for (const n of snapshot.loop.notes) {
    const match = notes.find(p => p.midi === n.pitch && Math.abs(p.ticks / parsed.header.ppq - n.start) < .003);
    assert.ok(match, `missing ${n.pitch} at ${n.start}`);
    assert.ok(Math.abs(match.durationTicks / parsed.header.ppq - n.duration) < .003);
    assert.ok(Math.abs(match.velocity - n.velocity) <= 1 / 127);
  }
  assert.equal(parsed.tracks[0].endOfTrackTicks, snapshot.loop.beats * parsed.header.ppq);
});

test('changing instrument does not alter the exported MIDI', () => {
  assert.deepEqual(midiBytes(snapshot), midiBytes({ ...snapshot, instrument: 'buzzer', effects: { tone: .1, space: .9, volume: .3 } }));
});

test('24-bit stereo WAV contains correct headers and signed samples', () => {
  const data = wavBytes([new Float32Array([0, 1, -1]), new Float32Array([.5, -.5, 0])], 44100);
  const view = new DataView(data.buffer);
  assert.equal(strFromU8(data.slice(0, 4)), 'RIFF'); assert.equal(strFromU8(data.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 18); assert.equal(data.length, 62);
  assert.deepEqual([...data.slice(50, 53)], [255, 255, 127]);
  assert.deepEqual([...data.slice(56, 59)], [0, 0, 128]);
});

test('ZIP contains reproducible project, MIDI, audio and required credits', () => {
  const wav = wavBytes([new Float32Array(10), new Float32Array(10)], 44100);
  const bundle = unzipSync(bundleBytes(snapshot, wav, 'Salamander Grand Piano — Alexander Holm — CC BY 3.0'));
  assert.deepEqual(Object.keys(bundle).sort(), ['CREDITS.txt', 'loop.mid', 'loop.wav', 'loopify.json']);
  assert.deepEqual(JSON.parse(strFromU8(bundle['loopify.json'])), snapshot);
  assert.match(strFromU8(bundle['CREDITS.txt']), /CC BY 3.0/);
});
