/** Self-hosted multisamples. All note names use scientific pitch: C4 = MIDI 60.
 * gain is a linear amplitude multiplier; release is in seconds.
 * Source versions, checksums, processing, and licenses: public/samples/SOURCES.json.
 */
export interface SampleInstrument {
  id: string;
  name: string;
  kind: 'sample';
  source: string;
  license: string;
  baseUrl: string;
  notes: Record<string, string>;
  gain: number;
  release: number;
}

export const sampleInstruments: SampleInstrument[] = [
  {
    "id": "grand-piano",
    "name": "Grand Piano",
    "kind": "sample",
    "source": "https://github.com/sfzinstruments/SalamanderGrandPiano",
    "license": "CC-BY-3.0",
    "baseUrl": "./samples/grand-piano/",
    "notes": {
      "C2": "C2.mp3",
      "D#2": "Ds2.mp3",
      "F#2": "Fs2.mp3",
      "A2": "A2.mp3",
      "C3": "C3.mp3",
      "D#3": "Ds3.mp3",
      "F#3": "Fs3.mp3",
      "A3": "A3.mp3",
      "C4": "C4.mp3",
      "D#4": "Ds4.mp3",
      "F#4": "Fs4.mp3",
      "A4": "A4.mp3",
      "C5": "C5.mp3",
      "D#5": "Ds5.mp3",
      "F#5": "Fs5.mp3",
      "A5": "A5.mp3",
      "C6": "C6.mp3"
    },
    "gain": 0.75,
    "release": 0.85
  },
  {
    "id": "fm-piano",
    "name": "FM Piano",
    "kind": "sample",
    "source": "https://github.com/sgossner/VCSL",
    "license": "CC0-1.0",
    "baseUrl": "./samples/fm-piano/",
    "notes": {
      "C2": "C2.mp3",
      "E2": "E2.mp3",
      "G#2": "Gs2.mp3",
      "C3": "C3.mp3",
      "E3": "E3.mp3",
      "G#3": "Gs3.mp3",
      "C4": "C4.mp3",
      "E4": "E4.mp3",
      "G#4": "Gs4.mp3",
      "C5": "C5.mp3",
      "E5": "E5.mp3",
      "G#5": "Gs5.mp3",
      "C6": "C6.mp3"
    },
    "gain": 0.65,
    "release": 0.65
  },
  {
    "id": "marimba",
    "name": "Marimba",
    "kind": "sample",
    "source": "https://github.com/sgossner/VCSL",
    "license": "CC0-1.0",
    "baseUrl": "./samples/marimba/",
    "notes": {
      "F2": "F2.mp3",
      "C3": "C3.mp3",
      "G3": "G3.mp3",
      "B3": "B3.mp3",
      "F4": "F4.mp3",
      "C5": "C5.mp3",
      "G5": "G5.mp3",
      "B5": "B5.mp3"
    },
    "gain": 0.65,
    "release": 0.6
  },
  {
    "id": "vibraphone",
    "name": "Vibraphone",
    "kind": "sample",
    "source": "https://github.com/sgossner/VCSL",
    "license": "CC0-1.0",
    "baseUrl": "./samples/vibraphone/",
    "notes": {
      "F3": "F3.mp3",
      "A3": "A3.mp3",
      "C4": "C4.mp3",
      "E4": "E4.mp3",
      "G4": "G4.mp3",
      "B4": "B4.mp3",
      "D5": "D5.mp3",
      "F5": "F5.mp3",
      "A5": "A5.mp3",
      "C6": "C6.mp3",
      "E6": "E6.mp3"
    },
    "gain": 0.6,
    "release": 1.2
  }
];
