// Automatic clipping and captioning from a word-level transcript. Pure functions, no DOM,
// so they run in Node tests. Times are seconds on the source video.

import { newCueId, type Cue, type Word } from './subtitles.ts';
import { clipTitle } from './clipmeta.ts';

export type Sentence = { start: number; end: number; text: string; words: Word[] };

export type AutoClip = {
  id: string;
  start: number;
  end: number;
  /** 0–100: how likely this is to work as a stand-alone short. */
  score: number;
  title: string;
  text: string;
};

const END_PUNCT = /[.?!…]["')\]]*$/;
const FILLER_START = /^(so|and|but|um+|uh+|like|or|because|then|well|yeah|okay|ok)\b/i;
const HOOK_WORDS =
  /\b(how|why|what|secret|never|always|mistake|truth|best|worst|stop|need|must|biggest|first|most|only|nobody|everyone|crazy|insane|money|free|hack|tip|easy|fast|you)\b/i;

/** Normalises raw recogniser words: trims, drops empties and fixes zero/negative lengths. */
export function cleanWords(raw: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of raw) {
    const text = w.text.trim();
    if (!text || !Number.isFinite(w.start)) continue;
    const start = Math.max(0, w.start);
    const end = Number.isFinite(w.end) && w.end > start ? w.end : start + 0.2;
    out.push({ text, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Splits words into sentences at end punctuation or pauses longer than `gap` seconds. */
export function segmentSentences(words: Word[], gap = 0.8): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || END_PUNCT.test(w.text) || next.start - w.end > gap) flush();
  });
  flush();
  return out;
}

export type CaptionOptions = { maxWords?: number; maxChars?: number; maxDur?: number };

/**
 * Groups words into short caption cues (social style: a few words at a time).
 * Breaks after punctuation, on pauses, or when a group gets too long.
 */
export function groupCaptions(words: Word[], opts: CaptionOptions = {}): Cue[] {
  const maxWords = opts.maxWords ?? 3;
  const maxChars = opts.maxChars ?? 22;
  const maxDur = opts.maxDur ?? 1.6;
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({
      id: newCueId(),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
      words: cur,
    });
    cur = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    cur.push(w);
    const chars = cur.map((x) => x.text).join(' ').length;
    const nextChars = next ? chars + 1 + next.text.length : 0;
    if (
      !next ||
      cur.length >= maxWords ||
      nextChars > maxChars ||
      next.end - cur[0].start > maxDur ||
      /[.,?!;:…]$/.test(w.text) ||
      next.start - w.end > 0.5
    ) flush();
  });
  // Close tiny gaps so captions don't flicker off between groups.
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = cues[i + 1].start - cues[i].end;
    if (gap > 0 && gap < 0.35) cues[i].end = cues[i + 1].start;
  }
  return cues;
}

/** Loudness envelope: one RMS value per `hop` seconds. */
export type Energy = { hop: number; values: ArrayLike<number> };

function meanEnergy(e: Energy, start: number, end: number) {
  const a = Math.max(0, Math.floor(start / e.hop));
  const b = Math.min(e.values.length, Math.ceil(end / e.hop));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += e.values[i];
  return s / (b - a);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  const cut = t.length > 70 ? `${t.slice(0, 67).replace(/\s+\S*$/, '')}…` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Scores one candidate window made of whole sentences. */
export function scoreWindow(sents: Sentence[], energy?: Energy, overallEnergy = 0): number {
  const start = sents[0].start;
  const end = sents[sents.length - 1].end;
  const dur = Math.max(0.1, end - start);
  const words = sents.flatMap((s) => s.words);

  // Talking pace: ~2.2–3.8 words/s is lively speech; slower usually means dead air.
  const wps = words.length / dur;
  const pace = clamp01(1 - Math.abs(wps - 3) / 2.2);

  // Silence inside the clip.
  let silent = 0;
  for (let i = 1; i < words.length; i++) silent += Math.max(0, words[i].start - words[i - 1].end - 0.25);
  const flow = clamp01(1 - silent / dur / 0.35);

  // Hook: the opening sentence should grab attention and not start mid-thought.
  const first = sents[0].text;
  let hook = 0.35;
  if (/\?/.test(first)) hook += 0.3;
  if (HOOK_WORDS.test(first)) hook += 0.25;
  if (/\d/.test(first)) hook += 0.1;
  if (FILLER_START.test(first)) hook -= 0.35;
  hook = clamp01(hook);

  // Ending on a finished sentence feels complete.
  const lastWord = words[words.length - 1]?.text ?? '';
  const ending = END_PUNCT.test(lastWord) ? 1 : 0.4;

  // Emphasis anywhere: questions, exclamations, numbers.
  const all = sents.map((s) => s.text).join(' ');
  const emphasis = clamp01(((all.match(/[?!]/g)?.length ?? 0) * 0.25) + ((all.match(/\d/g)?.length ?? 0) > 0 ? 0.25 : 0));

  let energyScore = 0.5;
  if (energy && overallEnergy > 0) energyScore = clamp01((meanEnergy(energy, start, end) / overallEnergy - 0.6) / 0.8);

  const score = pace * 0.22 + flow * 0.18 + hook * 0.25 + ending * 0.1 + emphasis * 0.1 + energyScore * 0.15;
  return Math.round(clamp01(score) * 100);
}

export type PickOptions = {
  count: number;
  minDur: number;
  maxDur: number;
  /** Video length; used when there is no speech to fall back to even spacing. */
  duration: number;
  energy?: Energy;
};

/**
 * Picks up to `count` non-overlapping clips between minDur and maxDur seconds, each made of
 * whole sentences, best first.
 */
export function pickClips(words: Word[], opts: PickOptions): AutoClip[] {
  const { count, minDur, maxDur, duration, energy } = opts;
  const sents = segmentSentences(cleanWords(words));
  if (!sents.length) return evenClips(duration, count, (minDur + maxDur) / 2);

  const overall = energy && energy.values.length
    ? Array.from(energy.values).reduce((a, b) => a + b, 0) / energy.values.length
    : 0;
  const target = (minDur + maxDur) / 2;

  type Cand = { start: number; end: number; score: number; sents: Sentence[] };
  const cands: Cand[] = [];
  for (let i = 0; i < sents.length; i++) {
    let best: Cand | null = null;
    // Every valid window is a candidate (not just the best per start), so shorter
    // windows can still fill gaps between the top picks.
    for (let j = i; j < sents.length; j++) {
      const start = Math.max(0, sents[i].start - 0.15);
      const end = Math.min(duration || Infinity, sents[j].end + 0.35);
      const len = end - start;
      if (len > maxDur) break;
      if (len < minDur) continue;
      const window = sents.slice(i, j + 1);
      // Prefer lengths near the target as a tie-breaker.
      const score = scoreWindow(window, energy, overall) - Math.abs(len - target) / Math.max(1, target) * 6;
      const cand = { start, end, score, sents: window };
      cands.push(cand);
      if (!best || score > best.score) best = cand;
    }
    // A single sentence longer than maxDur: cut it at the word nearest the target length.
    if (!best && sents[i].end - sents[i].start > maxDur) {
      const ws = sents.slice(i).flatMap((s) => s.words);
      const startT = ws[0].start;
      let cut = ws.findIndex((w) => w.end - startT >= target);
      if (cut < 0) cut = ws.length - 1;
      const piece = ws.slice(0, cut + 1);
      const end = piece[piece.length - 1].end + 0.2;
      if (end - startT >= minDur) {
        const sent = { start: startT, end, text: piece.map((w) => w.text).join(' '), words: piece };
        cands.push({ start: Math.max(0, startT - 0.15), end, score: scoreWindow([sent], energy, overall) - 8, sents: [sent] });
      }
    }
  }

  if (!cands.length) {
    // Speech too short for the requested length: use what there is.
    const start = Math.max(0, sents[0].start - 0.15);
    const end = Math.min(duration || Infinity, sents[sents.length - 1].end + 0.35);
    const text = sents.map((s) => s.text).join(' ');
    return [{ id: newCueId(), start, end, score: scoreWindow(sents, energy, overall), title: clipTitle(text) || titleFrom(sents[0].text), text }];
  }

  cands.sort((a, b) => b.score - a.score);
  const chosen: Cand[] = [];
  for (const c of cands) {
    if (chosen.length >= count) break;
    if (chosen.some((o) => c.start < o.end + 0.5 && o.start < c.end + 0.5)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => ({
    id: newCueId(),
    start: round2(c.start),
    end: round2(c.end),
    score: Math.max(1, Math.min(99, Math.round(c.score))),
    title: clipTitle(c.sents.map((s) => s.text).join(' ')) || titleFrom(c.sents[0].text),
    text: c.sents.map((s) => s.text).join(' '),
  }));
}

/** Evenly spaced clips, for videos with no detectable speech. */
export function evenClips(duration: number, count: number, len: number): AutoClip[] {
  if (!(duration > 0) || count < 1) return [];
  const l = Math.min(len, duration);
  const n = Math.max(1, Math.min(count, Math.floor(duration / l)));
  const step = n > 1 ? (duration - l) / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => ({
    id: newCueId(),
    start: round2(i * step),
    end: round2(i * step + l),
    score: 50,
    title: `Clip ${i + 1}`,
    text: '',
  }));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Picks cut points for splitting long audio into pieces of at most `maxLen` seconds,
 * placing each cut at the quietest moment in the last few seconds of the piece so
 * words aren't chopped in half.
 */
export function quietCuts(energy: Energy, duration: number, maxLen = 28, search = 6): number[] {
  const cuts: number[] = [0];
  let t = 0;
  while (duration - t > maxLen) {
    const from = t + maxLen - search;
    const to = t + maxLen;
    let bestT = to;
    let bestV = Infinity;
    for (let x = from; x <= to; x += energy.hop) {
      const i = Math.floor(x / energy.hop);
      const v = energy.values[i] ?? Infinity;
      if (v < bestV) { bestV = v; bestT = x; }
    }
    t = Math.max(t + 1, bestT);
    cuts.push(round2(t));
  }
  cuts.push(duration);
  return cuts;
}

/** RMS loudness per `hop` seconds of mono samples. */
export function computeEnergy(samples: Float32Array, sampleRate: number, hop = 0.1): Energy {
  const size = Math.max(1, Math.round(sampleRate * hop));
  const n = Math.ceil(samples.length / size);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * size;
    const b = Math.min(samples.length, a + size);
    for (let k = a; k < b; k++) s += samples[k] * samples[k];
    values[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { hop, values };
}

/** Splits a timed text chunk into words with evenly shared timings (fallback when word timings fail). */
export function spreadWords(text: string, start: number, end: number): Word[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  let t = start;
  return parts.map((p) => {
    const d = ((p.length + 1) / total) * Math.max(0.1, end - start);
    const w = { text: p, start: round2(t), end: round2(t + d) };
    t += d;
    return w;
  });
}
