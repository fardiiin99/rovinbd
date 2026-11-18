'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECTS, clipCues, cropFor, cueAt, distributeLines, formatShort, newCueId, parseSubtitles,
  parseTimestamp, sortCues, toSrt, toVtt, wrapText, type Aspect, type Cue,
} from '@/lib/subtitles';

type SubStyle = {
  size: number; // % of the shorter output side
  color: string;
  bold: boolean;
  outline: boolean;
  outlineColor: string;
  box: boolean;
  boxColor: string;
  boxOpacity: number; // 0..1
  position: number; // vertical centre of the text block, % from top
  uppercase: boolean;
};

const DEFAULT_STYLE: SubStyle = {
  size: 6, color: '#ffffff', bold: true, outline: true, outlineColor: '#000000',
  box: false, boxColor: '#000000', boxOpacity: 0.6, position: 80, uppercase: false,
};

const PRESETS: { name: string; style: Partial<SubStyle> }[] = [
  { name: 'Classic', style: { color: '#ffffff', outline: true, outlineColor: '#000000', box: false } },
  { name: 'Boxed', style: { color: '#ffffff', outline: false, box: true, boxColor: '#000000', boxOpacity: 0.65 } },
  { name: 'Yellow', style: { color: '#ffe600', outline: true, outlineColor: '#000000', box: false } },
  { name: 'Bold pop', style: { color: '#ffffff', outline: true, outlineColor: '#000000', box: false, uppercase: true, size: 8, position: 70 } },
];

const FONT = '"Hind Siliguri", "Noto Sans Bengali", "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const STYLE_KEY = 'clipper:style';

type AudioRig = { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; speaker: GainNode };
type ExportJob = { end: number; rec: MediaRecorder; cancelled: boolean };
type Result = { url: string; ext: string; size: number };

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  // Only take MP4 when it is H.264 — some browsers accept plain "video/mp4" but put
  // VP9 inside, which iPhones and Instagram handle badly. WebM is the fallback.
  const candidates = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function hexToRgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawSubtitle(ctx: CanvasRenderingContext2D, raw: string, W: number, H: number, s: SubStyle) {
  const text = s.uppercase ? raw.toUpperCase() : raw;
  const fontPx = Math.max(10, Math.round((Math.min(W, H) * s.size) / 100));
  ctx.font = `${s.bold ? 700 : 500} ${fontPx}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = wrapText(text, W * 0.86, (t) => ctx.measureText(t).width);
  const lineH = fontPx * 1.3;
  const blockH = lines.length * lineH;
  let top = (H * s.position) / 100 - blockH / 2;
  top = Math.max(H * 0.03, Math.min(H * 0.97 - blockH, top));
  const pad = fontPx * 0.35;
  lines.forEach((line, i) => {
    const y = top + lineH * (i + 0.5);
    if (s.box) {
      const w = ctx.measureText(line).width + pad * 2;
      ctx.fillStyle = hexToRgba(s.boxColor, s.boxOpacity);
      ctx.beginPath();
      ctx.roundRect(W / 2 - w / 2, y - lineH / 2, w, lineH, fontPx * 0.2);
      ctx.fill();
    }
    if (s.outline) {
      ctx.lineWidth = Math.max(2, fontPx * 0.16);
      ctx.strokeStyle = s.outlineColor;
      ctx.strokeText(line, W / 2, y);
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, W / 2, y);
  });
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TimeInput({ value, onChange, className = '' }: { value: number; onChange: (n: number) => void; className?: string }) {
  const [text, setText] = useState(formatShort(value));
  useEffect(() => setText(formatShort(value)), [value]);
  const commit = () => {
    const n = parseTimestamp(text);
    if (n === null) setText(formatShort(value));
    else onChange(n);
  };
  return (
    <input
      className={`input font-mono text-sm py-1.5 px-2 ${className}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label="Time (m:ss.s)"
    />
  );
}

export default function Clipper() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioRig | null>(null);
  const exportRef = useRef<ExportJob | null>(null);
  const stopAtRef = useRef<number | null>(null);

  const [videoUrl, setVideoUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [duration, setDuration] = useState(0);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [cues, setCues] = useState<Cue[]>([]);
  const [style, setStyle] = useState<SubStyle>(DEFAULT_STYLE);
  const [aspect, setAspect] = useState<Aspect>('original');
  const [panX, setPanX] = useState(0);
  const [burn, setBurn] = useState(true);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [scriptOpen, setScriptOpen] = useState(false);
  const [script, setScript] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mime, setMime] = useState('');

  useEffect(() => setMime(pickMime()), []);

  // Remember the subtitle style between visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STYLE_KEY);
      if (saved) setStyle({ ...DEFAULT_STYLE, ...JSON.parse(saved) });
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* ignore */ }
  }, [style]);

  // Cues are saved per video file name so a refresh doesn't lose work.
  const cuesKey = fileName ? `clipper:cues:${fileName}` : '';
  useEffect(() => {
    if (!cuesKey) return;
    try { localStorage.setItem(cuesKey, JSON.stringify(cues)); } catch { /* ignore */ }
  }, [cues, cuesKey]);

  const crop = useMemo(() => cropFor(dims.w, dims.h, aspect, panX), [dims, aspect, panX]);

  // The render loop reads the latest settings through this ref, and repaints when they change.
  const live = useRef({ cues, style, crop, burn });
  const dirty = useRef(true);
  useEffect(() => {
    live.current = { cues, style, crop, burn };
    dirty.current = true;
  }, [cues, style, crop, burn]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) return;

      const job = exportRef.current;
      if (job && !v.paused && (v.currentTime >= job.end || v.ended)) {
        v.pause();
        if (job.rec.state !== 'inactive') job.rec.stop();
      }
      if (!job && stopAtRef.current !== null && v.currentTime >= stopAtRef.current) {
        v.pause();
        stopAtRef.current = null;
      }
      if (v.paused && !dirty.current && !job) return;
      dirty.current = false;

      const { crop: cr, cues: cs, style: st, burn: b } = live.current;
      if (c.width !== cr.outW || c.height !== cr.outH) {
        c.width = cr.outW;
        c.height = cr.outH;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, c.width, c.height);
      if (b) {
        const cue = cueAt(cs, v.currentTime);
        if (cue && cue.text.trim()) drawSubtitle(ctx, cue.text, c.width, c.height, st);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      setError('That does not look like a video file.');
      return;
    }
    setError('');
    setResult(null);
    setFileName(file.name);
    let saved: Cue[] = [];
    try { saved = JSON.parse(localStorage.getItem(`clipper:cues:${file.name}`) || '[]'); } catch { /* ignore */ }
    setCues(Array.isArray(saved) ? saved : []);
    setVideoUrl(URL.createObjectURL(file));
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setClipStart(0);
    setClipEnd(d);
    setCurrent(0);
  };

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration || 0, t));
    setCurrent(v.currentTime);
  }, [duration]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    stopAtRef.current = null;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const playClip = async () => {
    const v = videoRef.current;
    if (!v) return;
    await seek(v, clipStart);
    stopAtRef.current = clipEnd;
    v.play().catch(() => {});
  };

  // ---- cue editing ----
  const updateCue = (id: string, patch: Partial<Cue>) =>
    setCues((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCue = (id: string) => setCues((cs) => cs.filter((c) => c.id !== id));
  const addCue = () => {
    const start = Math.round(current * 10) / 10;
    const end = duration ? Math.min(duration, start + 2.5) : start + 2.5;
    const cue = { id: newCueId(), start, end: end > start + 0.1 ? end : start + 2.5, text: '' };
    setCues((cs) => sortCues([...cs, cue]));
    setTimeout(() => document.getElementById(`cue-${cue.id}`)?.focus(), 50);
  };
  const sortedCues = useMemo(() => sortCues(cues), [cues]);
  const activeCue = cueAt(cues, current);

  const importSubs = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseSubtitles(await file.text());
    if (!parsed.length) {
      setError('No subtitles found in that file. Use .srt or .vtt.');
      return;
    }
    setError('');
    if (cues.length && !confirm(`Replace your ${cues.length} subtitle(s) with the ${parsed.length} from this file?\n\nOK = replace, Cancel = add them to the existing ones.`)) {
      setCues((cs) => sortCues([...cs, ...parsed]));
    } else setCues(parsed);
  };

  const applyScript = () => {
    const made = distributeLines(script, clipStart, clipEnd);
    if (!made.length) return;
    const outside = cues.filter((c) => c.end <= clipStart || c.start >= clipEnd);
    if (outside.length !== cues.length && !confirm('Replace the subtitles inside the clip with these lines?')) return;
    setCues(sortCues([...outside, ...made]));
    setScriptOpen(false);
    setScript('');
  };

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'clip';
  const clipLen = Math.max(0, clipEnd - clipStart);

  // ---- export ----
  const ensureAudio = (): AudioRig => {
    if (audioRef.current) return audioRef.current;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    // A media element can only be wired into one audio graph, so this is created once
    // and kept: the preview keeps playing through `speaker`, export records from `dest`.
    const source = ctx.createMediaElementSource(videoRef.current!);
    const speaker = ctx.createGain();
    source.connect(speaker).connect(ctx.destination);
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest);
    audioRef.current = { ctx, dest, speaker };
    return audioRef.current;
  };

  const startExport = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    if (!mime) {
      setError('This browser cannot record video. Use a recent Chrome, Edge or Safari.');
      return;
    }
    if (clipLen < 0.2) {
      setError('The clip is too short. Set a start and end first.');
      return;
    }
    setError('');
    setResult(null);
    setExporting(true);
    stopAtRef.current = null;
    v.pause();

    const rig = ensureAudio();
    await rig.ctx.resume();
    rig.speaker.gain.value = 0; // record the sound without playing it out loud
    await seek(v, clipStart);
    dirty.current = true;

    const fps = 30;
    const pixels = crop.outW * crop.outH;
    const bps = Math.round(Math.min(16e6, Math.max(2.5e6, pixels * fps * (quality === 'high' ? 0.2 : 0.1))));
    const videoStream = c.captureStream(fps);
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...rig.dest.stream.getAudioTracks()]);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 160_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    const job: ExportJob = { end: clipEnd, rec, cancelled: false };
    exportRef.current = job;

    try {
      rec.start(250);
      await v.play();
      await stopped;
    } catch (e) {
      job.cancelled = true;
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      if (rec.state !== 'inactive') rec.stop();
    } finally {
      v.pause();
      videoStream.getTracks().forEach((t) => t.stop());
      rig.speaker.gain.value = 1;
      exportRef.current = null;
      setExporting(false);
    }

    if (job.cancelled || !chunks.length) return;
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    setResult({ url: URL.createObjectURL(blob), ext: type === 'video/mp4' ? 'mp4' : 'webm', size: blob.size });
  };

  const cancelExport = () => {
    const job = exportRef.current;
    if (!job) return;
    job.cancelled = true;
    videoRef.current?.pause();
    if (job.rec.state !== 'inactive') job.rec.stop();
  };

  const exportProgress = exporting && clipLen ? Math.min(1, Math.max(0, (current - clipStart) / clipLen)) : 0;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%');

  return (
    <div className="space-y-6">
      {/* Kept mounted so the audio graph stays attached to one element. */}
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        className="hidden"
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={() => { dirty.current = true; }}
        onSeeked={() => { dirty.current = true; }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => { if (videoUrl) setError('This browser cannot play that video format. Try an MP4 (H.264) file.'); }}
      />

      {error && <div className="card p-3 text-sm text-red-700 border-red-200 bg-red-50">{error}</div>}

      {!videoUrl ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }}
          className={`card flex flex-col items-center justify-center text-center p-12 border-2 border-dashed cursor-pointer transition ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-stone-300 hover:border-brand-400'}`}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-stone-400" aria-hidden>
            <rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" />
          </svg>
          <div className="mt-3 font-semibold">Choose a video or drop it here</div>
          <div className="text-sm text-stone-500 mt-1">MP4, MOV or WebM</div>
          <input type="file" accept="video/*" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
      ) : (
        <>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
            {/* Preview + timeline */}
            <div className="card p-4 space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="truncate font-medium" title={fileName}>{fileName}</div>
                <label className={`btn btn-outline text-sm py-1.5 px-3 shrink-0 ${exporting ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  Change video
                  <input type="file" accept="video/*" className="sr-only" disabled={exporting} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>

              <div className="bg-stone-900 rounded-md flex items-center justify-center overflow-hidden">
                <canvas ref={canvasRef} className="block max-w-full max-h-[62vh]" onClick={exporting ? undefined : togglePlay} />
              </div>

              <div className="relative h-9">
                <div className="absolute inset-x-0 top-3 h-3 rounded bg-stone-200" />
                <div className="absolute top-3 h-3 rounded bg-brand-500/50" style={{ left: pct(clipStart), width: pct(clipLen) }} />
                {sortedCues.map((c) => (
                  <div key={c.id} className="absolute top-7 h-1.5 rounded bg-amber-500" style={{ left: pct(c.start), width: pct(Math.max(0.05, c.end - c.start)) }} />
                ))}
                <input
                  type="range" min={0} max={duration || 0} step={0.01} value={current}
                  disabled={exporting}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  className="absolute inset-x-0 top-1.5 w-full accent-brand-600 bg-transparent"
                  aria-label="Playhead"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary py-1.5 px-4" onClick={togglePlay} disabled={exporting}>{playing ? 'Pause' : 'Play'}</button>
                <button className="btn btn-outline py-1.5 px-2.5 text-sm" onClick={() => seekTo(current - 1)} disabled={exporting} title="Back 1 second">−1s</button>
                <button className="btn btn-outline py-1.5 px-2.5 text-sm" onClick={() => seekTo(current - 1 / 30)} disabled={exporting} title="Back 1 frame">◀ frame</button>
                <button className="btn btn-outline py-1.5 px-2.5 text-sm" onClick={() => seekTo(current + 1 / 30)} disabled={exporting} title="Forward 1 frame">frame ▶</button>
                <button className="btn btn-outline py-1.5 px-2.5 text-sm" onClick={() => seekTo(current + 1)} disabled={exporting} title="Forward 1 second">+1s</button>
                <span className="font-mono text-sm text-stone-600 ml-auto">{formatShort(current)} / {formatShort(duration)}</span>
              </div>

              <fieldset disabled={exporting} className="grid sm:grid-cols-2 gap-3 border-t border-stone-200 pt-4">
                <div>
                  <label className="label">Clip start</label>
                  <div className="flex gap-2">
                    <TimeInput value={clipStart} onChange={(t) => setClipStart(Math.max(0, Math.min(t, clipEnd - 0.1)))} />
                    <button className="btn btn-outline text-sm py-1.5 px-2.5 whitespace-nowrap" onClick={() => setClipStart(Math.min(current, clipEnd - 0.1))}>Set to playhead</button>
                  </div>
                </div>
                <div>
                  <label className="label">Clip end</label>
                  <div className="flex gap-2">
                    <TimeInput value={clipEnd} onChange={(t) => setClipEnd(Math.min(duration, Math.max(t, clipStart + 0.1)))} />
                    <button className="btn btn-outline text-sm py-1.5 px-2.5 whitespace-nowrap" onClick={() => setClipEnd(Math.max(current, clipStart + 0.1))}>Set to playhead</button>
                  </div>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-stone-600">Clip length: <b className="font-mono">{formatShort(clipLen)}</b></span>
                  <button className="btn btn-outline text-sm py-1.5 px-3" onClick={playClip}>▶ Play clip</button>
                  <button className="btn btn-ghost text-sm py-1.5 px-3" onClick={() => { setClipStart(0); setClipEnd(duration); }}>Use whole video</button>
                </div>
              </fieldset>
            </div>

            {/* Format + style */}
            <fieldset disabled={exporting} className="space-y-6 min-w-0">
              <div className="card p-4 space-y-3">
                <h2 className="font-semibold">Frame</h2>
                <div>
                  <label className="label">Aspect ratio</label>
                  <select className="input" value={aspect} onChange={(e) => { setAspect(e.target.value as Aspect); setPanX(0); }}>
                    {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {aspect !== 'original' && crop.sw < dims.w - 1 && (
                  <div>
                    <label className="label">Crop position (left ↔ right)</label>
                    <input type="range" min={-1} max={1} step={0.01} value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-full accent-brand-600" />
                  </div>
                )}
                <div className="text-xs text-stone-500">Output: {crop.outW} × {crop.outH}</div>
              </div>

              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Subtitle style</h2>
                  <label className="text-sm flex items-center gap-2">
                    <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} className="accent-brand-600" />
                    Show
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button key={p.name} className="btn btn-outline text-xs py-1 px-2.5" onClick={() => setStyle((s) => ({ ...s, ...p.style }))}>{p.name}</button>
                  ))}
                </div>
                <div>
                  <label className="label">Size</label>
                  <input type="range" min={3} max={12} step={0.25} value={style.size} onChange={(e) => setStyle({ ...style, size: Number(e.target.value) })} className="w-full accent-brand-600" />
                </div>
                <div>
                  <label className="label">Position (top ↕ bottom)</label>
                  <input type="range" min={5} max={95} step={1} value={style.position} onChange={(e) => setStyle({ ...style, position: Number(e.target.value) })} className="w-full accent-brand-600" />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="color" value={style.color} onChange={(e) => setStyle({ ...style, color: e.target.value })} className="h-7 w-9 rounded border border-stone-300" />
                    Text
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={style.bold} onChange={(e) => setStyle({ ...style, bold: e.target.checked })} className="accent-brand-600" />
                    Bold
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={style.outline} onChange={(e) => setStyle({ ...style, outline: e.target.checked })} className="accent-brand-600" />
                    Outline
                    <input type="color" value={style.outlineColor} onChange={(e) => setStyle({ ...style, outlineColor: e.target.value })} className="h-7 w-9 rounded border border-stone-300" />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ ...style, uppercase: e.target.checked })} className="accent-brand-600" />
                    CAPS
                  </label>
                  <label className="flex items-center gap-2 col-span-2">
                    <input type="checkbox" checked={style.box} onChange={(e) => setStyle({ ...style, box: e.target.checked })} className="accent-brand-600" />
                    Background
                    <input type="color" value={style.boxColor} onChange={(e) => setStyle({ ...style, boxColor: e.target.value })} className="h-7 w-9 rounded border border-stone-300" />
                    <input type="range" min={0.1} max={1} step={0.05} value={style.boxOpacity} onChange={(e) => setStyle({ ...style, boxOpacity: Number(e.target.value) })} className="flex-1 min-w-0 accent-brand-600" aria-label="Background opacity" />
                  </label>
                </div>
              </div>
            </fieldset>
          </div>

          {/* Subtitles */}
          <fieldset disabled={exporting} className="card p-4 space-y-4 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold mr-auto">Subtitles <span className="text-stone-400 font-normal">({cues.length})</span></h2>
              <button className="btn btn-primary text-sm py-1.5 px-3" onClick={addCue}>+ Add at playhead</button>
              <button className="btn btn-outline text-sm py-1.5 px-3" onClick={() => setScriptOpen((o) => !o)}>Paste script</button>
              <label className="btn btn-outline text-sm py-1.5 px-3 cursor-pointer">
                Import .srt / .vtt
                <input type="file" accept=".srt,.vtt,text/vtt" className="sr-only" onChange={(e) => { importSubs(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button className="btn btn-outline text-sm py-1.5 px-3" disabled={!cues.length} onClick={() => downloadText(toSrt(clipCues(cues, clipStart, clipEnd)), `${baseName}-clip.srt`)}>Download .srt</button>
              <button className="btn btn-outline text-sm py-1.5 px-3" disabled={!cues.length} onClick={() => downloadText(toVtt(clipCues(cues, clipStart, clipEnd)), `${baseName}-clip.vtt`)}>.vtt</button>
              <button className="btn btn-ghost text-sm py-1.5 px-3 text-red-600" disabled={!cues.length} onClick={() => { if (confirm('Delete all subtitles?')) setCues([]); }}>Clear</button>
            </div>

            {scriptOpen && (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
                <p className="text-sm text-stone-600">
                  Write or paste the words, one subtitle per line. They are spread across the clip
                  ({formatShort(clipStart)} – {formatShort(clipEnd)}) by length; fine-tune the times afterwards.
                </p>
                <textarea className="input min-h-32" value={script} onChange={(e) => setScript(e.target.value)} placeholder={'Our new bandana collection is here\nHandmade cotton, 6 colours\nOrder now — cash on delivery'} />
                <div className="flex gap-2">
                  <button className="btn btn-primary text-sm py-1.5 px-3" onClick={applyScript} disabled={!script.trim()}>Create subtitles</button>
                  <button className="btn btn-ghost text-sm py-1.5 px-3" onClick={() => setScriptOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {!sortedCues.length ? (
              <p className="text-sm text-stone-500">
                No subtitles yet. Move the playhead to where someone starts talking and press <b>Add at playhead</b>,
                paste a script, or import an .srt file.
              </p>
            ) : (
              <ul className="space-y-2">
                {sortedCues.map((c) => {
                  const outside = c.end <= clipStart || c.start >= clipEnd;
                  const active = activeCue?.id === c.id;
                  return (
                    <li key={c.id} className={`rounded-md border p-2.5 flex flex-col sm:flex-row gap-2 ${active ? 'border-brand-500 bg-brand-50' : 'border-stone-200'} ${outside ? 'opacity-50' : ''}`}>
                      <div className="flex sm:flex-col gap-1.5 shrink-0">
                        <div className="flex gap-1 items-center">
                          <TimeInput className="w-24" value={c.start} onChange={(t) => updateCue(c.id, { start: t, end: Math.max(c.end, t + 0.1) })} />
                          <button className="btn btn-ghost text-xs py-1 px-1.5" title="Start at playhead" onClick={() => updateCue(c.id, { start: current, end: Math.max(c.end, current + 0.1) })}>⏱</button>
                        </div>
                        <div className="flex gap-1 items-center">
                          <TimeInput className="w-24" value={c.end} onChange={(t) => updateCue(c.id, { end: Math.max(t, c.start + 0.1) })} />
                          <button className="btn btn-ghost text-xs py-1 px-1.5" title="End at playhead" onClick={() => updateCue(c.id, { end: Math.max(current, c.start + 0.1) })}>⏱</button>
                        </div>
                      </div>
                      <textarea
                        id={`cue-${c.id}`}
                        className="input flex-1 min-h-[4.5rem] text-sm"
                        value={c.text}
                        onChange={(e) => updateCue(c.id, { text: e.target.value })}
                        onFocus={() => { if (!playing) seekTo(c.start + 0.01); }}
                        placeholder="Subtitle text"
                      />
                      <div className="flex sm:flex-col gap-1.5 shrink-0">
                        <button className="btn btn-outline text-xs py-1 px-2" onClick={() => seekTo(c.start + 0.01)}>Go to</button>
                        <button className="btn btn-ghost text-xs py-1 px-2 text-red-600" onClick={() => removeCue(c.id)}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-stone-500">Times are m:ss.s on the original video. Subtitles are saved in this browser for this file name.</p>
          </fieldset>

          {/* Export */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold mr-auto">Export</h2>
              <select className="input py-1.5 text-sm" style={{ width: 'auto' }} value={quality} onChange={(e) => setQuality(e.target.value as 'standard' | 'high')} disabled={exporting}>
                <option value="high">High quality</option>
                <option value="standard">Smaller file</option>
              </select>
              {exporting ? (
                <button className="btn btn-outline" onClick={cancelExport}>Cancel</button>
              ) : (
                <button className="btn btn-primary" onClick={startExport} disabled={!mime || clipLen < 0.2}>Export clip ({formatShort(clipLen)})</button>
              )}
            </div>
            <p className="text-xs text-stone-500">
              {mime
                ? <>Saves as <b>{mime.startsWith('video/mp4') ? 'MP4' : 'WebM'}</b>, {crop.outW} × {crop.outH}{burn && cues.length ? ', with subtitles burned in' : ''}. Export plays the clip once in real time — keep this tab open and visible until it finishes.</>
                : 'This browser cannot record video. Use a recent Chrome, Edge or Safari.'}
            </p>
            {exporting && (
              <div>
                <div className="h-2 rounded bg-stone-200 overflow-hidden">
                  <div className="h-full bg-brand-600 transition-[width] duration-200" style={{ width: `${exportProgress * 100}%` }} />
                </div>
                <div className="text-xs text-stone-500 mt-1">Recording… {Math.round(exportProgress * 100)}%</div>
              </div>
            )}
            {result && (
              <div className="flex flex-col sm:flex-row gap-4 items-start border-t border-stone-200 pt-4">
                <video src={result.url} controls playsInline className="w-full sm:w-72 max-h-80 rounded bg-black" />
                <div className="space-y-2">
                  <div className="text-sm">Done — {(result.size / 1024 / 1024).toFixed(1)} MB {result.ext.toUpperCase()}</div>
                  <button className="btn btn-primary" onClick={() => download(result.url, `${baseName}-clip.${result.ext}`)}>Download video</button>
                  {result.ext === 'webm' && (
                    <p className="text-xs text-stone-500 max-w-xs">
                      WebM uploads fine to Facebook, YouTube and TikTok on the web. For MP4, export from a recent Chrome or Safari.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
