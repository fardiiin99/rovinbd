// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestamp, formatShort, parseTimestamp, parseSubtitles, clipCues, toSrt, toVtt,
  cueAt, distributeLines, wrapText, cropFor, outputSize, coverRect,
} from './subtitles.ts';

test('timestamps format and parse round-trip', () => {
  assert.equal(formatTimestamp(62.5), '00:01:02,500');
  assert.equal(formatTimestamp(3725.042, '.'), '01:02:05.042');
  assert.equal(formatShort(62.5), '1:02.5');
  assert.equal(formatShort(3725), '1:02:05.0');
  assert.equal(parseTimestamp('00:01:02,500'), 62.5);
  assert.equal(parseTimestamp('1:02.5'), 62.5);
  assert.equal(parseTimestamp('7.25'), 7.25);
  assert.equal(parseTimestamp('abc'), null);
  assert.equal(parseTimestamp(''), null);
});

test('parses SRT with CRLF, BOM and tags', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nআসসালামু আলাইকুম\r\n';
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1, 2.5, 'Hello\nworld']);
  assert.equal(cues[1].text, 'আসসালামু আলাইকুম');
});

test('parses WebVTT with cue settings and skips bad cues', () => {
  const vtt = 'WEBVTT\n\nintro\n00:01.000 --> 00:02.000 align:center\nHi\n\n00:05.000 --> 00:04.000\nbackwards\n';
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 1);
  assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1, 2, 'Hi']);
});

test('clipCues shifts to clip time and trims edges', () => {
  const cues = [
    { id: 'a', start: 8, end: 12, text: 'straddles start' },
    { id: 'b', start: 15, end: 17, text: 'inside' },
    { id: 'c', start: 19, end: 25, text: 'straddles end' },
    { id: 'd', start: 30, end: 31, text: 'outside' },
  ];
  const out = clipCues(cues, 10, 20);
  assert.deepEqual(out.map((c) => [c.start, c.end]), [[0, 2], [5, 7], [9, 10]]);
});

test('SRT and VTT output', () => {
  const cues = [{ id: 'a', start: 0, end: 1.5, text: 'One' }, { id: 'b', start: 2, end: 3, text: 'Two' }];
  assert.equal(toSrt(cues), '1\n00:00:00,000 --> 00:00:01,500\nOne\n\n2\n00:00:02,000 --> 00:00:03,000\nTwo\n');
  assert.ok(toVtt(cues).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nOne'));
  // Output parses back to the same timings.
  assert.deepEqual(parseSubtitles(toSrt(cues)).map((c) => [c.start, c.end, c.text]), [[0, 1.5, 'One'], [2, 3, 'Two']]);
});

test('cueAt picks the active cue, end-exclusive', () => {
  const cues = [{ id: 'a', start: 0, end: 2, text: 'A' }, { id: 'b', start: 1, end: 3, text: 'B' }];
  assert.equal(cueAt(cues, 0.5)?.text, 'A');
  assert.equal(cueAt(cues, 1.5)?.text, 'B');
  assert.equal(cueAt(cues, 3), null);
});

test('distributeLines covers the whole range in order', () => {
  const cues = distributeLines('first line here\n\nsecond\nthird and the longest line of all', 10, 20);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 10);
  assert.equal(cues[2].end, 20);
  for (let i = 1; i < cues.length; i++) assert.ok(Math.abs(cues[i].start - cues[i - 1].end) < 0.01);
  assert.ok(cues[2].end - cues[2].start > cues[1].end - cues[1].start);
  assert.deepEqual(distributeLines('', 0, 5), []);
});

test('wrapText wraps by width and keeps newlines', () => {
  const measure = (s: string) => s.length;
  assert.deepEqual(wrapText('the quick brown fox', 10, measure), ['the quick', 'brown fox']);
  assert.deepEqual(wrapText('a\nb c', 10, measure), ['a', 'b c']);
});

test('outputSize gives social sizes from the source resolution', () => {
  assert.deepEqual(outputSize('9:16', 1920, 1080), { w: 1080, h: 1920 });
  assert.deepEqual(outputSize('1:1', 1280, 720), { w: 1280, h: 1280 });
  assert.deepEqual(outputSize('16:9', 3840, 2160), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize('original', 1281, 721), { w: 1280, h: 720 });
});

test('coverRect fills the box and pans', () => {
  const r = coverRect(1920, 1080, 1080, 960);
  assert.ok(Math.abs(r.sw / r.sh - 1080 / 960) < 1e-9);
  assert.equal(r.sh, 1080);
  assert.equal(coverRect(1920, 1080, 1080, 960, -1).sx, 0);
  assert.ok(Math.abs(coverRect(1920, 1080, 1080, 960, 1).sx + r.sw - 1920) < 1e-9);
});

test('cropFor centre-crops to the aspect with even output size', () => {
  const r = cropFor(1920, 1080, '9:16');
  assert.equal(r.sh, 1080);
  assert.ok(Math.abs(r.sw - 607.5) < 0.01);
  assert.ok(Math.abs(r.sx - (1920 - 607.5) / 2) < 0.01);
  assert.deepEqual([r.outW % 2, r.outH % 2], [0, 0]);
  assert.equal(cropFor(1920, 1080, '9:16', -1).sx, 0);
  const o = cropFor(1281, 721, 'original');
  assert.deepEqual([o.outW, o.outH], [1280, 720]);
  const sq = cropFor(1080, 1920, '1:1');
  assert.deepEqual([sq.sw, sq.sh, sq.sy], [1080, 1080, 420]);
});
