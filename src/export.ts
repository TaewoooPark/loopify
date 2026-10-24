import * as MidiPackage from '@tonejs/midi';
const Midi: typeof MidiPackage.Midi = Reflect.get(MidiPackage, 'Midi') ?? Reflect.get(MidiPackage, 'default').Midi;
import { zipSync, strToU8 } from 'fflate';
import { type Snapshot } from './engine';

export function midiBytes(snapshot: Snapshot): Uint8Array {
  const midi = new Midi();
  midi.header.name = 'Loopify';
  midi.header.setTempo(snapshot.settings.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4], measures: 0 });
  const track = midi.addTrack(); track.name = 'Keys'; track.instrument.number = 0;
  for (const note of snapshot.loop.notes) track.addNote({ midi: note.pitch, ticks: Math.round(note.start * midi.header.ppq), durationTicks: Math.max(1, Math.round(note.duration * midi.header.ppq)), velocity: note.velocity });
  track.endOfTrackTicks = Math.round(snapshot.loop.beats * midi.header.ppq);
  return midi.toArray();
}

export function wavBytes(channels: Float32Array[], sampleRate: number): Uint8Array {
  const count = channels[0].length, bytes = count * channels.length * 3;
  const buffer = new ArrayBuffer(44 + bytes), view = new DataView(buffer);
  const string = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  string(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); string(8, 'WAVE'); string(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 3, true); view.setUint16(32, channels.length * 3, true); view.setUint16(34, 24, true);
  string(36, 'data'); view.setUint32(40, bytes, true);
  let peak = 1;
  channels.forEach(data => { for (const sample of data) peak = Math.max(peak, Math.abs(sample)); });
  const scale = peak > 1 ? .98 / peak : 1;
  let offset = 44;
  for (let i = 0; i < count; i++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[i] * scale));
    const sample = Math.round(value * (value < 0 ? 8388608 : 8388607));
    view.setUint8(offset++, sample & 255); view.setUint8(offset++, (sample >> 8) & 255); view.setUint8(offset++, (sample >> 16) & 255);
  }
  return new Uint8Array(buffer);
}

export function bundleBytes(snapshot: Snapshot, wav: Uint8Array, credits: string) {
  return zipSync({ 'loop.mid': midiBytes(snapshot), 'loop.wav': wav, 'loopify.json': strToU8(JSON.stringify(snapshot, null, 2)), 'CREDITS.txt': strToU8(credits) }, { level: 0 });
}

export function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([typeof bytes === 'string' ? bytes : bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
