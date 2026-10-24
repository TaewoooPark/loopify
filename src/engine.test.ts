import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT, ENGINE_VERSION, generate, mutateMaps, rng, validateSnapshot, type Snapshot } from './engine.ts';

test('generation is reproducible and diverse across seeds', () => {
  assert.deepEqual(generate(DEFAULT), generate(structuredClone(DEFAULT)));
  const fingerprints = new Set();
  for (let seed = 0; seed < 120; seed++) {
    const loop = generate({ ...DEFAULT, seed });
    fingerprints.add(JSON.stringify(loop.notes.map(n => [n.pitch, n.start, n.duration])));
  }
  assert.ok(fingerprints.size > 110, `${fingerprints.size} distinct loops`);
});

test('random parameter combinations produce bounded, valid musical events', () => {
  const random = rng(2391);
  for (let seed = 0; seed < 1500; seed++) {
    const s = { ...DEFAULT, seed, bars: [2, 4, 8][seed % 3], root: seed % 12, mode: (['minor', 'major', 'dorian', 'mixolydian'] as const)[seed % 4], maps: DEFAULT.maps.map(m => ({ ...m, x: random(), y: random() })) };
    const loop = generate(s);
    assert.equal(loop.chords.length, s.bars);
    assert.ok(loop.notes.length > s.bars * 3);
    for (const n of loop.notes) {
      assert.ok(n.pitch >= 28 && n.pitch <= 96 && Number.isInteger(n.pitch));
      assert.ok(n.duration > 0 && n.start >= 0 && n.start + n.duration <= loop.beats + 1e-8);
      assert.ok(n.velocity > 0 && n.velocity <= 1);
    }
  }
});

test('every macro changes its intended musical dimension', () => {
  const at = (map: number, axis: 'x' | 'y', value: number) => generate({ ...DEFAULT, maps: DEFAULT.maps.map((m, i) => i === map ? { ...m, [axis]: value } : m) });
  for (let i = 0; i < 5; i++) for (const axis of ['x', 'y'] as const) assert.notDeepEqual(at(i, axis, 0).notes, at(i, axis, 1).notes, `map ${i} ${axis}`);
  assert.ok(at(2, 'x', 1).notes.length > at(2, 'x', 0).notes.length);
  const mean = (loop: ReturnType<typeof generate>, field: 'pitch' | 'duration') => loop.notes.reduce((sum, n) => sum + n[field], 0) / loop.notes.length;
  assert.ok(mean(at(1, 'y', 1), 'pitch') > mean(at(1, 'y', 0), 'pitch'));
  assert.ok(mean(at(4, 'x', 1), 'duration') > mean(at(4, 'x', 0), 'duration'));
});

test('frozen bars preserve exact events under regeneration', () => {
  const original = generate(DEFAULT);
  const next = generate({ ...DEFAULT, seed: 12612, maps: DEFAULT.maps.map(m => ({ ...m, x: .98, y: .95 })) }, original, [0, 2]);
  for (const bar of [0, 2]) {
    assert.deepEqual(next.notes.filter(n => n.bar === bar), original.notes.filter(n => n.bar === bar));
    assert.deepEqual(next.chords[bar], original.chords[bar]);
  }
  assert.notDeepEqual(next.notes.filter(n => n.bar === 1), original.notes.filter(n => n.bar === 1));
});

test('locked maps are preserved for global and local exploration', () => {
  const s = { ...DEFAULT, maps: DEFAULT.maps.map((m, i) => ({ ...m, locked: i % 2 === 0 })) };
  for (const wide of [false, true]) {
    const changed = mutateMaps(s, wide);
    for (let i = 0; i < 5; i += 2) assert.deepEqual(changed.maps[i], s.maps[i]);
    assert.equal(changed.bpm, s.bpm); assert.equal(changed.root, s.root);
  }
});

test('project validation rejects invalid data and accepts round trips', () => {
  const snapshot: Snapshot = { settings: DEFAULT, loop: generate(DEFAULT), instrument: 'grand-piano', effects: { volume: .7, space: .2, tone: .5 }, frozen: [], version: ENGINE_VERSION };
  assert.ok(validateSnapshot(JSON.parse(JSON.stringify(snapshot))));
  assert.equal(validateSnapshot({ ...snapshot, settings: { ...DEFAULT, bpm: 0 } }), null);
  assert.equal(validateSnapshot({ ...snapshot, loop: { ...snapshot.loop, notes: [{ ...snapshot.loop.notes[0], duration: -1 }] } }), null);
  assert.equal(validateSnapshot(null), null);
});

test('map extremes produce substantial changes in rhythm, articulation and dynamics', () => {
  let sparse = 0, dense = 0, short = 0, long = 0, evenRange = 0, contourRange = 0;
  const changed = (seed: number, map: number, axis: 'x' | 'y', value: number) => generate({ ...DEFAULT, seed, maps: DEFAULT.maps.map((m, i) => i === map ? { ...m, [axis]: value } : m) });
  const duration = (loop: ReturnType<typeof generate>) => loop.notes.reduce((sum, n) => sum + n.duration, 0) / loop.notes.length;
  const range = (loop: ReturnType<typeof generate>) => Math.max(...loop.notes.map(n => n.velocity)) - Math.min(...loop.notes.map(n => n.velocity));
  for (let seed = 0; seed < 64; seed++) {
    sparse += changed(seed, 2, 'x', 0).notes.length;
    dense += changed(seed, 2, 'x', 1).notes.length;
    short += duration(changed(seed, 4, 'x', 0));
    long += duration(changed(seed, 4, 'x', 1));
    evenRange += range(changed(seed, 4, 'y', 0));
    contourRange += range(changed(seed, 4, 'y', 1));
  }
  assert.ok(dense > sparse * 3, 'density must change the musical texture, not just add one note');
  assert.ok(long > short * 4, 'articulation must range from short points to sustained lines');
  assert.ok(contourRange > evenRange * 2, 'contour must create audible dynamic accents');
});

test('new seeds vary rhythmic phrases as well as pitches', () => {
  const patterns = new Set<string>();
  for (let seed = 0; seed < 64; seed++) {
    const loop = generate({ ...DEFAULT, seed });
    patterns.add(JSON.stringify([...new Set(loop.notes.filter(n => n.voice === 'chord' && n.bar === 0).map(n => Math.floor(n.start * 4) / 4))]));
  }
  assert.ok(patterns.size >= 4, `${patterns.size} distinct comping rhythms`);
});

test('strummed chords do not chop a sustained melody into tiny retriggers', () => {
  const loop = generate({ ...DEFAULT, maps: DEFAULT.maps.map((m, i) => i === 4 ? { ...m, x: 1 } : m) });
  const leads = loop.notes.filter(n => n.voice === 'lead');
  assert.ok(leads.length > 0);
  assert.ok(leads.every(n => n.duration >= .2), 'melody attacks should survive nearby chord attacks');
});
