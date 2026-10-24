import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Play, Pause, Shuffle, MoveUpRight, LockKeyhole, LockKeyholeOpen, Download, Undo2, Redo2, SlidersHorizontal, X, Bookmark, FolderOpen, Plus, Check, Volume2, LoaderCircle, ChevronDown, RotateCcw, Trash2 } from 'lucide-react';
import { AudioEngine, instruments } from './audio';
import { DEFAULT, ENGINE_VERSION, MAPS, PITCHES, clamp, freshSeed, generate, mutateMaps, noteName, validateSnapshot, type MapValue, type Note, type Settings, type Snapshot, type Effects } from './engine';
import { bundleBytes, download, midiBytes, wavBytes } from './export';
import { unzipSync, strFromU8 } from 'fflate';

const INITIAL: Snapshot = { settings: structuredClone(DEFAULT), loop: generate(DEFAULT), instrument: 'grand-piano', effects: { tone: .7, space: .16, volume: .72 }, frozen: [], version: ENGINE_VERSION };
function stored(): Snapshot { try { return validateSnapshot(JSON.parse(localStorage.getItem('loopify.current') ?? 'null')) ?? INITIAL; } catch { return INITIAL; } }
type Saved = { id: string; date: string; snapshot: Snapshot };
function storedSaves(): Saved[] { try { const data = JSON.parse(localStorage.getItem('loopify.saved') ?? '[]'); return Array.isArray(data) ? data.filter((v: Saved) => v && typeof v.id === 'string' && validateSnapshot(v.snapshot)).slice(0, 40) : []; } catch { return []; } }

function MapPad({ index, value, active, begin, change }: { index: number; value: MapValue; active: boolean; begin: () => void; change: (value: MapValue) => void }) {
  const meta = MAPS[index], pad = useRef<HTMLDivElement>(null), dragging = useRef(false);
  const position = (event: ReactPointerEvent) => {
    if (value.locked || !pad.current) return;
    const rect = pad.current.getBoundingClientRect();
    change({ ...value, x: clamp((event.clientX - rect.left - 18) / (rect.width - 36)), y: clamp(1 - (event.clientY - rect.top - 18) / (rect.height - 36)) });
  };
  return <section id={`map-${index}`} className={`map-card ${active ? 'is-active' : ''} ${value.locked ? 'is-locked' : ''}`} aria-label={meta.name}>
    <div className="map-tools">
      <button className="icon micro" aria-label={`Randomize ${meta.name}`} title={`Randomize ${meta.name}`} disabled={value.locked} onClick={() => { begin(); change({ ...value, x: crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296, y: crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 }); }}><Shuffle size={13}/></button>
      <button className={`icon micro ${value.locked ? 'selected' : ''}`} aria-label={`${value.locked ? 'Unlock' : 'Lock'} ${meta.name}`} aria-pressed={value.locked} title={`${value.locked ? 'Unlock' : 'Lock'} ${meta.name}`} onClick={() => { begin(); change({ ...value, locked: !value.locked }); }}>{value.locked ? <LockKeyhole size={13}/> : <LockKeyholeOpen size={13}/>}</button>
    </div>
    <span className="axis top">{meta.top}</span>
    <div ref={pad} className="map-pad" role="group" aria-label={`${meta.name} XY control`} onPointerDown={event => { if (value.locked) return; event.preventDefault(); begin(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); position(event); }} onPointerMove={event => { if (dragging.current) position(event); }} onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragging.current = false; }}>
      <div className="map-cross horizontal"/><div className="map-cross vertical"/>
      <div className="map-position" style={{ left: `calc(18px + (100% - 36px) * ${value.x})`, top: `calc(18px + (100% - 36px) * ${1 - value.y})` }}>
        <div className="map-radius" style={{ width: `${22 + value.radius * 145}px`, height: `${22 + value.radius * 145}px` }}/>
        <span className="map-point"/>
      </div>
      <input className="sr-only axis-input" type="range" min="0" max="100" step="1" value={Math.round(value.x * 100)} disabled={value.locked} aria-label={`${meta.name}: ${meta.left} to ${meta.right}`} onFocus={begin} onChange={e => change({ ...value, x: Number(e.target.value) / 100 })}/>
      <input className="sr-only axis-input" type="range" min="0" max="100" step="1" value={Math.round(value.y * 100)} disabled={value.locked} aria-label={`${meta.name}: ${meta.bottom} to ${meta.top}`} onFocus={begin} onChange={e => change({ ...value, y: Number(e.target.value) / 100 })}/>
    </div>
    <div className="axis ends"><span>{meta.left}</span><span>{meta.right}</span></div>
    <span className="axis bottom">{meta.bottom}</span>
  </section>;
}

function PianoRoll({ snapshot, audio, playing, toggleBar, editNote, begin }: { snapshot: Snapshot; audio: AudioEngine; playing: boolean; toggleBar: (bar: number) => void; editNote: (id: string, pitch: number, start: number) => void; begin: () => void }) {
  const surface = useRef<HTMLDivElement>(null), playhead = useRef<HTMLDivElement>(null), drag = useRef<{ id: string; x: number; y: number; pitch: number; start: number; width: number; height: number } | null>(null);
  const { loop, settings, frozen } = snapshot;
  const lowest = Math.min(...loop.notes.map(n => n.pitch), 48) - 2, highest = Math.max(...loop.notes.map(n => n.pitch), 76) + 2;
  const low = Math.floor(lowest / 12) * 12, high = Math.ceil(highest / 12) * 12;
  const rows = high - low + 1;
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (playhead.current) { playhead.current.style.left = `${audio.beat / loop.beats * 100}%`; playhead.current.style.opacity = playing ? '1' : '0'; }
      if (playing) frame = requestAnimationFrame(tick);
    }; tick(); return () => cancelAnimationFrame(frame);
  }, [audio, playing, loop.beats]);
  return <div className="sequence">
    <div className="bar-strip"><span className="pitch-spacer"/>{loop.chords.map((chord, index) => <button key={index} className={`bar-label ${frozen.includes(index) ? 'frozen' : ''}`} aria-label={`${frozen.includes(index) ? 'Unlock' : 'Lock'} bar ${index + 1}`} title={`${chord.name} · ${frozen.includes(index) ? 'Unlock' : 'Lock'} bar ${index + 1}`} onClick={() => toggleBar(index)}><span className="bar-count">{String(index + 1).padStart(2, '0')}</span><span className="chord-name">{chord.name}</span>{frozen.includes(index) && <LockKeyhole size={10}/>}</button>)}</div>
    <div className="roll-body">
      <div className="pitch-labels">{Array.from({ length: rows }, (_, i) => high - i).filter(p => p % 12 === 0).map(p => <span key={p} style={{ top: `${(high - p + .5) / rows * 100}%` }}>{noteName(p)}</span>)}</div>
      <div className="note-field" ref={surface} data-testid="piano-roll" style={{ '--bars': settings.bars, '--rows': rows } as React.CSSProperties} onPointerMove={event => {
        if (!drag.current) return;
        const d = drag.current;
        const pitch = clamp(d.pitch - Math.round((event.clientY - d.y) / d.height * rows), 28, 96);
        const start = clamp(Math.round((d.start + (event.clientX - d.x) / d.width * loop.beats) * 4) / 4, 0, loop.beats - .25);
        editNote(d.id, pitch, start);
      }} onPointerUp={event => { if (drag.current) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }}>
        {Array.from({ length: settings.bars + 1 }, (_, i) => <span className="bar-line" key={i} style={{ left: `${i / settings.bars * 100}%` }}/ >)}
        {Array.from({ length: rows }, (_, i) => high - i).filter(p => p % 12 === 0).map(p => <span key={p} className="octave-line" style={{ top: `${(high - p + 1) / rows * 100}%` }}/ >)}
        {frozen.map(bar => <span key={bar} className="frozen-area" style={{ left: `${bar / settings.bars * 100}%`, width: `${100 / settings.bars}%` }}/ >)}
        {loop.notes.map(note => <button key={note.id} className={`note ${note.voice} ${frozen.includes(note.bar) ? 'locked-note' : ''}`} aria-label={`${noteName(note.pitch)}, beat ${note.start + 1}`} title={`${noteName(note.pitch)} · ${note.duration.toFixed(2)} beats`} style={{ left: `${note.start / loop.beats * 100}%`, top: `${(high - note.pitch) / rows * 100}%`, width: `${Math.max(.16, note.duration / loop.beats * 100)}%`, height: `${Math.max(1.3, 78 / rows)}%` }} onPointerDown={event => {
          if (frozen.includes(note.bar) || !surface.current) return;
          event.preventDefault(); begin(); const rect = surface.current.getBoundingClientRect();
          drag.current = { id: note.id, x: event.clientX, y: event.clientY, pitch: note.pitch, start: note.start, width: rect.width, height: rect.height };
          surface.current.setPointerCapture(event.pointerId); if (!playing) void audio.audition(note, snapshot.instrument).catch(() => {});
        }} onKeyDown={event => {
          if (frozen.includes(note.bar)) return;
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); begin(); editNote(note.id, clamp(note.pitch + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0), 28, 96), clamp(note.start + (event.key === 'ArrowRight' ? .25 : event.key === 'ArrowLeft' ? -.25 : 0), 0, loop.beats - .25)); }
        }}/ >)}
        <div className="playhead" ref={playhead}><span/></div>
      </div>
    </div>
    <div className="beat-strip"><span className="pitch-spacer"/><div>{Array.from({ length: loop.beats }, (_, i) => <span key={i}>{i % 4 === 0 ? i / 4 + 1 : '·'}</span>)}</div></div>
  </div>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(stored), current = useRef(snapshot);
  const [audio] = useState(() => new AudioEngine());
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<'export' | 'sound' | 'saved' | 'about' | null>(null), [tail, setTail] = useState(false), [message, setMessage] = useState('');
  const [saved, setSaved] = useState<Saved[]>(storedSaves), [historySize, setHistorySize] = useState([0, 0]);
  const [activeMap, setActiveMap] = useState(0);
  const undo = useRef<Snapshot[]>([]), redo = useRef<Snapshot[]>([]), importRef = useRef<HTMLInputElement>(null), loadId = useRef(0), playId = useRef(0);
  current.current = snapshot;
  const announce = useCallback((text: string) => setMessage(text), []);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4200); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem('loopify.current', JSON.stringify(snapshot)); } catch { announce('Storage is full. Export a project to keep it.'); } }, 400); return () => clearTimeout(timer); }, [snapshot, announce]);
  useEffect(() => { audio.setEffects(snapshot.effects); }, [audio, snapshot.effects]);
  useEffect(() => { if (playing) audio.replace(snapshot.loop, snapshot.settings.bpm); }, [audio, playing, snapshot.loop, snapshot.settings.bpm]);
  useEffect(() => () => audio.stop(), [audio]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.focus();
    return () => previous?.focus();
  }, [panel]);
  const checkpoint = useCallback(() => { undo.current = [...undo.current.slice(-39), structuredClone(current.current)]; redo.current = []; setHistorySize([undo.current.length, 0]); }, []);
  const set = useCallback((next: Snapshot) => { current.current = next; setSnapshot(next); }, []);
  const updateSettings = (settings: Settings) => {
    const old = current.current, prior = old.settings;
    const regenerate = settings.seed !== prior.seed || settings.bars !== prior.bars || settings.root !== prior.root || settings.mode !== prior.mode || settings.maps.some((m, i) => m.x !== prior.maps[i].x || m.y !== prior.maps[i].y);
    set({ ...old, settings, loop: regenerate ? generate(settings, old.loop, old.frozen) : old.loop, frozen: old.frozen.filter(b => b < settings.bars), version: regenerate ? ENGINE_VERSION : old.version });
  };
  const restore = (direction: 'undo' | 'redo') => {
    const from = direction === 'undo' ? undo : redo, to = direction === 'undo' ? redo : undo;
    const next = from.current.pop(); if (!next) return;
    const previousInstrument = current.current.instrument;
    to.current.push(structuredClone(current.current)); set(next); setHistorySize([undo.current.length, redo.current.length]);
    if (next.instrument !== previousInstrument) void selectInstrument(next.instrument, false);
  };
  async function togglePlay() {
    if (playing || loading) { playId.current++; audio.stop(); setPlaying(false); setLoading(false); return; }
    const request = ++playId.current;
    setLoading(true);
    try {
      const ready = await audio.initialize(current.current.instrument);
      if (!ready || request !== playId.current) return;
      audio.setEffects(current.current.effects); audio.start(current.current.loop, current.current.settings.bpm); setPlaying(true);
    } catch (error) { announce(error instanceof Error ? error.message : 'Audio could not start.'); }
    finally { if (request === playId.current) setLoading(false); }
  }
  async function selectInstrument(id: string, record = true) {
    if (record) checkpoint();
    const request = ++loadId.current; setLoading(true);
    try {
      const ready = await audio.initialize(id);
      if (!ready || request !== loadId.current) return;
      set({ ...current.current, instrument: id });
    } catch (error) { announce(error instanceof Error ? error.message : 'Instrument unavailable.'); }
    finally { if (request === loadId.current) setLoading(false); }
  }
  const regenerate = (kind: 'new' | 'near' | 'wide') => {
    checkpoint(); const old = current.current.settings;
    updateSettings(kind === 'new' ? { ...old, seed: freshSeed() } : mutateMaps(old, kind === 'wide'));
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, textarea, [role="dialog"]')) return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); regenerate(event.shiftKey ? 'wide' : 'new'); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); }
      if (event.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const editNote = (id: string, pitch: number, start: number) => {
    const old = current.current, targetBar = Math.floor(start / 4);
    if (old.frozen.includes(targetBar)) return;
    set({ ...old, loop: { ...old.loop, notes: old.loop.notes.map(n => n.id === id ? { ...n, pitch, start, bar: targetBar, duration: Math.min(n.duration, old.loop.beats - start) } : n) } });
  };
  const toggleBar = (bar: number) => { checkpoint(); const old = current.current; set({ ...old, frozen: old.frozen.includes(bar) ? old.frozen.filter(b => b !== bar) : [...old.frozen, bar] }); };
  const changeGlobal = (patch: Partial<Settings>) => { checkpoint(); updateSettings({ ...current.current.settings, ...patch }); };
  const changeEffect = (patch: Partial<Effects>) => set({ ...current.current, effects: { ...current.current.effects, ...patch } });
  const persistSaved = (values: Saved[]) => { setSaved(values); try { localStorage.setItem('loopify.saved', JSON.stringify(values)); } catch { announce('Storage is full. Export a project to keep it.'); } };
  async function exportFile(format: 'midi' | 'wav' | 'zip' | 'json') {
    const value = structuredClone(current.current), name = `loopify-${value.settings.bpm}-${value.settings.seed.toString(36)}`;
    setBusy(format);
    try {
      if (format === 'midi') download(midiBytes(value), name + '.mid', 'audio/midi');
      else if (format === 'json') download(JSON.stringify(value, null, 2), name + '.json', 'application/json');
      else {
        const buffer = await audio.render(value.loop, value.settings.bpm, value.instrument, value.effects, tail);
        const bytes = wavBytes([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate);
        if (format === 'wav') download(bytes, name + '.wav', 'audio/wav');
        else { const credits = await fetch('./SAMPLE-CREDITS.txt'); if (!credits.ok) throw new Error('Credits unavailable. Please retry.'); download(bundleBytes(value, bytes, await credits.text()), name + '.zip', 'application/zip'); }
      }
      announce('Exported.');
    } catch (error) { announce(error instanceof Error ? error.message : 'Export failed. Please retry.'); }
    finally { setBusy(null); }
  }
  async function importFile(file: File) {
    try {
      if (file.size > 80000000) throw new Error('Project is too large.');
      let text: string;
      if (file.name.toLowerCase().endsWith('.zip')) {
        const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => entry.name === 'loopify.json' && entry.originalSize < 3000000 });
        if (!files['loopify.json']) throw new Error('No Loopify project in this ZIP.');
        text = strFromU8(files['loopify.json']);
      } else { if (file.size > 3000000) throw new Error('Project is too large.'); text = await file.text(); }
      const next = validateSnapshot(JSON.parse(text));
      if (!next) throw new Error('Invalid Loopify project.');
      if (!instruments.some(i => i.id === next.instrument)) throw new Error('This instrument is unavailable.');
      checkpoint(); await audio.initialize(next.instrument); set(next); announce('Loaded.');
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not open project.'); }
  }
  const selectedInstrument = instruments.find(i => i.id === snapshot.instrument) ?? instruments[0];
  return <main className="app-shell">
    <header className="toolbar">
      <div className="toolbar-left">
        <button className={`play-button ${playing ? 'playing' : ''}`} aria-label={loading ? 'Cancel loading' : playing ? 'Pause' : 'Play'} title="Play / pause · Space" onClick={() => void togglePlay()}>{loading ? <LoaderCircle className="spin" size={18}/> : playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button>
        <label className="bpm-control"><input aria-label="Tempo" type="number" inputMode="numeric" min="30" max="240" value={snapshot.settings.bpm} onChange={e => { const n = Number(e.target.value); if (n >= 30 && n <= 240) changeGlobal({ bpm: n }); }}/><span>BPM</span></label>
        <span className="divider"/>
        <select aria-label="Key" value={snapshot.settings.root} onChange={e => changeGlobal({ root: Number(e.target.value) })}>{PITCHES.map((p, i) => <option key={i} value={i}>{p}</option>)}</select>
        <select aria-label="Mode" value={snapshot.settings.mode} onChange={e => changeGlobal({ mode: e.target.value as Settings['mode'] })}><option value="minor">Minor</option><option value="major">Major</option><option value="dorian">Dorian</option><option value="mixolydian">Mixolydian</option></select>
        <span className="divider"/>
        <select aria-label="Loop length" value={snapshot.settings.bars} onChange={e => changeGlobal({ bars: Number(e.target.value) })}>{[2, 4, 8].map(n => <option key={n} value={n}>{n} bars</option>)}</select>
      </div>
      <div className="toolbar-right">
        <button className="icon" aria-label="Undo" title="Undo · ⌘Z" disabled={!historySize[0]} onClick={() => restore('undo')}><Undo2 size={16}/></button>
        <button className="icon" aria-label="Redo" title="Redo · ⇧⌘Z" disabled={!historySize[1]} onClick={() => restore('redo')}><Redo2 size={16}/></button>
        <span className="divider"/>
        <button className={`icon ${panel === 'saved' ? 'selected' : ''}`} aria-label="Saved loops" title="Saved loops" onClick={() => setPanel(panel === 'saved' ? null : 'saved')}><Bookmark size={16}/></button>
        <button className="icon" aria-label="Export" title="Export" onClick={() => setPanel(panel === 'export' ? null : 'export')}><Download size={17}/></button>
      </div>
    </header>

    <PianoRoll snapshot={snapshot} audio={audio} playing={playing} toggleBar={toggleBar} editNote={editNote} begin={checkpoint}/>

    <div className="middle-toolbar">
      <div className="sound-control"><span className="sound-status"/><div className="instrument-select"><select aria-label="Instrument" value={snapshot.instrument} onChange={event => void selectInstrument(event.target.value)}>{instruments.map(i => <option value={i.id} key={i.id}>{i.name}</option>)}</select><ChevronDown size={12}/></div><button className={`icon small ${panel === 'sound' ? 'selected' : ''}`} aria-label="Sound settings" title="Sound settings" onClick={() => setPanel(panel === 'sound' ? null : 'sound')}><SlidersHorizontal size={14}/></button></div>
      <div className="generate-controls"><button className="text-button subtle" aria-label="Vary" title="Vary unlocked maps nearby" onClick={() => regenerate('near')}><span className="action-label">Vary</span><MoveUpRight size={15}/></button><button className="text-button" aria-label="Generate" title="New loop · R" onClick={() => regenerate('new')}><Shuffle size={16}/><span className="action-label">Generate</span></button><button className="icon small" aria-label="Explore all unlocked maps" title="Explore · Shift R" onClick={() => regenerate('wide')}><RotateCcw size={16}/></button></div>
    </div>

    <div className="maps-area"><div className="maps">{snapshot.settings.maps.map((value, index) => <MapPad key={index} index={index} active={index === activeMap} value={value} begin={checkpoint} change={value => {
      const old = current.current.settings; const maps = old.maps.map((m, i) => i === index ? value : m);
      updateSettings({ ...old, maps });
    }}/>)}</div><nav className="map-nav" aria-label="Maps">{MAPS.map((map, index) => <button key={map.name} aria-label={`Show ${map.name} map`} aria-pressed={activeMap === index} aria-controls={`map-${index}`} title={map.name} onClick={() => setActiveMap(index)} onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); const next = (index + (event.key === 'ArrowRight' ? 1 : 4)) % 5;
      setActiveMap(next); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
    }}><span>{String(index + 1).padStart(2, '0')}</span>{snapshot.settings.maps[index].locked && <LockKeyhole size={10}/>}</button>)}</nav></div>

    <footer className="footer"><span className="seed">{snapshot.settings.seed.toString(16).padStart(8, '0')}</span><div className="volume"><Volume2 size={13}/><input type="range" min="0" max="1" step=".01" aria-label="Volume" value={snapshot.effects.volume} onChange={event => changeEffect({ volume: Number(event.target.value) })}/></div><div className="footer-links"><a href="./SAMPLE-CREDITS.txt" target="_blank" rel="noreferrer">Credits</a><button onClick={() => setPanel('about')}>About</button></div></footer>

    {panel && <div className="panel-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setPanel(null); }}><aside className={`floating-panel ${panel}`} role="dialog" aria-modal="true" aria-label={panel === 'sound' ? 'Sound settings' : panel === 'saved' ? 'Saved loops' : panel === 'about' ? 'About Loopify' : 'Export'} onKeyDown={event => {
      if (event.key === 'Escape') setPanel(null);
      if (event.key === 'Tab') {
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)');
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="panel-heading"><span>{panel === 'sound' ? selectedInstrument.name : panel === 'saved' ? 'Saved' : panel === 'about' ? 'About' : 'Export'}</span><button className="icon small" aria-label="Close" onClick={() => setPanel(null)}><X size={16}/></button></div>
      {panel === 'about' && <><div className="about-wordmark">loopify.</div><p className="about-copy">A small instrument for finding your next loop. Move through harmony, space, pulse, orbit and breath. Keep what speaks to you.</p><p className="about-copy">Music theory, seeded variation and Web Audio. Everything runs in your browser. Export notes as MIDI, sound as WAV, or both together.</p><div className="about-person"><strong>Made by Taewoo Park</strong><p className="about-copy">Aligning physics, code, and culture toward a civilization-scale solution.</p><div className="about-links"><a href="https://taewoopark.com" target="_blank" rel="noreferrer">Website ↗</a><a href="https://github.com/TaewoooPark" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://github.com/TaewoooPark/loopify" target="_blank" rel="noreferrer">Source ↗</a></div></div></>}
      {panel === 'export' && <><div className="export-options">{(['midi', 'wav', 'zip', 'json'] as const).map(type => <button disabled={!!busy} key={type} onClick={() => void exportFile(type)}><span>{type === 'json' ? 'Project' : type.toUpperCase()}</span>{busy === type ? <LoaderCircle className="spin" size={15}/> : <Download size={14}/>}</button>)}</div><label className="check-row"><input type="checkbox" checked={tail} onChange={e => setTail(e.target.checked)}/>Include tail</label><span className="panel-meta">WAV · 44.1 kHz / 24-bit</span></>}
      {panel === 'sound' && <><label className="slider-row"><span>Tone</span><input type="range" min="0" max="1" step=".01" value={snapshot.effects.tone} onPointerDown={checkpoint} onChange={e => changeEffect({ tone: Number(e.target.value) })}/></label><label className="slider-row"><span>Space</span><input type="range" min="0" max="1" step=".01" value={snapshot.effects.space} onPointerDown={checkpoint} onChange={e => changeEffect({ space: Number(e.target.value) })}/></label><div className="radius-controls">{MAPS.map((m, i) => <label className="slider-row" key={m.name}><span>{m.name}</span><input aria-label={`${m.name} variation range`} type="range" min="0" max=".5" step=".01" value={snapshot.settings.maps[i].radius} disabled={snapshot.settings.maps[i].locked} onPointerDown={checkpoint} onChange={e => { const s = current.current.settings; updateSettings({ ...s, maps: s.maps.map((map, index) => index === i ? { ...map, radius: Number(e.target.value) } : map) }); }}/></label>)}</div></>}
      {panel === 'saved' && <><div className="save-actions"><button className="text-button" onClick={() => { persistSaved([{ id: crypto.randomUUID(), date: new Date().toISOString(), snapshot: structuredClone(current.current) }, ...saved].slice(0, 40)); announce('Saved.'); }}><Plus size={14}/>Save</button><button className="icon" aria-label="Open project" title="Open project" onClick={() => importRef.current?.click()}><FolderOpen size={17}/></button></div><div className="saved-list">{saved.map(item => <div className="saved-row" key={item.id}><button onClick={async () => { checkpoint(); try { await audio.initialize(item.snapshot.instrument); set(structuredClone(item.snapshot)); setPanel(null); } catch { announce('Could not load instrument.'); } }}><span>{PITCHES[item.snapshot.settings.root]} {item.snapshot.settings.mode}</span><span>{item.snapshot.settings.bpm} · {item.snapshot.settings.bars} bars</span></button><button className="icon small" aria-label="Delete saved loop" onClick={() => persistSaved(saved.filter(v => v.id !== item.id))}><Trash2 size={13}/></button></div>)}</div></>}
    </aside></div>}
    <input ref={importRef} type="file" accept=".json,.zip,application/json,application/zip" className="sr-only" aria-label="Import project file" onChange={e => { if (e.target.files?.[0]) void importFile(e.target.files[0]); e.target.value = ''; }}/>
    <div className={`toast ${message ? 'visible' : ''}`} role="status">{message && <><Check size={13}/>{message}</>}</div>
  </main>;
}
