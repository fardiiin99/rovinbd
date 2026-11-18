'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECTS, clipCues, coverRect, cueAt, distributeLines, formatShort, newCueId, outputSize, parseSubtitles,
  parseTimestamp, sortCues, toSrt, toVtt, wrapText, type Aspect, type Cue, type Word,
} from '@/lib/subtitles';
import { groupCaptions, pickClips, type AutoClip, type Energy } from '@/lib/autoclip';
import { transcribeFile, WHISPER_MODELS, whisperEngine, type ModelId, type Progress, type SpeechEngine } from './transcribe';
import { buildTrack, cropFraction, panForCenter, trackX, type FaceSample, type Track } from '@/lib/reframe';
import { loadMediapipe, scanFaces, type FaceDetectorLoader } from './facetrack';

type FaceScan = { start: number; end: number; samples: FaceSample[] };
type Range = { start: number; end: number };

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
  highlight: boolean; // colour the word being spoken (auto captions)
  highlightColor: string;
  animate: boolean; // pop each caption in
};

const DEFAULT_STYLE: SubStyle = {
  size: 7, color: '#ffffff', bold: true, outline: true, outlineColor: '#000000',
  box: false, boxColor: '#000000', boxOpacity: 0.6, position: 72, uppercase: true,
  highlight: true, highlightColor: '#ffd60a', animate: true,
};

const PRESETS: { name: string; style: Partial<SubStyle> }[] = [
  { name: 'Pop', style: { color: '#ffffff', outline: true, outlineColor: '#000000', box: false, uppercase: true, highlight: true, highlightColor: '#ffd60a', animate: true, size: 7.5 } },
  { name: 'Green pop', style: { color: '#ffffff', outline: true, outlineColor: '#000000', box: false, uppercase: true, highlight: true, highlightColor: '#4ade80', animate: true, size: 7.5 } },
  { name: 'Boxed', style: { color: '#ffffff', outline: false, box: true, boxColor: '#000000', boxOpacity: 0.65, uppercase: false, highlight: true, highlightColor: '#ffd60a', animate: false, size: 6 } },
  { name: 'Classic', style: { color: '#ffffff', outline: true, outlineColor: '#000000', box: false, uppercase: false, highlight: false, animate: false, size: 6 } },
];

type Layout = 'fill' | 'fit' | 'split';
const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: 'fill', label: 'Fill', hint: 'Crop to fill the frame' },
  { value: 'fit', label: 'Fit + blur', hint: 'Whole video, blurred copy behind' },
  { value: 'split', label: 'Split screen', hint: 'Video on top, background clip below' },
];

const LENGTHS = [
  { key: 'short', label: '15–30s', min: 15, max: 30 },
  { key: 'mid', label: '30–60s', min: 30, max: 60 },
  { key: 'long', label: '60–90s', min: 60, max: 90 },
  { key: 'custom', label: 'Custom', min: 0, max: 0 },
] as const;
type LengthKey = (typeof LENGTHS)[number]['key'];

const FONT = '"Montserrat", "Hind Siliguri", "Noto Sans Bengali", "Noto Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const STYLE_KEY = 'clipper:style';

type AudioRig = { ctx: AudioContext; dest: MediaStreamAudioDestinationNode; speaker: GainNode };
type ExportJob = { end: number; rec: MediaRecorder; cancelled: boolean };
type Result = { url: string; ext: string; size: number };
type TranscriptState = { words: Word[]; energy?: Energy };

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

function setFont(ctx: CanvasRenderingContext2D, W: number, H: number, s: SubStyle) {
  const fontPx = Math.max(10, Math.round((Math.min(W, H) * s.size) / 100));
  ctx.font = `${s.bold ? 800 : 500} ${fontPx}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  return fontPx;
}

function blockTop(H: number, blockH: number, s: SubStyle) {
  const top = (H * s.position) / 100 - blockH / 2;
  return Math.max(H * 0.03, Math.min(H * 0.97 - blockH, top));
}

/** Plain caption: whole text in one colour. */
function drawPlain(ctx: CanvasRenderingContext2D, raw: string, W: number, H: number, s: SubStyle) {
  const text = s.uppercase ? raw.toUpperCase() : raw;
  const fontPx = setFont(ctx, W, H, s);
  ctx.textAlign = 'center';
  const lines = wrapText(text, W * 0.86, (t) => ctx.measureText(t).width);
  const lineH = fontPx * 1.3;
  const top = blockTop(H, lines.length * lineH, s);
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
      ctx.lineWidth = Math.max(2, fontPx * 0.18);
      ctx.strokeStyle = s.outlineColor;
      ctx.strokeText(line, W / 2, y);
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, W / 2, y);
  });
}

/** Word-by-word caption: the word being spoken is drawn in the highlight colour. */
function drawKaraoke(ctx: CanvasRenderingContext2D, words: Word[], t: number, W: number, H: number, s: SubStyle) {
  const fontPx = setFont(ctx, W, H, s);
  ctx.textAlign = 'left';
  const texts = words.map((w) => (s.uppercase ? w.text.toUpperCase() : w.text));
  const widths = texts.map((x) => ctx.measureText(x).width);
  const space = ctx.measureText(' ').width;
  const maxW = W * 0.86;
  const lines: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  texts.forEach((_, i) => {
    const add = cur.length ? space + widths[i] : widths[i];
    if (cur.length && curW + add > maxW) { lines.push(cur); cur = [i]; curW = widths[i]; }
    else { cur.push(i); curW += add; }
  });
  if (cur.length) lines.push(cur);

  let active = -1;
  words.forEach((w, i) => { if (t >= w.start - 0.02) active = i; });

  const lineH = fontPx * 1.3;
  const top = blockTop(H, lines.length * lineH, s);
  const pad = fontPx * 0.35;
  lines.forEach((idx, li) => {
    const y = top + lineH * (li + 0.5);
    const total = idx.reduce((a, i) => a + widths[i], 0) + space * (idx.length - 1);
    let x = W / 2 - total / 2;
    if (s.box) {
      ctx.fillStyle = hexToRgba(s.boxColor, s.boxOpacity);
      ctx.beginPath();
      ctx.roundRect(x - pad, y - lineH / 2, total + pad * 2, lineH, fontPx * 0.2);
      ctx.fill();
    }
    for (const i of idx) {
      if (s.outline) {
        ctx.lineWidth = Math.max(2, fontPx * 0.18);
        ctx.strokeStyle = s.outlineColor;
        ctx.strokeText(texts[i], x, y);
      }
      ctx.fillStyle = i === active ? s.highlightColor : s.color;
      ctx.fillText(texts[i], x, y);
      x += widths[i] + space;
    }
  });
}

function drawCaption(ctx: CanvasRenderingContext2D, cue: Cue, t: number, W: number, H: number, s: SubStyle) {
  ctx.save();
  if (s.animate) {
    // Pop in over the first 150 ms.
    const p = Math.max(0, Math.min(1, (t - cue.start) / 0.15));
    const k = 0.8 + 0.2 * (1 - (1 - p) * (1 - p));
    const ax = W / 2;
    const ay = (H * s.position) / 100;
    ctx.translate(ax, ay);
    ctx.scale(k, k);
    ctx.translate(-ax, -ay);
  }
  const words = cue.words;
  const wordsMatch = words?.length && words.map((w) => w.text).join(' ') === cue.text.trim();
  if (s.highlight && wordsMatch) drawKaraoke(ctx, words!, t, W, H, s);
  else drawPlain(ctx, cue.text, W, H, s);
  ctx.restore();
}

/** Default save: a normal browser download. Hosts that block those can pass their own. */
async function browserSave(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Ask = { message: string; yesLabel: string; noLabel?: string; onYes: () => void; onNo?: () => void };

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

function ScorePill({ score }: { score: number }) {
  const tone = score >= 70 ? 'bg-emerald-100 text-emerald-800' : score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-700';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${tone}`}>Score {score}</span>;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 rounded bg-stone-200 overflow-hidden">
      <div className="h-full bg-brand-600 transition-[width] duration-200" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export type ClipperProps = {
  /** Saves a generated file. Defaults to a browser download. */
  saveFile?: (blob: Blob, name: string) => Promise<void>;
  /** 'copy' puts .srt/.vtt text on the clipboard instead of saving a file. */
  subtitleExport?: 'download' | 'copy';
  /** Speech-to-text engine; defaults to in-browser Whisper. */
  speechEngine?: SpeechEngine;
  /** When set, speech and face features (which download models) are switched off and this explains why. */
  modelsUnavailable?: string;
  /** Face detector; defaults to MediaPipe in the browser. */
  faceLoader?: FaceDetectorLoader;
};

export default function Clipper({
  saveFile = browserSave, subtitleExport = 'download', speechEngine = whisperEngine, modelsUnavailable,
  faceLoader = loadMediapipe,
}: ClipperProps = {}) {
  const speechUnavailable = modelsUnavailable;
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blurRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<AudioRig | null>(null);
  const exportRef = useRef<ExportJob | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batchCancelRef = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);

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
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [layout, setLayout] = useState<Layout>('fill');
  const [bgUrl, setBgUrl] = useState('');
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
  const [ask, setAsk] = useState<Ask | null>(null);
  const [notice, setNotice] = useState('');

  // Auto clips
  const [clipCount, setClipCount] = useState(3);
  const [lengthKey, setLengthKey] = useState<LengthKey>('mid');
  const [customMin, setCustomMin] = useState(20);
  const [customMax, setCustomMax] = useState(45);
  const [model, setModel] = useState<ModelId>('Xenova/whisper-base.en');
  const [transcript, setTranscript] = useState<TranscriptState | null>(null);
  const [busy, setBusy] = useState<'' | 'clips' | 'captions' | 'faces'>('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [clips, setClips] = useState<AutoClip[]>([]);
  const [activeClip, setActiveClip] = useState('');
  const [clipResults, setClipResults] = useState<Record<string, Result>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  // Auto reframe (face tracking)
  const [reframe, setReframe] = useState(true);
  const [faceScans, setFaceScans] = useState<FaceScan[]>([]);
  const faceScansRef = useRef<FaceScan[]>([]);
  const [faceProgress, setFaceProgress] = useState<{ value: number; text: string } | null>(null);
  const faceAbortRef = useRef<AbortController | null>(null);

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

  const out = useMemo(() => outputSize(aspect, dims.w, dims.h), [aspect, dims]);

  // How much of the source width the crop keeps; face following only matters when it crops.
  const cropW = useMemo(
    () => cropFraction(dims.w, dims.h, out.w, layout === 'split' ? Math.round(out.h / 2) : out.h),
    [dims, out, layout],
  );
  const needsReframe = aspect !== 'original' && layout !== 'fit' && cropW < 0.98;
  const follow = reframe && needsReframe && !modelsUnavailable;
  const tracks = useMemo(
    () => faceScans.map((s) => ({ start: s.start, end: s.end, track: buildTrack(s.samples, { cropW }) as Track | null })),
    [faceScans, cropW],
  );

  // The render loop reads the latest settings through this ref, and repaints when they change.
  const live = useRef({ cues, style, out, burn, layout, panX, aspect, tracks, follow });
  const dirty = useRef(true);
  useEffect(() => {
    live.current = { cues, style, out, burn, layout, panX, aspect, tracks, follow };
    dirty.current = true;
  }, [cues, style, out, burn, layout, panX, aspect, bgUrl, tracks, follow]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) return;

      const job = exportRef.current;
      // Not gated on !paused: when the clip runs to the end of the file the video
      // pauses itself, and the recorder still has to be stopped.
      if (job && job.rec.state === 'recording' && (v.currentTime >= job.end || v.ended)) {
        v.pause();
        job.rec.stop();
      }
      if (!job && stopAtRef.current !== null && v.currentTime >= stopAtRef.current) {
        v.pause();
        stopAtRef.current = null;
      }
      if (v.paused && !dirty.current && !job) return;
      dirty.current = false;

      const L = live.current;
      const W = L.out.w;
      const H = L.out.h;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      // Follow the tracked face where a track covers this moment, else the manual pan.
      const panAt = (dw: number, dh: number) => {
        if (L.follow) {
          const t = v.currentTime;
          const tr = L.tracks.find((x) => x.track && t >= x.start - 0.05 && t <= x.end + 0.05);
          if (tr?.track) return panForCenter(trackX(tr.track, t), vw, vh, dw, dh);
        }
        return L.panX;
      };

      if (L.aspect === 'original' || L.layout === 'fill') {
        const r = coverRect(vw, vh, W, H, panAt(W, H));
        ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
      } else if (L.layout === 'fit') {
        // Blurred, darkened fill: draw tiny, then scale up with smoothing.
        const b = (blurRef.current ??= document.createElement('canvas'));
        b.width = Math.max(8, Math.round(W / 24));
        b.height = Math.max(8, Math.round(H / 24));
        const bctx = b.getContext('2d')!;
        const r = coverRect(vw, vh, b.width, b.height);
        bctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, b.width, b.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(b, 0, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, W, H);
        const k = Math.min(W / vw, H / vh);
        const dw = vw * k;
        const dh = vh * k;
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        const half = Math.round(H / 2);
        const r = coverRect(vw, vh, W, half, panAt(W, half));
        ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, half);
        const bg = bgRef.current;
        if (bg && bg.readyState >= 2 && bg.videoWidth) {
          const rb = coverRect(bg.videoWidth, bg.videoHeight, W, H - half);
          ctx.drawImage(bg, rb.sx, rb.sy, rb.sw, rb.sh, 0, half, W, H - half);
        } else {
          ctx.fillStyle = '#1c1917';
          ctx.fillRect(0, half, W, H - half);
          ctx.fillStyle = '#a8a29e';
          ctx.font = `600 ${Math.round(W / 22)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Add a background video', W / 2, half + (H - half) / 2);
        }
      }
      if (L.burn) {
        const cue = cueAt(L.cues, v.currentTime);
        if (cue && cue.text.trim()) drawCaption(ctx, cue, v.currentTime, W, H, L.style);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (bgUrl) URL.revokeObjectURL(bgUrl); }, [bgUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const wordsKey = (f: File) => `clipper:words:${f.name}:${f.size}`;

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      setError('That does not look like a video file.');
      return;
    }
    abortRef.current?.abort();
    setError('');
    setNotice('');
    setResult(null);
    setClips([]);
    setClipResults({});
    setActiveClip('');
    faceAbortRef.current?.abort();
    faceScansRef.current = [];
    setFaceScans([]);
    setFaceProgress(null);
    fileRef.current = file;
    setFileName(file.name);
    let saved: Cue[] = [];
    try { saved = JSON.parse(localStorage.getItem(`clipper:cues:${file.name}`) || '[]'); } catch { /* ignore */ }
    setCues(Array.isArray(saved) ? saved : []);
    let words: Word[] | null = null;
    try { words = JSON.parse(localStorage.getItem(wordsKey(file)) || 'null'); } catch { /* ignore */ }
    setTranscript(Array.isArray(words) ? { words } : null);
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

  const playRange = async (start: number, end: number) => {
    const v = videoRef.current;
    if (!v) return;
    await seek(v, start);
    stopAtRef.current = end;
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
    if (!cues.length) return setCues(parsed);
    setAsk({
      message: `You already have ${cues.length} subtitle(s). Replace them with the ${parsed.length} from this file, or add these to them?`,
      yesLabel: 'Replace',
      noLabel: 'Add to existing',
      onYes: () => setCues(parsed),
      onNo: () => setCues((cs) => sortCues([...cs, ...parsed])),
    });
  };

  const applyScript = () => {
    const made = distributeLines(script, clipStart, clipEnd);
    if (!made.length) return;
    const outside = cues.filter((c) => c.end <= clipStart || c.start >= clipEnd);
    const apply = () => {
      setCues(sortCues([...outside, ...made]));
      setScriptOpen(false);
      setScript('');
    };
    if (outside.length === cues.length) return apply();
    setAsk({ message: 'Replace the subtitles inside the clip with these lines?', yesLabel: 'Replace', onYes: apply });
  };

  const baseName = fileName.replace(/\.[^.]+$/, '') || 'clip';
  const clipLen = Math.max(0, clipEnd - clipStart);

  const exportSubs = async (kind: 'srt' | 'vtt') => {
    const clipped = clipCues(cues, clipStart, clipEnd);
    const text = kind === 'srt' ? toSrt(clipped) : toVtt(clipped);
    if (subtitleExport === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        setNotice(`Copied the .${kind} text. Paste it into a text file named ${baseName}-clip.${kind}.`);
      } catch {
        setError('Could not copy to the clipboard.');
      }
      return;
    }
    await saveFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${baseName}-clip.${kind}`);
  };

  const saveResult = async (r: Result, name: string) => {
    try {
      const blob = await (await fetch(r.url)).blob();
      await saveFile(blob, `${name}.${r.ext}`);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'declined') setError(`Could not save the video${code ? ` (${code})` : ''}.`);
    }
  };

  // ---- auto captions + auto clips ----
  const lengthRange = (): { min: number; max: number } => {
    if (lengthKey === 'custom') {
      const a = Math.max(3, Math.min(customMin, customMax));
      const b = Math.max(a + 1, Math.max(customMin, customMax));
      return { min: a, max: b };
    }
    const l = LENGTHS.find((x) => x.key === lengthKey)!;
    return { min: l.min, max: l.max };
  };

  const ensureTranscript = async (): Promise<TranscriptState | null> => {
    if (transcript) return transcript;
    const file = fileRef.current;
    if (!file) return null;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const t = await transcribeFile(file, model, setProgress, ac.signal, speechEngine);
      const state = { words: t.words, energy: t.energy };
      setTranscript(state);
      try { localStorage.setItem(wordsKey(file), JSON.stringify(t.words)); } catch { /* too big or blocked */ }
      return state;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        const msg = e instanceof Error ? e.message : String(e);
        setError(/fetch|network|Failed to load|import/i.test(msg)
          ? `Could not download the speech model. Check your internet connection and try again. (${msg})`
          : msg);
      }
      return null;
    } finally {
      abortRef.current = null;
    }
  };

  const applyAutoCaptions = (words: Word[]) => {
    const auto = groupCaptions(words);
    if (!auto.length) return;
    const manual = cues.some((c) => !c.words);
    if (!manual) return setCues(auto);
    setAsk({
      message: 'Replace your current subtitles with automatic captions from the speech?',
      yesLabel: 'Use auto captions',
      noLabel: 'Keep mine',
      onYes: () => setCues(auto),
    });
  };

  const selectClip = (c: AutoClip) => {
    setActiveClip(c.id);
    setClipStart(c.start);
    setClipEnd(c.end);
    seekTo(c.start + 0.01);
  };

  const isTracked = (r: Range) =>
    faceScansRef.current.some((s) => s.start <= r.start + 0.01 && s.end >= r.end - 0.01);

  /** Finds faces in any of these ranges not scanned yet, so the crop can follow them. */
  const ensureFaces = async (ranges: Range[]): Promise<boolean> => {
    if (!follow || !videoUrl) return true;
    const todo = ranges.filter((r) => !isTracked(r));
    if (!todo.length) return true;
    const ac = new AbortController();
    faceAbortRef.current = ac;
    try {
      for (let i = 0; i < todo.length; i++) {
        const r = todo[i];
        const label = todo.length > 1 ? ` (clip ${i + 1} of ${todo.length})` : '';
        setFaceProgress({ value: 0, text: `Loading face tracking…${label}` });
        const samples = await scanFaces(
          videoUrl, r.start, r.end,
          (f) => setFaceProgress({ value: f, text: `Following faces${label}… ${Math.round(f * 100)}%` }),
          ac.signal, faceLoader,
        );
        faceScansRef.current = [...faceScansRef.current, { start: r.start, end: r.end, samples }];
        setFaceScans(faceScansRef.current);
      }
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false;
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Face tracking could not run, so the crop stays where you set it. (${msg})`);
      setReframe(false);
      return true;
    } finally {
      faceAbortRef.current = null;
      setFaceProgress(null);
    }
  };

  const trackCurrentClip = async () => {
    setError('');
    setBusy('faces');
    try { await ensureFaces([{ start: clipStart, end: clipEnd }]); } finally { setBusy(''); }
  };

  const generateClips = async () => {
    setError('');
    setNotice('');
    setBusy('clips');
    try {
      const t = await ensureTranscript();
      if (!t) return;
      const { min, max } = lengthRange();
      const picked = pickClips(t.words, { count: clipCount, minDur: min, maxDur: max, duration, energy: t.energy });
      Object.values(clipResults).forEach((r) => URL.revokeObjectURL(r.url));
      setClipResults({});
      setClips(picked);
      if (!t.words.length) setNotice('No speech was found, so the clips are evenly spaced through the video.');
      else if (picked.length < clipCount) setNotice(`Only found ${picked.length} good moment(s) of that length. Try a shorter clip length for more.`);
      if (t.words.length) applyAutoCaptions(t.words);
      if (picked[0]) selectClip(picked[0]);
      setProgress(null);
      setBusy('faces');
      await ensureFaces(picked);
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const autoSubtitles = async () => {
    setError('');
    setBusy('captions');
    try {
      const t = await ensureTranscript();
      if (!t) return;
      if (!t.words.length) setNotice('No speech was found in this video.');
      else applyAutoCaptions(t.words);
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const cancelAuto = () => { abortRef.current?.abort(); faceAbortRef.current?.abort(); };

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

  /** Records [start, end] through the canvas. Resolves null if cancelled or failed. */
  const exportRange = async (start: number, end: number): Promise<Result | null> => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return null;
    stopAtRef.current = null;
    v.pause();

    const rig = ensureAudio();
    await rig.ctx.resume();
    rig.speaker.gain.value = 0; // record the sound without playing it out loud
    await seek(v, start);
    dirty.current = true;

    const fps = 30;
    const pixels = out.w * out.h;
    const bps = Math.round(Math.min(16e6, Math.max(2.5e6, pixels * fps * (quality === 'high' ? 0.2 : 0.1))));
    const videoStream = c.captureStream(fps);
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...rig.dest.stream.getAudioTracks()]);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 160_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    const job: ExportJob = { end, rec, cancelled: false };
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
    }

    if (job.cancelled || !chunks.length) return null;
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    return { url: URL.createObjectURL(blob), ext: type === 'video/mp4' ? 'mp4' : 'webm', size: blob.size };
  };

  const canExport = () => {
    if (!mime) {
      setError('This browser cannot record video. Use a recent Chrome, Edge or Safari.');
      return false;
    }
    return true;
  };

  const startExport = async () => {
    if (!canExport()) return;
    if (clipLen < 0.2) {
      setError('The clip is too short. Set a start and end first.');
      return;
    }
    setError('');
    setResult(null);
    if (!(await ensureFaces([{ start: clipStart, end: clipEnd }]))) return;
    setExporting(true);
    batchCancelRef.current = false;
    const r = await exportRange(clipStart, clipEnd);
    setExporting(false);
    if (!r) return;
    const clip = clips.find((x) => x.id === activeClip && Math.abs(x.start - clipStart) < 0.01 && Math.abs(x.end - clipEnd) < 0.01);
    if (clip) setClipResults((prev) => ({ ...prev, [clip.id]: r }));
    else setResult(r);
  };

  const exportClip = async (c: AutoClip) => {
    if (!canExport()) return;
    setError('');
    selectClip(c);
    if (!(await ensureFaces([c]))) return;
    setExporting(true);
    batchCancelRef.current = false;
    const r = await exportRange(c.start, c.end);
    setExporting(false);
    if (r) setClipResults((prev) => ({ ...prev, [c.id]: r }));
  };

  const exportAll = async () => {
    if (!canExport()) return;
    setError('');
    const todo = clips.filter((c) => !clipResults[c.id]);
    if (!(await ensureFaces(todo))) return;
    setExporting(true);
    batchCancelRef.current = false;
    setBatch({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (batchCancelRef.current) break;
      const c = todo[i];
      selectClip(c);
      const r = await exportRange(c.start, c.end);
      if (!r) break;
      setClipResults((prev) => ({ ...prev, [c.id]: r }));
      setBatch({ done: i + 1, total: todo.length });
    }
    setBatch(null);
    setExporting(false);
  };

  const downloadAll = async () => {
    for (let i = 0; i < clips.length; i++) {
      const r = clipResults[clips[i].id];
      if (r) await saveResult(r, `${baseName}-clip-${i + 1}`);
    }
  };

  const cancelExport = () => {
    batchCancelRef.current = true;
    const job = exportRef.current;
    if (!job) return;
    job.cancelled = true;
    videoRef.current?.pause();
    if (job.rec.state !== 'inactive') job.rec.stop();
  };

  const exportProgress = exporting && clipLen ? Math.min(1, Math.max(0, (current - clipStart) / clipLen)) : 0;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : '0%');
  const range = lengthRange();
  const doneCount = clips.filter((c) => clipResults[c.id]).length;
  const modelInfo = WHISPER_MODELS.find((m) => m.id === model)!;

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
        onPlay={() => { setPlaying(true); bgRef.current?.play().catch(() => {}); }}
        onPause={() => { setPlaying(false); bgRef.current?.pause(); }}
        onError={() => { if (videoUrl) setError('This browser cannot play that video format. Try an MP4 (H.264) file.'); }}
      />
      <video ref={bgRef} src={bgUrl || undefined} className="hidden" muted loop playsInline preload="auto" onLoadedData={() => { dirty.current = true; }} />

      {error && <div className="card p-3 text-sm text-red-700 border-red-200 bg-red-50">{error}</div>}
      {notice && (
        <div className="card p-3 text-sm text-emerald-800 border-emerald-200 bg-emerald-50 flex gap-3 items-start">
          <span className="flex-1">{notice}</span>
          <button className="text-emerald-700 hover:underline" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}
      {ask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="card p-5 max-w-sm w-full space-y-4">
            <p className="text-sm text-stone-800">{ask.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn btn-ghost text-sm py-1.5 px-3" onClick={() => setAsk(null)}>Cancel</button>
              {ask.noLabel && (
                <button className="btn btn-outline text-sm py-1.5 px-3" onClick={() => { ask.onNo?.(); setAsk(null); }}>{ask.noLabel}</button>
              )}
              <button className="btn btn-primary text-sm py-1.5 px-3" autoFocus onClick={() => { ask.onYes(); setAsk(null); }}>{ask.yesLabel}</button>
            </div>
          </div>
        </div>
      )}

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
          <div className="text-sm text-stone-500 mt-1">A podcast, interview, stream or talk. MP4, MOV or WebM.</div>
          <input type="file" accept="video/*" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
      ) : (
        <>
          {/* Auto clips */}
          <section className="card p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="mr-auto min-w-0">
                <h2 className="font-semibold text-lg">Auto clips</h2>
                <p className="text-sm text-stone-600">Finds the best moments, cuts them to length and adds captions from the speech.</p>
              </div>
              <div className="text-sm text-stone-500 truncate max-w-full" title={fileName}>{fileName} · {formatShort(duration)}</div>
            </div>

            <fieldset disabled={!!busy || exporting} className="grid md:grid-cols-3 gap-5">
              <div>
                <label className="label" htmlFor="clip-count">Number of clips</label>
                <div className="flex items-center gap-3">
                  <input id="clip-count" type="range" min={1} max={10} value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} className="flex-1 accent-brand-600" />
                  <span className="w-8 text-center text-lg font-semibold tabular-nums">{clipCount}</span>
                </div>
              </div>
              <div>
                <span className="label">Clip length</span>
                <div className="flex flex-wrap gap-1.5">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.key}
                      className={`btn text-sm py-1.5 px-3 ${lengthKey === l.key ? 'btn-primary' : 'btn-outline'}`}
                      aria-pressed={lengthKey === l.key}
                      onClick={() => setLengthKey(l.key)}
                    >{l.label}</button>
                  ))}
                </div>
                {lengthKey === 'custom' && (
                  <div className="flex items-center gap-2 mt-2 text-sm">
                    <input aria-label="Shortest clip in seconds" type="number" min={3} max={600} value={customMin} onChange={(e) => setCustomMin(Number(e.target.value) || 0)} className="input py-1.5 w-20" />
                    <span>to</span>
                    <input aria-label="Longest clip in seconds" type="number" min={4} max={600} value={customMax} onChange={(e) => setCustomMax(Number(e.target.value) || 0)} className="input py-1.5 w-20" />
                    <span>seconds</span>
                  </div>
                )}
              </div>
              <div>
                <label className="label" htmlFor="speech-model">Speech recognition</label>
                <select id="speech-model" className="input" value={model} onChange={(e) => { setModel(e.target.value as ModelId); }}>
                  {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.size})</option>)}
                </select>
                <p className="text-xs text-stone-500 mt-1">
                  {transcript ? `Speech already transcribed (${transcript.words.length.toLocaleString()} words).` : `${modelInfo.note}. Runs on this computer; the first run downloads the model.`}
                </p>
              </div>
            </fieldset>

            {busy ? (
              <div className="space-y-2">
                <ProgressBar value={faceProgress ? faceProgress.value : progress ? (progress.stage === 'audio' ? 0.02 : progress.value) : 0} />
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <span className="flex-1">{faceProgress?.text ?? progress?.text ?? 'Starting…'}</span>
                  <button className="btn btn-outline text-sm py-1.5 px-3" onClick={cancelAuto}>{busy === 'faces' ? 'Skip' : 'Cancel'}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {speechUnavailable && <p className="w-full text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">{speechUnavailable}</p>}
                <button className="btn btn-primary" onClick={generateClips} disabled={exporting || !duration || !!speechUnavailable}>
                  {clips.length ? 'Regenerate clips' : `Generate ${clipCount} clip${clipCount > 1 ? 's' : ''}`}
                </button>
                <span className="text-sm text-stone-500">{range.min}–{range.max}s each, captions included</span>
              </div>
            )}

            {clips.length > 0 && (
              <div className="space-y-3 border-t border-stone-200 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold mr-auto">{clips.length} clip{clips.length > 1 ? 's' : ''}, best first</h3>
                  {batch ? (
                    <>
                      <span className="text-sm text-stone-600">Exporting {Math.min(batch.done + 1, batch.total)} of {batch.total}…</span>
                      <button className="btn btn-outline text-sm py-1.5 px-3" onClick={cancelExport}>Stop</button>
                    </>
                  ) : (
                    <>
                      {doneCount < clips.length && (
                        <button className="btn btn-primary text-sm py-1.5 px-3" onClick={exportAll} disabled={exporting || !!busy}>
                          Export {doneCount ? 'the rest' : 'all'} ({clips.length - doneCount})
                        </button>
                      )}
                      {doneCount > 0 && (
                        <button className="btn btn-outline text-sm py-1.5 px-3" onClick={downloadAll} disabled={exporting}>Download all ({doneCount})</button>
                      )}
                    </>
                  )}
                </div>
                <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {clips.map((c, i) => {
                    const r = clipResults[c.id];
                    const active = c.id === activeClip;
                    return (
                      <li key={c.id} className={`rounded-lg border p-3 flex flex-col gap-2 min-w-0 ${active ? 'border-brand-500 ring-1 ring-brand-500 bg-brand-50/40' : 'border-stone-200 bg-white'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-stone-500 tabular-nums">#{i + 1}</span>
                          <ScorePill score={c.score} />
                          <span className="ml-auto text-xs text-stone-500 font-mono tabular-nums">{formatShort(c.start)}–{formatShort(c.end)} · {Math.round(c.end - c.start)}s</span>
                        </div>
                        <p className="text-sm font-medium text-stone-900 line-clamp-2" title={c.text}>{c.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                          <button className="btn btn-outline text-xs py-1 px-2.5" disabled={exporting} onClick={() => { selectClip(c); playRange(c.start, c.end); }}>▶ Preview</button>
                          <button className="btn btn-ghost text-xs py-1 px-2.5" disabled={exporting} onClick={() => { selectClip(c); editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Edit</button>
                          {r ? (
                            <button className="btn btn-primary text-xs py-1 px-2.5 ml-auto" onClick={() => saveResult(r, `${baseName}-clip-${i + 1}`)}>Download ({(r.size / 1048576).toFixed(1)} MB)</button>
                          ) : (
                            <button className="btn btn-primary text-xs py-1 px-2.5 ml-auto" disabled={exporting || !!busy} onClick={() => exportClip(c)}>Export</button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {exporting && (
                  <div>
                    <ProgressBar value={exportProgress} />
                    <div className="text-xs text-stone-500 mt-1">Recording… {Math.round(exportProgress * 100)}%. Keep this tab open and visible.</div>
                  </div>
                )}
              </div>
            )}
          </section>

          <div ref={editorRef} className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 scroll-mt-4">
            {/* Preview + timeline */}
            <div className="card p-4 space-y-4 min-w-0">
              <div className="flex items-center justify-between gap-3 text-sm">
                <h2 className="font-semibold">Editor</h2>
                <label className={`btn btn-outline text-sm py-1.5 px-3 shrink-0 ${exporting || busy ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  Change video
                  <input type="file" accept="video/*" className="sr-only" disabled={exporting || !!busy} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>

              <div className="bg-stone-900 rounded-md flex items-center justify-center overflow-hidden">
                <canvas ref={canvasRef} className="block max-w-full max-h-[62vh]" onClick={exporting ? undefined : togglePlay} />
              </div>

              <div className="relative h-9">
                <div className="absolute inset-x-0 top-3 h-3 rounded bg-stone-200" />
                {clips.map((c) => (
                  <div key={c.id} className="absolute top-3 h-3 rounded bg-stone-400/40" style={{ left: pct(c.start), width: pct(c.end - c.start) }} />
                ))}
                <div className="absolute top-3 h-3 rounded bg-brand-500/60" style={{ left: pct(clipStart), width: pct(clipLen) }} />
                {sortedCues.length < 400 && sortedCues.map((c) => (
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
                  <button className="btn btn-outline text-sm py-1.5 px-3" onClick={() => playRange(clipStart, clipEnd)}>▶ Play clip</button>
                  <button className="btn btn-ghost text-sm py-1.5 px-3" onClick={() => { setActiveClip(''); setClipStart(0); setClipEnd(duration); }}>Use whole video</button>
                </div>
              </fieldset>
            </div>

            {/* Format + style */}
            <fieldset disabled={exporting} className="space-y-6 min-w-0">
              <div className="card p-4 space-y-3">
                <h2 className="font-semibold">Frame</h2>
                <div>
                  <label className="label" htmlFor="aspect">Aspect ratio</label>
                  <select id="aspect" className="input" value={aspect} onChange={(e) => { setAspect(e.target.value as Aspect); setPanX(0); }}>
                    {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {aspect !== 'original' && (
                  <div>
                    <span className="label">Layout</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {LAYOUTS.map((l) => (
                        <button
                          key={l.value}
                          title={l.hint}
                          aria-pressed={layout === l.value}
                          className={`btn text-xs py-1.5 px-2 ${layout === l.value ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => {
                            setLayout(l.value);
                            if (l.value === 'split') setStyle((s) => ({ ...s, position: 50 }));
                          }}
                        >{l.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {aspect !== 'original' && layout === 'split' && (
                  <div>
                    <label className={`btn btn-outline text-sm py-1.5 px-3 w-full ${exporting ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                      {bgUrl ? 'Change background video' : 'Add background video'}
                      <input type="file" accept="video/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBgUrl(URL.createObjectURL(f)); e.target.value = ''; }} />
                    </label>
                    <p className="text-xs text-stone-500 mt-1">Plays muted and looped under your video, like gameplay or satisfying clips.</p>
                  </div>
                )}
                {needsReframe && !modelsUnavailable && (() => {
                  const cur = tracks.find((x) => x.start <= clipStart + 0.01 && x.end >= clipEnd - 0.01);
                  return (
                    <div className="rounded-md border border-stone-200 p-2.5 space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={reframe} onChange={(e) => setReframe(e.target.checked)} className="accent-brand-600" />
                        Auto reframe: follow faces
                      </label>
                      {reframe && (
                        faceProgress ? (
                          <div className="space-y-1">
                            <ProgressBar value={faceProgress.value} />
                            <div className="text-xs text-stone-500">{faceProgress.text}</div>
                          </div>
                        ) : cur ? (
                          <p className="text-xs text-stone-600">
                            {cur.track
                              ? `Following ${cur.track.cut.filter(Boolean).length ? 'the speaker, with cuts between people' : 'the face'} in this clip.`
                              : 'No faces found in this clip, so it uses the crop position below.'}
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs text-stone-600 flex-1 min-w-[10rem]">Faces are found automatically before export.</p>
                            <button className="btn btn-outline text-xs py-1 px-2.5" disabled={!!busy || clipLen < 0.5} onClick={trackCurrentClip}>Find faces now</button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })()}
                {aspect !== 'original' && layout !== 'fit' && (!follow || !tracks.some((x) => x.track && x.start <= clipStart + 0.01 && x.end >= clipEnd - 0.01)) && (
                  <div>
                    <label className="label" htmlFor="pan">Crop position (left ↔ right)</label>
                    <input id="pan" type="range" min={-1} max={1} step={0.01} value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-full accent-brand-600" />
                  </div>
                )}
                <div className="text-xs text-stone-500">Output: {out.w} × {out.h}</div>
              </div>

              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Caption style</h2>
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
                  <label className="label" htmlFor="cap-size">Size</label>
                  <input id="cap-size" type="range" min={3} max={12} step={0.25} value={style.size} onChange={(e) => setStyle({ ...style, size: Number(e.target.value) })} className="w-full accent-brand-600" />
                </div>
                <div>
                  <label className="label" htmlFor="cap-pos">Position (top ↕ bottom)</label>
                  <input id="cap-pos" type="range" min={5} max={95} step={1} value={style.position} onChange={(e) => setStyle({ ...style, position: Number(e.target.value) })} className="w-full accent-brand-600" />
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
                  <label className="flex items-center gap-2 col-span-2">
                    <input type="checkbox" checked={style.highlight} onChange={(e) => setStyle({ ...style, highlight: e.target.checked })} className="accent-brand-600" />
                    Highlight spoken word
                    <input type="color" value={style.highlightColor} onChange={(e) => setStyle({ ...style, highlightColor: e.target.value })} className="h-7 w-9 rounded border border-stone-300" />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={style.animate} onChange={(e) => setStyle({ ...style, animate: e.target.checked })} className="accent-brand-600" />
                    Pop in
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ ...style, uppercase: e.target.checked })} className="accent-brand-600" />
                    CAPS
                  </label>
                  <label className="flex items-center gap-2 col-span-2">
                    <input type="checkbox" checked={style.outline} onChange={(e) => setStyle({ ...style, outline: e.target.checked })} className="accent-brand-600" />
                    Outline
                    <input type="color" value={style.outlineColor} onChange={(e) => setStyle({ ...style, outlineColor: e.target.value })} className="h-7 w-9 rounded border border-stone-300" />
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
          <fieldset disabled={exporting || !!busy} className="card p-4 space-y-4 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold mr-auto">Captions <span className="text-stone-400 font-normal">({cues.length})</span></h2>
              <button className="btn btn-primary text-sm py-1.5 px-3" onClick={autoSubtitles} disabled={!!speechUnavailable} title={speechUnavailable}>{transcript ? 'Auto captions' : 'Auto captions from speech'}</button>
              <button className="btn btn-outline text-sm py-1.5 px-3" onClick={addCue}>+ Add at playhead</button>
              <button className="btn btn-outline text-sm py-1.5 px-3" onClick={() => setScriptOpen((o) => !o)}>Paste script</button>
              <label className="btn btn-outline text-sm py-1.5 px-3 cursor-pointer">
                Import .srt / .vtt
                <input type="file" accept=".srt,.vtt,text/vtt" className="sr-only" onChange={(e) => { importSubs(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button className="btn btn-outline text-sm py-1.5 px-3" disabled={!cues.length} onClick={() => exportSubs('srt')}>{subtitleExport === 'copy' ? 'Copy .srt' : 'Download .srt'}</button>
              <button className="btn btn-outline text-sm py-1.5 px-3" disabled={!cues.length} onClick={() => exportSubs('vtt')}>.vtt</button>
              <button className="btn btn-ghost text-sm py-1.5 px-3 text-red-600" disabled={!cues.length} onClick={() => setAsk({ message: `Delete all ${cues.length} caption(s)?`, yesLabel: 'Delete all', onYes: () => setCues([]) })}>Clear</button>
            </div>
            {busy === 'captions' && (
              <div className="space-y-2">
                <ProgressBar value={progress ? (progress.stage === 'audio' ? 0.02 : progress.value) : 0} />
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <span className="flex-1">{progress?.text ?? 'Starting…'}</span>
                </div>
              </div>
            )}

            {scriptOpen && (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 space-y-2">
                <p className="text-sm text-stone-600">
                  Write or paste the words, one caption per line. They are spread across the clip
                  ({formatShort(clipStart)} – {formatShort(clipEnd)}) by length; fine-tune the times afterwards.
                </p>
                <textarea className="input min-h-32" value={script} onChange={(e) => setScript(e.target.value)} placeholder={'Our new bandana collection is here\nHandmade cotton, 6 colours\nOrder now — cash on delivery'} />
                <div className="flex gap-2">
                  <button className="btn btn-primary text-sm py-1.5 px-3" onClick={applyScript} disabled={!script.trim()}>Create captions</button>
                  <button className="btn btn-ghost text-sm py-1.5 px-3" onClick={() => setScriptOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {(() => {
              // Only list the captions inside the current clip; long videos can have thousands.
              const visible = sortedCues.filter((c) => c.end > clipStart && c.start < clipEnd);
              if (!sortedCues.length) {
                return (
                  <p className="text-sm text-stone-500">
                    No captions yet. Press <b>Auto captions from speech</b>, add them by hand at the playhead,
                    paste a script, or import an .srt file.
                  </p>
                );
              }
              return (
                <>
                  <p className="text-xs text-stone-500">Showing {visible.length} caption(s) inside the current clip. Editing a caption&apos;s text turns off word highlighting for it.</p>
                  <ul className="space-y-2">
                    {visible.map((c) => {
                      const active = activeCue?.id === c.id;
                      return (
                        <li key={c.id} className={`rounded-md border p-2.5 flex flex-col sm:flex-row gap-2 ${active ? 'border-brand-500 bg-brand-50' : 'border-stone-200'}`}>
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
                            className="input flex-1 min-h-[3.25rem] text-sm"
                            value={c.text}
                            onChange={(e) => updateCue(c.id, { text: e.target.value })}
                            onFocus={() => { if (!playing) seekTo(c.start + 0.01); }}
                            placeholder="Caption text"
                          />
                          <div className="flex sm:flex-col gap-1.5 shrink-0">
                            <button className="btn btn-outline text-xs py-1 px-2" onClick={() => seekTo(c.start + 0.01)}>Go to</button>
                            <button className="btn btn-ghost text-xs py-1 px-2 text-red-600" onClick={() => removeCue(c.id)}>Delete</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            })()}
          </fieldset>

          {/* Export (manual range) */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold mr-auto">Export this clip</h2>
              <select className="input py-1.5 text-sm" style={{ width: 'auto' }} value={quality} onChange={(e) => setQuality(e.target.value as 'standard' | 'high')} disabled={exporting} aria-label="Quality">
                <option value="high">High quality</option>
                <option value="standard">Smaller file</option>
              </select>
              {exporting ? (
                <button className="btn btn-outline" onClick={cancelExport}>Cancel</button>
              ) : (
                <button className="btn btn-primary" onClick={startExport} disabled={!mime || clipLen < 0.2 || !!busy}>Export clip ({formatShort(clipLen)})</button>
              )}
            </div>
            <p className="text-xs text-stone-500">
              {mime
                ? <>Saves as <b>{mime.startsWith('video/mp4') ? 'MP4' : 'WebM'}</b>, {out.w} × {out.h}{burn && cues.length ? ', with captions burned in' : ''}. Export plays the clip once in real time; keep this tab open and visible until it finishes.</>
                : 'This browser cannot record video. Use a recent Chrome, Edge or Safari.'}
            </p>
            {exporting && !clips.length && (
              <div>
                <ProgressBar value={exportProgress} />
                <div className="text-xs text-stone-500 mt-1">Recording… {Math.round(exportProgress * 100)}%</div>
              </div>
            )}
            {result && (
              <div className="flex flex-col sm:flex-row gap-4 items-start border-t border-stone-200 pt-4">
                <video src={result.url} controls playsInline className="w-full sm:w-72 max-h-80 rounded bg-black" />
                <div className="space-y-2">
                  <div className="text-sm">Done: {(result.size / 1024 / 1024).toFixed(1)} MB {result.ext.toUpperCase()}</div>
                  <button className="btn btn-primary" onClick={() => saveResult(result, `${baseName}-clip`)}>Download video</button>
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
