import { sampleInstruments, type SampleInstrument } from './sample-manifest';
import { type Effects, type Loop, type Note, clamp, rng } from './engine';

type SynthInstrument = { id: string; name: string; kind: 'synth'; wave: OscillatorType; attack: number; release: number; cutoff: number; gain: number; detune?: number; fm?: boolean };
export type Instrument = SampleInstrument | SynthInstrument;
export const instruments: Instrument[] = [...sampleInstruments,
  { id: 'soft-sine', name: 'Sine', kind: 'synth', wave: 'sine', attack: .012, release: .35, cutoff: 8000, gain: .48 },
  { id: 'buzzer', name: 'Buzzer', kind: 'synth', wave: 'square', attack: .006, release: .08, cutoff: 2400, gain: .19 },
  { id: 'pulse', name: 'Pulse', kind: 'synth', wave: 'square', attack: .015, release: .35, cutoff: 1100, gain: .22, detune: 5 },
  { id: 'analog', name: 'Analog', kind: 'synth', wave: 'sawtooth', attack: .02, release: .45, cutoff: 2200, gain: .23, detune: 7 },
  { id: 'pluck', name: 'Pluck', kind: 'synth', wave: 'triangle', attack: .004, release: .14, cutoff: 3200, gain: .42 },
  { id: 'glass', name: 'Glass', kind: 'synth', wave: 'sine', attack: .004, release: 1.0, cutoff: 6000, gain: .28, fm: true },
  { id: 'pad', name: 'Air', kind: 'synth', wave: 'triangle', attack: .24, release: 1.2, cutoff: 1700, gain: .32, detune: 8 },
  { id: 'warm-pad', name: 'Felt', kind: 'synth', wave: 'sine', attack: .07, release: .7, cutoff: 950, gain: .4, detune: 3 },
];
type Bank = { pitch: number; buffer: AudioBuffer }[];
type Voice = { start: number; end: number; stop: (when: number) => void };
type Bus = { input: GainNode; filter: BiquadFilterNode; wet: GainNode; master: GainNode; dispose: () => void };
const bankCache = new Map<string, Bank>();
const loading = new Map<string, Promise<Bank>>();
const getInstrument = (id: string) => instruments.find(i => i.id === id) ?? instruments[0];
function toMidi(name: string) { const m = name.match(/^([A-G])([#b]?)(-?\d+)$/)!; return ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)) + (Number(m[3]) + 1) * 12; }

async function bankFor(ctx: BaseAudioContext, instrument: Instrument): Promise<Bank> {
  if (instrument.kind !== 'sample') return [];
  if (bankCache.has(instrument.id)) return bankCache.get(instrument.id)!;
  if (loading.has(instrument.id)) return loading.get(instrument.id)!;
  const promise = Promise.all(Object.entries(instrument.notes).map(async ([name, file]) => {
    const response = await fetch(instrument.baseUrl + file);
    if (!response.ok) throw new Error(`Could not load ${instrument.name}.`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    return { pitch: toMidi(name), buffer };
  })).then(bank => { bankCache.set(instrument.id, bank); loading.delete(instrument.id); return bank; }).catch(error => { loading.delete(instrument.id); throw error; });
  loading.set(instrument.id, promise);
  return promise;
}

function makeBus(ctx: BaseAudioContext, effects: Effects): Bus {
  const input = ctx.createGain(), filter = ctx.createBiquadFilter(), master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor(), convolver = ctx.createConvolver(), wet = ctx.createGain();
  filter.type = 'lowpass'; filter.frequency.value = 800 * Math.pow(20, effects.tone); filter.Q.value = .3;
  master.gain.value = effects.volume * .65;
  compressor.threshold.value = -12; compressor.knee.value = 20; compressor.ratio.value = 4; compressor.attack.value = .003; compressor.release.value = .15;
  const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.8), ctx.sampleRate), random = rng(12987);
  for (let channel = 0; channel < 2; channel++) { const values = impulse.getChannelData(channel); for (let i = 0; i < values.length; i++) values[i] = (random() * 2 - 1) * Math.pow(1 - i / values.length, 3.5); }
  convolver.buffer = impulse; wet.gain.value = effects.space * .42;
  input.connect(filter); filter.connect(compressor); filter.connect(convolver); convolver.connect(wet); wet.connect(compressor); compressor.connect(master); master.connect(ctx.destination);
  return { input, filter, wet, master, dispose: () => [input, filter, master, compressor, convolver, wet].forEach(n => n.disconnect()) };
}

function playVoice(ctx: BaseAudioContext, bus: Bus, instrument: Instrument, bank: Bank, note: Note, time: number, length: number): Voice {
  const envelope = ctx.createGain(), filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = instrument.kind === 'synth' ? instrument.cutoff : 18000;
  envelope.connect(filter); filter.connect(bus.input);
  const sources: (AudioBufferSourceNode | OscillatorNode)[] = [], extra: AudioNode[] = [];
  const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
  const attack = instrument.kind === 'sample' ? .004 : instrument.attack;
  const release = instrument.release;
  const gain = instrument.gain * note.velocity * (instrument.kind === 'sample' ? 2.4 : instrument.detune ? .55 : 1);
  const end = time + Math.max(.025, length) + release;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(gain, time + Math.min(attack, length * .4));
  envelope.gain.setTargetAtTime(gain * (instrument.id === 'pluck' ? .18 : .72), time + attack + .015, instrument.id === 'pluck' ? .11 : .8);
  envelope.gain.setTargetAtTime(.00001, time + length, Math.max(.012, release / 5));
  envelope.gain.setValueAtTime(0, end);
  if (instrument.kind === 'sample') {
    const nearest = bank.reduce((a, b) => Math.abs(b.pitch - note.pitch) < Math.abs(a.pitch - note.pitch) ? b : a);
    const source = ctx.createBufferSource(); source.buffer = nearest.buffer; source.playbackRate.value = 2 ** ((note.pitch - nearest.pitch) / 12); source.connect(envelope); sources.push(source);
  } else {
    const osc = ctx.createOscillator(); osc.type = instrument.wave; osc.frequency.value = frequency; osc.connect(envelope); sources.push(osc);
    if (instrument.detune) {
      osc.detune.value = -instrument.detune;
      const other = ctx.createOscillator(); other.type = instrument.wave; other.frequency.value = frequency; other.detune.value = instrument.detune; other.connect(envelope); sources.push(other);
    }
    if (instrument.fm) {
      const mod = ctx.createOscillator(), depth = ctx.createGain(); mod.frequency.value = frequency * 3.01; depth.gain.setValueAtTime(frequency * 1.4, time); depth.gain.exponentialRampToValueAtTime(1, time + Math.max(.03, length)); mod.connect(depth); depth.connect(osc.frequency); sources.push(mod); extra.push(depth);
    }
  }
  let cleaned = false;
  const clean = () => { if (cleaned) return; cleaned = true; [...sources, ...extra, envelope, filter].forEach(n => { try { n.disconnect(); } catch { /* already released */ } }); };
  sources[0].onended = clean;
  sources.forEach(source => { source.start(time); source.stop(end + .02); });
  return { start: time, end, stop: when => {
    if (cleaned) return;
    envelope.gain.cancelScheduledValues(when); envelope.gain.setTargetAtTime(0, when, .008);
    sources.forEach(source => { try { source.stop(when + .035); } catch { /* ended */ } });
  } };
}

export class AudioEngine {
  context?: AudioContext;
  private bus?: Bus;
  private bank: Bank = [];
  private instrument: Instrument = instruments[0];
  private loop?: Loop;
  private bpm = 96;
  private origin = 0;
  private scheduledUntil = 0;
  private timer?: number;
  private voices: Voice[] = [];
  private loadToken = 0;
  playing = false;
  effects: Effects = { tone: .7, space: .16, volume: .72 };
  async initialize(id: string) {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();
    this.bus ??= makeBus(this.context, this.effects);
    const token = ++this.loadToken, instrument = getInstrument(id);
    const bank = await bankFor(this.context, instrument);
    if (token !== this.loadToken) return false;
    this.bank = bank; this.instrument = instrument;
    if (this.playing && this.loop) this.replace(this.loop, this.bpm);
    return true;
  }
  setEffects(effects: Effects) {
    this.effects = effects;
    if (!this.context || !this.bus) return;
    const now = this.context.currentTime;
    this.bus.filter.frequency.setTargetAtTime(800 * Math.pow(20, effects.tone), now, .025);
    this.bus.wet.gain.setTargetAtTime(effects.space * .42, now, .025);
    this.bus.master.gain.setTargetAtTime(effects.volume * .65, now, .025);
  }
  start(loop: Loop, bpm: number) {
    if (!this.context || !this.bus) return;
    this.stop(); this.loop = loop; this.bpm = bpm; this.origin = this.context.currentTime + .03; this.scheduledUntil = this.origin; this.playing = true;
    this.tick(); this.timer = window.setInterval(() => this.tick(), 25);
  }
  stop() {
    this.playing = false; window.clearInterval(this.timer);
    if (this.context) this.voices.forEach(voice => voice.stop(this.context!.currentTime));
    this.voices = [];
  }
  get beat() { return this.context && this.loop && this.playing ? Math.max(0, (this.context.currentTime - this.origin) * this.bpm / 60) % this.loop.beats : 0; }
  replace(loop: Loop, bpm: number) {
    if (!this.context || !this.playing) { this.loop = loop; this.bpm = bpm; return; }
    const beat = this.beat % loop.beats, now = this.context.currentTime + .008;
    this.voices.forEach(v => v.stop(this.context!.currentTime)); this.voices = [];
    this.loop = loop; this.bpm = bpm; this.origin = now - beat * 60 / bpm; this.scheduledUntil = now;
    for (const note of loop.notes) {
      if (note.start < beat && note.start + note.duration > beat + .02) this.voices.push(playVoice(this.context, this.bus!, this.instrument, this.bank, note, now, (note.start + note.duration - beat) * 60 / bpm));
    }
    this.tick();
  }
  private tick() {
    if (!this.playing || !this.context || !this.loop || !this.bus) return;
    const ctx = this.context, from = Math.max(this.scheduledUntil, ctx.currentTime), until = ctx.currentTime + .13;
    const duration = this.loop.beats * 60 / this.bpm;
    const firstCycle = Math.max(0, Math.floor((from - this.origin) / duration));
    const lastCycle = Math.max(firstCycle, Math.floor((until - this.origin) / duration));
    this.voices = this.voices.filter(v => v.end > ctx.currentTime);
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) for (const note of this.loop.notes) {
      const time = this.origin + cycle * duration + note.start * 60 / this.bpm;
      if (time >= from && time < until) this.voices.push(playVoice(ctx, this.bus, this.instrument, this.bank, note, time, note.duration * 60 / this.bpm));
    }
    this.scheduledUntil = until;
  }
  async audition(note: Note, id: string) {
    if (!this.context || this.instrument.id !== id) await this.initialize(id);
    if (this.context && this.bus) this.voices.push(playVoice(this.context, this.bus, this.instrument, this.bank, note, this.context.currentTime + .005, .45));
  }
  async render(loop: Loop, bpm: number, id: string, effects: Effects, tail = false): Promise<AudioBuffer> {
    const instrument = getInstrument(id), rate = 44100, length = loop.beats * 60 / bpm;
    // Render two preceding cycles for a stable reverb tail, then crop one exact loop.
    const warmup = tail ? 0 : 2, tailSeconds = tail ? 3 : 0;
    const frames = Math.round(((warmup + 1) * length + tailSeconds) * rate);
    const ctx = new OfflineAudioContext(2, frames, rate), bank = await bankFor(ctx, instrument), bus = makeBus(ctx, effects);
    for (let cycle = 0; cycle <= warmup; cycle++) for (const note of loop.notes) playVoice(ctx, bus, instrument, bank, note, cycle * length + note.start * 60 / bpm, note.duration * 60 / bpm);
    const rendered = await ctx.startRendering();
    const start = Math.round(warmup * length * rate), count = tail ? frames : Math.round(length * rate);
    const cropped = new AudioBuffer({ length: count, numberOfChannels: 2, sampleRate: rate });
    for (let c = 0; c < 2; c++) cropped.copyToChannel(rendered.getChannelData(c).subarray(start, start + count), c);
    return cropped;
  }
  dispose() { this.stop(); this.bus?.dispose(); void this.context?.close(); }
}
