export type MapValue = { x: number; y: number; radius: number; locked: boolean };
export type Mode = 'minor' | 'major' | 'dorian' | 'mixolydian';
export type Settings = { seed: number; bpm: number; bars: number; root: number; mode: Mode; maps: MapValue[] };
export type Note = { id: string; pitch: number; start: number; duration: number; velocity: number; voice: 'chord' | 'lead' | 'bass'; bar: number };
export type Chord = { name: string; pitches: number[]; root: number; bar: number };
export type Loop = { notes: Note[]; chords: Chord[]; beats: number; seed: number };
export type Snapshot = { settings: Settings; loop: Loop; instrument: string; effects: Effects; frozen: number[]; version: number };
export type Effects = { tone: number; space: number; volume: number };
export const ENGINE_VERSION = 1;
export const PITCHES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const MAPS = [
  { name: 'Gravity', left: 'Belong', right: 'Depart', bottom: 'Ease', top: 'Tension' },
  { name: 'Space', left: 'Gather', right: 'Scatter', bottom: 'Sink', top: 'Float' },
  { name: 'Pulse', left: 'Sparse', right: 'Dense', bottom: 'Align', top: 'Skew' },
  { name: 'Orbit', left: 'Return', right: 'Explore', bottom: 'Flow', top: 'Leap' },
  { name: 'Breath', left: 'Point', right: 'Line', bottom: 'Even', top: 'Contour' },
];
export const DEFAULT: Settings = {
  seed: 847391, bpm: 96, bars: 4, root: 9, mode: 'minor',
  maps: [
    { x: .26, y: .36, radius: .14, locked: false },
    { x: .48, y: .48, radius: .12, locked: false },
    { x: .35, y: .26, radius: .12, locked: false },
    { x: .32, y: .25, radius: .14, locked: false },
    { x: .66, y: .48, radius: .1, locked: false },
  ],
};
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, n));
export const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export function noteName(pitch: number) { return PITCHES[(pitch % 12 + 12) % 12] + (Math.floor(pitch / 12) - 1); }
const SCALES: Record<Mode, number[]> = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
const PATHS = [[0, 5, 2, 6], [0, 3, 5, 4], [0, 2, 3, 4], [5, 3, 0, 4], [0, 6, 5, 6], [0, 3, 0, 4], [0, 5, 3, 4], [0, 1, 4, 0], [3, 4, 2, 5], [0, 6, 3, 4], [0, 2, 5, 3], [5, 6, 0, 2]];
function pitchNear(pc: number, target: number) { return pc + 12 * Math.round((target - pc) / 12); }
function chordLabel(pcs: number[], root: number) {
  const third = (pcs[1] - root + 12) % 12;
  const fifth = (pcs[2] - root + 12) % 12;
  let suffix = fifth === 6 ? 'dim' : third === 3 ? 'm' : '';
  if (pcs.length > 3) suffix += (pcs[3] - root + 12) % 12 === 11 ? 'maj7' : '7';
  if (pcs.length > 4) suffix += '(9)';
  return PITCHES[root] + suffix;
}

// Each layer has its own deterministic random stream. Moving a control changes its
// musical operation, rather than rolling all other decisions again on every frame.
export function generate(s: Settings, previous?: Loop, frozen: number[] = []): Loop {
  const [gravity, space, pulse, orbit, breath] = s.maps;
  const harmony = rng(s.seed), melody = rng(s.seed ^ 0x98312), rhythm = rng(s.seed ^ 0x726ea), touch = rng(s.seed ^ 0xabc12);
  const scale = SCALES[s.mode];
  const path = PATHS[Math.floor(harmony() * PATHS.length)];
  const beats = s.bars * 4;
  const notes: Note[] = [], chords: Chord[] = [];
  const center = 49 + Math.round(space.y * 20);
  const motif = Array.from({ length: 8 }, () => melody());
  let lastLead = center + 12;
  let lastVoicing: number[] = [];
  for (let bar = 0; bar < s.bars; bar++) {
    let degree = path[bar % path.length];
    const explore = harmony();
    if (bar > 0 && explore < gravity.x * .48) degree = (degree + 2 + Math.floor(harmony() * 3)) % 7;
    const rootPc = (s.root + scale[degree]) % 12;
    let pcs = [0, 2, 4].map(offset => (s.root + scale[(degree + offset) % 7]) % 12);
    if (gravity.y > .28) pcs.push((s.root + scale[(degree + 6) % 7]) % 12);
    if (gravity.y > .72) pcs.push((s.root + scale[(degree + 1) % 7]) % 12);
    // Secondary dominants / modal borrowing are deliberate harmonic choices,
    // not indiscriminate chromatic notes or a final nearest-scale snap.
    if (gravity.x > .46 && (degree === 4 || harmony() < (gravity.x - .46) * .7)) {
      pcs = [rootPc, (rootPc + 4) % 12, (rootPc + 7) % 12];
      if (gravity.y > .28) pcs.push((rootPc + 10) % 12);
      if (gravity.y > .72) pcs.push((rootPc + 2) % 12);
    }
    const candidates: number[][] = [];
    for (let inversion = 0; inversion < pcs.length; inversion++) {
      const rotated = [...pcs.slice(inversion), ...pcs.slice(0, inversion)];
      let voicing = [pitchNear(rotated[0], center - 3)];
      for (let i = 1; i < rotated.length; i++) {
        let p = pitchNear(rotated[i], voicing[i - 1] + 4);
        while (p <= voicing[i - 1]) p += 12;
        voicing.push(p);
      }
      if (space.x > .37 && voicing.length > 2) voicing[0] -= 12;
      if (space.x > .72 && voicing.length > 3) voicing[1] -= 12;
      voicing.sort((a, b) => a - b);
      const mean = voicing.reduce((a, b) => a + b) / voicing.length;
      const shift = 12 * Math.round((center - mean) / 12);
      voicing = voicing.map(p => clamp(p + shift, 36, 89));
      candidates.push(voicing);
    }
    const cost = (v: number[]) => {
      const movement = lastVoicing.length ? v.reduce((sum, p) => sum + Math.min(...lastVoicing.map(q => Math.abs(p - q))), 0) : Math.abs(v[0] - (center - 7));
      return movement + Math.abs(v.reduce((a, b) => a + b) / v.length - center) * .45;
    };
    candidates.sort((a, b) => cost(a) - cost(b));
    const voiced = [...new Set(candidates[0])];
    lastVoicing = voiced;
    chords.push({ name: chordLabel(pcs, rootPc), pitches: voiced, root: rootPc, bar });
    const chordSlots = pulse.x < .24 ? [0] : pulse.x < .65 ? [0, 2] : [0, 1, 2, 3];
    const skew = pulse.y;
    const gate = .2 + breath.x * 1.65;
    const contour = .82 + Math.sin((bar / s.bars) * Math.PI) * .15 * breath.y;
    function add(pitch: number, localStart: number, duration: number, velocity: number, voice: Note['voice']) {
      const start = Math.max(bar * 4, Math.min(bar * 4 + localStart, beats - .0625));
      notes.push({ id: `${bar}-${voice}-${notes.length}`, pitch: Math.round(clamp(pitch, 28, 96)), start, duration: Math.max(.06, Math.min(duration, beats - start)), velocity: clamp(velocity * contour, .25, .94), voice, bar });
    }
    for (let i = 0; i < chordSlots.length; i++) {
      let start = chordSlots[i];
      if (i > 0 && rhythm() < skew) start += .5;
      const spacing = 4 / chordSlots.length;
      const duration = Math.min(spacing - .04, spacing * gate * .8);
      for (let n = 0; n < voiced.length; n++) {
        const roll = pulse.x > .55 ? n * .065 * pulse.y : 0;
        const vel = .45 + (touch() - .5) * .18 * breath.y + (i === 0 ? .07 : 0);
        add(voiced[n], start + roll, duration, vel, 'chord');
      }
    }
    add(pitchNear(rootPc, center - 16), 0, Math.min(3.88, 1 + breath.x * 3), .56, 'bass');
    const steps = pulse.x < .18 ? 2 : pulse.x < .45 ? 4 : pulse.x < .76 ? 6 : 8;
    for (let i = 0; i < steps; i++) {
      const m = motif[i % motif.length];
      const randomValue = melody();
      const pick = orbit.x > randomValue ? melody() : m;
      const target = center + 8 + (pick - .5) * (6 + orbit.y * 22);
      const chordOptions = pcs.flatMap(pc => [-12, 0, 12].map(o => pitchNear(pc, target) + o)).filter(p => p >= center + 1 && p <= 91);
      const nearby = [...chordOptions].sort((a, b) => (Math.abs(a - target) + Math.abs(a - lastLead) * (1 - orbit.y) * .7) - (Math.abs(b - target) + Math.abs(b - lastLead) * (1 - orbit.y) * .7));
      let pitch = nearby[0] ?? pitchNear(rootPc, center + 9);
      let start = i * 4 / steps;
      start = Math.round(start * 4) / 4;
      if (i % 2 && skew > .2) start += .25 * Math.round(skew * 2);
      if (i % 2 && pick < orbit.x * .4) {
        const scaleOptions = scale.map(pc => pitchNear((pc + s.root) % 12, pitch));
        pitch = scaleOptions.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      }
      lastLead = pitch;
      const accent = (i % 2 === 0 ? .12 : -.02) * breath.y;
      add(pitch, Math.min(start, 3.75), Math.min(4 / steps * gate, 3.8), .66 + accent + (touch() - .5) * .12 * breath.y, 'lead');
    }
  }
  const retained = new Set(frozen.filter(b => b < s.bars));
  let result = notes.filter(n => !retained.has(n.bar));
  if (previous) {
    result.push(...previous.notes.filter(n => retained.has(n.bar)).map(n => ({ ...n, duration: Math.min(n.duration, beats - n.start) })));
    for (const bar of retained) { if (previous.chords[bar]) chords[bar] = structuredClone(previous.chords[bar]); }
  }
  // Merge same-pitch retriggers across voices so MIDI and the browser sampler agree.
  result.sort((a, b) => a.start - b.start || b.velocity - a.velocity);
  const merged: Note[] = [];
  for (const n of result) {
    if (retained.has(n.bar)) { merged.push(n); continue; }
    const existing = merged.find(p => !retained.has(p.bar) && p.pitch === n.pitch && Math.abs(p.start - n.start) < .025);
    if (existing) { existing.duration = Math.max(existing.duration, n.duration); existing.velocity = Math.max(existing.velocity, n.velocity); if (n.voice === 'lead') existing.voice = 'lead'; }
    else merged.push({ ...n });
  }
  const byPitch = new Map<number, Note[]>();
  merged.forEach(n => byPitch.set(n.pitch, [...(byPitch.get(n.pitch) ?? []), n]));
  for (const lane of byPitch.values()) {
    lane.sort((a, b) => a.start - b.start);
    lane.forEach((n, i) => { const next = lane[i + 1]; if (next && !retained.has(n.bar)) n.duration = Math.min(n.duration, Math.max(.025, next.start - n.start - .008)); });
  }
  return { notes: merged.sort((a, b) => a.start - b.start || a.pitch - b.pitch), chords, beats, seed: s.seed };
}

export function mutateMaps(s: Settings, wide = false): Settings {
  const seed = freshSeed(), random = rng(seed);
  return { ...s, seed, maps: s.maps.map(m => m.locked ? { ...m } : {
    ...m, x: wide ? random() : clamp(m.x + (random() - .5) * m.radius * 2),
    y: wide ? random() : clamp(m.y + (random() - .5) * m.radius * 2),
  }) };
}

export function validateSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Snapshot, s = v.settings;
  if (!s || !Number.isInteger(s.seed) || !Number.isFinite(s.bpm) || s.bpm < 30 || s.bpm > 240 || ![2, 4, 8].includes(s.bars) || !Number.isInteger(s.root) || s.root < 0 || s.root > 11 || !Object.hasOwn(SCALES, s.mode)) return null;
  if (!Array.isArray(s.maps) || s.maps.length !== 5 || !s.maps.every(m => ['x', 'y', 'radius'].every(k => typeof m[k as keyof MapValue] === 'number' && Number.isFinite(m[k as keyof MapValue]) && Number(m[k as keyof MapValue]) >= 0 && Number(m[k as keyof MapValue]) <= 1) && typeof m.locked === 'boolean')) return null;
  if (!v.loop || v.loop.beats !== s.bars * 4 || !Array.isArray(v.loop.notes) || v.loop.notes.length > 10000 || !v.loop.notes.every(n => Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127 && Number.isFinite(n.start) && n.start >= 0 && n.start < v.loop.beats && Number.isFinite(n.duration) && n.duration > 0 && n.start + n.duration <= v.loop.beats + .01 && Number.isFinite(n.velocity) && n.velocity > 0 && n.velocity <= 1 && Number.isInteger(n.bar) && n.bar >= 0 && n.bar < s.bars && ['lead', 'chord', 'bass'].includes(n.voice))) return null;
  if (!Array.isArray(v.loop.chords) || v.loop.chords.length !== s.bars || !v.loop.chords.every(c => typeof c.name === 'string' && c.name.length < 32 && Array.isArray(c.pitches) && c.pitches.every(Number.isFinite) && Number.isFinite(c.root))) return null;
  if (!v.effects || !(['tone', 'space', 'volume'] as const).every(k => Number.isFinite(v.effects[k]) && v.effects[k] >= 0 && v.effects[k] <= 1) || typeof v.instrument !== 'string' || !Array.isArray(v.frozen) || !v.frozen.every(b => Number.isInteger(b) && b >= 0 && b < s.bars)) return null;
  if (!v.loop.notes.every(n => typeof n.id === 'string' && n.id.length < 128) || new Set(v.loop.notes.map(n => n.id)).size !== v.loop.notes.length) return null;
  return v;
}
