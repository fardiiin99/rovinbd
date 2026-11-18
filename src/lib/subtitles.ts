// Pure helpers for the admin video clipper: subtitle cues, SRT/VTT parsing and
// formatting, text wrapping and crop geometry. No DOM access so it can be tested
// with Node's built-in runner.

export type Word = { text: string; start: number; end: number };

/** A subtitle. `words` (absolute times) is set for auto captions and drives word-by-word highlighting. */
export type Cue = { id: string; start: number; end: number; text: string; words?: Word[] };

let idCounter = 0;
export function newCueId(): string {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter}`;
}

/** 62.5 → "00:01:02,500" (SRT) or "00:01:02.500" (VTT). */
export function formatTimestamp(sec: number, sep: ',' | '.' = ','): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(rest, 3)}`;
}

/** Short editor format: 62.5 → "1:02.5", 3725 → "1:02:05.0". */
export function formatShort(sec: number): string {
  const t = Math.max(0, sec);
  const tenths = Math.round(t * 10);
  const h = Math.floor(tenths / 36_000);
  const m = Math.floor((tenths % 36_000) / 600);
  const s = (tenths % 600) / 10;
  const ss = s.toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Accepts "HH:MM:SS,mmm", "HH:MM:SS.mmm", "MM:SS.s", "SS.s". Returns null if invalid. */
export function parseTimestamp(input: string): number | null {
  const str = input.trim().replace(',', '.');
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(str)) return null;
  const parts = str.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const ARROW = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/** Parses SRT or WebVTT text into cues (absolute times as written in the file). */
export function parseSubtitles(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex((l) => ARROW.test(l));
    if (idx === -1) continue;
    const m = lines[idx].match(ARROW)!;
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(idx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // strip <i>, <b>, <c.class> tags
      .trim();
    if (!body) continue;
    cues.push({ id: newCueId(), start, end, text: body });
  }
  return sortCues(cues);
}

export function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Cues that overlap [start, end], shifted so the clip starts at 0 and trimmed to the clip. */
export function clipCues(cues: Cue[], start: number, end: number): Cue[] {
  return sortCues(cues)
    .filter((c) => c.end > start && c.start < end && c.text.trim())
    .map((c) => ({
      ...c,
      start: Math.max(0, c.start - start),
      end: Math.min(end, c.end) - start,
    }));
}

export function toSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text.trim()}\n`)
    .join('\n');
}

export function toVtt(cues: Cue[]): string {
  const body = cues
    .map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text.trim()}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** The cue to show at time t (the latest-starting one if several overlap). */
export function cueAt(cues: Cue[], t: number): Cue | null {
  let found: Cue | null = null;
  for (const c of cues) {
    if (t >= c.start && t < c.end && (!found || c.start >= found.start)) found = c;
  }
  return found;
}

/**
 * Turns a pasted script (one subtitle per line, blank lines ignored) into cues spread
 * across [start, end], each line getting time proportional to its length.
 */
export function distributeLines(script: string, start: number, end: number): Cue[] {
  const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const total = end - start;
  if (!lines.length || total <= 0) return [];
  // Short lines still need a minimum reading weight.
  const weights = lines.map((l) => Math.max(8, l.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return lines.map((text, i) => {
    const dur = (weights[i] / sum) * total;
    const cue = { id: newCueId(), start: round3(t), end: round3(i === lines.length - 1 ? end : t + dur), text };
    t += dur;
    return cue;
  });
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Word-wraps text to maxWidth using the supplied measure function; keeps explicit newlines. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = words[0];
    for (const w of words.slice(1)) {
      const next = `${line} ${w}`;
      if (measure(next) <= maxWidth) line = next;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export type Aspect = 'original' | '9:16' | '1:1' | '4:5' | '16:9';

export const ASPECTS: { value: Aspect; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '9:16', label: '9:16 (Reels / TikTok / Shorts)' },
  { value: '4:5', label: '4:5 (Instagram feed)' },
  { value: '1:1', label: '1:1 (Square)' },
  { value: '16:9', label: '16:9 (YouTube)' },
];

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Output frame size for an aspect: the long side matches the source's long side
 * (capped at 1920, so a 1080p video gives a 1080×1920 vertical), always even.
 */
export function outputSize(aspect: Aspect, srcW: number, srcH: number) {
  if (aspect === 'original' || !srcW || !srcH) return { w: even(srcW || 2), h: even(srcH || 2) };
  const [aw, ah] = aspect.split(':').map(Number);
  const ratio = aw / ah;
  const long = Math.min(1920, Math.max(srcW, srcH));
  return ratio < 1 ? { w: even(long * ratio), h: even(long) } : { w: even(long), h: even(long / ratio) };
}

/** Source rectangle that fills a dstW×dstH box ("cover"), sliding horizontally by panX in [-1, 1]. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number, panX = 0) {
  const target = dstW / dstH;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > target) sw = srcH * target;
  else sh = srcW / target;
  const pan = Math.max(-1, Math.min(1, panX));
  return { sx: ((srcW - sw) / 2) * (1 + pan), sy: (srcH - sh) / 2, sw, sh };
}

/**
 * Centre-crop region of the source for the chosen aspect, plus the output size
 * (even numbers, as video encoders require). panX in [-1, 1] slides the crop horizontally.
 */
export function cropFor(srcW: number, srcH: number, aspect: Aspect, panX = 0) {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  if (aspect === 'original' || !srcW || !srcH) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, outW: even(srcW), outH: even(srcH) };
  }
  const [aw, ah] = aspect.split(':').map(Number);
  const target = aw / ah;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > target) sw = srcH * target;
  else sh = srcW / target;
  const pan = Math.max(-1, Math.min(1, panX));
  const sx = ((srcW - sw) / 2) * (1 + pan);
  const sy = (srcH - sh) / 2;
  return { sx, sy, sw, sh, outW: even(sw), outH: even(sh) };
}
