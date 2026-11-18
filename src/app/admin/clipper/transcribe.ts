// In-browser speech-to-text with Whisper (transformers.js), run in a Web Worker so the
// page stays responsive. The library and model download from public CDNs on first use
// and are cached by the browser after that. Nothing is uploaded.

import { cleanWords, computeEnergy, quietCuts, spreadWords, type Energy } from '@/lib/autoclip';
import type { Word } from '@/lib/subtitles';

export const WHISPER_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Fast', size: '≈ 40 MB download', note: 'quickest, a few more mistakes' },
  { id: 'Xenova/whisper-base.en', label: 'Balanced', size: '≈ 80 MB download', note: 'good accuracy for most videos' },
  { id: 'Xenova/whisper-small.en', label: 'Accurate', size: '≈ 250 MB download', note: 'best accuracy, slowest' },
] as const;

export type ModelId = (typeof WHISPER_MODELS)[number]['id'];

export type Stage = 'audio' | 'model' | 'speech';
export type Progress = { stage: Stage; value: number; text: string };

/** Turns 16 kHz mono audio into words. Swappable so tests can run without the real model. */
export type SpeechEngine = (
  audio: Float32Array,
  cuts: number[],
  model: ModelId,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
) => Promise<Word[]>;

export const SAMPLE_RATE = 16000;
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

/** Decodes a video's soundtrack to 16 kHz mono samples. */
export async function decodeAudio(file: Blob): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC({ sampleRate: SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(buf);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const out = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / audio.numberOfChannels;
    }
    return out;
  } catch {
    throw new Error('Could not read any sound from this video. Does it have an audio track?');
  } finally {
    ctx.close().catch(() => {});
  }
}

// Runs inside the worker. Kept as plain JS text so no bundler setup is needed.
const WORKER_SOURCE = `
let lib = null, asr = null, loaded = '';
const post = (m) => self.postMessage(m);
async function load(model) {
  if (asr && loaded === model) return asr;
  lib = lib || await import(${JSON.stringify(LIB_URL)});
  lib.env.allowLocalModels = false;
  asr = await lib.pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress_total') post({ type: 'model', value: (p.progress || 0) / 100, loaded: p.loaded, total: p.total });
    },
  });
  loaded = model;
  return asr;
}
self.onmessage = async (e) => {
  const { audio, cuts, model, rate } = e.data;
  try {
    post({ type: 'model', value: 0 });
    const run = await load(model);
    post({ type: 'ready' });
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const piece = audio.subarray(Math.floor(a * rate), Math.floor(b * rate));
      if (piece.length < rate * 0.3) continue;
      let out, word = true;
      try {
        out = await run(piece, { return_timestamps: 'word' });
      } catch (err) {
        word = false;
        out = await run(piece, { return_timestamps: true });
      }
      const chunks = (out.chunks || []).map((c) => ({
        text: c.text,
        start: a + (c.timestamp[0] ?? 0),
        end: a + (c.timestamp[1] ?? (b - a)),
      }));
      post({ type: 'piece', index: i, of: cuts.length - 1, chunks, word });
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: String(err && err.message || err) });
  }
};
`;

/** The real engine: Whisper in a module Web Worker. */
export const whisperEngine: SpeechEngine = (audio, cuts, model, onProgress, signal) =>
  new Promise<Word[]>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    URL.revokeObjectURL(url);
    const words: Word[] = [];
    const finish = (fn: () => void) => { worker.terminate(); signal.removeEventListener('abort', onAbort); fn(); };
    const onAbort = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    signal.addEventListener('abort', onAbort);
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'The speech model failed to start.')));
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'model') {
        const mb = m.total ? ` (${Math.round(m.loaded / 1e6)} of ${Math.round(m.total / 1e6)} MB)` : '';
        onProgress({ stage: 'model', value: m.value, text: `Downloading the speech model${mb}. This happens once; it is cached after.` });
      } else if (m.type === 'ready') {
        onProgress({ stage: 'speech', value: 0, text: 'Listening to the video…' });
      } else if (m.type === 'piece') {
        for (const c of m.chunks as { text: string; start: number; end: number }[]) {
          if (m.word) words.push({ text: c.text, start: c.start, end: c.end });
          else words.push(...spreadWords(c.text, c.start, c.end));
        }
        onProgress({ stage: 'speech', value: (m.index + 1) / m.of, text: `Listening to the video… ${Math.round(((m.index + 1) / m.of) * 100)}%` });
      } else if (m.type === 'done') {
        finish(() => resolve(words));
      } else if (m.type === 'error') {
        finish(() => reject(new Error(`Speech recognition failed: ${m.message}`)));
      }
    };
    // Copy so the caller keeps its samples for scoring.
    const copy = audio.slice();
    worker.postMessage({ audio: copy, cuts, model, rate: SAMPLE_RATE }, [copy.buffer]);
  });

export type Transcript = { words: Word[]; energy: Energy; duration: number };

/** Full pipeline: decode sound, split at quiet points, recognise speech. */
export async function transcribeFile(
  file: Blob,
  model: ModelId,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
  engine: SpeechEngine = whisperEngine,
): Promise<Transcript> {
  onProgress({ stage: 'audio', value: 0, text: 'Reading the soundtrack…' });
  const audio = await decodeAudio(file);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const duration = audio.length / SAMPLE_RATE;
  const energy = computeEnergy(audio, SAMPLE_RATE, 0.1);
  const cuts = quietCuts(energy, duration, 28, 6);
  onProgress({ stage: 'audio', value: 1, text: 'Soundtrack ready.' });
  const words = cleanWords(await engine(audio, cuts, model, onProgress, signal));
  return { words, energy, duration };
}
